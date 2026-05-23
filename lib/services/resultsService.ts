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

const SEASON_START = "2026-03-28";

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
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
    const { data: gameRows } = await supabase
      .from("games")
      .select("id, game_date")
      .in("id", gameDbIds);
    const gameDateById = new Map<number, string>(
      ((gameRows ?? []) as Array<{ id: number; game_date: string }>).map((r) => [
        r.id,
        String(r.game_date).slice(0, 10),
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

    // Prop predictions with their player external_id
    const { data: propPredRows } = await supabase
      .from("prop_predictions")
      .select("id, game_id, prop_market, prop_line, players:player_id (external_id)")
      .in("game_id", gameDbIds);

    // Game predictions
    const { data: gamePredRows } = await supabase
      .from("game_predictions")
      .select("id, game_id, predicted_ml_winner, predicted_ou_side, predicted_nrfi, bet_odds_american")
      .in("game_id", gameDbIds);

    const inserts: Array<Record<string, unknown>> = [];

    // Resolve prop predictions
    type PropPredRow = {
      id: number; game_id: number; prop_market: string; prop_line: number;
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
      });
    }

    // Resolve game-level predictions (one game_prediction → up to 3 results
    // for ML/total/NRFI).
    type GamePredRow = {
      id: number; game_id: number;
      predicted_ml_winner: "home" | "away" | null;
      predicted_ou_side: "over" | "under" | null;
      predicted_nrfi: boolean | null;
      bet_odds_american: number | null;
    };
    for (const gp of (gamePredRows ?? []) as GamePredRow[]) {
      const actual = actuals.find((a) => a.game_db_id === gp.game_id);
      if (!actual) continue;
      const gameDate = gameDateById.get(gp.game_id) ?? date;
      const resolvedAtIso = `${gameDate}T23:30:00.000Z`;

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
