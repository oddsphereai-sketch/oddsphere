/**
 * Phase 3B — DB feature snapshot pipeline.
 *
 * `buildFeatureSnapshots(sport, slate_date)` reads from the existing
 * provider-ingested tables and produces `GameSnapshot[]` ready for
 * `runMlbAutoModelV1`. The function is the boundary between the impure
 * world (DB reads) and the pure world (the model itself).
 *
 * Discipline:
 *   • Strictly read-only. No INSERT, UPDATE, DELETE, or UPSERT calls.
 *   • Batched queries — ~14 round trips per slate, no N+1.
 *   • Honest null fallbacks. Missing data → null in snapshot. Never
 *     imputes fake values; the model handles nulls gracefully.
 *   • No provider calls; consumes only data already ingested by the
 *     provider services (slateService, statsService, linesService,
 *     weatherService).
 *
 * V1 NOTE — CURRENT_SEASON:
 *   The season is derived from `slate_date` when possible (slate dates
 *   are YYYY-MM-DD). When the derivation fails (e.g. spring-training
 *   month in the previous calendar year), falls back to the
 *   CURRENT_SEASON_FALLBACK constant. TODO: revisit when V2 season
 *   handling adds spring-training / off-season awareness.
 *
 * V1 NOTE — Pitch quality direction (Phase 3B implementation finding):
 *   The Phase 3B planning doc proposed
 *     pitch_quality_score = 1.0 + (whiff - 0.22) × 0.4
 *   Implemented with the SIGN INVERTED:
 *     pitch_quality_score = 1.0 - (whiff - 0.22) × 0.4
 *   Reasoning: pitcherEraFactor in Phase 3A multiplies the era_factor
 *   by `pitch_adj`. A pitcher with a HIGHER whiff rate is BETTER
 *   (suppresses more runs), so `pitch_adj` must be LOWER for them
 *   (era_factor is "runs allowed per game / league avg"; lower factor
 *   = better pitcher). The proposed formula inverted the direction;
 *   the corrected sign keeps the [0.92, 1.08] clamp range identical
 *   but flows in the right direction. Flagged loudly in the
 *   Phase 3B implementation report for operator review.
 */

import { supabase } from "../db/supabase";
import { isBlockedSportsbook } from "../config/blockedSportsbooks";
import { BOOK_PRIORITY } from "../config/bookPriority";
import {
  filterToFreshestTotalLineCluster,
  selectMainTotalLine,
} from "../services/selectMainTotalLine";
import type { Sport } from "../types/domain/Sport";
import type {
  ActiveInjuries,
  BatterSnapshot,
  DataQuality,
  GameSnapshot,
  ParkSnapshot,
  SharpSnapshot,
  StarterSnapshot,
  TeamSnapshot,
  WeatherSnapshot,
} from "./types";
import { shrinkBullpenEra } from "./types";
import { buildMlbCoherentMarketPriceMap } from "./mlbCoherentMarketPriceMap";

/**
 * Fallback when slate_date can't yield a season number cleanly.
 * V1 baseline is 2026 (MLB season tracked by year). Revisit yearly.
 */
const CURRENT_SEASON_FALLBACK = 2026;

const SYNTHETIC_PRICE_BOOKS = new Set(["locked_snapshot", "recommendation_snapshot", "splits_consensus"]);

/**
 * Trusted real-book priority used by the model snapshot for ML and O/U prices.
 * Keep this derived from the public Daily Edge selector so prediction math,
 * displayed prices, and stream overlays all read the same book universe.
 */
const TRUSTED_REAL_BOOK_PRIORITY: readonly string[] = BOOK_PRIORITY.filter(
  (book) => !SYNTHETIC_PRICE_BOOKS.has(book) && !isBlockedSportsbook(book),
);

const TOTAL_BOOK_PRIORITY: readonly string[] = TRUSTED_REAL_BOOK_PRIORITY;
const ML_BOOK_PRIORITY: readonly string[] = TRUSTED_REAL_BOOK_PRIORITY;
const MODEL_PRICE_MAX_SOURCE_AGE_MS = 90 * 60 * 1000;
// Supabase/PostgREST projects commonly cap a response at 1,000 rows. A full
// MLB slate can exceed that once active team batters, lineups, relievers, and
// starters are combined, so every all-player lookup must stay below the cap.
const FEATURE_SNAPSHOT_PLAYER_BATCH_SIZE = 500;

/**
 * Lock-line guard (2026-06-09 phantom-alt-line fix).
 *
 * Wider real-book priority list used by the main-line corroboration
 * resolver (`pickMainTotalLine` below). Mirrors the writer's
 * `BOOK_PRIORITY` post-`05ae36e` (predictionRecordService.ts) and
 * intentionally EXCLUDES `splits_consensus` — consensus is a no-vig
 * synthetic and never a real-book main market price.
 *
 * Books listed AFTER `caesars` were missing from the original
 * `TOTAL_BOOK_PRIORITY` and that gap let the writer's fallback pick
 * the FIRST `lines` row when none of the 5 priority books were
 * present. This list is now derived from the shared customer-facing
 * trusted-book priority, excludes synthetic sources, and excludes blocked
 * sources such as Kalshi/Fliff so model snapshots and Daily Edge cards use
 * the same real-book universe.
 */
const REAL_BOOK_TOTAL_PRIORITY: readonly string[] = TRUSTED_REAL_BOOK_PRIORITY;
const REAL_BOOK_SET: ReadonlySet<string> = new Set(REAL_BOOK_TOTAL_PRIORITY);

/**
 * Audit kind for the total-line source recorded in snapshot_json.
 *   real_book          → corroborated real-book main line picked
 *   consensus_fallback → no corroborated real-book main; splits_consensus used
 *   unavailable        → no usable source; downstream should hold the market
 */
export type TotalLineSourceKind = "real_book" | "consensus_fallback" | "unavailable";

export type TotalLineResolution = {
  /** The line value to use, or null when unavailable. */
  listed_total: number | null;
  /** Pinnacle convenience flag (used by V2.2 market-source tier logic). */
  has_pinnacle_total: boolean;
  /** Audit kind for snapshot_json.total_line_source_at_lock. */
  source: TotalLineSourceKind;
  /** Sportsbook that supplied the line (null for consensus/unavailable). */
  book: string | null;
  /** Number of real-books corroborating the chosen line as their MAIN. */
  agreement_count: number;
  /** True when splits_consensus had a row at the same line. */
  consensus_at_same_line: boolean;
};

// ─────────────────────────────────────────────────────────────
// Top-level helpers
// ─────────────────────────────────────────────────────────────

/**
 * Derive the season year from `slate_date`. V1 MLB convention: the
 * calendar year of the slate is the season. Spring training (Feb-Mar)
 * stays in the same year because BDL keys season the same way.
 *
 * If `slate_date` can't be parsed, returns CURRENT_SEASON_FALLBACK.
 */
function deriveSeason(slate_date: string): number {
  const match = slate_date.match(/^(\d{4})-/);
  if (match === null) return CURRENT_SEASON_FALLBACK;
  const year = parseInt(match[1]!, 10);
  return Number.isFinite(year) ? year : CURRENT_SEASON_FALLBACK;
}

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

function asBoolOrFalse(v: unknown): boolean {
  return v === true || v === "true" || v === 1 || v === "1";
}

function isFreshModelPriceSource(observedAt: string | null | undefined, nowMs = Date.now()): boolean {
  if (observedAt === null || observedAt === undefined) return true;
  const observedMs = Date.parse(observedAt);
  if (!Number.isFinite(observedMs)) return false;
  return nowMs - observedMs <= MODEL_PRICE_MAX_SOURCE_AGE_MS;
}

function asHandedness(v: unknown): "L" | "R" | "S" | null {
  if (v === "L" || v === "R" || v === "S") return v;
  return null;
}

function asThrows(v: unknown): "L" | "R" | null {
  if (v === "L" || v === "R") return v;
  return null;
}

/**
 * Phase 3B pitch-quality formula (sign-corrected from planning doc):
 *
 *   weighted_whiff = SUM(whiff_rate × pct_of_total) for top 3 pitches
 *                    by pct_of_total
 *   pitch_quality_score = clamp(1.0 - (weighted_whiff - 0.22) × 0.4,
 *                               0.92, 1.08)
 *
 * Higher whiff → LOWER score → era_factor multiplied by < 1.0 → fewer
 * runs allowed. Returns null when fewer than 3 pitch-type rows with
 * non-null whiff_rate exist (don't manufacture a quality score from
 * sparse data).
 */
function computePitchQualityScore(
  pitches: Array<{ whiff_rate: number | null; pct_of_total: number | null }>
): number | null {
  const ranked = pitches
    .filter((p) => p.whiff_rate !== null && p.pct_of_total !== null)
    .sort((a, b) => (b.pct_of_total ?? 0) - (a.pct_of_total ?? 0))
    .slice(0, 3);
  if (ranked.length < 3) return null;
  const totalPct = ranked.reduce((s, p) => s + (p.pct_of_total ?? 0), 0);
  if (totalPct <= 0) return null;
  const weighted = ranked.reduce(
    (s, p) => s + ((p.whiff_rate ?? 0) * (p.pct_of_total ?? 0)) / totalPct,
    0
  );
  // V1 league baseline whiff_rate ≈ 0.22 (Statcast era composite).
  // Sign-inverted from planning doc — see file header note.
  const raw = 1.0 - (weighted - 0.22) * 0.4;
  return Math.max(0.92, Math.min(1.08, raw));
}

// ─────────────────────────────────────────────────────────────
// Internal row shapes
// ─────────────────────────────────────────────────────────────

type GameRow = {
  id: number;
  external_id: number;
  sport: string;
  slate_date: string;
  game_date: string;
  home_team_id: number | null;
  away_team_id: number | null;
  home_pitcher_id: number | null;
  away_pitcher_id: number | null;
  ballpark_id: number | null;
};

type TeamRow = {
  id: number;
  external_id: number;
  abbreviation: string;
};

type PlayerRow = {
  id: number;
  external_id: number;
  full_name: string;
  team_id: number | null;
  position_abbr: string | null;
  is_pitcher: boolean | null;
  bats: string | null;
  throws: string | null;
  active: boolean | null;
};

type LineupRow = {
  game_id: number | null;
  team_id: number | null;
  player_id: number | null;
  batting_position: number | null;
  starting_position: string | null;
  is_confirmed: boolean | null;
  is_dh: boolean | null;
};

type SeasonStatsRow = {
  player_id: number;
  season: number;
  season_type: string;
  pitching_era: number | null;
  pitching_whip: number | null;
  pitching_k_per_9: number | null;
  batting_obp: number | null;
  batting_slg: number | null;
  batting_ops: number | null;
  /** R-16J Step 1 — plate appearances; used as sample size for lineup-OPS shrinkage. */
  batting_pa: number | null;
  first_inning_era: number | null;
  first_inning_starts: number | null;
  first_inning_whip: number | null;
  // R-14B — workload counters for confidence dampening flags.
  pitching_gs: number | null;
  pitching_gp: number | null;
  pitching_ip: number | null;
};

type StarterSeasonStatsSelection = {
  row: SeasonStatsRow | undefined;
  source: "current" | "prior_season_proxy" | "missing";
};

type SplitRow = {
  player_id: number;
  season: number;
  split_type: string;
  ops: number | null;
};

type PitchStatRow = {
  player_id: number;
  pitch_type: string | null;
  pct_of_total: number | null;
  whiff_rate: number | null;
};

type InjuryRow = {
  player_id: number | null;
  is_active: boolean;
  status: string | null;
};

type BallparkRow = {
  id: number;
  park_factor_runs: number | null;
  is_dome: boolean | null;
};

type WeatherRow = {
  game_id: number | null;
  fetched_at: string | null;
  temperature_f: number | null;
  humidity_pct: number | null;
  wind_speed_mph: number | null;
  wind_direction_degrees: number | null;
  is_notable: boolean | null;
  notable_reason: string | null;
};

type LineRow = {
  game_id: number;
  market_type: string;
  sportsbook: string;
  side: string | null;
  line_value: number | null;
  odds_american: number | null;
  fetched_at?: string | null;
};

type SharpSignalRow = {
  game_id: number;
  market_type: string;
  side: string;
  pinnacle_fair_probability: number | null;
  is_plus_ev: boolean | null;
  ev_pct: number | null;
  public_betting_pct: number | null;
  public_money_pct: number | null;
};

type GamePredictionRow = {
  game_id: number | null;
  sport_specific: unknown;
};

// ─────────────────────────────────────────────────────────────
// Mappers — group rows by FK / lookup key
// ─────────────────────────────────────────────────────────────

function groupBy<T, K extends string | number>(
  rows: T[],
  key: (r: T) => K | null
): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const r of rows) {
    const k = key(r);
    if (k === null) continue;
    const list = map.get(k);
    if (list) list.push(r);
    else map.set(k, [r]);
  }
  return map;
}

function indexBy<T, K extends string | number>(
  rows: T[],
  key: (r: T) => K | null
): Map<K, T> {
  const map = new Map<K, T>();
  for (const r of rows) {
    const k = key(r);
    if (k === null) continue;
    if (!map.has(k)) map.set(k, r);
  }
  return map;
}

function hasUsableStarterSeasonStats(row: SeasonStatsRow | undefined): row is SeasonStatsRow {
  if (row === undefined) return false;
  return (
    row.pitching_era !== null ||
    row.pitching_whip !== null ||
    row.pitching_k_per_9 !== null ||
    row.pitching_gs !== null ||
    row.pitching_gp !== null ||
    row.pitching_ip !== null
  );
}

function selectStarterSeasonStats(
  current: SeasonStatsRow | undefined,
  prior: SeasonStatsRow | undefined,
): StarterSeasonStatsSelection {
  if (hasUsableStarterSeasonStats(current)) {
    return { row: current, source: "current" };
  }
  if (hasUsableStarterSeasonStats(prior)) {
    return { row: prior, source: "prior_season_proxy" };
  }
  return { row: undefined, source: "missing" };
}

// ─────────────────────────────────────────────────────────────
// Snapshot builders (pure transforms from raw rows)
// ─────────────────────────────────────────────────────────────

function buildTeamSnapshot(
  team: TeamRow,
  bullpenEraProxy: number | null,
  teamAvgOps: { mean: number | null; sample: number | null },
  bullpenEraProxyRaw: number | null = null,
  bullpenIp: number | null = null
): TeamSnapshot {
  return {
    team_external_id: team.external_id,
    abbreviation: team.abbreviation,
    bullpen_era_proxy: bullpenEraProxy,
    bullpen_era_proxy_raw: bullpenEraProxyRaw,
    bullpen_ip: bullpenIp,
    // No team_season_stats table in V1 — model doesn't consume this
    // field. Reporting honest null.
    season_runs_per_game: null,
    // R-16J Step 1.6 — Tier 3 of the FI offense fallback hierarchy.
    // Null when the team has no rostered batters with batting_pa ≥ 100.
    team_avg_batter_ops: teamAvgOps.mean,
    team_avg_batter_ops_sample: teamAvgOps.sample,
  };
}

function buildStarterSnapshot(
  player: PlayerRow,
  seasonStatsSelection: StarterSeasonStatsSelection,
  pitchStats: PitchStatRow[],
  lineups: LineupRow[],
  injuries: InjuryRow[]
): StarterSnapshot {
  const seasonStats = seasonStatsSelection.row;
  const useCurrentFirstInningStats = seasonStatsSelection.source === "current";
  const isConfirmed = lineups.some(
    (l) =>
      l.player_id === player.id &&
      l.is_confirmed === true &&
      (l.starting_position === "P" ||
        l.starting_position === "SP" ||
        l.starting_position === "RP")
  );
  const isScratched = injuries.some(
    (inj) => inj.player_id === player.id && inj.is_active && inj.status === "Out"
  );

  return {
    player_external_id: player.external_id,
    player_name: player.full_name,
    throws: asThrows(player.throws),
    season_era: seasonStats?.pitching_era ?? null,
    season_whip: seasonStats?.pitching_whip ?? null,
    season_k_per_9: seasonStats?.pitching_k_per_9 ?? null,
    season_stats_season: seasonStats?.season ?? null,
    season_stats_source: seasonStatsSelection.source,
    // V1: no rolling 30-day table. Phase 3.x optimization.
    last30_era: null,
    pitch_quality_score: computePitchQualityScore(pitchStats),
    is_confirmed: isConfirmed,
    is_scratched: isScratched,
    first_inning_era: useCurrentFirstInningStats ? (seasonStats?.first_inning_era ?? null) : null,
    first_inning_starts: useCurrentFirstInningStats ? (seasonStats?.first_inning_starts ?? null) : null,
    first_inning_whip: useCurrentFirstInningStats ? (seasonStats?.first_inning_whip ?? null) : null,
    season_games_started: seasonStats?.pitching_gs ?? null,
    season_games_pitched: seasonStats?.pitching_gp ?? null,
    season_innings_pitched: seasonStats?.pitching_ip ?? null,
  };
}

function buildBatterSnapshot(
  player: PlayerRow,
  lineupRow: LineupRow,
  seasonStats: SeasonStatsRow | undefined,
  splits: SplitRow[],
  lineupSource: "confirmed" | "projected"
): BatterSnapshot {
  const vsLhp = splits.find((s) => s.split_type === "vs_lhp")?.ops ?? null;
  const vsRhp = splits.find((s) => s.split_type === "vs_rhp")?.ops ?? null;
  return {
    player_external_id: player.external_id,
    player_name: player.full_name,
    batting_position: lineupRow.batting_position,
    bats: asHandedness(player.bats),
    season_obp: seasonStats?.batting_obp ?? null,
    season_slg: seasonStats?.batting_slg ?? null,
    season_ops: seasonStats?.batting_ops ?? null,
    season_pa: seasonStats?.batting_pa ?? null,
    vs_lhp_ops: vsLhp,
    vs_rhp_ops: vsRhp,
    // R-16J Step 1.6 — provenance flag for the FI offense fallback chain.
    lineup_source: lineupSource,
  };
}

function buildParkSnapshot(park: BallparkRow | undefined): ParkSnapshot | null {
  if (park === undefined) return null;
  return {
    park_factor_runs: park.park_factor_runs,
    is_dome: park.is_dome === true,
  };
}

function buildWeatherSnapshot(
  weather: WeatherRow | undefined
): WeatherSnapshot | null {
  if (weather === undefined) return null;
  return {
    temperature_f: weather.temperature_f,
    humidity_pct: weather.humidity_pct,
    wind_speed_mph: weather.wind_speed_mph,
    wind_direction_degrees: weather.wind_direction_degrees,
    is_notable: weather.is_notable === true,
    notable_reason: weather.notable_reason,
    standard_source: "weather_forecasts",
    standard_fetched_at: weather.fetched_at,
  };
}

/**
 * Pick `lines.line_value` for market_type='total' — corroboration-aware.
 *
 * 2026-06-09 phantom-alt-line fix: the previous resolver iterated only
 * 5 priority books then fell back to `totals.find(line_value !== null)`,
 * which on a SharpAPI-only feed (no pinnacle/dk/fd/betmgm/caesars rows)
 * routinely picked a Kalshi binary-contract alt line (every 0.5 from
 * 2.5..12.5) or a `splits_consensus` row as the "listed total". Two of
 * tonight's locked totals (SEA@BAL → 9.5, STL@NYM → 8.5) locked at
 * phantom alt lines because of that and would have graded against the
 * wrong line.
 *
 * New rules:
 *   1. Real-book set = sportsbook != splits_consensus AND in REAL_BOOK_TOTAL_PRIORITY.
 *   2. A (book, line) is a "main-line candidate" only when that book
 *      has BOTH over+under at that line (filters out alt-line rows
 *      where only one side is listed at a given price).
 *   3. A line is "corroborated" when ≥2 real-books have it as their
 *      main line, OR ≥1 real-book + splits_consensus has the same line.
 *   4. If no line is corroborated:
 *        a. fall back to splits_consensus.line_value (consensus_fallback)
 *        b. else return null (unavailable; caller MUST hold this market)
 *   5. Among corroborated lines, prefer the one with the most
 *      corroborators (real-books + consensus); tie-break by
 *      REAL_BOOK_TOTAL_PRIORITY winner.
 *
 * Returns the resolution with audit metadata for snapshot_json.
 */
function pickListedTotal(linesForGame: LineRow[]): TotalLineResolution {
  const totals = filterToFreshestTotalLineCluster(
    linesForGame.filter((l) => l.market_type === "total"),
  );

  // Consensus line(s) — splits_consensus has at most one main line per
  // game. Captured separately so we can use it as a corroborator AND as
  // the final fallback when no real-book main line is corroborated.
  const consensusRow = totals.find(
    (l) => l.sportsbook === "splits_consensus" && l.line_value !== null,
  );
  const consensusLine = consensusRow?.line_value ?? null;

  // Real-book set with both-side requirement → "main-line candidates".
  const realBook = totals.filter(
    (l) =>
      l.sportsbook !== "splits_consensus" &&
      REAL_BOOK_SET.has(l.sportsbook.toLowerCase()) &&
      l.line_value !== null &&
      (l.side === "over" || l.side === "under"),
  );
  const bookLineSides = new Map<string, Set<string>>(); // "book::line" → {over, under}
  for (const r of realBook) {
    const key = `${r.sportsbook.toLowerCase()}::${r.line_value}`;
    const set = bookLineSides.get(key) ?? new Set<string>();
    set.add(r.side as string);
    bookLineSides.set(key, set);
  }
  // Corroboration count per line: number of distinct real-books with
  // a both-sided main at that line (alt-line single-side rows excluded
  // implicitly by step 2). Plus 1 if splits_consensus has the same line.
  const lineCorroborators = new Map<number, Set<string>>();
  for (const [key, sides] of bookLineSides) {
    if (!sides.has("over") || !sides.has("under")) continue;
    const [book, lineStr] = key.split("::");
    const line = Number(lineStr);
    const arr = lineCorroborators.get(line) ?? new Set<string>();
    arr.add(book);
    lineCorroborators.set(line, arr);
  }

  // Candidates that meet the corroboration bar.
  const candidates: Array<{ line: number; books: Set<string>; consensusMatch: boolean }> = [];
  for (const [line, books] of lineCorroborators) {
    const consensusMatch = consensusLine !== null && line === consensusLine;
    if (books.size >= 2 || (books.size >= 1 && consensusMatch)) {
      candidates.push({ line, books, consensusMatch });
    }
  }

  if (candidates.length > 0) {
    // Sort: max (books+consensus) desc; tie → REAL_BOOK_TOTAL_PRIORITY
    // winner desc (lowest priority index wins).
    candidates.sort((a, b) => {
      const ca = a.books.size + (a.consensusMatch ? 1 : 0);
      const cb = b.books.size + (b.consensusMatch ? 1 : 0);
      if (ca !== cb) return cb - ca;
      const pa = Math.min(...[...a.books].map((bk) => {
        const i = REAL_BOOK_TOTAL_PRIORITY.indexOf(bk);
        return i === -1 ? 999 : i;
      }));
      const pb = Math.min(...[...b.books].map((bk) => {
        const i = REAL_BOOK_TOTAL_PRIORITY.indexOf(bk);
        return i === -1 ? 999 : i;
      }));
      return pa - pb;
    });
    const chosen = candidates[0];
    const winningBook = [...chosen.books].sort((a, b) => {
      const ia = REAL_BOOK_TOTAL_PRIORITY.indexOf(a);
      const ib = REAL_BOOK_TOTAL_PRIORITY.indexOf(b);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    })[0];
    return {
      listed_total: chosen.line,
      has_pinnacle_total: chosen.books.has("pinnacle"),
      source: "real_book",
      book: winningBook,
      agreement_count: chosen.books.size,
      consensus_at_same_line: chosen.consensusMatch,
    };
  }

  // Thin-but-coherent market fallback. A current real book quoting both
  // sides at one line is a usable price even when a second book has not
  // populated yet. We still reject alt-line ladders and wide book conflict:
  // every eligible book/line must be paired, and the full candidate range
  // must be no wider than a normal half-run market transition.
  const pairedRealBookRows = realBook.filter((row) => {
    const key = `${row.sportsbook.toLowerCase()}::${row.line_value}`;
    const sides = bookLineSides.get(key);
    return sides?.has("over") === true && sides.has("under") === true;
  });
  const pairedLines = [...new Set(
    pairedRealBookRows
      .map((row) => row.line_value)
      .filter((line): line is number => line !== null),
  )].sort((a, b) => a - b);
  const thinRange = pairedLines.length > 0
    ? pairedLines[pairedLines.length - 1]! - pairedLines[0]!
    : Number.POSITIVE_INFINITY;
  if (pairedLines.length > 0 && thinRange <= 0.5) {
    const selected = selectMainTotalLine(pairedRealBookRows);
    if (selected !== null) {
      const books = new Set(
        pairedRealBookRows
          .filter((row) => row.line_value === selected)
          .map((row) => row.sportsbook.toLowerCase()),
      );
      const winningBook = [...books].sort((a, b) => {
        const ia = REAL_BOOK_TOTAL_PRIORITY.indexOf(a);
        const ib = REAL_BOOK_TOTAL_PRIORITY.indexOf(b);
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      })[0] ?? null;
      return {
        listed_total: selected,
        has_pinnacle_total: books.has("pinnacle"),
        source: "real_book",
        book: winningBook,
        agreement_count: books.size,
        consensus_at_same_line: false,
      };
    }
  }

  // No corroborated real-book main line. Fall back to splits_consensus
  // when available — it's a no-vig synthetic but at least it's a
  // canonical pick, not alt-line noise.
  if (consensusLine !== null) {
    return {
      listed_total: consensusLine,
      has_pinnacle_total: false,
      source: "consensus_fallback",
      book: "splits_consensus",
      agreement_count: 0,
      consensus_at_same_line: true,
    };
  }

  // Truly nothing usable. Caller must treat the total as unavailable
  // and hold the market — never lock or grade against an unknown line.
  return {
    listed_total: null,
    has_pinnacle_total: false,
    source: "unavailable",
    book: null,
    agreement_count: 0,
    consensus_at_same_line: false,
  };
}

function pickMlOdds(
  linesForGame: LineRow[],
  side: "home" | "away"
): number | null {
  const candidates = linesForGame.filter(
    (l) =>
      l.market_type === "moneyline" &&
      l.side === side &&
      l.odds_american !== null &&
      isFreshModelPriceSource(l.fetched_at) &&
      ML_BOOK_PRIORITY.includes(l.sportsbook.toLowerCase())
  );
  for (const book of ML_BOOK_PRIORITY) {
    const match = candidates.find(
      (l) => l.sportsbook.toLowerCase() === book && l.odds_american !== null
    );
    if (match !== undefined && match.odds_american !== null) {
      return match.odds_american;
    }
  }
  const any = candidates.find((l) => l.odds_american !== null);
  return any?.odds_american ?? null;
}

/**
 * Phase 6B.8 — pick the freshest real-book O/U price for the given side.
 *
 * Pre-6B.8 the model didn't extract per-side O/U prices at all; the
 * market snapshot only carried the listed line. Now V2.2 needs them
 * to compute a real no-vig OU market probability instead of the
 * legacy 0.5 placeholder.
 *
 * Selection rules (mirror pickMlOdds with one critical guard):
 *   1. Filter to (market_type='total', side=side, odds_american NOT NULL).
 *      This drops `splits_consensus` rows which carry the line value
 *      but never a real price.
 *   2. Walk the sharpbook priority chain (Pinnacle → DK → FD → MGM → CZR).
 *   3. Fall back to ANY non-null real-book row.
 *   4. Return null when nothing qualifies — the V2.2 model treats null
 *      as "no real OU market", which propagates to ou_market_prob=null
 *      in the audit (NOT 0.5).
 */
function pickOuOdds(
  linesForGame: LineRow[],
  side: "over" | "under"
): number | null {
  const candidates = linesForGame.filter(
    (l) =>
      l.market_type === "total" &&
      l.side === side &&
      l.odds_american !== null &&
      isFreshModelPriceSource(l.fetched_at) &&
      TOTAL_BOOK_PRIORITY.includes(l.sportsbook.toLowerCase()),
  );
  for (const book of TOTAL_BOOK_PRIORITY) {
    const match = candidates.find(
      (l) => l.sportsbook.toLowerCase() === book && l.odds_american !== null,
    );
    if (match !== undefined && match.odds_american !== null) {
      return match.odds_american;
    }
  }
  const any = candidates.find((l) => l.odds_american !== null);
  return any?.odds_american ?? null;
}

function fallbackListedLineFromPrediction(
  pred: GamePredictionRow | undefined
): number | null {
  if (pred === undefined) return null;
  const ss = pred.sport_specific as { listed_line?: unknown } | null;
  if (ss === null || ss === undefined) return null;
  const raw = ss.listed_line;
  return typeof raw === "number" ? raw : null;
}

function buildSharpSnapshot(
  signalsForGame: SharpSignalRow[]
): SharpSnapshot | null {
  if (signalsForGame.length === 0) return null;

  function pick(
    market_type: string,
    side: string
  ): SharpSignalRow | undefined {
    return signalsForGame.find(
      (s) => s.market_type === market_type && s.side === side
    );
  }

  function plusEv(
    market_type: string
  ): SharpSignalRow | undefined {
    return signalsForGame.find(
      (s) => s.market_type === market_type && s.is_plus_ev === true
    );
  }

  const mlHome = pick("moneyline", "home");
  const mlAway = pick("moneyline", "away");
  const totalOver = pick("total", "over");
  const totalEvRow = plusEv("total");
  const mlEvRow = plusEv("moneyline");

  return {
    pinnacle_ml_fair_prob_home:
      mlHome?.pinnacle_fair_probability ?? null,
    pinnacle_ml_fair_prob_away:
      mlAway?.pinnacle_fair_probability ?? null,
    pinnacle_total_ev_pct: totalEvRow?.ev_pct ?? null,
    pinnacle_ml_ev_pct: mlEvRow?.ev_pct ?? null,
    public_betting_pct_home: mlHome?.public_betting_pct ?? null,
    public_money_pct_home: mlHome?.public_money_pct ?? null,
    public_betting_pct_over: totalOver?.public_betting_pct ?? null,
    public_money_pct_over: totalOver?.public_money_pct ?? null,
    // R-14B — plus-EV side per market; null when no +EV row exists.
    ml_plus_ev_side:
      mlEvRow?.side === "home" || mlEvRow?.side === "away"
        ? mlEvRow.side
        : null,
    total_plus_ev_side:
      totalEvRow?.side === "over" || totalEvRow?.side === "under"
        ? totalEvRow.side
        : null,
  };
}

// ─────────────────────────────────────────────────────────────
// Main entry — buildFeatureSnapshots
// ─────────────────────────────────────────────────────────────

export async function buildFeatureSnapshots(
  sport: Sport,
  slate_date: string,
  /**
   * Phase 4C — optional filter to restrict the snapshot build to a
   * subset of slate games by `external_id`. When provided, the initial
   * `games` query restricts to those external_ids; all downstream
   * batched lookups naturally restrict to the filtered set (because
   * they join on the resulting `games.id`).
   *
   * When `undefined` or an empty array → behaves as Phase 3B did
   * (whole slate). Phase 3B/3C tests pass unchanged.
   *
   * Used by Phase 4C orchestrator write paths to write only T-60 /
   * single-game / held-only / non-override-morning subsets.
   */
  gameExternalIdsFilter?: number[]
): Promise<GameSnapshot[]> {
  // V1 scope — MLB only. Other sports return [] without DB roundtrips.
  if (sport !== "mlb") return [];

  const season = deriveSeason(slate_date);
  // Freeze one timestamp for the whole authoritative wave so sibling games
  // cannot cross a freshness boundary while this batch is being assembled.
  const featureSnapshotAsOf = new Date().toISOString();

  // Phase 4C: empty-array filter is treated as "explicit no games" —
  // short-circuit before any DB I/O. Distinct from `undefined` (no filter).
  if (gameExternalIdsFilter !== undefined && gameExternalIdsFilter.length === 0) {
    return [];
  }

  // ── Query 1: games on this slate ────────────────────────────────
  let gamesQuery = supabase
    .from("games")
    .select(
      "id, external_id, sport, slate_date, game_date, home_team_id, away_team_id, home_pitcher_id, away_pitcher_id, ballpark_id"
    )
    .eq("sport", sport)
    .eq("slate_date", slate_date);
  if (gameExternalIdsFilter !== undefined) {
    gamesQuery = gamesQuery.in("external_id", gameExternalIdsFilter);
  }
  const { data: gamesRaw, error: gamesErr } = await gamesQuery;

  if (gamesErr) {
    throw new Error(
      `featureSnapshot: games query failed for ${sport}/${slate_date}: ${gamesErr.message}`
    );
  }
  const games = (gamesRaw ?? []) as unknown as GameRow[];
  if (games.length === 0) return [];

  // Collect IDs we need for batched lookups
  const teamIds = new Set<number>();
  const starterIds = new Set<number>();
  const ballparkIds = new Set<number>();
  const gameIds = new Set<number>();

  for (const g of games) {
    if (g.home_team_id !== null) teamIds.add(g.home_team_id);
    if (g.away_team_id !== null) teamIds.add(g.away_team_id);
    if (g.home_pitcher_id !== null) starterIds.add(g.home_pitcher_id);
    if (g.away_pitcher_id !== null) starterIds.add(g.away_pitcher_id);
    if (g.ballpark_id !== null) ballparkIds.add(g.ballpark_id);
    gameIds.add(g.id);
  }

  // ── Query 2: teams ──────────────────────────────────────────────
  const { data: teamsRaw, error: teamsErr } = await supabase
    .from("teams")
    .select("id, external_id, abbreviation")
    .in("id", Array.from(teamIds));
  if (teamsErr) {
    throw new Error(`featureSnapshot: teams query failed: ${teamsErr.message}`);
  }
  const teamsById = indexBy(
    (teamsRaw ?? []) as unknown as TeamRow[],
    (t) => t.id
  );

  // ── Query 3: lineups ────────────────────────────────────────────
  const { data: lineupsRaw, error: lineupsErr } = await supabase
    .from("lineups")
    .select(
      "game_id, team_id, player_id, batting_position, starting_position, is_confirmed, is_dh"
    )
    .in("game_id", Array.from(gameIds));
  if (lineupsErr) {
    throw new Error(
      `featureSnapshot: lineups query failed: ${lineupsErr.message}`
    );
  }
  const lineups = (lineupsRaw ?? []) as unknown as LineupRow[];

  // Gather player IDs from lineups (batters + pitchers in lineups) +
  // probable starters from games table.
  const batterAndLineupPitcherIds = new Set<number>();
  for (const l of lineups) {
    if (l.player_id !== null) batterAndLineupPitcherIds.add(l.player_id);
  }

  // ── Query 4: RPs for bullpen proxy (separate query because the
  //          existing player query is keyed on lineups + starters; RPs
  //          aren't typically in the daily lineup) ────────────────
  const { data: rpRaw, error: rpErr } = await supabase
    .from("players")
    .select("id, team_id, position_abbr, active")
    .in("team_id", Array.from(teamIds))
    .eq("position_abbr", "RP")
    .eq("active", true);
  if (rpErr) {
    throw new Error(`featureSnapshot: RP query failed: ${rpErr.message}`);
  }
  const rpRows = (rpRaw ?? []) as Array<{
    id: number;
    team_id: number | null;
    position_abbr: string | null;
    active: boolean | null;
  }>;
  const rpIds = new Set<number>();
  for (const r of rpRows) rpIds.add(r.id);

  // ── Query 4b (R-16J Step 1.6): rostered batters per team for the
  //          team-level OPS aggregate (Tier 3 of the FI offense
  //          fallback hierarchy). Active, non-pitcher players. We only
  //          need id + team_id here; their season stats land in the
  //          existing season-stats batch via allPlayerIds. ──────────
  const { data: teamBattersRaw, error: tbErr } = await supabase
    .from("players")
    .select("id, team_id, is_pitcher, active")
    .in("team_id", Array.from(teamIds))
    .eq("is_pitcher", false)
    .eq("active", true);
  if (tbErr) {
    throw new Error(
      `featureSnapshot: team-batters query failed: ${tbErr.message}`
    );
  }
  const teamBatterRows = (teamBattersRaw ?? []) as Array<{
    id: number;
    team_id: number | null;
    is_pitcher: boolean | null;
    active: boolean | null;
  }>;
  const teamBatterIds = new Set<number>();
  for (const r of teamBatterRows) teamBatterIds.add(r.id);

  // ── Query 5: full player rows (starters + lineup batters + RPs +
  //          rostered team batters) ─────────────────────────────────
  const allPlayerIds = new Set<number>([
    ...starterIds,
    ...batterAndLineupPitcherIds,
    ...rpIds,
    ...teamBatterIds,
  ]);
  const allPlayerIdList = Array.from(allPlayerIds);
  const playersRaw: PlayerRow[] = [];
  for (let offset = 0; offset < allPlayerIdList.length; offset += FEATURE_SNAPSHOT_PLAYER_BATCH_SIZE) {
    const playerIdBatch = allPlayerIdList.slice(offset, offset + FEATURE_SNAPSHOT_PLAYER_BATCH_SIZE);
    const { data, error } = await supabase
      .from("players")
      .select(
        "id, external_id, full_name, team_id, position_abbr, is_pitcher, bats, throws, active"
      )
      .in("id", playerIdBatch)
      .limit(playerIdBatch.length);
    if (error) {
      throw new Error(`featureSnapshot: players query failed: ${error.message}`);
    }
    playersRaw.push(...((data ?? []) as unknown as PlayerRow[]));
  }
  const playersById = indexBy(
    playersRaw,
    (p) => p.id
  );

  // ── Query 6: season stats for everyone ──────────────────────────
  const seasonStatsSelect =
    "player_id, season, season_type, pitching_era, pitching_whip, pitching_k_per_9, " +
    "batting_obp, batting_slg, batting_ops, batting_pa, " +
    "first_inning_era, first_inning_starts, first_inning_whip, " +
    "pitching_gs, pitching_gp, pitching_ip";
  const seasonStatsRaw: SeasonStatsRow[] = [];
  for (let offset = 0; offset < allPlayerIdList.length; offset += FEATURE_SNAPSHOT_PLAYER_BATCH_SIZE) {
    const playerIdBatch = allPlayerIdList.slice(offset, offset + FEATURE_SNAPSHOT_PLAYER_BATCH_SIZE);
    const { data, error } = await supabase
      .from("player_season_stats")
      .select(seasonStatsSelect)
      .in("player_id", playerIdBatch)
      .eq("season", season)
      .eq("season_type", "regular")
      .limit(playerIdBatch.length);
    if (error) {
      throw new Error(`featureSnapshot: player_season_stats query failed: ${error.message}`);
    }
    seasonStatsRaw.push(...((data ?? []) as unknown as SeasonStatsRow[]));
  }
  const seasonStatsByPlayer = indexBy(
    seasonStatsRaw,
    (s) => s.player_id
  );
  const priorSeasonCandidates = [season - 1, season - 2].filter((s) => s > 0);
  const { data: priorStarterStatsRaw, error: priorSsErr } = starterIds.size > 0 && priorSeasonCandidates.length > 0
    ? await supabase
        .from("player_season_stats")
        .select(seasonStatsSelect)
        .in("player_id", Array.from(starterIds))
        .in("season", priorSeasonCandidates)
        .eq("season_type", "regular")
        .order("season", { ascending: false })
    : { data: null, error: null };
  if (priorSsErr) {
    throw new Error(
      `featureSnapshot: prior starter player_season_stats query failed: ${priorSsErr.message}`
    );
  }
  const priorStarterStatsByPlayer = new Map<number, SeasonStatsRow>();
  for (const row of (priorStarterStatsRaw ?? []) as unknown as SeasonStatsRow[]) {
    if (priorStarterStatsByPlayer.has(row.player_id)) continue;
    if (!hasUsableStarterSeasonStats(row)) continue;
    priorStarterStatsByPlayer.set(row.player_id, row);
  }

  // ── Query 7: splits (batters only, vs_lhp/vs_rhp) ──────────────
  const batterPlayerIds = Array.from(batterAndLineupPitcherIds);
  const { data: splitsRaw, error: splitsErr } = await supabase
    .from("player_splits")
    .select("player_id, season, split_type, ops")
    .in("player_id", batterPlayerIds)
    .eq("season", season)
    .in("split_type", ["vs_lhp", "vs_rhp"]);
  if (splitsErr) {
    throw new Error(
      `featureSnapshot: player_splits query failed: ${splitsErr.message}`
    );
  }
  const splitsByPlayer = groupBy(
    (splitsRaw ?? []) as unknown as SplitRow[],
    (s) => s.player_id
  );

  // ── Query 8: pitcher pitch stats (starters only) ───────────────
  const { data: pitchStatsRaw, error: psErr } = await supabase
    .from("pitcher_pitch_stats")
    .select("player_id, pitch_type, pct_of_total, whiff_rate")
    .in("player_id", Array.from(starterIds))
    .eq("season", season);
  if (psErr) {
    throw new Error(
      `featureSnapshot: pitcher_pitch_stats query failed: ${psErr.message}`
    );
  }
  const pitchStatsByPlayer = groupBy(
    (pitchStatsRaw ?? []) as unknown as PitchStatRow[],
    (p) => p.player_id
  );

  // ── Query 9: active injuries for any player we care about ──────
  const injuries: InjuryRow[] = [];
  for (let offset = 0; offset < allPlayerIdList.length; offset += FEATURE_SNAPSHOT_PLAYER_BATCH_SIZE) {
    const playerIdBatch = allPlayerIdList.slice(offset, offset + FEATURE_SNAPSHOT_PLAYER_BATCH_SIZE);
    const { data, error } = await supabase
      .from("player_injuries")
      .select("player_id, is_active, status")
      .in("player_id", playerIdBatch)
      .eq("is_active", true)
      .limit(playerIdBatch.length);
    if (error) {
      throw new Error(`featureSnapshot: player_injuries query failed: ${error.message}`);
    }
    injuries.push(...((data ?? []) as unknown as InjuryRow[]));
  }

  // ── Query 10: ballparks ────────────────────────────────────────
  const { data: parksRaw, error: parksErr } = await supabase
    .from("ballparks")
    .select("id, park_factor_runs, is_dome")
    .in("id", Array.from(ballparkIds));
  if (parksErr) {
    throw new Error(
      `featureSnapshot: ballparks query failed: ${parksErr.message}`
    );
  }
  const ballparksById = indexBy(
    (parksRaw ?? []) as unknown as BallparkRow[],
    (b) => b.id
  );

  // ── Query 11: weather forecasts (mock provider in V1; may be empty)
  const { data: weatherRaw, error: weatherErr } = await supabase
    .from("weather_forecasts")
    .select(
      "game_id, fetched_at, temperature_f, humidity_pct, wind_speed_mph, wind_direction_degrees, is_notable, notable_reason"
    )
    .in("game_id", Array.from(gameIds));
  if (weatherErr) {
    throw new Error(
      `featureSnapshot: weather_forecasts query failed: ${weatherErr.message}`
    );
  }
  const weatherByGame = indexBy(
    (weatherRaw ?? []) as unknown as WeatherRow[],
    (w) => w.game_id
  );

  // ── Query 12: lines ────────────────────────────────────────────
  const { data: linesRaw, error: linesErr } = await supabase
    .from("lines")
    .select("game_id, market_type, sportsbook, side, line_value, odds_american, fetched_at")
    .in("game_id", Array.from(gameIds))
    .in("market_type", ["total", "moneyline", "spread"]);
  if (linesErr) {
    throw new Error(`featureSnapshot: lines query failed: ${linesErr.message}`);
  }
  const linesByGame = groupBy(
    ((linesRaw ?? []) as unknown as LineRow[]).filter((line) => isFreshModelPriceSource(line.fetched_at)),
    (l) => l.game_id
  );

  // ── Query 13: sharp signals (Phase 1.6 enriched) ───────────────
  const { data: signalsRaw, error: sigErr } = await supabase
    .from("sharp_signals")
    .select(
      "game_id, market_type, side, pinnacle_fair_probability, is_plus_ev, ev_pct, public_betting_pct, public_money_pct"
    )
    .in("game_id", Array.from(gameIds));
  if (sigErr) {
    throw new Error(
      `featureSnapshot: sharp_signals query failed: ${sigErr.message}`
    );
  }
  const signalsByGame = groupBy(
    (signalsRaw ?? []) as unknown as SharpSignalRow[],
    (s) => s.game_id
  );

  // ── Query 14: game_predictions (for listed_line fallback) ──────
  const { data: predsRaw, error: predsErr } = await supabase
    .from("game_predictions")
    .select("game_id, sport_specific")
    .in("game_id", Array.from(gameIds));
  if (predsErr) {
    throw new Error(
      `featureSnapshot: game_predictions query failed: ${predsErr.message}`
    );
  }
  const predictionsByGame = indexBy(
    (predsRaw ?? []) as unknown as GamePredictionRow[],
    (p) => p.game_id
  );

  // ── Compute per-team bullpen ERA proxy ─────────────────────────
  // Group RP season ERAs by team and average. Falls back to null when
  // a team has no RP season-stats data.
  const rpsByTeam = groupBy(rpRows, (r) => r.team_id);
  // `bullpenEraByTeamId` is the SHRUNK proxy (consumed by the bullpen
  // factor). Raw proxy + total bullpen IP are preserved for audit.
  const bullpenEraByTeamId = new Map<number, number | null>();
  const bullpenEraRawByTeamId = new Map<number, number | null>();
  const bullpenIpByTeamId = new Map<number, number | null>();
  for (const [teamId, rps] of rpsByTeam.entries()) {
    const eras: number[] = [];
    let ipTotal = 0;
    for (const rp of rps) {
      const ss = seasonStatsByPlayer.get(rp.id);
      const era = ss?.pitching_era;
      if (era !== null && era !== undefined && Number.isFinite(era)) {
        eras.push(era);
        const ip = ss?.pitching_ip;
        if (ip !== null && ip !== undefined && Number.isFinite(ip)) ipTotal += ip;
      }
    }
    if (eras.length === 0) {
      bullpenEraByTeamId.set(teamId, null);
      bullpenEraRawByTeamId.set(teamId, null);
      bullpenIpByTeamId.set(teamId, null);
    } else {
      const rawAvg = eras.reduce((s, e) => s + e, 0) / eras.length;
      bullpenEraRawByTeamId.set(teamId, rawAvg);
      bullpenIpByTeamId.set(teamId, ipTotal);
      // James-Stein shrinkage toward the league-average ERA, weighted by
      // total bullpen IP. June reliever ERAs sit well below the full-season
      // 4.0 constant (especially elite, small-sample pens), which drove the
      // raw proxy below the trusted [0.5, 2.0] factor band (e.g. ATL/NYM ≈
      // 0.47). Shrinking stabilizes the factor for both the model and the
      // Key Stats display without inventing data — raw value preserved above.
      bullpenEraByTeamId.set(teamId, shrinkBullpenEra(rawAvg, ipTotal));
    }
  }

  // ── R-16J Step 1.6 — per-team batter-OPS aggregate proxy ───────
  // PA-weighted mean batting_ops across rostered batters with batting_pa
  // ≥ TEAM_OPS_MIN_PA. PA-weighted (not simple mean) so a 600-PA regular
  // dominates over a 110-PA platoon player; the consumer further shrinks
  // the result by SHRINKAGE_K_TEAM_OPS toward league mean. Sample
  // reported as total PA so the shrinkage step sees an honest n.
  // Falls back to { mean: null, sample: null } when no qualifying
  // batters — the model's tier 4 (league_avg) path picks up the slack.
  const TEAM_OPS_MIN_PA = 100;
  const teamBattersByTeam = groupBy(teamBatterRows, (r) => r.team_id);
  const teamAvgOpsByTeamId = new Map<
    number,
    { mean: number | null; sample: number | null }
  >();
  for (const [teamId, batters] of teamBattersByTeam.entries()) {
    let weightedOpsSum = 0;
    let paSum = 0;
    for (const b of batters) {
      const ss = seasonStatsByPlayer.get(b.id);
      const ops = ss?.batting_ops;
      const pa = ss?.batting_pa;
      if (
        ops === null ||
        ops === undefined ||
        pa === null ||
        pa === undefined ||
        pa < TEAM_OPS_MIN_PA ||
        !Number.isFinite(ops) ||
        !Number.isFinite(pa)
      ) {
        continue;
      }
      weightedOpsSum += ops * pa;
      paSum += pa;
    }
    if (paSum === 0) {
      teamAvgOpsByTeamId.set(teamId, { mean: null, sample: null });
    } else {
      teamAvgOpsByTeamId.set(teamId, {
        mean: weightedOpsSum / paSum,
        sample: paSum,
      });
    }
  }

  // ── Assemble per-game snapshots ────────────────────────────────
  const snapshots: GameSnapshot[] = [];
  for (const g of games) {
    const homeTeamRow =
      g.home_team_id !== null ? teamsById.get(g.home_team_id) : undefined;
    const awayTeamRow =
      g.away_team_id !== null ? teamsById.get(g.away_team_id) : undefined;
    if (homeTeamRow === undefined || awayTeamRow === undefined) {
      // Cannot build a snapshot without both teams — skip honestly.
      continue;
    }

    const home_team = buildTeamSnapshot(
      homeTeamRow,
      bullpenEraByTeamId.get(homeTeamRow.id) ?? null,
      teamAvgOpsByTeamId.get(homeTeamRow.id) ?? { mean: null, sample: null },
      bullpenEraRawByTeamId.get(homeTeamRow.id) ?? null,
      bullpenIpByTeamId.get(homeTeamRow.id) ?? null
    );
    const away_team = buildTeamSnapshot(
      awayTeamRow,
      bullpenEraByTeamId.get(awayTeamRow.id) ?? null,
      teamAvgOpsByTeamId.get(awayTeamRow.id) ?? { mean: null, sample: null },
      bullpenEraRawByTeamId.get(awayTeamRow.id) ?? null,
      bullpenIpByTeamId.get(awayTeamRow.id) ?? null
    );

    const gameLineups = lineups.filter((l) => l.game_id === g.id);

    function buildStarter(
      pitcherId: number | null
    ): StarterSnapshot | null {
      if (pitcherId === null) return null;
      const player = playersById.get(pitcherId);
      if (player === undefined) return null;
      return buildStarterSnapshot(
        player,
        selectStarterSeasonStats(
          seasonStatsByPlayer.get(player.id),
          priorStarterStatsByPlayer.get(player.id),
        ),
        pitchStatsByPlayer.get(player.id) ?? [],
        gameLineups,
        injuries
      );
    }
    const home_starter = buildStarter(g.home_pitcher_id);
    const away_starter = buildStarter(g.away_pitcher_id);

    // Build top-8 lineup per team, ordered by batting_position asc.
    //
    // R-16J Step 1.6 — prefer confirmed lineup rows when present;
    // otherwise fall back to projected rows so the downstream FI
    // offense fallback hierarchy can use them (tier 2). When BOTH
    // confirmed and projected rows exist for a team (e.g. BDL pushed
    // both a projected lineup and a partial confirmed one), confirmed
    // wins exclusively — mixing the two would produce inconsistent
    // provenance per batter. All emitted BatterSnapshots carry the
    // same `lineup_source` for the same team in a given game.
    function buildLineup(team_id: number): BatterSnapshot[] {
      const teamBatterLineups = gameLineups.filter(
        (l) =>
          l.team_id === team_id &&
          l.player_id !== null &&
          l.starting_position !== "P" &&
          l.starting_position !== "SP" &&
          l.starting_position !== "RP"
      );
      const confirmedRows = teamBatterLineups.filter(
        (l) => l.is_confirmed === true
      );
      const useConfirmed = confirmedRows.length > 0;
      const source: "confirmed" | "projected" = useConfirmed
        ? "confirmed"
        : "projected";
      const candidates = (useConfirmed ? confirmedRows : teamBatterLineups)
        .sort((a, b) => {
          // Nulls last; otherwise asc by batting_position
          const aPos = a.batting_position ?? 999;
          const bPos = b.batting_position ?? 999;
          return aPos - bPos;
        })
        .slice(0, 8);

      const out: BatterSnapshot[] = [];
      for (const lr of candidates) {
        if (lr.player_id === null) continue;
        const player = playersById.get(lr.player_id);
        if (player === undefined) continue;
        out.push(
          buildBatterSnapshot(
            player,
            lr,
            seasonStatsByPlayer.get(player.id),
            splitsByPlayer.get(player.id) ?? [],
            source
          )
        );
      }
      return out;
    }
    const home_lineup_top8 = buildLineup(homeTeamRow.id);
    const away_lineup_top8 = buildLineup(awayTeamRow.id);

    const ballpark =
      g.ballpark_id !== null
        ? buildParkSnapshot(ballparksById.get(g.ballpark_id))
        : null;
    const weather = buildWeatherSnapshot(weatherByGame.get(g.id));

    // Market — listed_total via corroboration-aware resolver. The
    // fallback to sport_specific.listed_line is preserved for
    // back-compat with games where lines were never ingested at all
    // (provider outage); when resolver returns "unavailable" AND no
    // sport_specific fallback exists, downstream must hold the market.
    const linesForGame = linesByGame.get(g.id) ?? [];
    const linesTotal = pickListedTotal(linesForGame);
    const sportSpecificListedLine = fallbackListedLineFromPrediction(
      predictionsByGame.get(g.id)
    );
    const finalListedTotal =
      linesTotal.listed_total !== null
        ? linesTotal.listed_total
        : sportSpecificListedLine;
    const market = {
      listed_total: finalListedTotal,
      home_ml_odds_american: pickMlOdds(linesForGame, "home"),
      away_ml_odds_american: pickMlOdds(linesForGame, "away"),
      // Phase 6B.8 — real per-side O/U prices for the no-vig market
      // probability path in V2.2. Null when no real-book O/U price
      // exists (which is common when only splits_consensus rows are
      // ingested for a game). V2.2 must NOT default null to 0.5.
      over_odds_american: pickOuOdds(linesForGame, "over"),
      under_odds_american: pickOuOdds(linesForGame, "under"),
      has_pinnacle_total: linesTotal.has_pinnacle_total,
      // 2026-06-09 phantom-alt-line fix — audit trail for the locked
      // total line so snapshot_json.total_line_source_at_lock /
      // total_line_book / total_line_agreement_count /
      // total_line_consensus_at_same_line can be persisted by the
      // writer. Captures HOW the line was chosen for this snapshot.
      total_line_source: linesTotal.source,
      total_line_book: linesTotal.book,
      total_line_agreement_count: linesTotal.agreement_count,
      total_line_consensus_at_same_line: linesTotal.consensus_at_same_line,
      coherent_price_map: buildMlbCoherentMarketPriceMap({
        rows: linesForGame,
        listedTotal: finalListedTotal,
        asOf: featureSnapshotAsOf,
      }),
    };

    const sharp = buildSharpSnapshot(signalsByGame.get(g.id) ?? []);

    // Injuries
    function isInjuredOut(player_external_id: number | undefined): boolean {
      if (player_external_id === undefined) return false;
      // injuries are keyed by player.id (DB id); resolve via playersById
      // by checking against the player record's id.
      // Instead — filter injuries by player_id where playersById.get(id).external_id matches
      for (const inj of injuries) {
        if (inj.player_id === null) continue;
        const p = playersById.get(inj.player_id);
        if (p === undefined) continue;
        if (p.external_id === player_external_id && inj.status === "Out") {
          return true;
        }
      }
      return false;
    }

    function injuredTop3HittersCount(lineup: BatterSnapshot[]): number {
      const top3 = lineup.filter(
        (b) =>
          b.batting_position !== null &&
          b.batting_position >= 1 &&
          b.batting_position <= 3
      );
      let count = 0;
      for (const b of top3) {
        if (isInjuredOut(b.player_external_id)) count++;
      }
      return count;
    }

    const active_injuries: ActiveInjuries = {
      home_starter_out: isInjuredOut(home_starter?.player_external_id),
      away_starter_out: isInjuredOut(away_starter?.player_external_id),
      home_top3_hitters_injured_count: injuredTop3HittersCount(home_lineup_top8),
      away_top3_hitters_injured_count: injuredTop3HittersCount(away_lineup_top8),
    };

    // Data quality flags
    const starter_confirmed =
      home_starter !== null &&
      away_starter !== null &&
      home_starter.is_confirmed === true &&
      away_starter.is_confirmed === true;
    // R-16J Step 1.6 — `lineup_confirmed` must require ALL batters carry
    // lineup_source==="confirmed". With the projected-lineup fallback,
    // home_lineup_top8 may now be entirely projected (length 8 from BDL
    // projection rows). Reporting `lineup_confirmed=true` for that case
    // would suppress unconfirmed-data confidence penalties downstream
    // that depend on the flag — staying honest about provenance keeps
    // the existing data-quality machinery accurate.
    const homeLineupAllConfirmed =
      home_lineup_top8.length >= 8 &&
      home_lineup_top8.every((b) => b.lineup_source === "confirmed");
    const awayLineupAllConfirmed =
      away_lineup_top8.length >= 8 &&
      away_lineup_top8.every((b) => b.lineup_source === "confirmed");
    const lineup_confirmed = homeLineupAllConfirmed && awayLineupAllConfirmed;
    const weather_available = weather !== null;
    const season_stats_present =
      home_starter?.season_era !== null &&
      home_starter?.season_era !== undefined &&
      away_starter?.season_era !== null &&
      away_starter?.season_era !== undefined;
    const data_quality: DataQuality = {
      starter_confirmed,
      lineup_confirmed,
      weather_available,
      season_stats_present,
    };

    snapshots.push({
      game_external_id: g.external_id,
      slate_date: g.slate_date,
      game_date: g.game_date,
      home_team,
      away_team,
      home_starter,
      away_starter,
      home_lineup_top8,
      away_lineup_top8,
      ballpark,
      weather,
      market,
      sharp,
      active_injuries,
      data_quality,
    });
  }

  return snapshots;
}

// ─────────────────────────────────────────────────────────────
// Test-only exports — exposed for unit/integration testing.
// Production code never imports __TEST__.
// ─────────────────────────────────────────────────────────────

export const __TEST__ = {
  deriveSeason,
  computePitchQualityScore,
  pickListedTotal,
  pickMlOdds,
  CURRENT_SEASON_FALLBACK,
  TOTAL_BOOK_PRIORITY,
};

// Silence unused-helper warnings (kept available for future helpers).
void asNumberOrNull;
void asStringOrNull;
void asBoolOrFalse;
