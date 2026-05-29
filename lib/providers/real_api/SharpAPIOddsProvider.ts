/**
 * SharpAPIOddsProvider — IOddsProvider implementation backed by SharpAPI.
 * Phase 1 (Gate B.1).
 *
 * Verified by Gate A probe — /events and /odds confirmed live with
 * documented field shapes. Pro $229 vs Sharp $399 tier difference does
 * not affect provider code; current operating assumption is Sharp tier
 * (task #149 to verify Pro tier later).
 *
 * Bridge problem: SharpAPI events have string IDs like
 * "mlb__nyy_bos_2026-05-29_b1" but our lines.game_id FK resolves via the
 * BDL integer external_id stored in games. The provider receives a
 * resolver closure at construction (the factory wires it to a Supabase
 * query against games + teams). For each SharpAPI event, the provider
 * normalizes the team strings, calls the resolver, and uses the returned
 * BDL external_id as LineRecord.game_external_id.
 *
 * Futures filter: SharpAPI's /events returns ALL MLB-tagged events
 * including Kalshi championship outright markets. The provider skips
 * events where market_type === "outright" (Gate A probe encountered one
 * and falsely flagged downstream coverage gaps).
 *
 * V1: getPlayerProps returns []. No Player Props in V1.
 */

import type { Sport } from "../../types/domain/Sport";
import type { MarketType, Side, Sportsbook } from "../../types/domain/Lines";
import type {
  IOddsProvider,
  LineRecord,
} from "../interfaces/IOddsProvider";
import { SharpApiClient, SharpApiNotFoundError } from "./_sharpApiClient";
import {
  normalizeMlbTeamName,
  type MlbTeamAbbrev,
} from "./_teamNameNormalizer";

/**
 * Resolver injected at construction time. Maps a SharpAPI event's natural
 * key (team abbrevs + date) to the BDL integer external_id already in
 * `games`. Returns null when no match — caller skips the event.
 *
 * The factory creates one resolver instance and passes it to both this
 * provider and SharpAPISignalProvider so they share resolution semantics.
 */
export type SharpApiGameResolver = (
  sport: Sport,
  date: string,
  homeAbbrev: MlbTeamAbbrev,
  awayAbbrev: MlbTeamAbbrev
) => Promise<number | null>;

/** Hard cap on SharpAPI calls per getGameLines invocation (safety net). */
const MAX_CALLS_PER_INVOCATION = 30;

// ─────────────────────────────────────────────────────────────
// Raw shapes
// ─────────────────────────────────────────────────────────────

type RawEvent = {
  id?: string | number | null;
  event_id?: string | number | null;
  sport?: string | null;
  league?: string | null;
  home_team?: string | null;
  away_team?: string | null;
  start_time?: string | null;
  status?: string | null;
  is_live?: boolean | null;
  market_type?: string | null;
  market_count?: number | null;
  book_count?: number | null;
};

type RawOddsRow = {
  event_id?: string | number | null;
  sportsbook?: string | null;
  book?: string | null;
  market_type?: string | null;
  market?: string | null;
  selection?: string | null;
  side?: string | null;
  line?: number | string | null;
  line_value?: number | string | null;
  price?: number | string | null;
  odds?: number | string | null;
  odds_american?: number | string | null;
  odds_decimal?: number | string | null;
  implied_probability?: number | string | null;
  // EV/fair fields can appear on /odds for some books; usually live on /opportunities/ev
  ev_percent?: number | string | null;
  ev_pct?: number | string | null;
  fair_odds?: number | string | null;
  is_ev_positive?: boolean | null;
  detected_at?: string | null;
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

function mapMarketType(raw: string | null): MarketType | null {
  if (raw === null) return null;
  const v = raw.toLowerCase().trim();
  if (v === "h2h" || v === "moneyline" || v === "ml") return "moneyline";
  if (v === "total" || v === "totals" || v === "over_under" || v === "ou") return "total";
  if (v === "spread" || v === "spreads" || v === "runline" || v === "run_line") {
    return "spread";
  }
  if (
    v === "first_inning_total" ||
    v === "1st_inning_total" ||
    v === "first_5_innings" ||
    v === "f5" ||
    v === "1h_total"
  ) {
    return "first_inning_total";
  }
  // Skip outrights (futures) — caller filters at /events level too, but
  // defense in depth.
  if (v === "outright" || v.includes("future") || v.includes("championship")) {
    return null;
  }
  return null;
}

function mapSportsbook(raw: string | null): Sportsbook | null {
  const s = asStringOrNull(raw);
  if (s === null) return null;
  return s.toLowerCase() as Sportsbook;
}

/**
 * Map SharpAPI's selection string to our Side enum, given the event's
 * market_type and the resolved home/away abbreviations. Returns null when
 * we can't confidently classify — caller skips the row.
 */
function mapSide(
  rawSelection: string | null,
  rawSide: string | null,
  marketType: MarketType,
  homeAbbrev: MlbTeamAbbrev,
  awayAbbrev: MlbTeamAbbrev
): Side | null {
  // Explicit side field wins when present.
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

  // Moneyline + spread: resolve team string → abbrev → home/away.
  const abbrev = normalizeMlbTeamName(selection);
  if (abbrev === null) return null;
  if (abbrev === homeAbbrev) return "home";
  if (abbrev === awayAbbrev) return "away";
  return null;
}

// ─────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────

export class SharpAPIOddsProvider implements IOddsProvider {
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

  async getGameLines(date: string, sport?: Sport): Promise<LineRecord[]> {
    const sportKey = sport ?? "mlb";
    if (sportKey !== "mlb") return [];

    // Step 1: fetch events for the date.
    let events: RawEvent[];
    let callsUsed = 1;
    try {
      events = await this.client.fetchAll<RawEvent>({
        path: "/events",
        query: { sport: "mlb", start_time_gte: date },
        maxPages: 3,
      });
    } catch (e) {
      if (e instanceof SharpApiNotFoundError) return [];
      throw e;
    }

    // Step 2: filter to single-game events and resolve to BDL game ids.
    type ResolvedEvent = {
      sharpEventId: string | number;
      homeAbbrev: MlbTeamAbbrev;
      awayAbbrev: MlbTeamAbbrev;
      gameExternalId: number;
    };
    const resolved: ResolvedEvent[] = [];

    for (const ev of events) {
      // Filter market_type=outright (futures).
      const marketTypeRaw = asStringOrNull(ev.market_type);
      if (marketTypeRaw !== null && marketTypeRaw.toLowerCase() === "outright") {
        continue;
      }
      // Only MLB.
      const sportTag = asStringOrNull(ev.sport)?.toLowerCase();
      if (sportTag !== null && sportTag !== undefined && sportTag !== "mlb") {
        continue;
      }
      const homeAbbrev = normalizeMlbTeamName(ev.home_team);
      const awayAbbrev = normalizeMlbTeamName(ev.away_team);
      if (homeAbbrev === null || awayAbbrev === null) {
        // Log via console.warn so cron output preserves the diagnostic;
        // no exception — skip and move on.
        console.warn(
          `[SharpAPIOddsProvider] skipping event — unmatched team string(s): home="${ev.home_team ?? ""}" away="${ev.away_team ?? ""}"`
        );
        continue;
      }
      const sharpEventId = ev.event_id ?? ev.id ?? null;
      if (sharpEventId === null) continue;
      const gameExternalId = await this.resolveGame(
        sportKey,
        date,
        homeAbbrev,
        awayAbbrev
      );
      if (gameExternalId === null) {
        // Game not in our DB for this slate. Expected for postponed games
        // or doubleheader edge cases — silent skip.
        continue;
      }
      resolved.push({ sharpEventId, homeAbbrev, awayAbbrev, gameExternalId });
    }

    // Step 3: fetch /odds per resolved event, map to LineRecord.
    const out: LineRecord[] = [];
    const fetchedAt = new Date().toISOString();
    for (const ev of resolved) {
      if (callsUsed >= MAX_CALLS_PER_INVOCATION) {
        console.warn(
          `[SharpAPIOddsProvider] call cap (${MAX_CALLS_PER_INVOCATION}) reached — returning partial`
        );
        break;
      }
      callsUsed++;
      let oddsRows: RawOddsRow[];
      try {
        oddsRows = await this.client.fetchAll<RawOddsRow>({
          path: "/odds",
          query: { event_id: String(ev.sharpEventId) },
          maxPages: 3,
        });
      } catch (e) {
        if (e instanceof SharpApiNotFoundError) continue;
        throw e;
      }
      for (const row of oddsRows) {
        const marketType = mapMarketType(asStringOrNull(row.market_type ?? row.market));
        if (marketType === null) continue;
        const sportsbook = mapSportsbook(asStringOrNull(row.sportsbook ?? row.book));
        if (sportsbook === null) continue;
        const side = mapSide(
          asStringOrNull(row.selection),
          asStringOrNull(row.side),
          marketType,
          ev.homeAbbrev,
          ev.awayAbbrev
        );
        if (side === null) continue;
        const lineValue = asNumberOrNull(row.line_value ?? row.line);
        const oddsAmerican = asNumberOrNull(
          row.odds_american ?? row.price ?? row.odds
        );
        const oddsDecimal = asNumberOrNull(row.odds_decimal);
        out.push({
          game_external_id: ev.gameExternalId,
          market_type: marketType,
          player_external_id: null,
          sportsbook,
          side,
          line_value: lineValue,
          odds_american: oddsAmerican,
          odds_decimal: oddsDecimal,
          implied_probability: asNumberOrNull(row.implied_probability),
          ev_percent: asNumberOrNull(row.ev_percent ?? row.ev_pct),
          fair_odds: asNumberOrNull(row.fair_odds),
          is_ev_positive:
            row.is_ev_positive === undefined || row.is_ev_positive === null
              ? null
              : row.is_ev_positive === true,
          fetched_at: asStringOrNull(row.fetched_at) ?? fetchedAt,
        });
      }
    }

    return out;
  }

  /**
   * V1: Player props are not in scope. Returns empty array. The IOddsProvider
   * contract requires the method exist; the morning-slate cron's
   * linesService.refreshPlayerProps call gets an empty list and writes
   * nothing. Mock provider continues to handle Player Props in tests.
   */
  async getPlayerProps(_date: string, _sport?: Sport): Promise<LineRecord[]> {
    void _date;
    void _sport;
    return [];
  }
}
