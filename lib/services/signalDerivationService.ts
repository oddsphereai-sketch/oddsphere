/**
 * signalDerivationService — compute Layer 2 (CONTEXT) signals for each
 * prop_prediction.
 *
 * V2.1's 3-layer signal architecture has a service per layer:
 *   • Layer 1 (model)   — predictionService writes ml_confidence /
 *                         ou_confidence / edge_pct / model_probability into
 *                         game_predictions + prop_predictions.
 *   • Layer 2 (context) — THIS SERVICE. Writes the 10-signal UI vocabulary
 *                         (hot, cold, vs_lhp, etc.) into
 *                         prop_predictions.signals JSONB.
 *   • Layer 3 (market)  — marketSignalDerivationService writes the 5-value
 *                         market read into game_predictions.market_signal +
 *                         prop_predictions.market_signal TEXT.
 *
 * The three layers don't interact in code — each service writes to its own
 * column independently. The grade engine (Phase 6.3d) blends all three into
 * the final 7-category grade.
 *
 * The 10 Layer-2 signals match the SIGNAL_META + Signal type union in
 * /app/lab/data/mockData.ts:
 *
 *   hot · cold · vs_lhp · vs_rhp · wind_out · wind_in · park
 *   rest_advantage · platoon · warning
 *
 * Most signals derive from REAL DB data populated by the providers (player
 * handedness from players.bats/throws, splits from player_splits, park
 * factors from ballparks, wind direction from weather_forecasts). A small
 * number (rest_advantage, the hot/cold proxy) use deterministic-hash mocks
 * that flip to real-API reads in Phase 7 without UI changes.
 *
 * Architecture
 *   • `deriveSignals(ctx)` — pure function over a SignalDerivationContext.
 *     Used inline by predictionService.generatePropPredictions so newly
 *     generated props get signals at insert time.
 *   • `deriveSignalsForSlate(sport, slate_date)` — assembles context for
 *     every prop on a slate by batching DB queries; returns
 *     Map<prop_prediction_id, Signal[]>. Used by the seed back-fill + any
 *     "recompute signals for a slate" cron.
 *   • `updateSignalsForSlate(...)` — applies the derived signals to the DB.
 *     Idempotent — re-running over the same slate produces identical rows.
 *
 * Phase 7 swap: the tri-state provider env vars (PLAYER_STATS_PROVIDER,
 * WEATHER_PROVIDER, etc.) drive the data sources for player_splits,
 * weather_forecasts, and ballparks. The derivation logic here doesn't
 * change — it just sees real inputs instead of seeded ones.
 */

import { supabase } from "../db/supabase";
import type { Sport } from "../types/domain/Sport";

// ─── Public types ─────────────────────────────────────────────────────────

export type Signal =
  | "hot"
  | "cold"
  | "vs_lhp"
  | "vs_rhp"
  | "wind_out"
  | "wind_in"
  | "park"
  | "rest_advantage"
  | "platoon"
  | "warning";

export type SignalDerivationContext = {
  /** DB prop_market (e.g., "batter_hits", "pitcher_strikeouts"). */
  prop_market: string;
  player_id: number;
  game_id: number;
  /** YYYY-MM-DD slate date — used in deterministic mock hashes. */
  slate_date: string;
  /** True for pitcher_* prop markets. Skips batter-only signals. */
  isPitcherProp: boolean;

  // Pitcher (opponent for batter props; the player themselves for pitcher props)
  pitcherThrows: "L" | "R" | null;
  // Batter
  batterBats: "L" | "R" | "S" | null;

  // Split averages (vs LHP / vs RHP). Null = no data.
  splitVsLhpAvg: number | null;
  splitVsRhpAvg: number | null;
  seasonBattingAvg: number | null;

  // Park factors — 100 = neutral, > 100 favors offense, < 100 favors pitchers.
  parkFactorRuns: number | null;
  parkFactorHr: number | null;
  parkFactorSo: number | null;

  // Weather. wind_direction_relative is one of "out_to_lf", "in_from_cf", etc.
  windDirectionRelative: string | null;
  windSpeedMph: number | null;

  // Model output (used as hot/cold proxy + warning composition).
  edgePct: number | null;
  tier: "premium" | "strong" | "good" | "skip" | null;
};

// ─── Pure derivation ──────────────────────────────────────────────────────

const MIN_WIND_MPH = 10;
const PARK_FAVORABLE_THRESHOLD = 105;
const PARK_UNFAVORABLE_THRESHOLD = 95;
const PLATOON_SPLIT_DELTA = 0.020; // 20 batting-average points above season
const HOT_EDGE_THRESHOLD = 6;       // edge_pct >= 6 → hot
const COLD_EDGE_THRESHOLD = -3;     // edge_pct <= -3 → cold
const REST_ADV_PROB = 0.15;         // ~15% of props get rest_advantage (mock)

const HR_LIKE_MARKETS = new Set([
  "batter_home_runs",
  "batter_total_bases",
]);
const HITS_LIKE_MARKETS = new Set([
  "batter_hits",
  "batter_total_bases",
  "batter_rbis",
]);
const PITCHER_MARKETS = new Set(["pitcher_strikeouts", "pitcher_earned_runs"]);

function isHrLike(market: string): boolean {
  return HR_LIKE_MARKETS.has(market);
}

function isHitsLike(market: string): boolean {
  return HITS_LIKE_MARKETS.has(market);
}

function isPitcher(market: string): boolean {
  return PITCHER_MARKETS.has(market);
}

/**
 * Deterministic 0..1 hash for a seed string. FNV-1a variant — fast, stable,
 * good enough for mock distribution. NOT cryptographic.
 */
function pseudoHash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xFFFFFFFF;
}

/** Pure derivation — no I/O. Caller assembles context. */
export function deriveSignals(ctx: SignalDerivationContext): Signal[] {
  const signals = new Set<Signal>();
  const market = ctx.prop_market;
  const isPProp = ctx.isPitcherProp || isPitcher(market);

  // ─── vs_lhp / vs_rhp — matchup context for BATTER props ─────────────────
  // Pitcher props don't get these (the prop SUBJECT is the pitcher, so
  // "vs_lhp/rhp" wouldn't be meaningful framing).
  if (!isPProp) {
    if (ctx.pitcherThrows === "L") signals.add("vs_lhp");
    if (ctx.pitcherThrows === "R") signals.add("vs_rhp");
  }

  // ─── park — favorable ballpark for the prop's market ────────────────────
  // Each market reads the relevant park factor. Only fires when favorable;
  // unfavorable rolls into the `warning` composite below.
  let parkFavorable = false;
  let parkUnfavorable = false;
  if (isHrLike(market) && ctx.parkFactorHr !== null) {
    if (ctx.parkFactorHr >= PARK_FAVORABLE_THRESHOLD) parkFavorable = true;
    if (ctx.parkFactorHr <= PARK_UNFAVORABLE_THRESHOLD) parkUnfavorable = true;
  } else if (isHitsLike(market) && ctx.parkFactorRuns !== null) {
    if (ctx.parkFactorRuns >= PARK_FAVORABLE_THRESHOLD) parkFavorable = true;
    if (ctx.parkFactorRuns <= PARK_UNFAVORABLE_THRESHOLD) parkUnfavorable = true;
  } else if (market === "pitcher_strikeouts" && ctx.parkFactorSo !== null) {
    if (ctx.parkFactorSo >= PARK_FAVORABLE_THRESHOLD) parkFavorable = true;
    if (ctx.parkFactorSo <= PARK_UNFAVORABLE_THRESHOLD) parkUnfavorable = true;
  } else if (market === "pitcher_earned_runs" && ctx.parkFactorRuns !== null) {
    // Pitcher ER props are UNDER bets; LOW park factor favors the pitcher
    // (fewer runs scored). Invert the convention.
    if (ctx.parkFactorRuns <= PARK_UNFAVORABLE_THRESHOLD) parkFavorable = true;
    if (ctx.parkFactorRuns >= PARK_FAVORABLE_THRESHOLD) parkUnfavorable = true;
  }
  if (parkFavorable) signals.add("park");

  // ─── wind_out / wind_in — only meaningful for power props ───────────────
  if (
    isHrLike(market) &&
    ctx.windDirectionRelative !== null &&
    ctx.windSpeedMph !== null &&
    ctx.windSpeedMph >= MIN_WIND_MPH
  ) {
    if (ctx.windDirectionRelative.startsWith("out_to_")) signals.add("wind_out");
    else if (ctx.windDirectionRelative.startsWith("in_from_")) signals.add("wind_in");
  }

  // ─── platoon — favorable handedness split for batter props ──────────────
  // Compare the batter's avg in the relevant split against their season avg.
  // Strong positive delta = platoon advantage. Switch hitters always assumed
  // to have the favorable split (they switch sides).
  if (!isPProp && ctx.seasonBattingAvg !== null && ctx.pitcherThrows !== null) {
    const splitAvg =
      ctx.pitcherThrows === "L" ? ctx.splitVsLhpAvg : ctx.splitVsRhpAvg;
    if (splitAvg !== null) {
      const delta = splitAvg - ctx.seasonBattingAvg;
      if (delta >= PLATOON_SPLIT_DELTA) signals.add("platoon");
    }
    if (ctx.batterBats === "S") signals.add("platoon"); // switch hitter
  }

  // ─── hot / cold — V1 mock proxy via the model's edge_pct ────────────────
  // Phase 7 swap: read last-10 game logs from BALLDONTLIE and compare to
  // season average. For now, the model's edge IS our "the player is hot"
  // signal — if our model thinks tonight's prop is +6% over fair, the
  // implication is the player is performing above expectations.
  if (ctx.edgePct !== null) {
    if (ctx.edgePct >= HOT_EDGE_THRESHOLD) signals.add("hot");
    if (ctx.edgePct <= COLD_EDGE_THRESHOLD) signals.add("cold");
  }

  // ─── rest_advantage — deterministic mock ────────────────────────────────
  // Phase 7 swap: read schedule data to compute actual days_rest.
  if (pseudoHash(`rest:${ctx.player_id}:${ctx.slate_date}`) < REST_ADV_PROB) {
    signals.add("rest_advantage");
  }

  // ─── warning — composite negative trigger ───────────────────────────────
  // Fires when conditions stack against the prop:
  //   • cold AND unfavorable park
  //   • cold AND wind blowing in (for power props)
  //   • model says tier=skip with negative edge AND no positive context
  const hasCold = signals.has("cold");
  const hasWindIn = signals.has("wind_in");
  if (hasCold && parkUnfavorable) signals.add("warning");
  if (hasCold && hasWindIn && isHrLike(market)) signals.add("warning");
  if (
    ctx.tier === "skip" &&
    (ctx.edgePct ?? 0) < -1 &&
    !signals.has("park") &&
    !signals.has("platoon") &&
    !signals.has("rest_advantage")
  ) {
    signals.add("warning");
  }

  // Order matters for display — surface the most actionable signals first.
  // (UI truncates to 3; we want the meaningful ones to win.)
  const ORDER: Signal[] = [
    "hot",
    "park",
    "wind_out",
    "platoon",
    "vs_lhp",
    "vs_rhp",
    "rest_advantage",
    "wind_in",
    "cold",
    "warning",
  ];
  return ORDER.filter((s) => signals.has(s));
}

// ─── Batch derivation over a slate ────────────────────────────────────────

type PropContextRow = {
  prop_id: number;
  prop_market: string;
  player_id: number;
  game_id: number;
  slate_date: string;
  // Pitcher (opposing for batter props; self for pitcher props)
  pitcherThrows: "L" | "R" | null;
  batterBats: "L" | "R" | "S" | null;
  splitVsLhpAvg: number | null;
  splitVsRhpAvg: number | null;
  seasonBattingAvg: number | null;
  parkFactorRuns: number | null;
  parkFactorHr: number | null;
  parkFactorSo: number | null;
  windDirectionRelative: string | null;
  windSpeedMph: number | null;
  edgePct: number | null;
  tier: "premium" | "strong" | "good" | "skip" | null;
};

/**
 * Assemble context for every prop_prediction on a slate, then derive signals.
 * Returns Map<prop_prediction_id, Signal[]>. Pure-ish (only DB reads).
 */
export async function deriveSignalsForSlate(
  sport: Sport,
  slate_date: string
): Promise<Map<number, Signal[]>> {
  // ─── 1. Slate games ────────────────────────────────────────────────────
  const { data: games } = await supabase
    .from("games")
    .select(
      "id, slate_date, home_team_id, away_team_id, home_pitcher_id, away_pitcher_id, ballpark_id"
    )
    .eq("sport", sport)
    .eq("slate_date", slate_date);
  const gameRows = (games ?? []) as Array<{
    id: number;
    slate_date: string;
    home_team_id: number | null;
    away_team_id: number | null;
    home_pitcher_id: number | null;
    away_pitcher_id: number | null;
    ballpark_id: number | null;
  }>;
  if (gameRows.length === 0) return new Map();
  const gameIds = gameRows.map((g) => g.id);
  const gameById = new Map(gameRows.map((g) => [g.id, g]));

  // ─── 2. Props on these games ───────────────────────────────────────────
  const { data: props } = await supabase
    .from("prop_predictions")
    .select("id, game_id, player_id, prop_market, edge_pct, tier")
    .in("game_id", gameIds);
  const propRows = (props ?? []) as Array<{
    id: number;
    game_id: number;
    player_id: number;
    prop_market: string;
    edge_pct: number | null;
    tier: string | null;
  }>;
  if (propRows.length === 0) return new Map();

  // ─── 3. Players (bats, throws, team_id) for both prop subjects + pitchers ─
  const playerIdSet = new Set<number>();
  for (const p of propRows) playerIdSet.add(p.player_id);
  for (const g of gameRows) {
    if (g.home_pitcher_id) playerIdSet.add(g.home_pitcher_id);
    if (g.away_pitcher_id) playerIdSet.add(g.away_pitcher_id);
  }
  const { data: players } = await supabase
    .from("players")
    .select("id, team_id, bats, throws, is_pitcher")
    .in("id", Array.from(playerIdSet));
  type PlayerRow = {
    id: number;
    team_id: number | null;
    bats: "L" | "R" | "S" | null;
    throws: "L" | "R" | null;
    is_pitcher: boolean;
  };
  const playerById = new Map<number, PlayerRow>(
    ((players ?? []) as PlayerRow[]).map((p) => [p.id, p])
  );

  // ─── 4. player_splits — vs_lhp/vs_rhp avg per player ───────────────────
  const subjectIds = Array.from(new Set(propRows.map((p) => p.player_id)));
  const { data: splits } = await supabase
    .from("player_splits")
    .select("player_id, split_type, avg")
    .in("player_id", subjectIds)
    .in("split_type", ["vs_lhp", "vs_rhp"]);
  type SplitRow = { player_id: number; split_type: string; avg: number | null };
  const splitByPlayer = new Map<number, { lhp: number | null; rhp: number | null }>();
  for (const s of (splits ?? []) as SplitRow[]) {
    const cur = splitByPlayer.get(s.player_id) ?? { lhp: null, rhp: null };
    if (s.split_type === "vs_lhp") cur.lhp = s.avg;
    if (s.split_type === "vs_rhp") cur.rhp = s.avg;
    splitByPlayer.set(s.player_id, cur);
  }

  // ─── 5. season batting average per player (current season) ─────────────
  const { data: seasonStats } = await supabase
    .from("player_season_stats")
    .select("player_id, batting_avg")
    .in("player_id", subjectIds)
    .eq("season", 2025); // SPLITS_SEASON parity with predictionService
  const seasonAvgByPlayer = new Map<number, number | null>(
    ((seasonStats ?? []) as Array<{ player_id: number; batting_avg: number | null }>).map((r) => [r.player_id, r.batting_avg])
  );

  // ─── 6. Ballpark park factors ──────────────────────────────────────────
  const ballparkIds = Array.from(
    new Set(gameRows.map((g) => g.ballpark_id).filter((id): id is number => id !== null))
  );
  const { data: parks } = await supabase
    .from("ballparks")
    .select("id, park_factor_runs, park_factor_hr, park_factor_so")
    .in("id", ballparkIds);
  const parkById = new Map<number, { runs: number | null; hr: number | null; so: number | null }>(
    ((parks ?? []) as Array<{ id: number; park_factor_runs: number | null; park_factor_hr: number | null; park_factor_so: number | null }>).map((p) => [
      p.id,
      { runs: p.park_factor_runs, hr: p.park_factor_hr, so: p.park_factor_so },
    ])
  );

  // ─── 7. Weather per game ────────────────────────────────────────────────
  const { data: weather } = await supabase
    .from("weather_forecasts")
    .select("game_id, wind_speed_mph, wind_direction_relative")
    .in("game_id", gameIds);
  const weatherByGame = new Map<number, { speed: number | null; dir: string | null }>(
    ((weather ?? []) as Array<{ game_id: number; wind_speed_mph: number | null; wind_direction_relative: string | null }>).map((w) => [
      w.game_id,
      { speed: w.wind_speed_mph, dir: w.wind_direction_relative },
    ])
  );

  // ─── 8. Per-prop context assembly ──────────────────────────────────────
  const result = new Map<number, Signal[]>();
  for (const prop of propRows) {
    const game = gameById.get(prop.game_id);
    if (!game) continue;
    const subject = playerById.get(prop.player_id);
    const isPProp = subject?.is_pitcher === true || PITCHER_MARKETS.has(prop.prop_market);

    // For batter props the OPPOSING pitcher is the relevant handedness; for
    // pitcher props the player themselves is the pitcher (vs_lhp/rhp won't
    // fire anyway because we skip those branches for pitcher props).
    let opposingPitcherThrows: "L" | "R" | null = null;
    if (!isPProp && subject?.team_id) {
      const oppPitcherId =
        subject.team_id === game.home_team_id ? game.away_pitcher_id : game.home_pitcher_id;
      if (oppPitcherId) {
        const opp = playerById.get(oppPitcherId);
        opposingPitcherThrows = opp?.throws ?? null;
      }
    }

    const splitRow = splitByPlayer.get(prop.player_id) ?? { lhp: null, rhp: null };
    const park = game.ballpark_id ? parkById.get(game.ballpark_id) ?? null : null;
    const wx = weatherByGame.get(prop.game_id) ?? null;

    const ctx: SignalDerivationContext = {
      prop_market: prop.prop_market,
      player_id: prop.player_id,
      game_id: prop.game_id,
      slate_date: game.slate_date,
      isPitcherProp: isPProp,
      pitcherThrows: opposingPitcherThrows,
      batterBats: subject?.bats ?? null,
      splitVsLhpAvg: splitRow.lhp,
      splitVsRhpAvg: splitRow.rhp,
      seasonBattingAvg: seasonAvgByPlayer.get(prop.player_id) ?? null,
      parkFactorRuns: park?.runs ?? null,
      parkFactorHr: park?.hr ?? null,
      parkFactorSo: park?.so ?? null,
      windDirectionRelative: wx?.dir ?? null,
      windSpeedMph: wx?.speed ?? null,
      edgePct: prop.edge_pct,
      tier: (prop.tier ?? null) as SignalDerivationContext["tier"],
    };
    result.set(prop.id, deriveSignals(ctx));
  }

  return result;
}

/**
 * Apply derived signals to prop_predictions for the slate. Idempotent —
 * UPDATE ... SET signals = $1 with the same input produces the same output.
 *
 * Returns counts. Used by the seed back-fill pass and (optionally) by the
 * lineup-watch / pregame-sweep crons to recompute signals after lineup
 * changes flip a prop from "platoon=yes" to "platoon=no".
 */
export async function updateSignalsForSlate(
  sport: Sport,
  slate_date: string
): Promise<{ updated: number; signalCounts: Record<string, number> }> {
  const map = await deriveSignalsForSlate(sport, slate_date);
  const signalCounts: Record<string, number> = {};
  let updated = 0;
  // Group by signal-array signature so we can batch UPDATEs (one UPDATE per
  // distinct signal-set instead of per-prop).
  const buckets = new Map<string, { signals: Signal[]; ids: number[] }>();
  for (const [propId, signals] of map.entries()) {
    for (const s of signals) signalCounts[s] = (signalCounts[s] ?? 0) + 1;
    const key = signals.join(",");
    const bucket = buckets.get(key) ?? { signals, ids: [] };
    bucket.ids.push(propId);
    buckets.set(key, bucket);
  }
  for (const bucket of buckets.values()) {
    const { error } = await supabase
      .from("prop_predictions")
      .update({ signals: bucket.signals })
      .in("id", bucket.ids);
    if (error) {
      throw new Error(`signal update failed: ${error.message}`);
    }
    updated += bucket.ids.length;
  }
  return { updated, signalCounts };
}
