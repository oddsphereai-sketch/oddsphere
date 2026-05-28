/**
 * resultsService — handles outcome resolution, tracking aggregation, and
 * closing-line-value math.
 *
 *   • resolveFinishedGames(sport, date, actuals)
 *     For each finished game, applies resolveProp + resolveGame to the
 *     game's prop_predictions + game_predictions and INSERTs
 *     prediction_results. The `actuals` payload comes from BALLDONTLIE
 *     box-score data in production; tests can inject synthetic outcomes.
 *
 *   • refreshTrackingAggregates(sport?)
 *     Reads all prediction_results, computes per-(sport, market, window)
 *     aggregates via aggregator.computeAggregates, DELETE-then-INSERTs
 *     tracking_aggregates. sport filter narrows to one sport's rows; omit
 *     for cross-sport (post-game-results cron uses cross-sport).
 *
 *   • computeCLV()
 *     Walks prediction_results rows past the 30-day silence window with
 *     both bet_odds + closing_odds populated, computes clv_pct +
 *     beat_closing_line, UPDATEs in place. Idempotent (recomputes the
 *     same value); cheap to re-run nightly.
 */

import { supabase } from "../db/supabase";
import {
  computeAggregates,
  type PredictionResultRow,
} from "../models/tracking/aggregator";
import {
  computeCalibration,
  type PredictionForCalibration,
} from "../models/tracking/calibrationComputer";
import { computeClv } from "../models/tracking/clvCalculator";
import {
  resolveGame,
  resolveProp,
  type GameOutcome,
  type GamePredictedSide,
  type PlayerStatLine,
} from "../models/tracking/outcomeResolver";
import type { PropMarketType } from "../types/domain/Lines";
import type { Sport } from "../types/domain/Sport";
import type { CronHandlerResult } from "../cron/runCron";
import { currentSlateDate } from "../dates/slateDate";

const SEASON_START = "2026-03-28";

/**
 * "Today" for tracking-aggregator window math. Uses the MLB anchor timezone
 * (ET) — game outcomes resolve at the same broadcast-day boundary the rest
 * of the Lab uses. Replaces the pre-5E.1 todayUTC() that drifted when the
 * UTC date had crossed but the ET broadcast day hadn't.
 */
function todayUTC(): string {
  return currentSlateDate("mlb");
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

export type FinishedGameActuals = {
  /** DB game.id (NOT external_id). */
  game_db_id: number;
  outcome: GameOutcome;
  /** player_external_id → stat line (PA stats etc.). */
  playerStatLines: Record<number, PlayerStatLine>;
};

export const resultsService = {
  /**
   * Resolve outcomes for finished games. Caller supplies the actuals
   * (BALLDONTLIE box scores in prod; synthetic data in tests). Writes
   * prediction_results rows for each prop_prediction + game_prediction.
   */
  async resolveFinishedGames(
    sport: Sport,
    date: string,
    actuals: FinishedGameActuals[]
  ): Promise<CronHandlerResult> {
    if (actuals.length === 0) {
      return { records_updated: 0, api_calls_made: 0 };
    }

    const gameDbIds = actuals.map((a) => a.game_db_id);

    // Clear stale prediction_results for these games to keep the resolver
    // idempotent (re-running on the same finals doesn't double-write).
    // Pull slate_date (5E.1) instead of slicing game_date — slate_date is the
    // local-evening date in the sport's anchor timezone, which is the value
    // we want stored on prediction_results.game_date for tracking aggregations.
    const { data: gameRows } = await supabase
      .from("games")
      .select("id, slate_date")
      .in("id", gameDbIds);
    const gameDateById = new Map<number, string>(
      ((gameRows ?? []) as Array<{ id: number; slate_date: string }>).map((r) => [
        r.id,
        r.slate_date,
      ])
    );

    // Find prediction IDs to delete results for
    const { data: gamePreds } = await supabase
      .from("game_predictions")
      .select("id")
      .in("game_id", gameDbIds);
    const gpIds = ((gamePreds ?? []) as { id: number }[]).map((r) => r.id);
    const { data: propPreds } = await supabase
      .from("prop_predictions")
      .select("id")
      .in("game_id", gameDbIds);
    const ppIds = ((propPreds ?? []) as { id: number }[]).map((r) => r.id);

    if (gpIds.length > 0) {
      await supabase.from("prediction_results").delete().in("game_prediction_id", gpIds);
    }
    if (ppIds.length > 0) {
      await supabase.from("prediction_results").delete().in("prop_prediction_id", ppIds);
    }

    // Prop predictions with their player external_id.
    // Fix 6.1 (Gap-23.5): read source_type so prediction_results carries
    // provenance forward. Production filter at lib/db/productionFilter.ts
    // can then keep mock/manual/real_api separation cohesive across
    // predictions → results → tracking/calibration aggregates.
    const { data: propPredRows } = await supabase
      .from("prop_predictions")
      .select("id, game_id, prop_market, prop_line, source_type, players:player_id (external_id)")
      .in("game_id", gameDbIds);

    // Game predictions — also read source_type for carry-forward.
    const { data: gamePredRows } = await supabase
      .from("game_predictions")
      .select("id, game_id, predicted_ml_winner, predicted_ou_side, predicted_nrfi, bet_odds_american, source_type")
      .in("game_id", gameDbIds);

    const inserts: Array<Record<string, unknown>> = [];

    // Resolve prop predictions
    type PropPredRow = {
      id: number; game_id: number; prop_market: string; prop_line: number;
      source_type: string | null;
      players: { external_id: number } | null;
    };
    for (const p of (propPredRows ?? []) as unknown as PropPredRow[]) {
      const extId = (p.players as unknown as { external_id: number } | null)?.external_id;
      if (extId === undefined) continue;
      const actual = actuals.find((a) => a.game_db_id === p.game_id);
      if (!actual) continue;
      const stats = actual.playerStatLines[extId];
      if (!stats) continue;
      const market = p.prop_market as PropMarketType;
      const r = resolveProp({
        prop_market: market,
        prop_line: p.prop_line,
        predicted_side: "over",
        player_stat_line: stats,
      });
      const gameDate = gameDateById.get(p.game_id) ?? date;
      inserts.push({
        prediction_type: "prop",
        prop_prediction_id: p.id,
        outcome: r.outcome,
        actual_value: r.actual_value,
        predicted_side: "over",
        sport,
        market: marketShortName(market),
        resolved_at: `${gameDate}T23:30:00.000Z`,
        game_date: gameDate,
        bet_odds_american: null,
        closing_odds_american: null,
        clv_pct: null,
        beat_closing_line: null,
        // Fix 6.1: inherit provenance from the source prop_prediction.
        // null source_type falls back to DB default 'mock' (defensive).
        source_type: p.source_type ?? "mock",
      });
    }

    // Resolve game-level predictions (one game_prediction → up to 3 results
    // for ML/total/NRFI). Fix 6.1: source_type inherited from source row.
    type GamePredRow = {
      id: number; game_id: number;
      predicted_ml_winner: "home" | "away" | null;
      predicted_ou_side: "over" | "under" | null;
      predicted_nrfi: boolean | null;
      bet_odds_american: number | null;
      source_type: string | null;
    };
    for (const gp of (gamePredRows ?? []) as GamePredRow[]) {
      const actual = actuals.find((a) => a.game_db_id === gp.game_id);
      if (!actual) continue;
      const gameDate = gameDateById.get(gp.game_id) ?? date;
      const resolvedAtIso = `${gameDate}T23:30:00.000Z`;
      // Fix 6.1: carry forward source_type for every result row spawned
      // from this game_prediction (ML / total / NRFI all share provenance).
      const inheritedSourceType = gp.source_type ?? "mock";

      if (gp.predicted_ml_winner) {
        const r = resolveGame({
          prediction_type: "game_ml",
          predicted_side: gp.predicted_ml_winner as GamePredictedSide,
          game_outcome: actual.outcome,
        });
        inserts.push({
          prediction_type: "game_ml",
          game_prediction_id: gp.id,
          outcome: r.outcome,
          actual_value: r.actual_value,
          predicted_side: gp.predicted_ml_winner,
          sport,
          market: "ml",
          resolved_at: resolvedAtIso,
          game_date: gameDate,
          bet_odds_american: gp.bet_odds_american,
          closing_odds_american: gp.bet_odds_american,
          clv_pct: null,
          beat_closing_line: null,
          source_type: inheritedSourceType,
        });
      }
      if (gp.predicted_ou_side) {
        const r = resolveGame({
          prediction_type: "game_total",
          predicted_side: gp.predicted_ou_side as GamePredictedSide,
          game_outcome: actual.outcome,
        });
        inserts.push({
          prediction_type: "game_total",
          game_prediction_id: gp.id,
          outcome: r.outcome,
          actual_value: r.actual_value,
          predicted_side: gp.predicted_ou_side,
          sport,
          market: "total",
          resolved_at: resolvedAtIso,
          game_date: gameDate,
          bet_odds_american: null,
          closing_odds_american: null,
          clv_pct: null,
          beat_closing_line: null,
          source_type: inheritedSourceType,
        });
      }
      if (gp.predicted_nrfi !== null) {
        const side = gp.predicted_nrfi ? "nrfi" : "yrfi";
        const r = resolveGame({
          prediction_type: "game_nrfi",
          predicted_side: side,
          game_outcome: actual.outcome,
        });
        inserts.push({
          prediction_type: "game_nrfi",
          game_prediction_id: gp.id,
          outcome: r.outcome,
          actual_value: r.actual_value,
          predicted_side: side,
          sport,
          market: gp.predicted_nrfi ? "nrfi" : "yrfi",
          resolved_at: resolvedAtIso,
          game_date: gameDate,
          bet_odds_american: null,
          closing_odds_american: null,
          clv_pct: null,
          beat_closing_line: null,
          source_type: inheritedSourceType,
        });
      }
    }

    if (inserts.length > 0) {
      const { error } = await supabase.from("prediction_results").insert(inserts);
      if (error) {
        throw new Error(`prediction_results insert failed: ${error.message}`);
      }
    }
    return { records_updated: inserts.length, api_calls_made: 0 };
  },

  /**
   * Recompute tracking_aggregates from prediction_results. DELETE-then-INSERT
   * so the table always reflects current aggregation.
   *
   * @param sport Optional — when provided, only that sport's rows update;
   *              omit for cross-sport refresh.
   */
  async refreshTrackingAggregates(sport?: Sport): Promise<CronHandlerResult> {
    let q = supabase
      .from("prediction_results")
      .select("sport, market, outcome, game_date");
    if (sport !== undefined) q = q.eq("sport", sport);
    const { data: results, error } = await q;
    if (error) {
      throw new Error(`refreshTrackingAggregates read failed: ${error.message}`);
    }
    const rows = (results ?? []) as PredictionResultRow[];
    const aggregates = computeAggregates(rows, {
      today: todayUTC(),
      seasonStart: SEASON_START,
    });

    // Scoped delete (so cross-sport mode doesn't wipe other sports)
    let delQ = supabase.from("tracking_aggregates").delete().gte("id", 0);
    if (sport !== undefined) delQ = delQ.eq("sport", sport);
    const { error: delErr } = await delQ;
    if (delErr) {
      throw new Error(`refreshTrackingAggregates delete failed: ${delErr.message}`);
    }

    if (aggregates.length > 0) {
      const { error: insErr } = await supabase.from("tracking_aggregates").insert(aggregates);
      if (insErr) {
        throw new Error(`refreshTrackingAggregates insert failed: ${insErr.message}`);
      }
    }
    return { records_updated: aggregates.length, api_calls_made: 0 };
  },

  /**
   * Recompute calibration_buckets from prediction_results joined with the
   * prediction tables (to get confidence values). DELETE-then-INSERT so
   * the table reflects current calibration data.
   *
   * Drives the "honest tracking" calibration display in Phase 5 UI — gates
   * via is_displayable for buckets with sample_count >= 30.
   */
  async refreshCalibrationBuckets(): Promise<CronHandlerResult> {
    // Pull predictions with their confidence values via the FK join. Two
    // queries (game-level vs prop) because the confidence column differs.
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

    const inputs: PredictionForCalibration[] = [];

    for (const r of (gameRes ?? []) as unknown as Array<{
      prediction_type: "game_ml" | "game_total" | "game_nrfi";
      sport: string;
      market: string;
      outcome: "win" | "loss" | "push" | "void";
      game_date: string;
      game_predictions: {
        ml_confidence: number | null;
        ou_confidence: number | null;
        nrfi_confidence: number | null;
      } | null;
    }>) {
      const gp = r.game_predictions;
      if (!gp) continue;
      const confidence =
        r.prediction_type === "game_ml" ? gp.ml_confidence
        : r.prediction_type === "game_total" ? gp.ou_confidence
        : r.prediction_type === "game_nrfi" ? gp.nrfi_confidence
        : null;
      if (confidence === null) continue;
      inputs.push({
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
      const pp = r.prop_predictions;
      if (!pp || pp.confidence_score === null) continue;
      inputs.push({
        prediction_type: r.prediction_type,
        sport: r.sport,
        market: r.market,
        confidence: pp.confidence_score,
        outcome: r.outcome,
        game_date: r.game_date,
      });
    }

    const buckets = computeCalibration(inputs, {
      today: todayUTC(),
      seasonStart: SEASON_START,
    });

    const { error: delErr } = await supabase
      .from("calibration_buckets")
      .delete()
      .gte("id", 0);
    if (delErr) {
      throw new Error(`refreshCalibrationBuckets delete failed: ${delErr.message}`);
    }

    if (buckets.length === 0) {
      return { records_updated: 0, api_calls_made: 0 };
    }

    const dbRows = buckets.map((c) => ({
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
    const { error: insErr } = await supabase
      .from("calibration_buckets")
      .insert(dbRows);
    if (insErr) {
      throw new Error(`refreshCalibrationBuckets insert failed: ${insErr.message}`);
    }

    return {
      records_updated: buckets.length,
      api_calls_made: 0,
      details: {
        total_inputs: inputs.length,
        displayable_buckets: buckets.filter((b) => b.is_displayable).length,
      },
    };
  },

  /**
   * Compute CLV for prediction_results past the silence window.
   * Idempotent — recomputes the same value when re-run.
   *
   * Returns counts: how many rows updated vs silent vs missing data.
   */
  async computeClvForResults(): Promise<CronHandlerResult> {
    const { data: rows } = await supabase
      .from("prediction_results")
      .select("id, bet_odds_american, closing_odds_american, game_date");

    let updated = 0;
    let silent = 0;
    const today = todayUTC();
    for (const r of (rows ?? []) as Array<{
      id: number;
      bet_odds_american: number | null;
      closing_odds_american: number | null;
      game_date: string;
    }>) {
      const result = computeClv({
        bet_odds_american: r.bet_odds_american,
        closing_odds_american: r.closing_odds_american,
        game_date: r.game_date,
        today,
      });
      if (result.clv_pct === null && result.beat_closing_line === null) {
        silent++;
        continue;
      }
      await supabase
        .from("prediction_results")
        .update({
          clv_pct: result.clv_pct,
          beat_closing_line: result.beat_closing_line,
        })
        .eq("id", r.id);
      updated++;
    }

    return {
      records_updated: updated,
      api_calls_made: 0,
      details: { silent_within_30d_or_missing: silent },
    };
  },
};
