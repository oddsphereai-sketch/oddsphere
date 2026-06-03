/**
 * SharpAPISignalProvider — ISharpSignalProvider implementation backed by
 * SharpAPI. Phase 1 (Gate B.1) + Phase 1.5 (Task #162 corrections) +
 * Phase 1.6 (/splits integration — Task #172).
 *
 * Data sources:
 *   • /opportunities/ev          — Pinnacle EV math (primary)
 *   • /opportunities/low_hold    — secondary low-vig context
 *   • /opportunities/arbitrage   — secondary arbitrage context
 *   • /splits?sport=mlb          — Phase 1.6: public betting % + public
 *                                  money % across moneyline / spread /
 *                                  total markets. Consensus aggregate
 *                                  (sportsbook="consensus"). Available
 *                                  on the Sharp $399 tier; confirmed
 *                                  via /account.features list.
 *
 * Strict discipline on framework gap fields:
 *   • has_steam_move      → false (SharpAPI does NOT expose steam in
 *                                  Sharp tier)
 *   • steam_books_count   → null
 *   • steam_detected_at   → null
 *   • has_reverse_line_movement → false (SharpAPI does NOT expose RLM)
 *   • rlm_direction       → null
 *   • signal_strength     → null  (derived downstream by classifier)
 *   • signal_summary      → null  (generated downstream by summaryGenerator)
 *
 * Phase 1.6 enables (when /splits returns a matching row):
 *   • public_betting_pct  → bets_pct[side]  × 100 (0-100 scale)
 *   • public_money_pct    → handle_pct[side] × 100
 *   • Sharp divergence axis (Signal 4) becomes detectable downstream
 *   • public_smoke detection (Signal 5) becomes detectable downstream
 *
 * /splits does NOT cover first-inning markets. NRFI / first_inning_total
 * signals continue to have public_betting_pct = null and public_money_pct
 * = null. This is a documented V1 limitation.
 *
 * Event identity bridge for /splits merge:
 *   /opportunities/ev event_ids include a `_b\d+` market-bucket suffix
 *   (e.g. mlb_marlins_mets_2026-05-29_b3). /splits event_ids strip that
 *   suffix (mlb_marlins_mets_2026-05-29). Phase 1.6 merges by team-pair
 *   match rather than event_id string — the home/away abbrevs derived
 *   from each /splits row are matched against the abbrevs the
 *   opportunity row already resolved through the TeamNameNormalizer.
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

/**
 * Hard cap on SharpAPI calls per getSharpSignals invocation.
 *
 * Current pattern: 3 /opportunities/* endpoints + 1 /splits = 4 calls
 * with no pagination beyond defaults. Cap of 8 leaves headroom for
 * pagination should an endpoint return more than expected.
 */
const MAX_CALLS_PER_INVOCATION = 8;

/**
 * Phase 1.6: SharpAPI's /opportunities/ev event_ids include a market
 * bucket suffix (`_b0`, `_b1`, `_b2`, `_b3`). /splits event_ids strip
 * that suffix. Used by both helpers to normalize event_ids before
 * comparing across endpoints. NOT used for merging today (we merge by
 * team-pair), but exported for diagnostics and any future event_id-keyed
 * merge.
 */
function stripEventBucketSuffix(eventId: string): string {
  return eventId.replace(/_b\d+$/, "");
}

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

/**
 * Phase 1.6: /splits response row shape (verified live 2026-05-29).
 *
 * Each row covers ONE game with three nested market objects:
 *   moneyline.{bets_pct, handle_pct}.{home, away}
 *   spread.{bets_pct, handle_pct}.{home, away}
 *   total.{bets_pct, handle_pct}.{over, under}
 *
 * Values in bets_pct / handle_pct are 0-1 floats. First-inning markets
 * are NOT included in /splits.
 */
type RawSplitMarket = {
  bets_pct?: Record<string, number | string | null> | null;
  handle_pct?: Record<string, number | string | null> | null;
};

type RawSplitsRow = {
  event_id?: string | null;
  sport?: string | null;
  league?: string | null;
  away_team?: string | null;
  home_team?: string | null;
  sportsbook?: string | null;
  moneyline?: RawSplitMarket | null;
  spread?: RawSplitMarket | null;
  total?: RawSplitMarket | null;
  fetched_at?: string | null;
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
 * Phase 4.1.9.C-1c.ix — splits date guard.
 *
 * Extracts the YYYY-MM-DD slate date encoded in a SharpAPI /splits event_id
 * (e.g., `mlb_twins_whitesox_2026-06-01` → `"2026-06-01"`). The bucket
 * suffix (`_b\d+`) is stripped first so event_ids returned by /opportunities
 * variants normalize to the same form.
 *
 * Returns null if the event_id is missing or doesn't carry a parseable
 * trailing date — caller treats null as "untrusted; do not merge."
 */
function extractSlateDateFromEventId(eventId: string | null): string | null {
  if (eventId === null) return null;
  const stripped = stripEventBucketSuffix(eventId);
  const m = stripped.match(/_(\d{4}-\d{2}-\d{2})$/);
  return m ? m[1] ?? null : null;
}

/**
 * Stats accumulator for the /splits merge. Surfaced to the caller so the
 * provider can log a warning when the date guard skips rows — important
 * diagnostic for late-evening runs where SharpAPI has already rolled
 * forward to the next slate.
 */
export type SplitsMergeStats = {
  totalRows: number;
  keptRows: number;
  skippedNonMlb: number;
  skippedTeamUnresolved: number;
  skippedDateUnparseable: number;
  skippedWrongDate: number;
};

/**
 * Phase 1.6 + Phase 4.1.9.C-1c.ix — build a lookup map from /splits rows
 * keyed by `${homeAbbrev}|${awayAbbrev}`.
 *
 * Now applies a DATE GUARD: each row must carry an event_id whose trailing
 * YYYY-MM-DD date equals `expectedDate`. Rows with a different (or
 * unparseable) date are skipped. This prevents tomorrow's pre-game splits
 * from being silently merged onto today's signal rows when the same
 * matchup repeats across consecutive days (multi-game series safety).
 *
 * Skip categories are tracked via the returned stats so callers can log
 * diagnostics (the operator script's verbose dry-run reports these).
 *
 * The map points to the RAW /splits row so callers can pluck whichever
 * market they need at merge time.
 */
function buildSplitsMap(
  rows: RawSplitsRow[],
  expectedDate: string
): { map: Map<string, RawSplitsRow>; stats: SplitsMergeStats } {
  const map = new Map<string, RawSplitsRow>();
  const stats: SplitsMergeStats = {
    totalRows: rows.length,
    keptRows: 0,
    skippedNonMlb: 0,
    skippedTeamUnresolved: 0,
    skippedDateUnparseable: 0,
    skippedWrongDate: 0,
  };
  for (const row of rows) {
    const leagueTag = asStringOrNull(row.league)?.toLowerCase();
    if (leagueTag !== null && leagueTag !== "mlb") {
      stats.skippedNonMlb++;
      continue;
    }
    // Date guard. Skip rows without a parseable event_id date OR whose
    // date doesn't match the slate being processed. This is the V1.1c
    // multi-game-series safety: at late evening, /splits rolls to the
    // next day; the team-pair merge alone would silently bind tomorrow's
    // splits to today's game.
    const rowDate = extractSlateDateFromEventId(asStringOrNull(row.event_id));
    if (rowDate === null) {
      stats.skippedDateUnparseable++;
      continue;
    }
    if (rowDate !== expectedDate) {
      stats.skippedWrongDate++;
      continue;
    }
    const home = normalizeMlbTeamName(row.home_team);
    const away = normalizeMlbTeamName(row.away_team);
    if (home === null || away === null) {
      stats.skippedTeamUnresolved++;
      continue;
    }
    const key = `${home}|${away}`;
    if (!map.has(key)) {
      map.set(key, row);
      stats.keptRows++;
    }
  }
  return { map, stats };
}

/**
 * Phase 1.6: given a SharpSignalRecord (already-mapped) and the
 * matching /splits row for the game, plus the bookkeeping context
 * needed to pick the right (market, side) cell, return the pair
 * `[public_betting_pct, public_money_pct]` as 0-100 numbers, or
 * `[null, null]` when the splits row doesn't cover this market/side
 * (notably first_inning_total — /splits has no first-inning data).
 *
 * Values in /splits are 0-1 floats; conversion to the 0-100 scale used
 * by sharp_signals happens here via × 100.
 */
function publicPctsFromSplits(
  market: MarketType,
  side: Side,
  splits: RawSplitsRow
): { betting: number | null; money: number | null } {
  // Phase 1.6: first-inning is not covered by /splits. Return nulls so
  // the SharpSignalRecord retains its existing null discipline for
  // NRFI / first_inning_total picks.
  if (market === "first_inning_total") {
    return { betting: null, money: null };
  }

  let marketObj: RawSplitMarket | null | undefined = null;
  if (market === "moneyline") marketObj = splits.moneyline;
  else if (market === "spread") marketObj = splits.spread;
  else if (market === "total") marketObj = splits.total;

  if (marketObj === null || marketObj === undefined) {
    return { betting: null, money: null };
  }

  const betsRaw = marketObj.bets_pct?.[side];
  const handleRaw = marketObj.handle_pct?.[side];
  const betsFraction = asNumberOrNull(betsRaw);
  const handleFraction = asNumberOrNull(handleRaw);

  return {
    betting: betsFraction === null ? null : betsFraction * 100,
    money: handleFraction === null ? null : handleFraction * 100,
  };
}

/**
 * Phase 1.6: enriched mapOpportunity return — the SharpSignalRecord plus
 * the home/away team abbrevs we already resolved from the row. The
 * abbrevs let getSharpSignals merge /splits data without re-normalizing
 * team strings.
 */
type MappedSignal = {
  signal: SharpSignalRecord;
  home: MlbTeamAbbrev;
  away: MlbTeamAbbrev;
};

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
): Promise<MappedSignal | null> {
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

  const signal: SharpSignalRecord = {
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
    // Phase 1.6: public_betting_pct and public_money_pct start NULL.
    // Merge step in getSharpSignals patches them from /splits when a
    // matching row is found for (homeAbbrev, awayAbbrev) and the
    // signal's market is one of moneyline / spread / total.
    public_betting_pct: null,
    public_money_pct: null,
    signal_strength: null,
    signal_summary: null,
    computed_at: asStringOrNull(row.detected_at) ?? fallbackComputedAt,
  };
  return { signal, home: homeAbbrev, away: awayAbbrev };
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
    // Phase 1.6: track each signal alongside its (homeAbbrev, awayAbbrev)
    // so the splits merge step can look up /splits rows by team pair
    // without re-normalizing team strings on the SharpSignalRecord.
    const seen = new Map<string, MappedSignal>();

    // Fetch order matters for dedup: /opportunities/ev FIRST so its rows
    // become the precedent. Subsequent low_hold/arbitrage rows for the
    // same (game, market, side) are skipped — preserves EV's richer data
    // (pinnacle_fair_probability, ev_pct, is_plus_ev=true).
    const opportunityEndpoints: Array<{
      path: string;
      source: "ev" | "low_hold" | "arbitrage";
    }> = [
      { path: "/opportunities/ev", source: "ev" },
      { path: "/opportunities/low_hold", source: "low_hold" },
      { path: "/opportunities/arbitrage", source: "arbitrage" },
    ];

    let callsUsed = 0;
    for (const { path, source } of opportunityEndpoints) {
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
        const mapped = await mapOpportunity(
          row,
          source,
          sportKey,
          date,
          this.resolveGame,
          fallbackComputedAt
        );
        if (mapped === null) continue;
        if (
          gameExternalId !== undefined &&
          mapped.signal.game_external_id !== gameExternalId
        ) {
          continue;
        }
        const key = buildDedupeKey(
          mapped.signal.game_external_id,
          mapped.signal.market_type,
          mapped.signal.side
        );
        if (!seen.has(key)) {
          seen.set(key, mapped);
        }
        // Else: keep the earlier (higher-precedence) record. /opportunities/ev
        // rows land first; low_hold/arbitrage duplicates are dropped.
      }
    }

    // Phase 1.6 — /splits merge.
    // After the three opportunity endpoints land, fetch /splits ONCE
    // and merge public_betting_pct + public_money_pct into any signal
    // whose (homeAbbrev, awayAbbrev) appears in the splits payload AND
    // whose market is moneyline / spread / total. First-inning signals
    // are intentionally skipped — /splits does not include first-inning
    // markets in V1 (documented limitation).
    if (callsUsed < MAX_CALLS_PER_INVOCATION) {
      callsUsed++;
      let splitsRows: RawSplitsRow[];
      try {
        splitsRows = await this.client.fetchAll<RawSplitsRow>({
          path: "/splits",
          query: { sport: "mlb" },
          maxPages: 2,
        });
      } catch (e) {
        // 404 or any other failure is non-fatal: SharpSignalRecords keep
        // public_betting_pct / public_money_pct null, framework rules
        // fall back to the pre-Phase-1.6 behavior. Log via console.warn
        // so cron output preserves the diagnostic.
        if (e instanceof SharpApiNotFoundError) {
          splitsRows = [];
        } else {
          console.warn(
            `[SharpAPISignalProvider] /splits fetch failed: ${
              e instanceof Error ? e.message : String(e)
            }`
          );
          splitsRows = [];
        }
      }
      const { map: splitsByPair, stats: splitsStats } = buildSplitsMap(
        splitsRows,
        date
      );
      if (splitsStats.skippedWrongDate > 0) {
        console.warn(
          `[SharpAPISignalProvider] /splits date guard: skipped ${splitsStats.skippedWrongDate} row(s) with event_id date != ${date} ` +
            `(multi-game-series safety — likely SharpAPI rolled forward to the next slate). Total rows=${splitsStats.totalRows}, kept=${splitsStats.keptRows}.`
        );
      }
      if (splitsStats.skippedDateUnparseable > 0) {
        console.warn(
          `[SharpAPISignalProvider] /splits date guard: skipped ${splitsStats.skippedDateUnparseable} row(s) with unparseable event_id date. ` +
            `These would otherwise have merged on team-pair alone and risked cross-slate contamination.`
        );
      }
      for (const entry of seen.values()) {
        // Skip first_inning_total — no first-inning splits in V1.
        if (entry.signal.market_type === "first_inning_total") continue;
        const splitsRow = splitsByPair.get(`${entry.home}|${entry.away}`);
        if (splitsRow === undefined) continue;
        const { betting, money } = publicPctsFromSplits(
          entry.signal.market_type,
          entry.signal.side,
          splitsRow
        );
        // Mutate in place — the entry holds a reference, the returned
        // array maps `entry.signal` from `seen.values()`.
        if (betting !== null) entry.signal.public_betting_pct = betting;
        if (money !== null) entry.signal.public_money_pct = money;
      }
    } else {
      console.warn(
        `[SharpAPISignalProvider] call cap (${MAX_CALLS_PER_INVOCATION}) reached — /splits merge skipped, public_betting_pct / public_money_pct stay null`
      );
    }

    return Array.from(seen.values()).map((e) => e.signal);
  }
}

// ─────────────────────────────────────────────────────────────
// Test-only exports — accessible via the module but never invoked by
// services. Tests use these to verify pure helper behavior without
// hitting the SharpAPI network.
// ─────────────────────────────────────────────────────────────

export const __TEST__ = {
  stripEventBucketSuffix,
  buildSplitsMap,
  publicPctsFromSplits,
  extractSlateDateFromEventId,
};
