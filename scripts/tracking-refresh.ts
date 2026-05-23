/**
 * scripts/tracking-refresh.ts — chain all four tracking modules end-to-end.
 *
 *   1. Demonstrate outcomeResolver by synthesizing one completed game's
 *      outcome (NYY vs BOS) and writing prediction_results for its
 *      4 prop_predictions + 3 game_prediction resolutions.
 *   2. Recompute tracking_aggregates from ALL prediction_results (delete +
 *      rebuild — matches what the Phase 4 nightly cron will do).
 *   3. Compute calibration_buckets from joined predictions + outcomes;
 *      insert / refresh.
 *   4. Recompute CLV on prediction_results past the 30-day silence window;
 *      verify within-silence picks remain NULL.
 *   5. Spot-check + report.
 *
 * Run with: npm run tracking-refresh
 */

import { supabase } from "../lib/db/supabase";
import {
  resolveGame,
  resolveProp,
  type PlayerStatLine,
  type GameOutcome,
} from "../lib/models/tracking/outcomeResolver";
import {
  computeAggregates,
  type PredictionResultRow,
} from "../lib/models/tracking/aggregator";
import {
  computeCalibration,
  type PredictionForCalibration,
} from "../lib/models/tracking/calibrationComputer";
import { computeClv } from "../lib/models/tracking/clvCalculator";
import type { PropMarketType } from "../lib/types/domain/Lines";

const TODAY = "2026-05-22";
const SEASON_START = "2026-03-28";

function logSection(t: string) {
  console.log(`\n${"─".repeat(70)}\n${t}\n${"─".repeat(70)}`);
}

async function main() {
  console.log("tracking-refresh · slate", TODAY, "\n");
  const startedAt = Date.now();

  // ── Stage 1: synthetic resolution of NYY @ BOS (game 18599100) ──────────
  logSection("Stage 1 · resolve synthetic NYY-BOS outcome");

  // Fake game outcome
  const nyyBosOutcome: GameOutcome = {
    home_score: 7, // NYY
    away_score: 4, // BOS
    first_inning_total_runs: 2,
    total_line: 8.5,
  };
  // Fake per-player stat lines (only the 3 players with props on this game)
  // Judge: 2 H, 1 HR, 5 TB (4 from HR + 1 from a single), 3 RBI
  // Soto: 1 H, 0 HR, 1 TB, 1 RBI
  // Cole: 7 K, 2 ER, 5 H allowed
  const statsByPlayerExtId: Record<number, PlayerStatLine> = {
    592450: { batting_h: 2, batting_hr: 1, batting_tb: 5, batting_rbi: 3 }, // Judge
    600002: { batting_h: 1, batting_hr: 0, batting_tb: 1, batting_rbi: 1 }, // Soto
    543037: { pitching_k: 7, pitching_er: 2, pitching_h: 5 },                // Cole
  };

  // Load NYY-BOS game + its prop_predictions + its game_prediction
  const { data: nyyGameRow } = await supabase
    .from("games")
    .select("id, external_id, game_date")
    .eq("external_id", 18599100)
    .single();
  if (!nyyGameRow) throw new Error("NYY-BOS game not found in DB");
  const nyyGameId = nyyGameRow.id;
  const nyyGameDate = String(nyyGameRow.game_date).slice(0, 10);

  // Wipe any prediction_results for tonight's NYY-BOS so we can re-resolve
  await supabase.from("prediction_results").delete().or(
    `game_prediction_id.in.(${(await getPredIds("game_predictions", nyyGameId)).join(",")}),prop_prediction_id.in.(${(await getPredIds("prop_predictions", nyyGameId)).join(",")})`
  );

  // Prop resolutions
  const { data: propRows } = await supabase
    .from("prop_predictions")
    .select("id, player_id, prop_market, prop_line, players:player_id (external_id)")
    .eq("game_id", nyyGameId);

  let propResolved = 0;
  const propResultsToInsert: Record<string, unknown>[] = [];
  for (const p of (propRows ?? []) as unknown as Array<{
    id: number;
    player_id: number;
    prop_market: string;
    prop_line: number;
    players: { external_id: number } | null;
  }>) {
    const extId = (p.players as unknown as { external_id: number } | null)?.external_id;
    if (extId === undefined) continue;
    const stats = statsByPlayerExtId[extId];
    if (!stats) continue; // no synthetic stats for this player
    const r = resolveProp({
      prop_market: p.prop_market as PropMarketType,
      prop_line: p.prop_line,
      predicted_side: "over", // V1: model only predicts over
      player_stat_line: stats,
    });
    propResultsToInsert.push({
      prediction_type: "prop",
      prop_prediction_id: p.id,
      outcome: r.outcome,
      actual_value: r.actual_value,
      predicted_side: "over",
      sport: "mlb",
      market: marketShortName(p.prop_market as PropMarketType),
      resolved_at: `${nyyGameDate}T23:30:00.000Z`,
      game_date: nyyGameDate,
      bet_odds_american: null, // will be filled from prop_predictions in production
      closing_odds_american: null,
      clv_pct: null,
      beat_closing_line: null,
    });
    propResolved++;
  }

  // Game prediction resolution
  const { data: gpRow } = await supabase
    .from("game_predictions")
    .select(
      "id, predicted_ml_winner, ml_confidence, predicted_ou_side, ou_confidence, predicted_nrfi, nrfi_confidence, bet_odds_american"
    )
    .eq("game_id", nyyGameId)
    .single();

  const gameResultsToInsert: Record<string, unknown>[] = [];
  if (gpRow) {
    // ML resolution
    const mlR = resolveGame({
      prediction_type: "game_ml",
      predicted_side: gpRow.predicted_ml_winner as "home" | "away",
      game_outcome: nyyBosOutcome,
    });
    gameResultsToInsert.push({
      prediction_type: "game_ml",
      game_prediction_id: gpRow.id,
      outcome: mlR.outcome,
      actual_value: mlR.actual_value,
      predicted_side: gpRow.predicted_ml_winner,
      sport: "mlb",
      market: "ml",
      resolved_at: `${nyyGameDate}T23:30:00.000Z`,
      game_date: nyyGameDate,
      bet_odds_american: gpRow.bet_odds_american,
      closing_odds_american: gpRow.bet_odds_american,
      clv_pct: null,
      beat_closing_line: null,
    });
    // OU resolution
    const ouR = resolveGame({
      prediction_type: "game_total",
      predicted_side: gpRow.predicted_ou_side as "over" | "under",
      game_outcome: nyyBosOutcome,
    });
    gameResultsToInsert.push({
      prediction_type: "game_total",
      game_prediction_id: gpRow.id,
      outcome: ouR.outcome,
      actual_value: ouR.actual_value,
      predicted_side: gpRow.predicted_ou_side,
      sport: "mlb",
      market: "total",
      resolved_at: `${nyyGameDate}T23:30:00.000Z`,
      game_date: nyyGameDate,
      bet_odds_american: null,
      closing_odds_american: null,
      clv_pct: null,
      beat_closing_line: null,
    });
    // NRFI resolution
    const nrfiR = resolveGame({
      prediction_type: "game_nrfi",
      predicted_side: gpRow.predicted_nrfi ? "nrfi" : "yrfi",
      game_outcome: nyyBosOutcome,
    });
    gameResultsToInsert.push({
      prediction_type: "game_nrfi",
      game_prediction_id: gpRow.id,
      outcome: nrfiR.outcome,
      actual_value: nrfiR.actual_value,
      predicted_side: gpRow.predicted_nrfi ? "nrfi" : "yrfi",
      sport: "mlb",
      market: gpRow.predicted_nrfi ? "nrfi" : "yrfi",
      resolved_at: `${nyyGameDate}T23:30:00.000Z`,
      game_date: nyyGameDate,
      bet_odds_american: null,
      closing_odds_american: null,
      clv_pct: null,
      beat_closing_line: null,
    });
  }

  const allInsert = [...propResultsToInsert, ...gameResultsToInsert];
  if (allInsert.length > 0) {
    const { error } = await supabase.from("prediction_results").insert(allInsert);
    if (error) throw new Error(`Insert NYY-BOS results failed: ${error.message}`);
  }
  console.log(
    `  resolved + wrote: ${propResolved} prop results, ${gameResultsToInsert.length} game-level results`
  );

  // ── Stage 2: recompute tracking_aggregates ──────────────────────────────
  logSection("Stage 2 · recompute tracking_aggregates");

  const { data: allResults } = await supabase
    .from("prediction_results")
    .select("sport, market, outcome, game_date");
  const aggs = computeAggregates(
    (allResults ?? []) as PredictionResultRow[],
    { today: TODAY, seasonStart: SEASON_START }
  );
  await supabase.from("tracking_aggregates").delete().gte("id", 0);
  if (aggs.length > 0) {
    const { error } = await supabase.from("tracking_aggregates").insert(aggs);
    if (error) throw new Error(`Insert aggregates failed: ${error.message}`);
  }
  console.log(`  recomputed ${aggs.length} aggregate rows`);

  // ── Stage 3: compute calibration_buckets ────────────────────────────────
  logSection("Stage 3 · compute calibration_buckets");

  // Pull predictions joined with their confidence values
  const { data: gameRes } = await supabase
    .from("prediction_results")
    .select(
      "prediction_type, sport, market, outcome, game_date, game_predictions:game_prediction_id (ml_confidence, ou_confidence, nrfi_confidence)"
    )
    .not("game_prediction_id", "is", null);

  const { data: propRes } = await supabase
    .from("prediction_results")
    .select(
      "prediction_type, sport, market, outcome, game_date, prop_predictions:prop_prediction_id (confidence_score)"
    )
    .not("prop_prediction_id", "is", null);

  const calibrationInputs: PredictionForCalibration[] = [];

  for (const r of (gameRes ?? []) as unknown as Array<{
    prediction_type: "game_ml" | "game_total" | "game_nrfi";
    sport: string;
    market: string;
    outcome: "win" | "loss" | "push" | "void";
    game_date: string;
    game_predictions: { ml_confidence: number | null; ou_confidence: number | null; nrfi_confidence: number | null } | null;
  }>) {
    const gp = r.game_predictions as unknown as { ml_confidence: number | null; ou_confidence: number | null; nrfi_confidence: number | null } | null;
    if (!gp) continue;
    const confidence =
      r.prediction_type === "game_ml" ? gp.ml_confidence
      : r.prediction_type === "game_total" ? gp.ou_confidence
      : r.prediction_type === "game_nrfi" ? gp.nrfi_confidence
      : null;
    if (confidence === null) continue;
    calibrationInputs.push({
      prediction_type: r.prediction_type,
      sport: r.sport,
      market: r.market,
      confidence,
      outcome: r.outcome,
      game_date: r.game_date,
    });
  }

  for (const r of (propRes ?? []) as unknown as Array<{
    prediction_type: "prop";
    sport: string;
    market: string;
    outcome: "win" | "loss" | "push" | "void";
    game_date: string;
    prop_predictions: { confidence_score: number | null } | null;
  }>) {
    const pp = r.prop_predictions as unknown as { confidence_score: number | null } | null;
    if (!pp || pp.confidence_score === null) continue;
    calibrationInputs.push({
      prediction_type: r.prediction_type,
      sport: r.sport,
      market: r.market,
      confidence: pp.confidence_score,
      outcome: r.outcome,
      game_date: r.game_date,
    });
  }

  const calibration = computeCalibration(calibrationInputs, {
    today: TODAY,
    seasonStart: SEASON_START,
  });

  await supabase.from("calibration_buckets").delete().gte("id", 0);

  if (calibration.length > 0) {
    const dbRows = calibration.map((c) => ({
      sport: c.sport,
      prediction_type: c.prediction_type,
      market: c.market,
      confidence_bucket_lower: c.confidence_bucket_lower,
      confidence_bucket_upper: c.confidence_bucket_upper,
      confidence_bucket_label: c.confidence_bucket_label,
      predictions_in_bucket: c.sample_count,
      actual_hit_rate: c.hit_rate,
      expected_hit_rate: c.expected_hit_rate,
      calibration_delta: c.calibration_delta,
      is_displayable: c.is_displayable,
      min_sample_size: 30,
      time_window: c.time_window,
    }));
    const { error } = await supabase.from("calibration_buckets").insert(dbRows);
    if (error) throw new Error(`Insert calibration failed: ${error.message}`);
  }
  const displayable = calibration.filter((c) => c.is_displayable).length;
  console.log(
    `  computed ${calibration.length} calibration buckets · ${displayable} displayable (sample >= 30)`
  );

  // ── Stage 4: recompute CLV on prediction_results ────────────────────────
  logSection("Stage 4 · recompute CLV");

  const { data: clvRows } = await supabase
    .from("prediction_results")
    .select("id, bet_odds_american, closing_odds_american, game_date");

  let updated = 0;
  let silent = 0;
  for (const r of (clvRows ?? []) as Array<{
    id: number;
    bet_odds_american: number | null;
    closing_odds_american: number | null;
    game_date: string;
  }>) {
    const clv = computeClv({
      bet_odds_american: r.bet_odds_american,
      closing_odds_american: r.closing_odds_american,
      game_date: r.game_date,
      today: TODAY,
    });
    if (clv.clv_pct === null && clv.beat_closing_line === null) {
      silent++;
      continue;
    }
    await supabase
      .from("prediction_results")
      .update({ clv_pct: clv.clv_pct, beat_closing_line: clv.beat_closing_line })
      .eq("id", r.id);
    updated++;
  }
  console.log(`  CLV: ${updated} updated, ${silent} silent (within 30-day window or missing data)`);

  // ── Stage 5: verification ───────────────────────────────────────────────
  logSection("Stage 5 · verification");

  // Tonight's NYY-BOS prediction_results
  const { data: nyyResults } = await supabase
    .from("prediction_results")
    .select(
      "prediction_type, market, predicted_side, outcome, actual_value, clv_pct"
    )
    .eq("game_date", nyyGameDate)
    .or(
      `game_prediction_id.in.(${(await getPredIds("game_predictions", nyyGameId)).join(",")}),prop_prediction_id.in.(${(await getPredIds("prop_predictions", nyyGameId)).join(",")})`
    );
  console.log(`  Tonight's NYY-BOS predictions (${(nyyResults ?? []).length} resolved):`);
  (nyyResults ?? []).forEach((r) => {
    console.log(
      `    ${r.prediction_type.padEnd(12)} ${r.market.padEnd(20)} ${r.predicted_side.padEnd(6)} · ${r.outcome.toUpperCase().padEnd(5)} · actual ${r.actual_value}` +
        (r.clv_pct !== null ? ` · CLV ${r.clv_pct}%` : " · CLV silent")
    );
  });

  // Tracking aggregates top-line
  const { data: aggTop } = await supabase
    .from("tracking_aggregates")
    .select("market, time_window, wins, losses, pushes, hit_rate")
    .eq("time_window", "all_time")
    .order("market");
  console.log(`\n  Tracking aggregates (all_time):`);
  (aggTop ?? []).forEach((r) => {
    console.log(
      `    ${r.market.padEnd(20)} ${r.wins}-${r.losses}-${r.pushes} · ${r.hit_rate ?? "n/a"}%`
    );
  });

  // Calibration top-line
  const { data: calTop } = await supabase
    .from("calibration_buckets")
    .select(
      "prediction_type, market, confidence_bucket_label, predictions_in_bucket, actual_hit_rate, expected_hit_rate, calibration_delta, is_displayable, time_window"
    )
    .eq("time_window", "all_time")
    .order("prediction_type");
  console.log(`\n  Calibration buckets (all_time):`);
  (calTop ?? []).forEach((r) => {
    const displayable = r.is_displayable ? "✓" : "✗";
    const actual = r.actual_hit_rate !== null ? `${r.actual_hit_rate}%` : "n/a";
    const delta = r.calibration_delta !== null ? `${r.calibration_delta > 0 ? "+" : ""}${r.calibration_delta}` : "n/a";
    console.log(
      `    ${r.prediction_type.padEnd(12)} ${r.market.padEnd(20)} ${r.confidence_bucket_label.padEnd(10)} · n=${String(r.predictions_in_bucket).padStart(3)} · actual ${actual.padEnd(8)} · expected ${r.expected_hit_rate}% · delta ${delta} · disp ${displayable}`
    );
  });

  // CLV silence verification
  const { count: silentNow } = await supabase
    .from("prediction_results")
    .select("*", { count: "exact", head: true })
    .is("clv_pct", null)
    .gte("game_date", "2026-04-22"); // last 30 days
  const { count: silentTotal } = await supabase
    .from("prediction_results")
    .select("*", { count: "exact", head: true })
    .gte("game_date", "2026-04-22");
  console.log(`\n  CLV silence check: ${silentNow}/${silentTotal} last-30d picks have null CLV (expect 100%)`);

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n✅ tracking-refresh complete · ${elapsed}s total\n`);
}

async function getPredIds(table: "game_predictions" | "prop_predictions", gameId: number): Promise<number[]> {
  const { data } = await supabase.from(table).select("id").eq("game_id", gameId);
  return ((data ?? []) as { id: number }[]).map((r) => r.id);
}

function marketShortName(propMarket: PropMarketType): string {
  switch (propMarket) {
    case "batter_hits":          return "prop_hits";
    case "batter_total_bases":   return "prop_total_bases";
    case "batter_home_runs":     return "prop_home_runs";
    case "batter_rbis":          return "prop_rbis";
    case "pitcher_strikeouts":   return "prop_strikeouts";
    case "pitcher_earned_runs":  return "prop_earned_runs";
    case "pitcher_hits_allowed": return "prop_hits_allowed";
  }
}

main().catch((e) => {
  console.error("\n❌ tracking-refresh failed:", e.message);
  if (e.stack) console.error(e.stack);
  process.exit(1);
});
