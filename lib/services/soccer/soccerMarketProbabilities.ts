/**
 * Derive WC-1 launch market probabilities from a Dixon-Coles joint
 * score distribution — WC-3 pure math.
 *
 * Pure module. No DB. No HTTP. No market input.
 *
 * BINDING CONTRACT (project-wc-model-standard §4.4):
 *   • Double Chance is derived ONLY from match_result probabilities;
 *     market DC odds NEVER touch the output here.
 *   • Total is derived ONLY from the score distribution; market total
 *     odds NEVER touch the output here.
 *   • BTTS is derived ONLY from the score distribution; market BTTS
 *     odds NEVER touch the output here.
 *
 * All four markets resolve on 90-minute regulation only per WC-1.
 */

import type { ScoreDistribution } from "./dixonColes";

export type MatchResultProbabilities = {
  home: number;
  draw: number;
  away: number;
};

export type DoubleChanceProbabilities = {
  home_or_draw: number;
  away_or_draw: number;
  home_or_away: number;
};

export type TotalProbabilities = {
  line: number;
  over: number;
  under: number;
  push: number;
};

export type BttsProbabilities = {
  yes: number;
  no: number;
};

export type SoccerMarketProbabilities = {
  match_result: MatchResultProbabilities;
  double_chance: DoubleChanceProbabilities;
  total: TotalProbabilities;
  btts: BttsProbabilities;
};

/** P(home_goals > away_goals), P(=), P(<) over the joint distribution. */
export function matchResultFromDistribution(joint: ScoreDistribution): MatchResultProbabilities {
  let home = 0;
  let draw = 0;
  let away = 0;
  for (let h = 0; h < joint.length; h++) {
    for (let a = 0; a < joint[h].length; a++) {
      const p = joint[h][a];
      if (h > a) home += p;
      else if (h < a) away += p;
      else draw += p;
    }
  }
  return { home, draw, away };
}

/** Derived strictly from match_result probabilities. NEVER consults market. */
export function doubleChanceFromMatchResult(mr: MatchResultProbabilities): DoubleChanceProbabilities {
  return {
    home_or_draw: mr.home + mr.draw,
    away_or_draw: mr.away + mr.draw,
    home_or_away: mr.home + mr.away,
  };
}

/**
 * Total probabilities at a given line. Whole-line totals can push:
 * P(over) = P(total > line), P(under) = P(total < line),
 * P(push) = P(total = line). Half-line totals: push = 0.
 *
 * @param joint score distribution
 * @param line  total goals line (typically 2.5)
 */
export function totalFromDistribution(joint: ScoreDistribution, line: number): TotalProbabilities {
  let over = 0;
  let under = 0;
  let push = 0;
  for (let h = 0; h < joint.length; h++) {
    for (let a = 0; a < joint[h].length; a++) {
      const t = h + a;
      const p = joint[h][a];
      if (t > line) over += p;
      else if (t < line) under += p;
      else push += p;
    }
  }
  return { line, over, under, push };
}

/** BTTS Yes = P(home_goals ≥ 1 AND away_goals ≥ 1). */
export function bttsFromDistribution(joint: ScoreDistribution): BttsProbabilities {
  let yes = 0;
  for (let h = 1; h < joint.length; h++) {
    for (let a = 1; a < joint[h].length; a++) {
      yes += joint[h][a];
    }
  }
  const no = 1 - yes;
  return { yes, no };
}

/**
 * One-call helper that produces every WC-1 tracked market probability
 * from the joint distribution. Caller supplies the total line (typically
 * 2.5 — the canonical launch line; alternates can be derived with
 * separate calls to totalFromDistribution).
 */
export function deriveSoccerMarketProbabilities(opts: {
  joint: ScoreDistribution;
  totalLine: number;
}): SoccerMarketProbabilities {
  const matchResult = matchResultFromDistribution(opts.joint);
  const doubleChance = doubleChanceFromMatchResult(matchResult);
  const total = totalFromDistribution(opts.joint, opts.totalLine);
  const btts = bttsFromDistribution(opts.joint);
  return { match_result: matchResult, double_chance: doubleChance, total, btts };
}
