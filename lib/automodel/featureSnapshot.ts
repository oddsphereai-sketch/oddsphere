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

/**
 * Fallback when slate_date can't yield a season number cleanly.
 * V1 baseline is 2026 (MLB season tracked by year). Revisit yearly.
 */
const CURRENT_SEASON_FALLBACK = 2026;

/** Sharpbook priority for the `listed_total` chain (Pinnacle first). */
const TOTAL_BOOK_PRIORITY: readonly string[] = [
  "pinnacle",
  "draftkings",
  "fanduel",
  "betmgm",
  "caesars",
] as const;

const ML_BOOK_PRIORITY: readonly string[] = TOTAL_BOOK_PRIORITY;

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

// ─────────────────────────────────────────────────────────────
// Snapshot builders (pure transforms from raw rows)
// ─────────────────────────────────────────────────────────────

function buildTeamSnapshot(
  team: TeamRow,
  bullpenEraProxy: number | null
): TeamSnapshot {
  return {
    team_external_id: team.external_id,
    abbreviation: team.abbreviation,
    bullpen_era_proxy: bullpenEraProxy,
    // No team_season_stats table in V1 — model doesn't consume this
    // field. Reporting honest null.
    season_runs_per_game: null,
  };
}

function buildStarterSnapshot(
  player: PlayerRow,
  seasonStats: SeasonStatsRow | undefined,
  pitchStats: PitchStatRow[],
  lineups: LineupRow[],
  injuries: InjuryRow[]
): StarterSnapshot {
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
    // V1: no rolling 30-day table. Phase 3.x optimization.
    last30_era: null,
    pitch_quality_score: computePitchQualityScore(pitchStats),
    is_confirmed: isConfirmed,
    is_scratched: isScratched,
    // V1: no BDL plays-derived first-inning ERA. Phase 3.x.
    first_inning_era: null,
  };
}

function buildBatterSnapshot(
  player: PlayerRow,
  lineupRow: LineupRow,
  seasonStats: SeasonStatsRow | undefined,
  splits: SplitRow[]
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
    vs_lhp_ops: vsLhp,
    vs_rhp_ops: vsRhp,
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
  };
}

/**
 * Pick `lines.line_value` for market_type='total' following the
 * priority chain (Pinnacle → other named books → any sportsbook).
 * Returns null when no total line is present.
 */
function pickListedTotal(linesForGame: LineRow[]): {
  listed_total: number | null;
  has_pinnacle_total: boolean;
} {
  const totals = linesForGame.filter((l) => l.market_type === "total");
  for (const book of TOTAL_BOOK_PRIORITY) {
    const match = totals.find(
      (l) => l.sportsbook.toLowerCase() === book && l.line_value !== null
    );
    if (match !== undefined && match.line_value !== null) {
      return {
        listed_total: match.line_value,
        has_pinnacle_total: book === "pinnacle",
      };
    }
  }
  // Fall through to ANY sportsbook with a total
  const anyTotal = totals.find((l) => l.line_value !== null);
  if (anyTotal !== undefined && anyTotal.line_value !== null) {
    return { listed_total: anyTotal.line_value, has_pinnacle_total: false };
  }
  return { listed_total: null, has_pinnacle_total: false };
}

function pickMlOdds(
  linesForGame: LineRow[],
  side: "home" | "away"
): number | null {
  const candidates = linesForGame.filter(
    (l) => l.market_type === "moneyline" && l.side === side
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
  };
}

// ─────────────────────────────────────────────────────────────
// Main entry — buildFeatureSnapshots
// ─────────────────────────────────────────────────────────────

export async function buildFeatureSnapshots(
  sport: Sport,
  slate_date: string
): Promise<GameSnapshot[]> {
  // V1 scope — MLB only. Other sports return [] without DB roundtrips.
  if (sport !== "mlb") return [];

  const season = deriveSeason(slate_date);

  // ── Query 1: games on this slate ────────────────────────────────
  const { data: gamesRaw, error: gamesErr } = await supabase
    .from("games")
    .select(
      "id, external_id, sport, slate_date, game_date, home_team_id, away_team_id, home_pitcher_id, away_pitcher_id, ballpark_id"
    )
    .eq("sport", sport)
    .eq("slate_date", slate_date);

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

  // ── Query 5: full player rows (starters + lineup batters + RPs) ─
  const allPlayerIds = new Set<number>([
    ...starterIds,
    ...batterAndLineupPitcherIds,
    ...rpIds,
  ]);
  const { data: playersRaw, error: playersErr } = await supabase
    .from("players")
    .select(
      "id, external_id, full_name, team_id, position_abbr, is_pitcher, bats, throws, active"
    )
    .in("id", Array.from(allPlayerIds));
  if (playersErr) {
    throw new Error(
      `featureSnapshot: players query failed: ${playersErr.message}`
    );
  }
  const playersById = indexBy(
    (playersRaw ?? []) as unknown as PlayerRow[],
    (p) => p.id
  );

  // ── Query 6: season stats for everyone ──────────────────────────
  const { data: seasonStatsRaw, error: ssErr } = await supabase
    .from("player_season_stats")
    .select(
      "player_id, season, season_type, pitching_era, pitching_whip, pitching_k_per_9, batting_obp, batting_slg, batting_ops"
    )
    .in("player_id", Array.from(allPlayerIds))
    .eq("season", season)
    .eq("season_type", "regular");
  if (ssErr) {
    throw new Error(
      `featureSnapshot: player_season_stats query failed: ${ssErr.message}`
    );
  }
  const seasonStatsByPlayer = indexBy(
    (seasonStatsRaw ?? []) as unknown as SeasonStatsRow[],
    (s) => s.player_id
  );

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
  const { data: injRaw, error: injErr } = await supabase
    .from("player_injuries")
    .select("player_id, is_active, status")
    .in("player_id", Array.from(allPlayerIds))
    .eq("is_active", true);
  if (injErr) {
    throw new Error(
      `featureSnapshot: player_injuries query failed: ${injErr.message}`
    );
  }
  const injuries = (injRaw ?? []) as unknown as InjuryRow[];

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
      "game_id, temperature_f, humidity_pct, wind_speed_mph, wind_direction_degrees, is_notable, notable_reason"
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
    .select("game_id, market_type, sportsbook, side, line_value, odds_american")
    .in("game_id", Array.from(gameIds))
    .in("market_type", ["total", "moneyline", "spread"]);
  if (linesErr) {
    throw new Error(`featureSnapshot: lines query failed: ${linesErr.message}`);
  }
  const linesByGame = groupBy(
    (linesRaw ?? []) as unknown as LineRow[],
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
  const bullpenEraByTeamId = new Map<number, number | null>();
  for (const [teamId, rps] of rpsByTeam.entries()) {
    const eras: number[] = [];
    for (const rp of rps) {
      const ss = seasonStatsByPlayer.get(rp.id);
      const era = ss?.pitching_era;
      if (era !== null && era !== undefined && Number.isFinite(era)) {
        eras.push(era);
      }
    }
    if (eras.length === 0) {
      bullpenEraByTeamId.set(teamId, null);
    } else {
      const avg = eras.reduce((s, e) => s + e, 0) / eras.length;
      bullpenEraByTeamId.set(teamId, avg);
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
      bullpenEraByTeamId.get(homeTeamRow.id) ?? null
    );
    const away_team = buildTeamSnapshot(
      awayTeamRow,
      bullpenEraByTeamId.get(awayTeamRow.id) ?? null
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
        seasonStatsByPlayer.get(player.id),
        pitchStatsByPlayer.get(player.id) ?? [],
        gameLineups,
        injuries
      );
    }
    const home_starter = buildStarter(g.home_pitcher_id);
    const away_starter = buildStarter(g.away_pitcher_id);

    // Build top-8 lineup per team, ordered by batting_position asc
    function buildLineup(team_id: number): BatterSnapshot[] {
      const batterLineups = gameLineups
        .filter(
          (l) =>
            l.team_id === team_id &&
            l.player_id !== null &&
            l.starting_position !== "P" &&
            l.starting_position !== "SP" &&
            l.starting_position !== "RP"
        )
        .sort((a, b) => {
          // Nulls last; otherwise asc by batting_position
          const aPos = a.batting_position ?? 999;
          const bPos = b.batting_position ?? 999;
          return aPos - bPos;
        })
        .slice(0, 8);

      const out: BatterSnapshot[] = [];
      for (const lr of batterLineups) {
        if (lr.player_id === null) continue;
        const player = playersById.get(lr.player_id);
        if (player === undefined) continue;
        out.push(
          buildBatterSnapshot(
            player,
            lr,
            seasonStatsByPlayer.get(player.id),
            splitsByPlayer.get(player.id) ?? []
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

    // Market — listed_total priority chain + fallback to sport_specific
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
      has_pinnacle_total: linesTotal.has_pinnacle_total,
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
    const lineup_confirmed = home_lineup_top8.length >= 8 && away_lineup_top8.length >= 8;
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
