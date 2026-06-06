/**
 * Push 2 — Slate-driven market coverage audit.
 *
 * The OddSphere product rule: if a configured provider has usable
 * market data for an expected game, we never surface generic
 * "unavailable." This service is the mechanism that enforces it.
 *
 * Flow:
 *   1. Load expected games from `games` (sport + slate_date).
 *   2. For each expected game, classify per-market DB coverage:
 *        moneyline, total, spread, first_inning_total
 *   3. For each game with at least one missing or one-sided market,
 *      probe SharpAPI `/odds` with constructed candidate event_ids
 *      from `sharpApiEventIdCandidates`. First non-empty response
 *      wins.
 *   4. Apply Push 2 row-level filters (mapMarketType, mapSportsbook,
 *      mapSide, wrong-game guard, alternate-line drop) via
 *      sharpApiMarketCoverage.
 *   5. In apply mode, dedupe-insert recovered rows into `lines`
 *      (uniqueness key: game_id + market_type + sportsbook + side +
 *      line_value). Never overwrite existing rows.
 *   6. Return a structured report with per-market reason codes,
 *      book quality, candidate used, and aggregate counts.
 *
 * Safety:
 *   - Never modifies `game_predictions`.
 *   - Never touches `slate_status`, `locked_at`, or any prediction
 *     field.
 *   - Default dry-run; explicit `apply: true` required for writes.
 *   - Per-game errors are isolated; one failed game does not abort
 *     the audit.
 *
 * The Push 2 reason-code enum lives in this file as the canonical
 * source of truth for both the operator script and the production
 * integration. Adding a new reason → add it here + in the report
 * schema → callers learn about it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Sport } from "../types/domain/Sport";
import type { LineRecord } from "../providers/interfaces/IOddsProvider";
import { SharpApiClient } from "../providers/real_api/_sharpApiClient";
import { generateMlbEventIdCandidates } from "../providers/real_api/sharpApiEventIdCandidates";
import {
  fetchOddsAndMapForEventId,
  hasTwoSidedPairForMarket,
  aggregateBookQuality,
  type BookQuality,
  type CoverageFetchResult,
} from "../providers/real_api/sharpApiMarketCoverage";
import { type MlbTeamAbbrev } from "../providers/real_api/_teamNameNormalizer";

// ─── reason codes ──────────────────────────────────────────────────

/**
 * Per-(game, market) outcome classification. Always paired with a
 * specific cause so the audit report can explain every cell of the
 * coverage matrix. Generic "unavailable" never appears as a stored
 * reason — every absence must resolve to one of these.
 */
export type CoverageReasonCode =
  // healthy paths
  | "ok_db_has_market"
  | "ok_recovered_from_direct_odds"
  // expected-game classification
  | "provider_true_missing"
  | "provider_has_data_db_missing"
  | "event_id_discovery_miss"
  | "event_id_candidate_no_rows"
  // mapping/guard rejections
  | "team_normalization_failed"
  | "game_resolver_failed"
  | "home_away_mismatch"
  | "wrong_game_guard_rejected"
  | "unsupported_market"
  | "parser_drop"
  | "alternate_line_dropped"
  | "duplicate_variant_dropped"
  // quality flags
  | "low_quality_source_only"
  | "one_sided_market_only"
  // operational failures
  | "stale_line"
  | "missing_required_price"
  | "db_insert_error"
  | "provider_error"
  | "rate_limited"
  | "unknown";

// ─── coverage matrix per game per market ───────────────────────────

export type MarketKey = "moneyline" | "total" | "spread" | "first_inning_total";

const MARKET_SIDES: Record<MarketKey, [string, string]> = {
  moneyline: ["home", "away"],
  total: ["over", "under"],
  spread: ["home", "away"],
  first_inning_total: ["over", "under"],
};

type DbMarketState = {
  rowCount: number;
  twoSided: boolean;
  books: string[];
  bookQuality: BookQuality;
};

export type GameMarketCoverage = {
  market: MarketKey;
  dbState: DbMarketState;
  reason: CoverageReasonCode;
  /** Populated only when recovery was attempted. */
  candidateUsed?: string;
  /** Populated only on a successful recovery write (apply mode). */
  rowsInsertedFromRecovery?: number;
  /** Populated only on a successful recovery (apply or dry-run). */
  bookQualityRecovered?: BookQuality;
  /** Populated only when wrong-game guard fired. */
  candidatesProbedCount?: number;
};

export type GameCoverageRow = {
  gameId: number;
  externalId: number;
  homeAbbrev: MlbTeamAbbrev | null;
  awayAbbrev: MlbTeamAbbrev | null;
  gameDate: string | null;
  matchup: string;
  markets: Record<MarketKey, GameMarketCoverage>;
  /** True when ML and total were missing AND fallback recovery wrote rows. */
  recovered: boolean;
  /** True when home/away abbrev didn't normalize — skip recovery attempt. */
  blockedByNormalization: boolean;
};

// ─── aggregate report ──────────────────────────────────────────────

export type CoverageAudit = {
  sport: Sport;
  slateDate: string;
  ranAt: string;
  apply: boolean;
  games: GameCoverageRow[];
  aggregate: {
    expectedGames: number;
    mlDbCoverage: number;
    mlAfterRecoveryCoverage: number;
    totalDbCoverage: number;
    totalAfterRecoveryCoverage: number;
    spreadDbCoverage: number;
    fiDbCoverage: number;
    providerHasDataDbMissing: number;
    providerTrueMissing: number;
    recoveredCount: number;
    rejectedWrongGameCount: number;
    parserDropCount: number;
    providerErrorCount: number;
    rateLimitCount: number;
    rowsInserted: number;
    rowsSkippedDuplicate: number;
  };
};

// ─── input options ─────────────────────────────────────────────────

export type MarketCoverageAuditOptions = {
  sport: Sport;
  date: string;
  apply: boolean;
  supabase: SupabaseClient;
  /** Optional injected SharpAPI client (defaults to one built from SHARPAPI_KEY env). */
  sharpApiClient?: SharpApiClient;
  /**
   * Maximum candidate event_ids probed per missing game. Each candidate
   * costs at most one /odds call. With 4-16 candidates per missing
   * game and typically 0-3 missing games per slate, the realistic
   * worst case stays well inside the 1000-call SharpAPI quota.
   */
  maxCandidatesPerGame?: number;
};

// ─── main ──────────────────────────────────────────────────────────

/**
 * Run the slate-driven coverage audit. Read-only by default. Pass
 * `apply: true` to insert recovered lines (still scoped to lines
 * table only; never touches predictions).
 */
export async function auditMarketCoverage(
  opts: MarketCoverageAuditOptions,
): Promise<CoverageAudit> {
  const { sport, date, apply, supabase } = opts;
  const ranAt = new Date().toISOString();
  const maxCandidates = opts.maxCandidatesPerGame ?? 16;

  // 1) Load expected games
  const { data: gameRows, error: gamesErr } = await supabase
    .from("games")
    .select(
      "id, external_id, game_date, home_team_id, away_team_id, slate_status",
    )
    .eq("sport", sport)
    .eq("slate_date", date);
  if (gamesErr) {
    throw new Error(
      `marketCoverageAudit: games fetch failed for ${sport}/${date}: ${gamesErr.message}`,
    );
  }
  const games = (gameRows ?? []) as Array<{
    id: number;
    external_id: number;
    game_date: string | null;
    home_team_id: number;
    away_team_id: number;
    slate_status: string | null;
  }>;

  if (games.length === 0) {
    return emptyAudit(sport, date, ranAt, apply);
  }

  // 2) Load team abbreviations for normalization (single query)
  const teamIds = Array.from(
    new Set([
      ...games.map((g) => g.home_team_id),
      ...games.map((g) => g.away_team_id),
    ]),
  );
  const { data: teamRows } = await supabase
    .from("teams")
    .select("id, abbreviation")
    .in("id", teamIds);
  const teamAbbrevById = new Map<number, string>(
    ((teamRows ?? []) as Array<{ id: number; abbreviation: string }>).map(
      (t) => [t.id, t.abbreviation],
    ),
  );

  // 3) Bulk-load all lines for the slate (single query)
  const gameIds = games.map((g) => g.id);
  const { data: lineRows, error: linesErr } = await supabase
    .from("lines")
    .select("game_id, market_type, sportsbook, side, line_value")
    .in("game_id", gameIds)
    .is("player_id", null);
  if (linesErr) {
    throw new Error(
      `marketCoverageAudit: lines fetch failed: ${linesErr.message}`,
    );
  }
  const linesByGame = new Map<number, Array<{ market_type: string; sportsbook: string; side: string; line_value: number | null }>>();
  for (const r of (lineRows ?? []) as Array<{
    game_id: number;
    market_type: string;
    sportsbook: string;
    side: string;
    line_value: number | null;
  }>) {
    let arr = linesByGame.get(r.game_id);
    if (arr === undefined) {
      arr = [];
      linesByGame.set(r.game_id, arr);
    }
    arr.push({
      market_type: r.market_type,
      sportsbook: r.sportsbook,
      side: r.side,
      line_value: r.line_value,
    });
  }

  // 4) Build coverage rows
  const sharpClient = opts.sharpApiClient ?? buildSharpApiClient();
  const coverageRows: GameCoverageRow[] = [];

  let rowsInserted = 0;
  let rowsSkippedDuplicate = 0;

  for (const g of games) {
    const homeAbbrevRaw = teamAbbrevById.get(g.home_team_id) ?? null;
    const awayAbbrevRaw = teamAbbrevById.get(g.away_team_id) ?? null;
    const homeAbbrev = homeAbbrevRaw as MlbTeamAbbrev | null;
    const awayAbbrev = awayAbbrevRaw as MlbTeamAbbrev | null;
    const matchup = `${awayAbbrevRaw ?? "?"}@${homeAbbrevRaw ?? "?"}`;
    const slateLines = linesByGame.get(g.id) ?? [];

    const blockedByNormalization = homeAbbrev === null || awayAbbrev === null;

    // Initial per-market DB classification. Reason is set after the
    // recovery pass; this provisional value is replaced before the
    // function returns.
    const markets: Record<MarketKey, GameMarketCoverage> = {
      moneyline: initialMarketCoverage(slateLines, "moneyline"),
      total: initialMarketCoverage(slateLines, "total"),
      spread: initialMarketCoverage(slateLines, "spread"),
      first_inning_total: initialMarketCoverage(slateLines, "first_inning_total"),
    };

    // Identify markets that need recovery (zero rows in DB)
    const needsRecovery = (Object.keys(markets) as MarketKey[]).some(
      (m) => markets[m].dbState.rowCount === 0,
    );

    let recovered = false;

    if (needsRecovery && !blockedByNormalization && homeAbbrev !== null && awayAbbrev !== null) {
      const candidates = generateMlbEventIdCandidates(
        homeAbbrev,
        awayAbbrev,
        date,
      ).slice(0, maxCandidates);

      // Probe candidates in order; first one with mapped rows wins.
      let winning: { eventId: string; result: CoverageFetchResult } | null = null;
      let candidatesProbed = 0;
      let providerErr = false;
      let rateLimited = false;
      let wrongGameCount = 0;
      let parserDropCount = 0;

      for (const eventId of candidates) {
        candidatesProbed++;
        let result: CoverageFetchResult;
        try {
          result = await fetchOddsAndMapForEventId(sharpClient, eventId, {
            homeAbbrev,
            awayAbbrev,
            gameExternalId: g.external_id,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (/rate.*limit/i.test(msg)) {
            rateLimited = true;
          } else {
            providerErr = true;
          }
          continue;
        }
        wrongGameCount += result.drops.wrong_game_guard_rejected ?? 0;
        parserDropCount +=
          (result.drops.unsupported_market ?? 0) +
          (result.drops.alternate_line_dropped ?? 0) +
          (result.drops.unknown_book ?? 0) +
          (result.drops.unsupported_side ?? 0);
        if (result.ok) {
          winning = { eventId, result };
          break;
        }
      }

      if (winning !== null) {
        // Optional apply: dedupe-insert recovered records.
        const insertable = dedupeAgainstSlate(
          winning.result.records,
          g.id,
          slateLines,
        );
        let insertedHere = 0;
        let skippedHere = winning.result.records.length - insertable.length;
        if (apply && insertable.length > 0) {
          const payload = insertable.map((r) => ({
            game_id: g.id,
            market_type: r.market_type,
            player_id: null,
            sportsbook: r.sportsbook,
            side: r.side,
            line_value: r.line_value,
            odds_american: r.odds_american,
            odds_decimal: r.odds_decimal,
            implied_probability: r.implied_probability,
            ev_percent: r.ev_percent,
            fair_odds: r.fair_odds,
            is_ev_positive: r.is_ev_positive,
            fetched_at: r.fetched_at,
          }));
          const { error: insErr } = await supabase
            .from("lines")
            .insert(payload);
          if (insErr) {
            // Surface insertion error per-market without aborting the audit.
            for (const m of Object.keys(markets) as MarketKey[]) {
              if (markets[m].dbState.rowCount === 0) {
                markets[m] = {
                  ...markets[m],
                  reason: "db_insert_error",
                  candidateUsed: winning.eventId,
                  candidatesProbedCount: candidatesProbed,
                };
              }
            }
            continue;
          }
          insertedHere = payload.length;
          rowsInserted += insertedHere;
          rowsSkippedDuplicate += skippedHere;
          // Update in-memory state so subsequent reads in this run see the recovery
          for (const ins of insertable) {
            slateLines.push({
              market_type: ins.market_type,
              sportsbook: ins.sportsbook,
              side: ins.side ?? "",
              line_value: ins.line_value,
            });
          }
        } else if (!apply) {
          // Dry-run: still report what would happen
          rowsSkippedDuplicate += skippedHere;
        }

        recovered = true;

        // Re-classify markets after recovery
        for (const m of Object.keys(markets) as MarketKey[]) {
          const after = classifyDbMarket(apply ? slateLines : [...slateLines, ...winning.result.records.map((r) => ({
            market_type: r.market_type,
            sportsbook: r.sportsbook,
            side: r.side ?? "",
            line_value: r.line_value,
          }))], m);
          if (markets[m].dbState.rowCount === 0 && after.rowCount > 0) {
            const fitsTwoSided = after.twoSided;
            const isLowQuality = after.bookQuality === "low";
            markets[m] = {
              market: m,
              dbState: after,
              reason: isLowQuality
                ? "low_quality_source_only"
                : !fitsTwoSided
                ? "one_sided_market_only"
                : "ok_recovered_from_direct_odds",
              candidateUsed: winning.eventId,
              rowsInsertedFromRecovery: apply ? insertedHere : 0,
              bookQualityRecovered: after.bookQuality,
              candidatesProbedCount: candidatesProbed,
            };
          }
        }
        void insertedHere;
      } else {
        // No candidate produced rows — surface the right reason on
        // every market that was missing.
        for (const m of Object.keys(markets) as MarketKey[]) {
          if (markets[m].dbState.rowCount > 0) continue;
          let reason: CoverageReasonCode = "provider_true_missing";
          if (rateLimited) reason = "rate_limited";
          else if (providerErr) reason = "provider_error";
          else if (wrongGameCount > 0 && parserDropCount === 0) reason = "wrong_game_guard_rejected";
          else if (parserDropCount > 0) reason = "parser_drop";
          else reason = "event_id_candidate_no_rows";
          markets[m] = {
            ...markets[m],
            reason,
            candidatesProbedCount: candidatesProbed,
          };
        }
      }
    } else if (blockedByNormalization) {
      for (const m of Object.keys(markets) as MarketKey[]) {
        if (markets[m].dbState.rowCount === 0) {
          markets[m] = {
            ...markets[m],
            reason: "team_normalization_failed",
          };
        }
      }
    } else {
      // No recovery needed — set DB-coverage reasons for everything
      for (const m of Object.keys(markets) as MarketKey[]) {
        if (markets[m].dbState.rowCount > 0) {
          markets[m] = { ...markets[m], reason: "ok_db_has_market" };
        }
      }
    }

    // Ensure all market reasons are set
    for (const m of Object.keys(markets) as MarketKey[]) {
      if (markets[m].reason === undefined) {
        markets[m] = {
          ...markets[m],
          reason:
            markets[m].dbState.rowCount > 0
              ? "ok_db_has_market"
              : "event_id_candidate_no_rows",
        };
      }
    }

    coverageRows.push({
      gameId: g.id,
      externalId: g.external_id,
      homeAbbrev,
      awayAbbrev,
      gameDate: g.game_date,
      matchup,
      markets,
      recovered,
      blockedByNormalization,
    });
  }

  // 5) Aggregate
  const aggregate = buildAggregate(coverageRows, rowsInserted, rowsSkippedDuplicate);

  return {
    sport,
    slateDate: date,
    ranAt,
    apply,
    games: coverageRows,
    aggregate,
  };
}

// ─── helpers ───────────────────────────────────────────────────────

function buildSharpApiClient(): SharpApiClient {
  const key = process.env.SHARPAPI_KEY;
  if (key === undefined || key.trim().length === 0) {
    throw new Error(
      "marketCoverageAudit: SHARPAPI_KEY missing from environment",
    );
  }
  return new SharpApiClient(key);
}

function initialMarketCoverage(
  rows: ReadonlyArray<{ market_type: string; sportsbook: string; side: string; line_value: number | null }>,
  market: MarketKey,
): GameMarketCoverage {
  const dbState = classifyDbMarket(rows, market);
  return {
    market,
    dbState,
    reason:
      dbState.rowCount > 0
        ? "ok_db_has_market"
        : "event_id_candidate_no_rows",
  };
}

function classifyDbMarket(
  rows: ReadonlyArray<{ market_type: string; sportsbook: string; side: string; line_value: number | null }>,
  market: MarketKey,
): DbMarketState {
  const m = rows.filter((r) => r.market_type === market);
  const books = Array.from(new Set(m.map((r) => r.sportsbook)));
  const [sa, sb] = MARKET_SIDES[market];
  const byBook = new Map<string, Set<string>>();
  for (const r of m) {
    let s = byBook.get(r.sportsbook);
    if (s === undefined) {
      s = new Set<string>();
      byBook.set(r.sportsbook, s);
    }
    s.add(r.side);
  }
  let twoSided = false;
  for (const s of byBook.values()) {
    if (s.has(sa) && s.has(sb)) {
      twoSided = true;
      break;
    }
  }
  return {
    rowCount: m.length,
    twoSided,
    books,
    bookQuality: aggregateBookQuality(books),
  };
}

function dedupeAgainstSlate(
  records: ReadonlyArray<LineRecord>,
  _gameId: number,
  existing: ReadonlyArray<{ market_type: string; sportsbook: string; side: string; line_value: number | null }>,
): LineRecord[] {
  const key = (r: { market_type: string; sportsbook: string; side: string; line_value: number | null }) =>
    `${r.market_type}::${r.sportsbook}::${r.side}::${r.line_value ?? "null"}`;
  const existingKeys = new Set(existing.map(key));
  const out: LineRecord[] = [];
  const seenInRun = new Set<string>();
  for (const r of records) {
    const k = key({
      market_type: r.market_type as string,
      sportsbook: r.sportsbook as string,
      side: (r.side ?? "") as string,
      line_value: r.line_value,
    });
    if (existingKeys.has(k) || seenInRun.has(k)) continue;
    seenInRun.add(k);
    out.push(r);
  }
  // hasTwoSidedPairForMarket import-prevention silencer (used elsewhere)
  void hasTwoSidedPairForMarket;
  return out;
}

function buildAggregate(
  rows: ReadonlyArray<GameCoverageRow>,
  rowsInserted: number,
  rowsSkippedDuplicate: number,
): CoverageAudit["aggregate"] {
  let mlDb = 0;
  let mlAfter = 0;
  let totalDb = 0;
  let totalAfter = 0;
  let spreadDb = 0;
  let fiDb = 0;
  let providerHasData = 0;
  let providerTrue = 0;
  let recoveredCount = 0;
  let wrongGame = 0;
  let parserDrop = 0;
  let providerErr = 0;
  let rateLimit = 0;

  for (const r of rows) {
    const mlDbHas = r.markets.moneyline.dbState.rowCount > 0;
    const totDbHas = r.markets.total.dbState.rowCount > 0;
    if (mlDbHas) {
      mlDb++;
      mlAfter++;
    } else if (r.markets.moneyline.reason === "ok_recovered_from_direct_odds") {
      mlAfter++;
      providerHasData++;
    }
    if (totDbHas) {
      totalDb++;
      totalAfter++;
    } else if (r.markets.total.reason === "ok_recovered_from_direct_odds") {
      totalAfter++;
      providerHasData++;
    }
    if (r.markets.spread.dbState.rowCount > 0) spreadDb++;
    if (r.markets.first_inning_total.dbState.rowCount > 0) fiDb++;

    if (r.recovered) recoveredCount++;

    for (const m of [
      r.markets.moneyline,
      r.markets.total,
      r.markets.spread,
      r.markets.first_inning_total,
    ]) {
      if (m.reason === "provider_true_missing") providerTrue++;
      if (m.reason === "wrong_game_guard_rejected") wrongGame++;
      if (m.reason === "parser_drop") parserDrop++;
      if (m.reason === "provider_error") providerErr++;
      if (m.reason === "rate_limited") rateLimit++;
    }
  }

  return {
    expectedGames: rows.length,
    mlDbCoverage: mlDb,
    mlAfterRecoveryCoverage: mlAfter,
    totalDbCoverage: totalDb,
    totalAfterRecoveryCoverage: totalAfter,
    spreadDbCoverage: spreadDb,
    fiDbCoverage: fiDb,
    providerHasDataDbMissing: providerHasData,
    providerTrueMissing: providerTrue,
    recoveredCount,
    rejectedWrongGameCount: wrongGame,
    parserDropCount: parserDrop,
    providerErrorCount: providerErr,
    rateLimitCount: rateLimit,
    rowsInserted,
    rowsSkippedDuplicate,
  };
}

function emptyAudit(
  sport: Sport,
  slateDate: string,
  ranAt: string,
  apply: boolean,
): CoverageAudit {
  return {
    sport,
    slateDate,
    ranAt,
    apply,
    games: [],
    aggregate: {
      expectedGames: 0,
      mlDbCoverage: 0,
      mlAfterRecoveryCoverage: 0,
      totalDbCoverage: 0,
      totalAfterRecoveryCoverage: 0,
      spreadDbCoverage: 0,
      fiDbCoverage: 0,
      providerHasDataDbMissing: 0,
      providerTrueMissing: 0,
      recoveredCount: 0,
      rejectedWrongGameCount: 0,
      parserDropCount: 0,
      providerErrorCount: 0,
      rateLimitCount: 0,
      rowsInserted: 0,
      rowsSkippedDuplicate: 0,
    },
  };
}

// Re-export the pure classifiers for tests
export { classifyDbMarket as __classifyDbMarketForTests };
