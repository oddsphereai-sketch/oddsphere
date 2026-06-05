/**
 * SharpAPIOddsProvider — IOddsProvider implementation backed by SharpAPI.
 * Phase 1.5 correction (Task #162).
 *
 * DISCOVERY ENDPOINT: /opportunities/ev — not /events.
 *
 * Phase 1's earlier /events flow returned 0 rows in live smoke because
 * (a) SharpAPI tags game rows as sport="baseball" + league="mlb" rather
 * than sport="mlb", and (b) /events returns a mostly-junk mix of Kalshi
 * futures, college baseball, KBO, NPB, golf, and fictional MiLB-style
 * teams under sport="baseball" — even when filtering for league=mlb,
 * the team strings come back compressed ("TOR Toronto") in ways our
 * normalizer can't safely resolve.
 *
 * /opportunities/ev returns ONLY real game-level opportunities with full
 * team names ("Toronto Blue Jays" / "Baltimore Orioles") and a clean
 * event_id that /odds accepts. Even though it filters to +EV-positive
 * opportunities, every active MLB game with sharp-book reference odds
 * surfaces multiple opportunity rows, so we get the full slate of
 * discoverable events. Games with NO +EV opportunity are invisible —
 * that's acceptable for V1 because without a sharp reference we have no
 * Pinnacle context for that game anyway.
 *
 * Bridge problem: SharpAPI events have string IDs like
 * "mlb_bluejays_orioles_2026-05-29_b3" but our lines.game_id FK resolves
 * via the BDL integer external_id stored in games. The provider receives
 * a resolver closure at construction (the factory wires it to a Supabase
 * query). For each unique SharpAPI event, we normalize teams, call the
 * resolver, and use the returned BDL external_id as
 * LineRecord.game_external_id.
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
import {
  discoverEventsFromOpportunities,
  type DiscoveryStats as EvDiscoveryStats,
} from "./_opportunitiesDiscovery";
import {
  discoverEventsFromSplits,
  type DiscoveryStats as SplitsDiscoveryStats,
  type RawSplitsRow,
} from "./_splitsDiscovery";

/**
 * Phase 4.2.C.1.R-16E — provenance label for game-line rows synthesized
 * from SharpAPI's `/splits` consensus payload when `/odds` returns no
 * rows for a market. Used as the `sportsbook` column on the synthetic
 * `lines` row so downstream code (no-vig math, UI label, audit) can
 * distinguish splits-fallback from real-book data.
 *
 * Lower priority than every real book in NO_VIG_BOOK_PRIORITY — the
 * Daily Edge route reads from real books first and only consults
 * `splits_consensus` when no real-book two-sided pair exists for a
 * market.
 */
export const SPLITS_CONSENSUS_BOOK = "splits_consensus";

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
// R-17 Step 2E.1 — raised 30 → 50 to handle multi-bucket /odds harvest.
// A 15-game slate with both `_b0` and `_b3` published per event consumes
// ~30 /odds calls; +2 (opportunities/ev + splits) puts us at the edge
// of the old 30 cap. 50 provides ~70% headroom for larger slates while
// still being deeply conservative against the 1000-call quota window.
//
// R-17 Step 2F.1 — speculative bucket probe adds at most 1 extra /odds
// call per event (the "opposite" common bucket — `_b3` when only `_b0`
// is advertised, vice versa). Today's 15-game slate worst case:
// 1 ev + 1 splits + 15 advertised + 15 speculative = 32 calls. Still
// well inside 50.
const MAX_CALLS_PER_INVOCATION = 50;

// R-17 Step 2F.1 — suffixes the targeted speculative probe is allowed to
// fetch when /opportunities/ev advertised only one of `_b0` / `_b3`.
// The 2026-06-05 audit (Step 2F) observed `_b1` and `_b2` returned zero
// rows on every event tested; they're deliberately excluded so the
// probe stays cheap and yield-positive.
const SPECULATIVE_PROBE_SUFFIXES = ["_b0", "_b3"] as const;

// ─────────────────────────────────────────────────────────────
// Raw shapes
// ─────────────────────────────────────────────────────────────

/**
 * /opportunities/ev row used as discovery source. Only fields the
 * provider reads — SharpAPI returns ~40 keys per row; we ignore the
 * ones we don't use.
 */
type RawOpportunity = {
  event_id?: string | number | null;
  sport?: string | null;
  league?: string | null;
  home_team?: string | null;
  away_team?: string | null;
  is_player_prop?: boolean | null;
  is_alternate_line?: boolean | null;
};

/**
 * /odds row — Phase 1.5 inspection (Task #162). Verified live keys
 * include `sportsbook`, `market_type`, `selection_type` (the clean side
 * field — "home" / "away" / "over" / "under"), `selection` (string
 * label), `line`, `odds_american`, `odds_decimal`, `odds_probability`,
 * `league`, `sport`, `last_seen_at`, `wire_received_at`.
 */
type RawOddsRow = {
  event_id?: string | number | null;
  sportsbook?: string | null;
  sport?: string | null;
  league?: string | null;
  market_type?: string | null;
  selection?: string | null;
  selection_type?: string | null;
  is_main_line?: boolean | null;
  is_alternate_line?: boolean | null;
  is_live?: boolean | null;
  line?: number | string | null;
  odds_american?: number | string | null;
  odds_decimal?: number | string | null;
  odds_probability?: number | string | null;
  last_seen_at?: string | null;
  wire_received_at?: string | null;
  // R-16G-A — provider-side defensive guard reads these to verify the
  // row's internal home/away labels match the event's resolved home/
  // away. Some books (kalshi observed 2026-06-04) emit rows where
  // `home_team` and `away_team` are inverted relative to the actual
  // game, leading to silent wrong-side prices downstream.
  home_team?: string | null;
  away_team?: string | null;
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
 * Intentionally NOT mapped:
 *   - "1st_5_innings_total_runs" / "f5" — that's the FIRST 5 INNINGS market,
 *     not the first inning. Different market; would mis-grade NRFI picks.
 *   - team_total, player props, alternate lines, futures, championships →
 *     return null; caller drops the row.
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
  // R-16F-C — accept SharpAPI's live emission "1st_inning_total_runs"
  // alongside the previously-recognized short forms. SharpAPI's /odds
  // endpoint returns the long form per audit; the short forms are kept
  // for back-compat / defensive coverage.
  //
  // Intentionally NOT mapped to first_inning_total:
  //   - "1st_inning_moneyline_3-way" — a 3-way ML at the END of the 1st
  //     (home/away/tie). Different market than NRFI/YRFI.
  //   - "1st_3_innings_total_runs" / "1st_5_innings_total_runs" — F3/F5
  //     totals; different windows than first-inning. Would mis-grade
  //     NRFI picks.
  if (
    v === "first_inning_total" ||
    v === "1st_inning_total" ||
    v === "1st_inning_total_runs"
  ) {
    return "first_inning_total";
  }
  return null;
}

function mapSportsbook(raw: string | null): Sportsbook | null {
  const s = asStringOrNull(raw);
  if (s === null) return null;
  return s.toLowerCase() as Sportsbook;
}

/**
 * Map SharpAPI's `selection_type` field directly to our Side enum.
 * Phase 1.5 (Task #162): /odds rows include selection_type as a clean
 * enum-like field ("home" / "away" / "over" / "under" / "yes" / "no"),
 * eliminating the need for team-string parsing. Returns null when the
 * value isn't recognized — caller skips the row.
 */
/**
 * R-16E — build a synthetic LineRecord tagged with the splits-consensus
 * provenance book. Centralized so all three markets share identical
 * field discipline (ev_percent / fair_odds / is_ev_positive are always
 * null on these rows — /splits does not de-vig).
 */
function makeSplitsLineRecord(opts: {
  gameExternalId: number;
  marketType: MarketType;
  side: Side;
  odds_american: number | null;
  line_value: number | null;
  fetched_at: string;
}): LineRecord {
  return {
    game_external_id: opts.gameExternalId,
    market_type: opts.marketType,
    player_external_id: null,
    sportsbook: SPLITS_CONSENSUS_BOOK as Sportsbook,
    side: opts.side,
    line_value: opts.line_value,
    odds_american: opts.odds_american,
    odds_decimal: null,
    implied_probability: null,
    ev_percent: null,
    fair_odds: null,
    is_ev_positive: null,
    fetched_at: opts.fetched_at,
  };
}

function mapSide(rawSelectionType: unknown): Side | null {
  const s = asStringOrNull(rawSelectionType);
  if (s === null) return null;
  const v = s.toLowerCase();
  if (
    v === "home" ||
    v === "away" ||
    v === "over" ||
    v === "under" ||
    v === "yes" ||
    v === "no"
  ) {
    return v;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────

export class SharpAPIOddsProvider implements IOddsProvider {
  private readonly client: SharpApiClient;
  private readonly resolveGame: SharpApiGameResolver;

  constructor(
    apiKey: string,
    resolveGame: SharpApiGameResolver,
    opts?: { client?: SharpApiClient }
  ) {
    // Test affordance (R-16D): allow injecting a pre-built / stubbed client
    // so unit tests can exercise the V2 discovery + odds-fetch flow without
    // a real SHARPAPI_KEY. Production always passes the apiKey string and
    // gets a freshly-built client.
    this.client = opts?.client ?? new SharpApiClient(apiKey);
    this.resolveGame = resolveGame;
  }

  /** Test/diagnostic accessor — never called by services. */
  getClient(): SharpApiClient {
    return this.client;
  }

  async getGameLines(date: string, sport?: Sport): Promise<LineRecord[]> {
    const sportKey = sport ?? "mlb";
    if (sportKey !== "mlb") return [];

    // Step 1: discover unique game events via /opportunities/ev.
    // /events is intentionally NOT used (Task #162) — see file header.
    let opportunities: RawOpportunity[];
    let callsUsed = 1;
    try {
      opportunities = await this.client.fetchAll<RawOpportunity>({
        path: "/opportunities/ev",
        query: { sport: "mlb" },
        maxPages: 5,
      });
    } catch (e) {
      if (e instanceof SharpApiNotFoundError) return [];
      throw e;
    }

    // Step 2: dedupe to unique events, filter league === "mlb", drop
    // player props and alternate lines, then resolve to BDL game ids.
    type ResolvedEvent = {
      sharpEventId: string;
      homeAbbrev: MlbTeamAbbrev;
      awayAbbrev: MlbTeamAbbrev;
      gameExternalId: number;
    };

    type EventCandidate = {
      sharpEventId: string;
      homeRaw: string | null;
      awayRaw: string | null;
    };
    const eventCandidates = new Map<string, EventCandidate>();
    for (const opp of opportunities) {
      if (opp.is_player_prop === true) continue;
      if (opp.is_alternate_line === true) continue;
      const league = asStringOrNull(opp.league)?.toLowerCase();
      if (league !== null && league !== undefined && league !== "mlb") {
        continue;
      }
      const id = asStringOrNull(opp.event_id);
      if (id === null) continue;
      if (eventCandidates.has(id)) continue;
      eventCandidates.set(id, {
        sharpEventId: id,
        homeRaw: asStringOrNull(opp.home_team),
        awayRaw: asStringOrNull(opp.away_team),
      });
    }

    const resolved: ResolvedEvent[] = [];
    for (const cand of eventCandidates.values()) {
      const homeAbbrev = normalizeMlbTeamName(cand.homeRaw);
      const awayAbbrev = normalizeMlbTeamName(cand.awayRaw);
      if (homeAbbrev === null || awayAbbrev === null) {
        console.warn(
          `[SharpAPIOddsProvider] skipping event ${cand.sharpEventId} — unmatched team string(s): home="${cand.homeRaw ?? ""}" away="${cand.awayRaw ?? ""}"`
        );
        continue;
      }
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
      resolved.push({
        sharpEventId: cand.sharpEventId,
        homeAbbrev,
        awayAbbrev,
        gameExternalId,
      });
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
          query: { event_id: ev.sharpEventId },
          maxPages: 3,
        });
      } catch (e) {
        if (e instanceof SharpApiNotFoundError) continue;
        throw e;
      }
      for (const row of oddsRows) {
        // Defense-in-depth: cross-check league on each odds row. Already
        // filtered upstream at /opportunities/ev discovery, but a row
        // tagged non-mlb here would still be a defect to skip.
        const rowLeague = asStringOrNull(row.league)?.toLowerCase();
        if (rowLeague !== null && rowLeague !== undefined && rowLeague !== "mlb") {
          continue;
        }
        // Drop alternate lines — V1 only ingests the main line per market.
        if (row.is_alternate_line === true) continue;

        const marketType = mapMarketType(asStringOrNull(row.market_type));
        if (marketType === null) continue;
        const sportsbook = mapSportsbook(asStringOrNull(row.sportsbook));
        if (sportsbook === null) continue;
        const side = mapSide(row.selection_type);
        if (side === null) continue;

        // R-16G-A — V1 mirror of the V2 home/away sanity guard. Same
        // rationale: some books emit rows whose own home_team/away_team
        // strings are inverted relative to the actual event. Reject
        // those before they reach `lines` to prevent wrong-side prices.
        if (side === "home" || side === "away") {
          const rowHomeAbbr = normalizeMlbTeamName(asStringOrNull(row.home_team));
          const rowAwayAbbr = normalizeMlbTeamName(asStringOrNull(row.away_team));
          if (
            rowHomeAbbr !== null &&
            rowAwayAbbr !== null &&
            (rowHomeAbbr !== ev.homeAbbrev || rowAwayAbbr !== ev.awayAbbrev)
          ) {
            console.warn(
              `[SharpAPIOddsProvider V1] R-16G-A reject: ${sportsbook} row has home="${row.home_team}"/away="${row.away_team}" but event ${ev.awayAbbrev}@${ev.homeAbbrev}.`
            );
            continue;
          }
        }

        out.push({
          game_external_id: ev.gameExternalId,
          market_type: marketType,
          player_external_id: null,
          sportsbook,
          side,
          line_value: asNumberOrNull(row.line),
          odds_american: asNumberOrNull(row.odds_american),
          odds_decimal: asNumberOrNull(row.odds_decimal),
          implied_probability: asNumberOrNull(row.odds_probability),
          // EV / fair fields live on /opportunities/ev rows (handled by
          // SharpAPISignalProvider), NOT on /odds rows. Leave null.
          ev_percent: null,
          fair_odds: null,
          is_ev_positive: null,
          fetched_at:
            asStringOrNull(row.last_seen_at) ??
            asStringOrNull(row.wire_received_at) ??
            fetchedAt,
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

  // ─────────────────────────────────────────────────────────────
  // Phase 4.2.C.1.R-16D — V2: full-slate line refresh
  // ─────────────────────────────────────────────────────────────
  //
  // V1 (getGameLines, above) uses `/opportunities/ev` for BOTH event
  // discovery and odds payload, which silently shrinks coverage when
  // the +EV-opportunity event set is smaller than the actual slate.
  //
  // V2 keeps the per-event `/odds?event_id=` payload step but moves
  // event discovery to `/splits?sport=mlb`, which returns one row per
  // slate game regardless of opportunity status. Additionally V2
  // harvests the suffixed event_ids that `/opportunities/ev` exposes
  // (e.g. `mlb_athletics_cubs_2026-06-04_b3`) so `/odds` calls use the
  // exact event_id form SharpAPI's odds endpoint accepts — falling
  // back to the stripped `/splits` event_id (no `_b\d+` suffix) when
  // `/opportunities/ev` returned no row for that game.
  //
  // The output is rich enough for the line-refresh service to do
  // per-game upserts (preserving existing rows for games where the
  // provider returned nothing) and for the operator script to print
  // a per-game coverage report.
  //
  // Pure provider — does NO DB work. The service decides write vs
  // preserve based on this discovery report.

  /**
   * V2 result — `records` is identical-shape to the V1 LineRecord[],
   * `discovery` is the per-game breakdown the line-refresh service and
   * operator script consume for coverage reporting + safe per-game
   * upsert.
   */
  async getGameLinesV2(
    date: string,
    sport?: Sport
  ): Promise<{ records: LineRecord[]; discovery: V2DiscoveryReport }> {
    const sportKey = sport ?? "mlb";
    if (sportKey !== "mlb") {
      return {
        records: [],
        discovery: emptyDiscoveryReport(),
      };
    }

    const fetchedAt = new Date().toISOString();
    let callsUsed = 0;

    // R-17 Step 2B — canonical event discovery via /opportunities/ev.
    //
    // Pre-Step-2B this step used `discoverEventsFromSplits` and then a
    // second pass to harvest suffixed event_ids from /opportunities/ev.
    // The 2026-06-05 SharpAPI audit confirmed /splits is a consensus-
    // splits aggregator (not a slate listing) and was missing 6 of 15
    // tonight games. /opportunities/ev returns all canonical slate
    // events AND already carries suffixed event_ids — so discovery and
    // suffixed-id harvest collapse into one step.
    const evResult = await discoverEventsFromOpportunities(
      this.client,
      sportKey,
      date
    );
    callsUsed += 1;

    // Pre-Step-2B variable name kept for downstream readability — the
    // shape is the same {events[], rows[]} contract.
    const opportunitiesUnavailable = evResult.events.length === 0;

    // Step 1.5 — /splits ENRICHMENT fetch (R-16E fallback only).
    //
    // /splits is still needed for the per-market splits-consensus
    // fallback that fires when /odds returns zero rows for a game's
    // moneyline / total / spread. NOT used for discovery anymore —
    // event identity comes from /opportunities/ev above. Lookup keyed
    // by `${home}|${away}` so it matches the canonical events. Failures
    // here are tolerated: R-16E simply won't fire; odds-only coverage
    // proceeds for whichever games /odds returns data for.
    type SplitsLookupEvent = {
      home: MlbTeamAbbrev;
      away: MlbTeamAbbrev;
      rawRow: RawSplitsRow;
    };
    let splitsLookupEvents: SplitsLookupEvent[] = [];
    try {
      const splitsResult = await discoverEventsFromSplits(
        this.client,
        sportKey,
        date
      );
      callsUsed += 1;
      splitsLookupEvents = splitsResult.events.map((e) => ({
        home: e.home,
        away: e.away,
        rawRow: e.rawRow,
      }));
    } catch (e) {
      console.warn(
        `[SharpAPIOddsProvider V2] /splits enrichment unavailable; R-16E fallback disabled this run: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
    }

    // Step 3: resolve each discovered event to a BDL game external_id +
    // pick the event_id form(s) to use for /odds. Anything that fails
    // to resolve is captured for the discovery report — not silently
    // dropped.
    //
    // R-17 Step 2E.1 — `effectiveEventIds` carries ALL observed buckets
    // for the event (was a single string pre-2E.1). The Step 4 harvest
    // loops over every entry and merges results with a cross-bucket
    // dedupe set.
    type ResolvedV2Event = {
      home: MlbTeamAbbrev;
      away: MlbTeamAbbrev;
      gameExternalId: number;
      splitsEventId: string;
      effectiveEventIds: string[];
      eventIdSource: "opportunities_suffixed" | "splits_stripped";
    };

    const resolved: ResolvedV2Event[] = [];
    const unresolvedTeamPairs: Array<{ home: MlbTeamAbbrev; away: MlbTeamAbbrev }> = [];

    for (const ev of evResult.events) {
      const gameExtId = await this.resolveGame(sportKey, date, ev.home, ev.away);
      if (gameExtId === null) {
        unresolvedTeamPairs.push({ home: ev.home, away: ev.away });
        continue;
      }
      resolved.push({
        home: ev.home,
        away: ev.away,
        gameExternalId: gameExtId,
        splitsEventId: ev.sharpEventId, // stripped form, kept name for back-compat
        effectiveEventIds: ev.suffixedEventIds,
        eventIdSource: "opportunities_suffixed",
      });
    }

    // Build a quick lookup from (home, away) → /splits raw row so
    // Step 4's per-event loop can synthesize fallback rows for markets
    // where /odds returned nothing (R-16E). When /splits is unavailable
    // or has no row for a given pair, the fallback simply doesn't fire
    // for that game.
    const splitsRowByPair = new Map<string, RawSplitsRow>();
    for (const sev of splitsLookupEvents) {
      splitsRowByPair.set(`${sev.home}|${sev.away}`, sev.rawRow);
    }

    // Step 4: per-event /odds + R-16E /splits fallback. Per-game coverage
    // detail captured so the service can decide preserve-vs-replace per
    // (game, market) — and so the operator can see which rows came from
    // a real book vs the splits-consensus fallback.
    const records: LineRecord[] = [];
    const perGame: V2DiscoveryPerGame[] = [];

    for (const ev of resolved) {
      // R-17 Step 2E.1 — per-game accumulators are aggregated across
      // every observed bucket. The dedupe set guarantees that an
      // identical (book, market, side, line) row appearing in two
      // buckets only writes once. Distinct books from different
      // buckets are kept naturally.
      const seenKeys = new Set<string>();
      let mlFromOdds = 0,
        totFromOdds = 0,
        sprFromOdds = 0,
        other = 0;
      let rejectedHomeAwayMismatch = 0;
      let dedupedAcrossBuckets = 0;
      const books = new Set<string>();
      const bucketsObserved = [...ev.effectiveEventIds];
      const bucketsFetched: string[] = [];
      const bucketsCallCapped: string[] = [];
      const bucketStatuses: V2OddsCallStatus[] = [];

      // Inner loop: call /odds for EVERY observed `_b\d+` suffix.
      // Single-bucket events behave exactly as before (one call,
      // one merge). Multi-bucket events recover the books that
      // were silently dropped pre-2E.1.
      for (const effectiveEventId of ev.effectiveEventIds) {
        if (callsUsed >= MAX_CALLS_PER_INVOCATION) {
          bucketsCallCapped.push(effectiveEventId);
          bucketStatuses.push("skipped_call_cap");
          continue;
        }
        callsUsed++;
        bucketsFetched.push(effectiveEventId);

        let oddsRows: RawOddsRow[];
        let bucketStatus: V2OddsCallStatus;
        try {
          oddsRows = await this.client.fetchAll<RawOddsRow>({
            path: "/odds",
            query: { event_id: effectiveEventId },
            maxPages: 3,
          });
          bucketStatus = oddsRows.length === 0 ? "empty" : "ok";
        } catch (e) {
          if (e instanceof SharpApiNotFoundError) {
            oddsRows = [];
            bucketStatus = "not_found";
          } else {
            throw e;
          }
        }
        bucketStatuses.push(bucketStatus);

        for (const row of oddsRows) {
          const rowLeague = asStringOrNull(row.league)?.toLowerCase();
          if (rowLeague !== null && rowLeague !== undefined && rowLeague !== "mlb") {
            continue;
          }
          if (row.is_alternate_line === true) continue;

          const marketType = mapMarketType(asStringOrNull(row.market_type));
          if (marketType === null) continue;
          const sportsbook = mapSportsbook(asStringOrNull(row.sportsbook));
          if (sportsbook === null) continue;
          const side = mapSide(row.selection_type);
          if (side === null) continue;

          // R-16G-A — provider-side home/away sanity guard. Preserved
          // intact under Step 2E.1; runs per row regardless of which
          // bucket the row came from.
          //
          // Some books (kalshi observed 2026-06-04 across TOR@ATL,
          // LAD@ARI, PIT@HOU) emit /odds rows whose own `home_team`
          // and `away_team` strings are INVERTED relative to the
          // actual event. Defensive guard: REJECT mismatched rows.
          if (side === "home" || side === "away") {
            const rowHomeAbbr = normalizeMlbTeamName(asStringOrNull(row.home_team));
            const rowAwayAbbr = normalizeMlbTeamName(asStringOrNull(row.away_team));
            if (
              rowHomeAbbr !== null &&
              rowAwayAbbr !== null &&
              (rowHomeAbbr !== ev.home || rowAwayAbbr !== ev.away)
            ) {
              rejectedHomeAwayMismatch++;
              console.warn(
                `[SharpAPIOddsProvider] R-16G-A reject: ${sportsbook} row has home="${row.home_team}"/away="${row.away_team}" but event ${ev.away}@${ev.home}. Likely provider side-flip; dropping to prevent wrong-side price.`
              );
              continue;
            }
          }

          // R-17 Step 2E.1 — cross-bucket dedupe key. Same (book,
          // market, side, line_value) appearing in two buckets is
          // counted once. Odds value is deliberately NOT in the
          // key — if `_b0` says caesars ML home -120 and `_b3` says
          // caesars ML home -118 a beat later, we keep the FIRST
          // observation (the one we wrote on the first bucket call).
          // The downstream `lines` upsert is keyed on (game, market,
          // sportsbook, side) anyway, so writing both would just
          // overwrite. Cleanest behavior: first wins, audit counter
          // shows how many duplicates we saw.
          const lineValue = asNumberOrNull(row.line);
          const dedupeKey = `${ev.gameExternalId}|${marketType}|${sportsbook}|${side}|${lineValue ?? "null"}`;
          if (seenKeys.has(dedupeKey)) {
            dedupedAcrossBuckets++;
            continue;
          }
          seenKeys.add(dedupeKey);

          if (marketType === "moneyline") mlFromOdds++;
          else if (marketType === "total") totFromOdds++;
          else if (marketType === "spread") sprFromOdds++;
          else other++;
          books.add(sportsbook);

          records.push({
            game_external_id: ev.gameExternalId,
            market_type: marketType,
            player_external_id: null,
            sportsbook,
            side,
            line_value: lineValue,
            odds_american: asNumberOrNull(row.odds_american),
            odds_decimal: asNumberOrNull(row.odds_decimal),
            implied_probability: asNumberOrNull(row.odds_probability),
            ev_percent: null,
            fair_odds: null,
            is_ev_positive: null,
            fetched_at:
              asStringOrNull(row.last_seen_at) ??
              asStringOrNull(row.wire_received_at) ??
              fetchedAt,
          });
        }
      }

      // Aggregate per-game oddsCallStatus from per-bucket statuses.
      // - "ok" if any bucket returned rows
      // - "empty" if all calls succeeded but returned zero rows
      // - "not_found" if all calls were 404
      // - "skipped_call_cap" if NO bucket was fetched (cap hit before
      //                       this event was reached)
      //
      // Reflects the ADVERTISED buckets only. Speculative recovery
      // (Step 2F.1, below) lives on its own diagnostic fields so the
      // advertised-vs-speculative split stays legible to operators.
      let status: V2OddsCallStatus;
      if (bucketsFetched.length === 0) {
        status = "skipped_call_cap";
      } else if (bucketStatuses.some((s) => s === "ok")) {
        status = "ok";
      } else if (bucketStatuses.every((s) => s === "not_found")) {
        status = "not_found";
      } else {
        status = "empty";
      }

      // ─── R-17 Step 2F.1 — targeted speculative bucket probe ──────
      //
      // The 2026-06-05 audit found SharpAPI silently publishes a
      // small payload on `_b3` for events advertised at `_b0`
      // (prophetx-only on 3 of 14 events tested). The opposite case
      // (`_b0` for events advertised at `_b3`) returned zero rows
      // on every event tested today but is symmetric and cheap, so
      // we probe it too. `_b1` / `_b2` always returned zero rows
      // and are deliberately not in SPECULATIVE_PROBE_SUFFIXES.
      //
      // Speculative rows share the SAME seenKeys dedupe set as the
      // advertised loop above. If a (book, market, side, line) tuple
      // appears in both an advertised bucket AND a speculative one,
      // the advertised row wins (already in seenKeys) and the
      // speculative copy is counted in dedupedAcrossBuckets. The
      // recovery counters below capture only TRUE additions.
      const observedSuffixSet = new Set<string>(
        ev.effectiveEventIds
          .map((id) => id.match(/_b\d+$/)?.[0] ?? "")
          .filter((s): s is string => s.length > 0)
      );
      const speculativeProbeIds: Array<{ suffix: string; fullId: string }> = [];
      for (const sfx of SPECULATIVE_PROBE_SUFFIXES) {
        if (observedSuffixSet.has(sfx)) continue;
        speculativeProbeIds.push({
          suffix: sfx,
          fullId: `${ev.splitsEventId}${sfx}`,
        });
      }

      const speculativeBucketsAttempted: string[] = [];
      const speculativeBucketsWithRows: string[] = [];
      const speculativeBucketsCallCapped: string[] = [];
      let speculativeRowsRecovered = 0;
      const booksBeforeSpeculative = new Set(books);

      for (const probe of speculativeProbeIds) {
        if (callsUsed >= MAX_CALLS_PER_INVOCATION) {
          speculativeBucketsCallCapped.push(probe.fullId);
          continue;
        }
        callsUsed++;
        speculativeBucketsAttempted.push(probe.fullId);

        let probeRows: RawOddsRow[];
        try {
          probeRows = await this.client.fetchAll<RawOddsRow>({
            path: "/odds",
            query: { event_id: probe.fullId },
            maxPages: 3,
          });
        } catch (e) {
          if (e instanceof SharpApiNotFoundError) {
            probeRows = [];
          } else {
            throw e;
          }
        }

        let mergedFromThisBucket = 0;
        for (const row of probeRows) {
          // Same row-filter discipline as the advertised loop.
          const rowLeague = asStringOrNull(row.league)?.toLowerCase();
          if (rowLeague !== null && rowLeague !== undefined && rowLeague !== "mlb") {
            continue;
          }
          if (row.is_alternate_line === true) continue;

          const marketType = mapMarketType(asStringOrNull(row.market_type));
          if (marketType === null) continue;
          const sportsbook = mapSportsbook(asStringOrNull(row.sportsbook));
          if (sportsbook === null) continue;
          const side = mapSide(row.selection_type);
          if (side === null) continue;

          // R-16G-A — preserved on the speculative path. Same rationale:
          // some books emit rows with inverted home/away strings; reject
          // those before they reach `lines`.
          if (side === "home" || side === "away") {
            const rowHomeAbbr = normalizeMlbTeamName(asStringOrNull(row.home_team));
            const rowAwayAbbr = normalizeMlbTeamName(asStringOrNull(row.away_team));
            if (
              rowHomeAbbr !== null &&
              rowAwayAbbr !== null &&
              (rowHomeAbbr !== ev.home || rowAwayAbbr !== ev.away)
            ) {
              rejectedHomeAwayMismatch++;
              console.warn(
                `[SharpAPIOddsProvider speculative] R-16G-A reject: ${sportsbook} row has home="${row.home_team}"/away="${row.away_team}" but event ${ev.away}@${ev.home}.`
              );
              continue;
            }
          }

          const lineValue = asNumberOrNull(row.line);
          const dedupeKey = `${ev.gameExternalId}|${marketType}|${sportsbook}|${side}|${lineValue ?? "null"}`;
          if (seenKeys.has(dedupeKey)) {
            dedupedAcrossBuckets++;
            continue;
          }
          seenKeys.add(dedupeKey);

          if (marketType === "moneyline") mlFromOdds++;
          else if (marketType === "total") totFromOdds++;
          else if (marketType === "spread") sprFromOdds++;
          else other++;
          books.add(sportsbook);

          records.push({
            game_external_id: ev.gameExternalId,
            market_type: marketType,
            player_external_id: null,
            sportsbook,
            side,
            line_value: lineValue,
            odds_american: asNumberOrNull(row.odds_american),
            odds_decimal: asNumberOrNull(row.odds_decimal),
            implied_probability: asNumberOrNull(row.odds_probability),
            ev_percent: null,
            fair_odds: null,
            is_ev_positive: null,
            fetched_at:
              asStringOrNull(row.last_seen_at) ??
              asStringOrNull(row.wire_received_at) ??
              fetchedAt,
          });
          mergedFromThisBucket++;
        }

        if (mergedFromThisBucket > 0) {
          speculativeBucketsWithRows.push(probe.fullId);
          speculativeRowsRecovered += mergedFromThisBucket;
        }
      }

      // Books that appeared ONLY via speculative buckets (i.e. weren't
      // already in `books` when the speculative phase started).
      const speculativeBooksRecovered: string[] = [];
      for (const b of books) {
        if (!booksBeforeSpeculative.has(b)) speculativeBooksRecovered.push(b);
      }
      speculativeBooksRecovered.sort();

      // R-16E — per-market /splits fallback.
      // For each game-level market where /odds returned ZERO rows, look
      // at the /splits payload for this team-pair and synthesize rows
      // labeled `sportsbook = "splits_consensus"`. This restores ML
      // no-vig for games where /odds is silent at this minute, and
      // surfaces total/spread line values (no juice — /splits does not
      // carry over/under or runline juice odds).
      let mlFromSplits = 0,
        totFromSplits = 0,
        sprFromSplits = 0;
      const splitsRow = splitsRowByPair.get(`${ev.home}|${ev.away}`);
      const splitsFetchedAt =
        asStringOrNull(splitsRow?.fetched_at as unknown) ?? fetchedAt;

      if (splitsRow !== undefined) {
        // ML — both sides + American odds present → full fallback.
        if (mlFromOdds === 0) {
          const ml = (splitsRow as Record<string, unknown>).moneyline as
            | Record<string, unknown>
            | undefined
            | null;
          const homeAm = asNumberOrNull(ml?.home_odds);
          const awayAm = asNumberOrNull(ml?.away_odds);
          if (ml !== undefined && ml !== null && homeAm !== null && awayAm !== null) {
            records.push(makeSplitsLineRecord({
              gameExternalId: ev.gameExternalId,
              marketType: "moneyline",
              side: "home",
              odds_american: homeAm,
              line_value: null,
              fetched_at: splitsFetchedAt,
            }));
            records.push(makeSplitsLineRecord({
              gameExternalId: ev.gameExternalId,
              marketType: "moneyline",
              side: "away",
              odds_american: awayAm,
              line_value: null,
              fetched_at: splitsFetchedAt,
            }));
            mlFromSplits = 2;
            books.add(SPLITS_CONSENSUS_BOOK);
          }
        }

        // Total — only the LINE value is in /splits (no over/under
        // juice). Synthesize over/under rows with line_value populated
        // and odds_american = null. Downstream no-vig will NOT compute
        // a market implied prob from these (it requires odds_american
        // on both sides) — that's correct: no juice → no honest implied
        // prob. But the UI can display the listed total.
        if (totFromOdds === 0) {
          const total = (splitsRow as Record<string, unknown>).total as
            | Record<string, unknown>
            | undefined
            | null;
          const totalLine = asNumberOrNull(total?.line);
          if (total !== undefined && total !== null && totalLine !== null) {
            records.push(makeSplitsLineRecord({
              gameExternalId: ev.gameExternalId,
              marketType: "total",
              side: "over",
              odds_american: null,
              line_value: totalLine,
              fetched_at: splitsFetchedAt,
            }));
            records.push(makeSplitsLineRecord({
              gameExternalId: ev.gameExternalId,
              marketType: "total",
              side: "under",
              odds_american: null,
              line_value: totalLine,
              fetched_at: splitsFetchedAt,
            }));
            totFromSplits = 2;
            books.add(SPLITS_CONSENSUS_BOOK);
          }
        }

        // Spread — same shape as total. SharpAPI's /splits encodes the
        // runline LINE in `spread.home_odds`/`spread.away_odds` (despite
        // the misleading field name). We store the absolute line as
        // line_value on home/away rows; odds_american stays null because
        // /splits does NOT carry runline juice.
        if (sprFromOdds === 0) {
          const spread = (splitsRow as Record<string, unknown>).spread as
            | Record<string, unknown>
            | undefined
            | null;
          const homeLine = asNumberOrNull(spread?.home_odds);
          const awayLine = asNumberOrNull(spread?.away_odds);
          if (spread !== undefined && spread !== null && homeLine !== null && awayLine !== null) {
            records.push(makeSplitsLineRecord({
              gameExternalId: ev.gameExternalId,
              marketType: "spread",
              side: "home",
              odds_american: null,
              line_value: homeLine,
              fetched_at: splitsFetchedAt,
            }));
            records.push(makeSplitsLineRecord({
              gameExternalId: ev.gameExternalId,
              marketType: "spread",
              side: "away",
              odds_american: null,
              line_value: awayLine,
              fetched_at: splitsFetchedAt,
            }));
            sprFromSplits = 2;
            books.add(SPLITS_CONSENSUS_BOOK);
          }
        }
      }

      perGame.push({
        gameExternalId: ev.gameExternalId,
        home: ev.home,
        away: ev.away,
        splitsEventId: ev.splitsEventId,
        // R-17 Step 2E.1 — `effectiveEventId` retained as first-of-list
        // for refresh-lines.ts back-compat; new `effectiveEventIds` /
        // `bucketsFetched` carry the full multi-bucket truth.
        effectiveEventId: ev.effectiveEventIds[0] ?? "",
        effectiveEventIds: ev.effectiveEventIds,
        bucketsObserved,
        bucketsFetched,
        bucketsCallCapped,
        dedupedAcrossBuckets,
        // R-17 Step 2F.1 — speculative bucket probe diagnostics.
        speculativeBucketsAttempted,
        speculativeBucketsWithRows,
        speculativeBucketsCallCapped,
        speculativeBooksRecovered,
        speculativeRowsRecovered,
        eventIdSource: ev.eventIdSource,
        oddsCallStatus: status,
        mlRows: mlFromOdds + mlFromSplits,
        totalRows: totFromOdds + totFromSplits,
        spreadRows: sprFromOdds + sprFromSplits,
        otherRows: other,
        books: [...books].sort(),
        mlRowsFromOdds: mlFromOdds,
        totalRowsFromOdds: totFromOdds,
        spreadRowsFromOdds: sprFromOdds,
        mlRowsFromSplits: mlFromSplits,
        totalRowsFromSplits: totFromSplits,
        spreadRowsFromSplits: sprFromSplits,
      });
    }

    const discovery: V2DiscoveryReport = {
      // R-17 Step 2B — discovery source switched to /opportunities/ev.
      discoverySource: "opportunities_ev",
      // R-17 Step 2B — `discoveryStats` now sourced from the EV
      // discovery (was splits stats pre-2B). The {With,WithSplitsId}*
      // counters stay in the report shape for back-compat: all
      // canonical events are suffixed in the new scheme, so
      // eventsWithSplitsIdOnly is always 0.
      discoveryStats: evResult.stats,
      eventsDiscovered: evResult.events.length,
      eventsResolvedToGame: resolved.length,
      eventsUnresolvedTeamPair: unresolvedTeamPairs,
      eventsWithSuffixedId: resolved.filter(
        (r) => r.eventIdSource === "opportunities_suffixed"
      ).length,
      eventsWithSplitsIdOnly: resolved.filter(
        (r) => r.eventIdSource === "splits_stripped"
      ).length,
      opportunitiesUnavailable,
      apiCallsMade: callsUsed,
      perGame,
    };

    return { records, discovery };
  }
}

// ─────────────────────────────────────────────────────────────
// V2 discovery report types
// ─────────────────────────────────────────────────────────────

export type V2OddsCallStatus =
  | "ok"
  | "empty"
  | "not_found"
  | "skipped_call_cap";

export type V2DiscoveryPerGame = {
  gameExternalId: number;
  home: MlbTeamAbbrev;
  away: MlbTeamAbbrev;
  splitsEventId: string;
  /** First observed suffixed event_id. Retained for refresh-lines.ts
   *  back-compat; new consumers should prefer `effectiveEventIds`. */
  effectiveEventId: string;
  /** R-17 Step 2E.1 — every bucket suffix observed for this game in
   *  `/opportunities/ev`. The harvest loop hits one /odds call per
   *  entry and merges with a cross-bucket dedupe key. */
  effectiveEventIds: string[];
  /** R-17 Step 2E.1 — every bucket suffix observed (alias of
   *  effectiveEventIds, semantically clearer in operator banners). */
  bucketsObserved: string[];
  /** Buckets we actually called /odds for (subset of bucketsObserved
   *  unless the call cap intervened). */
  bucketsFetched: string[];
  /** Buckets we couldn't fetch because the per-invocation call cap
   *  was already hit. Empty in steady state. */
  bucketsCallCapped: string[];
  /** Rows skipped because (book, market, side, line) already present
   *  from an earlier bucket. Diagnostic — bigger numbers mean the
   *  buckets carried overlapping content, not a code defect.
   *  Step 2F.1: this counter also increments for speculative-bucket
   *  rows that collide with an advertised-bucket row. */
  dedupedAcrossBuckets: number;
  /** R-17 Step 2F.1 — speculative bucket probe diagnostics. The probe
   *  fires when /opportunities/ev advertised only one of `_b0` / `_b3`
   *  for this event; it queries the opposite suffix to recover books
   *  that SharpAPI doesn't advertise (e.g. prophetx on the 2026-06-05
   *  slate). `_b1` / `_b2` are NEVER probed — the Step 2F audit found
   *  zero yield on those. Speculative rows feed the same dedupe set
   *  + records array as the advertised loop; these fields capture only
   *  the additive recovery. */
  speculativeBucketsAttempted: string[];
  /** Subset of speculativeBucketsAttempted whose /odds response
   *  contributed at least one merged record (after dedupe + filters
   *  + R-16G-A team guard). */
  speculativeBucketsWithRows: string[];
  /** Speculative probes blocked by MAX_CALLS_PER_INVOCATION. Empty in
   *  steady state — today's 15-game slate worst case is well inside
   *  the 50-call budget. */
  speculativeBucketsCallCapped: string[];
  /** Sportsbooks (alphabetical) that appeared ONLY in speculative
   *  buckets — i.e. weren't in `books` after the advertised loop.
   *  This is the recovery signal: non-empty means /opportunities/ev
   *  was silently hiding those books. */
  speculativeBooksRecovered: string[];
  /** Count of records pushed during the speculative phase (after
   *  dedupe + filters). 0 when probes fired but every row collided
   *  with an advertised bucket. */
  speculativeRowsRecovered: number;
  eventIdSource: "opportunities_suffixed" | "splits_stripped";
  oddsCallStatus: V2OddsCallStatus;
  /** Combined row counts (real /odds + R-16E /splits fallback). */
  mlRows: number;
  totalRows: number;
  spreadRows: number;
  otherRows: number;
  /** Distinct sportsbook names contributing rows (includes
   *  `"splits_consensus"` when /splits fallback fired). */
  books: string[];
  /** R-16E — per-source breakdown for the operator report. */
  mlRowsFromOdds: number;
  totalRowsFromOdds: number;
  spreadRowsFromOdds: number;
  mlRowsFromSplits: number;
  totalRowsFromSplits: number;
  spreadRowsFromSplits: number;
};

export type V2DiscoveryReport = {
  // R-17 Step 2B — discovery source string is "opportunities_ev" going
  // forward. `splitsStats` was renamed to `discoveryStats` and now
  // carries the /opportunities/ev discovery stats (which include extra
  // counters like skippedPlayerProp / skippedAlternateLine / dedupedRows
  // / keptEvents that the pre-2B splits stats didn't have).
  discoverySource: "opportunities_ev";
  discoveryStats: EvDiscoveryStats;
  eventsDiscovered: number;
  eventsResolvedToGame: number;
  eventsUnresolvedTeamPair: Array<{ home: MlbTeamAbbrev; away: MlbTeamAbbrev }>;
  eventsWithSuffixedId: number;
  /** Kept in report shape for back-compat. Always 0 under R-17 Step 2B
   *  because all canonical events come from /opportunities/ev suffixed. */
  eventsWithSplitsIdOnly: number;
  opportunitiesUnavailable: boolean;
  apiCallsMade: number;
  perGame: V2DiscoveryPerGame[];
};

function emptyDiscoveryReport(): V2DiscoveryReport {
  return {
    discoverySource: "opportunities_ev",
    discoveryStats: {
      totalRows: 0,
      keptEvents: 0,
      skippedNonMlb: 0,
      skippedMissingEventId: 0,
      skippedPlayerProp: 0,
      skippedAlternateLine: 0,
      skippedDateUnparseable: 0,
      skippedWrongDate: 0,
      skippedTeamUnresolved: 0,
      dedupedRows: 0,
      multiBucketEvents: [],
    },
    eventsDiscovered: 0,
    eventsResolvedToGame: 0,
    eventsUnresolvedTeamPair: [],
    eventsWithSuffixedId: 0,
    eventsWithSplitsIdOnly: 0,
    opportunitiesUnavailable: false,
    apiCallsMade: 0,
    perGame: [],
  };
}

// ─────────────────────────────────────────────────────────────
// Test-only exports — exposed for the R-17 Step 2D mapping regression
// suite (and any future provider tests that want to exercise the
// mapping helpers without spinning up a SharpApiClient). Production
// code never imports from `__TEST__`.
// ─────────────────────────────────────────────────────────────

export const __TEST__ = {
  mapMarketType,
  mapSportsbook,
  mapSide,
};

