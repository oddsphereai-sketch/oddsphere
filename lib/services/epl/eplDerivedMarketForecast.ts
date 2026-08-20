import { bivariatePoissonScoreDistribution } from "@/lib/services/soccer/dixonColes";
import { deriveSoccerMarketProbabilities } from "@/lib/services/soccer/soccerMarketProbabilities";

export const EPL_TOTAL_CLUB_WEIGHT = 0.25;
export const EPL_GOAL_PROJECTION_CLUB_WEIGHT = 0.3;

export function calibratedEplTotalOverProbability(clubOver: number, marketOver: number | null): number {
  if (marketOver === null || !Number.isFinite(marketOver)) return clubOver;
  return EPL_TOTAL_CLUB_WEIGHT * clubOver + (1 - EPL_TOTAL_CLUB_WEIGHT) * marketOver;
}

type MarketTargets = { home: number; draw: number; away: number; over: number };
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
