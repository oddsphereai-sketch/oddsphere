import {
  bivariatePoissonScoreDistribution,
  medianTotalFromDistribution,
  mostLikelyTotalFromDistribution,
} from "@/lib/services/soccer/dixonColes";
import { deriveSoccerMarketProbabilities } from "@/lib/services/soccer/soccerMarketProbabilities";

export const EPL_TOTAL_CLUB_WEIGHT = 0.25;
export const EPL_GOAL_PROJECTION_CLUB_WEIGHT = 0.3;
export const EPL_MATCH_RESULT_SCORE_READER_RELEASE = "epl_match_result_locked_score_reconstruction_2026_08_23_r1" as const;

export function calibratedEplTotalOverProbability(clubOver: number, marketOver: number | null): number {
  if (marketOver === null || !Number.isFinite(marketOver)) return clubOver;
  return EPL_TOTAL_CLUB_WEIGHT * clubOver + (1 - EPL_TOTAL_CLUB_WEIGHT) * marketOver;
}

type MarketTargets = { home: number; draw: number; away: number; over: number };
type MatchResultTargets = Pick<MarketTargets, "home" | "draw" | "away">;
export type EplGoalsMarketDistribution = {
  homeLambda: number;
  awayLambda: number;
  bttsYes: number;
};
type GridRow = MarketTargets & EplGoalsMarketDistribution;
let cachedGrid: GridRow[] | null = null;

function marketGrid(): GridRow[] {
  if (cachedGrid) return cachedGrid;
  const rows: GridRow[] = [];
  for (let homeLambda = 0.3; homeLambda <= 3.5; homeLambda += 0.05) {
    for (let awayLambda = 0.3; awayLambda <= 3.5; awayLambda += 0.05) {
      const markets = deriveSoccerMarketProbabilities({
        joint: bivariatePoissonScoreDistribution(homeLambda, awayLambda, -0.1),
        totalLine: 2.5,
      });
      rows.push({
        home: markets.match_result.home,
        draw: markets.match_result.draw,
        away: markets.match_result.away,
        over: markets.total.over,
        bttsYes: markets.btts.yes,
        homeLambda,
        awayLambda,
      });
    }
  }
  cachedGrid = rows;
  return rows;
}

/**
 * Infer BTTS from a coherent three-way result book plus the two-sided 2.5
 * total. This is independent of the offered BTTS price that grades the read.
 * The 1X2 and Total market targets are fit to the same Dixon-Coles family used
 * by the club model; the Total target receives the validation-selected 1.5x
 * loss weight.
 */
export function impliedEplGoalsMarketDistribution(targets: MarketTargets | null): EplGoalsMarketDistribution | null {
  if (!targets || Object.values(targets).some((value) => !Number.isFinite(value))) return null;
  let best: GridRow | null = null;
  let bestLoss = Number.POSITIVE_INFINITY;
  for (const candidate of marketGrid()) {
    const loss = (candidate.home - targets.home) ** 2
      + (candidate.draw - targets.draw) ** 2
      + (candidate.away - targets.away) ** 2
      + 1.5 * (candidate.over - targets.over) ** 2;
    if (loss < bestLoss) { best = candidate; bestLoss = loss; }
  }
  return best ? { homeLambda: best.homeLambda, awayLambda: best.awayLambda, bttsYes: best.bttsYes } : null;
}

export function impliedEplBttsYesProbability(targets: MarketTargets | null): number | null {
  return impliedEplGoalsMarketDistribution(targets)?.bttsYes ?? null;
}

export type EplMatchResultScoreOutlook = {
  expectedGoals: { home: number; away: number };
  likelyScore: { home: number; away: number };
  likelyScoreProbability: number;
  medianTotal: number;
  mostLikelyTotal: number;
  fitLoss: number;
};

const matchResultScoreCache = new Map<string, EplMatchResultScoreOutlook | null>();

/**
 * Recover the Dixon-Coles score head from a locked snapshot's immutable 1X2
 * probabilities. This is a reader reconstruction of the same model family,
 * not a new forecast and not a market-informed goals blend.
 */
export function impliedEplMatchResultScoreOutlook(targets: MatchResultTargets | null): EplMatchResultScoreOutlook | null {
  if (!targets || Object.values(targets).some((value) => !Number.isFinite(value) || value < 0 || value > 1)) return null;
  const sum = targets.home + targets.draw + targets.away;
  if (Math.abs(sum - 1) > 0.01) return null;
  const normalized = { home: targets.home / sum, draw: targets.draw / sum, away: targets.away / sum };
  const cacheKey = [normalized.home, normalized.draw, normalized.away].map((value) => value.toFixed(8)).join(":");
  if (matchResultScoreCache.has(cacheKey)) return matchResultScoreCache.get(cacheKey) ?? null;

  let best = { homeLambda: 1.4, awayLambda: 1.2, loss: Number.POSITIVE_INFINITY };
  const consider = (homeLambda: number, awayLambda: number) => {
    const probabilities = deriveSoccerMarketProbabilities({
      joint: bivariatePoissonScoreDistribution(homeLambda, awayLambda, -0.1),
      totalLine: 2.5,
    }).match_result;
    const loss = (probabilities.home - normalized.home) ** 2
      + (probabilities.draw - normalized.draw) ** 2
      + (probabilities.away - normalized.away) ** 2;
    if (loss < best.loss) best = { homeLambda, awayLambda, loss };
  };

  for (const candidate of marketGrid()) {
    const loss = (candidate.home - normalized.home) ** 2
      + (candidate.draw - normalized.draw) ** 2
      + (candidate.away - normalized.away) ** 2;
    if (loss < best.loss) best = { homeLambda: candidate.homeLambda, awayLambda: candidate.awayLambda, loss };
  }
  for (const step of [0.01, 0.0025]) {
    const center = best;
    for (let homeOffset = -6; homeOffset <= 6; homeOffset++) {
      for (let awayOffset = -6; awayOffset <= 6; awayOffset++) {
        consider(
          Math.max(0.2, Math.min(4, center.homeLambda + homeOffset * step)),
          Math.max(0.2, Math.min(4, center.awayLambda + awayOffset * step)),
        );
      }
    }
  }
  if (best.loss > 0.00005) {
    matchResultScoreCache.set(cacheKey, null);
    return null;
  }

  const joint = bivariatePoissonScoreDistribution(best.homeLambda, best.awayLambda, -0.1);
  let likely = { home: 0, away: 0, probability: 0 };
  for (let home = 0; home < joint.length; home++) {
    for (let away = 0; away < joint[home]!.length; away++) {
      const probability = joint[home]![away]!;
      if (probability > likely.probability) likely = { home, away, probability };
    }
  }
  const outlook: EplMatchResultScoreOutlook = {
    expectedGoals: { home: best.homeLambda, away: best.awayLambda },
    likelyScore: { home: likely.home, away: likely.away },
    likelyScoreProbability: likely.probability,
    medianTotal: medianTotalFromDistribution(joint),
    mostLikelyTotal: mostLikelyTotalFromDistribution(joint),
    fitLoss: best.loss,
  };
  matchResultScoreCache.set(cacheKey, outlook);
  return outlook;
}

export function calibratedEplGoalProjection(
  clubHome: number,
  clubAway: number,
  market: EplGoalsMarketDistribution | null,
): { home: number; away: number } {
  if (!market) return { home: clubHome, away: clubAway };
  return {
    home: EPL_GOAL_PROJECTION_CLUB_WEIGHT * clubHome + (1 - EPL_GOAL_PROJECTION_CLUB_WEIGHT) * market.homeLambda,
    away: EPL_GOAL_PROJECTION_CLUB_WEIGHT * clubAway + (1 - EPL_GOAL_PROJECTION_CLUB_WEIGHT) * market.awayLambda,
  };
}
