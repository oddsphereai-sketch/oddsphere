/**
 * Outcome Resolver — given a completed game and a prediction (game-level or
 * prop), determine the outcome (win/loss/push/void) and the actual_value.
 *
 * Pure functions. No I/O.
 *
 * Per the locked 3C methodology decision: resolveProp is called for ALL
 * prop_predictions (including skip-tier), so calibration analysis covers
 * the full distribution and we can validate "did the 3% edge threshold
 * correctly separate +EV from -EV picks?"
 *
 * Phase 4 cron's resultsService will call these in a loop after games
 * finalize, using actual stats fetched from BALLDONTLIE.
 */

import type { PropMarketType } from "../../types/domain/Lines";

export type ResolvedOutcome = {
  outcome: "win" | "loss" | "push" | "void";
  actual_value: number;
};

export type PropPredictedSide = "over" | "under";

export type PlayerStatLine = {
  batting_h?: number;
  batting_hr?: number;
  batting_tb?: number;
  batting_rbi?: number;
  pitching_k?: number;
  pitching_er?: number;
  pitching_h?: number;
};

export type GameOutcome = {
  home_score: number;
  away_score: number;
  first_inning_total_runs: number;
  total_line: number;
};

// ─────────────────────────────────────────────────────────────────────────
// Over / Under primitive
// ─────────────────────────────────────────────────────────────────────────

function resolveOver(line: number, actual: number): "win" | "loss" | "push" {
  if (actual > line) return "win";
  if (actual < line) return "loss";
  return "push";
}

function resolveUnder(line: number, actual: number): "win" | "loss" | "push" {
  if (actual < line) return "win";
  if (actual > line) return "loss";
  return "push";
}

// ─────────────────────────────────────────────────────────────────────────
// Prop resolution
// ─────────────────────────────────────────────────────────────────────────

function actualValueForMarket(
  market: PropMarketType,
  stats: PlayerStatLine
): number {
  switch (market) {
    case "batter_hits":           return stats.batting_h ?? 0;
    case "batter_home_runs":      return stats.batting_hr ?? 0;
    case "batter_total_bases":    return stats.batting_tb ?? 0;
    case "batter_rbis":           return stats.batting_rbi ?? 0;
    case "pitcher_strikeouts":    return stats.pitching_k ?? 0;
    case "pitcher_earned_runs":   return stats.pitching_er ?? 0;
    case "pitcher_hits_allowed":  return stats.pitching_h ?? 0;
  }
}

/**
 * Resolve a single prop prediction given the player's actual game stat line.
 *
 * Push only possible when the line is an integer and the actual matches
 * exactly (e.g., over 7 strikeouts and pitcher records exactly 7 = push).
 * Half-lines (1.5, 7.5) cannot push.
 */
export function resolveProp(args: {
  prop_market: PropMarketType;
  prop_line: number;
  predicted_side: PropPredictedSide;
  player_stat_line: PlayerStatLine;
}): ResolvedOutcome {
  const actual = actualValueForMarket(args.prop_market, args.player_stat_line);
  const outcome =
    args.predicted_side === "over"
      ? resolveOver(args.prop_line, actual)
      : resolveUnder(args.prop_line, actual);
  return { outcome, actual_value: actual };
}

// ─────────────────────────────────────────────────────────────────────────
// Game-level resolution
// ─────────────────────────────────────────────────────────────────────────

export type GamePredictionType = "game_ml" | "game_total" | "game_nrfi";

export type GamePredictedSide =
  | "home" | "away"
  | "over" | "under"
  | "nrfi" | "yrfi"
  | "yes" | "no";

export function resolveGame(args: {
  prediction_type: GamePredictionType;
  predicted_side: GamePredictedSide;
  game_outcome: GameOutcome;
}): ResolvedOutcome {
  const { home_score, away_score, first_inning_total_runs, total_line } =
    args.game_outcome;

  switch (args.prediction_type) {
    case "game_ml": {
      if (home_score === away_score) {
        // Push extremely rare for ML (extra innings don't tie); MLB has no
        // ties in regular season anymore. Defensive case.
        return { outcome: "push", actual_value: home_score - away_score };
      }
      const winner: "home" | "away" = home_score > away_score ? "home" : "away";
      const outcome = args.predicted_side === winner ? "win" : "loss";
      return { outcome, actual_value: home_score - away_score };
    }
    case "game_total": {
      const total = home_score + away_score;
      const outcome =
        args.predicted_side === "over"
          ? resolveOver(total_line, total)
          : resolveUnder(total_line, total);
      return { outcome, actual_value: total };
    }
    case "game_nrfi": {
      // NRFI = no run in first inning. YRFI = yes run.
      // Conventional predicted_side: "nrfi" / "yrfi" / "under" (no run) / "over" (run).
      const nrfiHit = first_inning_total_runs === 0;
      const predictedNrfi =
        args.predicted_side === "nrfi" ||
        args.predicted_side === "no" ||
        args.predicted_side === "under";
      const outcome = nrfiHit === predictedNrfi ? "win" : "loss";
      return { outcome, actual_value: first_inning_total_runs };
    }
  }
}
