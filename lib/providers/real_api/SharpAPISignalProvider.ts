/**
 * SharpAPISignalProvider — ISharpSignalProvider implementation backed by
 * SharpAPI. Phase 1 (Gate B.1).
 *
 * Verified by Gate A probe — /opportunities/ev confirmed Pinnacle EV math
 * (pinnacle_fair_probability + fair_odds + ev_pct + devig_method="POWER").
 * /opportunities/low_hold and /opportunities/arbitrage also work; both are
 * fetched as secondary context, deduplicated with /opportunities/ev rows
 * taking precedence.
 *
 * Strict NULL discipline on gap fields per Gate B framework decisions:
 *   • has_steam_move      → false (SharpAPI does NOT expose steam)
 *   • steam_books_count   → null
 *   • steam_detected_at   → null
 *   • has_reverse_line_movement → false (SharpAPI does NOT expose RLM)
 *   • rlm_direction       → null
 *   • public_betting_pct  → null  (SharpAPI does NOT expose public splits)
 *   • public_money_pct    → null
 *   • signal_strength     → null  (derived downstream by classifier)
 *   • signal_summary      → null  (generated downstream by summaryGenerator)
 *
 * Same bridge problem as SharpAPIOddsProvider — uses an injected resolver
 * to map SharpAPI events to BDL integer game external_ids.
 */

import type { Sport } from "../../types/domain/Sport";
import type { MarketType, Side } from "../../types/domain/Lines";
import type {
  ISharpSignalProvider,
  SharpSignalRecord,
} from "../interfaces/ISharpSignalProvider";
import { SharpApiClient, SharpApiNotFoundError } from "./_sharpApiClient";
import {
  normalizeMlbTeamName,
  type MlbTeamAbbrev,
} from "./_teamNameNormalizer";
import type { SharpApiGameResolver } from "./SharpAPIOddsProvider";

/** Hard cap on SharpAPI calls per getSharpSignals invocation. */
const MAX_CALLS_PER_INVOCATION = 8;

// ─────────────────────────────────────────────────────────────
// Raw shapes
// ─────────────────────────────────────────────────────────────

type RawOpportunity = {
  event_id?: string | number | null;
  sport?: string | null;
  league?: string | null;
  home_team?: string | null;
  away_team?: string | null;
  market_type?: string | null;
  market?: string | null;
  selection?: string | null;
  selection_type?: string | null;
  side?: string | null;
  pinnacle_fair_probability?: number | string | null;
  partner_fair_probability?: number | string | null;
  fair_probability?: number | string | null;
  fair_odds?: number | string | null;
  no_vig_odds?: number | string | null;
  ev_pct?: number | string | null;
  ev_percent?: number | string | null;
  ev_percentage?: number | string | null;
  edge?: number | string | null;
  detected_at?: string | null;
  is_player_prop?: boolean | null;
  is_alternate_line?: boolean | null;
};

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function asNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function asStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

/**
 * Map SharpAPI market_type strings to our internal MarketType union.
 *
 * Phase 1.5 correction (Task #162): SharpAPI returns specific names
 * observed in the live data:
 *   - "moneyline" / "h2h"          → moneyline
 *   - "total_runs" / "total"       → total
 *   - "run_line" / "runline"       → spread
 *   - "first_inning_total"         → first_inning_total (true 1-inning O/U)
 *
 * Intentionally NOT mapped to first_inning_total:
 *   - "1st_5_innings_total_runs" / "f5" — that's the FIRST 5 INNINGS market,
 *     not the first inning. Different market; would mis-grade NRFI picks.
 *
 * Intentionally skipped (return null → caller drops the row):
 *   - team_total            (per-team runs O/U; not a V1 market)
 *   - player props          (no Player Props in V1)
 *   - alternate lines       (alt totals/spreads; ignore non-main lines)
 *   - F5 / first 5 innings  (different market than first_inning)
 *   - outright / futures / championship
 */
function mapMarketType(raw: string | null): MarketType | null {
  if (raw === null) return null;
  const v = raw.toLowerCase().trim();
  if (v === "h2h" || v === "moneyline" || v === "ml") return "moneyline";
  if (v === "total" || v === "totals" || v === "total_runs" || v === "over_under" || v === "ou") {
    return "total";
  }
  if (v === "spread" || v === "spreads" || v === "runline" || v === "run_line") {
    return "spread";
  }
  if (v === "first_inning_total" || v === "1st_inning_total") {
    return "first_inning_total";
  }
  // Everything else (team_total, player props, alternate lines, F5,
  // futures, championships) → skip.
  return null;
}

function mapSide(
  rawSelection: string | null,
  rawSide: string | null,
  marketType: MarketType,
  homeAbbrev: MlbTeamAbbrev,
  awayAbbrev: MlbTeamAbbrev
): Side | null {
  const explicit = asStringOrNull(rawSide);
  if (explicit !== null) {
    const v = explicit.toLowerCase();
    if (v === "home" || v === "away" || v === "over" || v === "under" || v === "yes" || v === "no") {
      return v;
    }
  }
  const selection = asStringOrNull(rawSelection);
  if (selection === null) return null;
  const sel = selection.toLowerCase();

  if (marketType === "total" || marketType === "first_inning_total") {
    if (sel.includes("over") || sel === "o") return "over";
    if (sel.includes("under") || sel === "u") return "under";
    return null;
  }

  const abbrev = normalizeMlbTeamName(selection);
  if (abbrev === null) return null;
  if (abbrev === homeAbbrev) return "home";
  if (abbrev === awayAbbrev) return "away";
  return null;
}

function buildDedupeKey(
  gameExternalId: number,
  marketType: MarketType,
  side: Side
): string {
  return `${gameExternalId}::${marketType}::${side}`;
}

/**
 * Maps a /opportunities/* row to a SharpSignalRecord. Returns null when
 * the row can't be confidently mapped (e.g., team unresolved, market
 * type unsupported).
 *
 * `source` controls is_plus_ev: /opportunities/ev rows are +EV by
 * definition; /opportunities/low_hold and /opportunities/arbitrage rows
 * carry no +EV semantic.
 */
async function mapOpportunity(
  row: RawOpportunity,
  source: "ev" | "low_hold" | "arbitrage",
  sportKey: Sport,
  date: string,
  resolveGame: SharpApiGameResolver,
  fallbackComputedAt: string
): Promise<SharpSignalRecord | null> {
  // Phase 1.5 correction (Task #162): SharpAPI tags game-level opportunities
  // as is_player_prop=false and is_alternate_line=false. Skip player prop
  // rows (no Player Props in V1) and alternate-line rows (we only ingest the
  // main line per market for V1).
  if (row.is_player_prop === true) return null;
  if (row.is_alternate_line === true) return null;

  const homeAbbrev = normalizeMlbTeamName(row.home_team);
  const awayAbbrev = normalizeMlbTeamName(row.away_team);
  if (homeAbbrev === null || awayAbbrev === null) return null;

  const marketType = mapMarketType(asStringOrNull(row.market_type ?? row.market));
  if (marketType === null) return null;

  const side = mapSide(
    asStringOrNull(row.selection),
    asStringOrNull(row.side ?? row.selection_type),
    marketType,
    homeAbbrev,
    awayAbbrev
  );
  if (side === null) return null;

  const gameExternalId = await resolveGame(
    sportKey,
    date,
    homeAbbrev,
    awayAbbrev
  );
  if (gameExternalId === null) return null;

  // Phase 1.5: SharpAPI exposes both pinnacle_fair_probability and
  // partner_fair_probability on /opportunities/ev rows. partner_* refers to
  // the sharp-book partner (Pinnacle in practice; sharp_book="pinnacle"
  // observed). Prefer pinnacle_* when explicitly named; fall back to
  // partner_* then generic fair_probability.
  const pinnacleProb =
    asNumberOrNull(row.pinnacle_fair_probability) ??
    asNumberOrNull(row.partner_fair_probability) ??
    asNumberOrNull(row.fair_probability);

  const evPct =
    asNumberOrNull(row.ev_pct) ??
    asNumberOrNull(row.ev_percent) ??
    asNumberOrNull(row.ev_percentage) ??
    asNumberOrNull(row.edge);

  return {
    game_external_id: gameExternalId,
    market_type: marketType,
    side,
    pinnacle_fair_probability: pinnacleProb,
    is_plus_ev: source === "ev",
    ev_pct: evPct,
    has_steam_move: false,
    steam_detected_at: null,
    steam_books_count: null,
    has_reverse_line_movement: false,
    rlm_direction: null,
    public_betting_pct: null,
    public_money_pct: null,
    signal_strength: null,
    signal_summary: null,
    computed_at: asStringOrNull(row.detected_at) ?? fallbackComputedAt,
  };
}

// ─────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────

export class SharpAPISignalProvider implements ISharpSignalProvider {
  private readonly client: SharpApiClient;
  private readonly resolveGame: SharpApiGameResolver;

  constructor(apiKey: string, resolveGame: SharpApiGameResolver) {
    this.client = new SharpApiClient(apiKey);
    this.resolveGame = resolveGame;
  }

  /** Test/diagnostic accessor — never called by services. */
  getClient(): SharpApiClient {
    return this.client;
  }

  async getSharpSignals(
    date: string,
    gameExternalId?: number
  ): Promise<SharpSignalRecord[]> {
    const sportKey: Sport = "mlb";
    const fallbackComputedAt = new Date().toISOString();
    const seen = new Map<string, SharpSignalRecord>();

    // Fetch order matters for dedup: /opportunities/ev FIRST so its rows
    // become the precedent. Subsequent low_hold/arbitrage rows for the
    // same (game, market, side) are skipped — preserves EV's richer data
    // (pinnacle_fair_probability, ev_pct, is_plus_ev=true).
    const endpoints: Array<{
      path: string;
      source: "ev" | "low_hold" | "arbitrage";
    }> = [
      { path: "/opportunities/ev", source: "ev" },
      { path: "/opportunities/low_hold", source: "low_hold" },
      { path: "/opportunities/arbitrage", source: "arbitrage" },
    ];

    let callsUsed = 0;
    for (const { path, source } of endpoints) {
      if (callsUsed >= MAX_CALLS_PER_INVOCATION) {
        console.warn(
          `[SharpAPISignalProvider] call cap (${MAX_CALLS_PER_INVOCATION}) reached at ${path} — returning partial`
        );
        break;
      }
      callsUsed++;
      let rows: RawOpportunity[];
      try {
        rows = await this.client.fetchAll<RawOpportunity>({
          path,
          query: { sport: "mlb" },
          maxPages: 2,
        });
      } catch (e) {
        if (e instanceof SharpApiNotFoundError) {
          rows = [];
        } else {
          throw e;
        }
      }

      for (const row of rows) {
        // Phase 1.5 correction (Task #162): SharpAPI tags game rows as
        // sport="baseball" + league="mlb". The earlier sport==="mlb" check
        // rejected every row. Filter on league instead. Fall through if
        // league is missing (defense — let downstream team-name mapping
        // decide), but skip explicit non-mlb leagues (college_baseball,
        // kbo, npb, etc.).
        const leagueTag = asStringOrNull(row.league)?.toLowerCase();
        if (leagueTag !== null && leagueTag !== "mlb") {
          continue;
        }
        const record = await mapOpportunity(
          row,
          source,
          sportKey,
          date,
          this.resolveGame,
          fallbackComputedAt
        );
        if (record === null) continue;
        if (
          gameExternalId !== undefined &&
          record.game_external_id !== gameExternalId
        ) {
          continue;
        }
        const key = buildDedupeKey(
          record.game_external_id,
          record.market_type,
          record.side
        );
        if (!seen.has(key)) {
          seen.set(key, record);
        }
        // Else: keep the earlier (higher-precedence) record. /opportunities/ev
        // rows land first; low_hold/arbitrage duplicates are dropped.
      }
    }

    return Array.from(seen.values());
  }
}
