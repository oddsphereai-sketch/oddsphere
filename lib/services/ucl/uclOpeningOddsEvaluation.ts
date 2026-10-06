import type { BdlUclMatch, BdlUclOdds, BdlUclTeamMatchStats } from "@/lib/providers/real_api/BallDontLieUclProvider";
import { buildUclCompetitionContexts, regulationScore } from "./uclCompetitionContext";
import { partitionUclChronologicalMatches } from "./uclChronologicalEvaluation";
import { fitAndPredictUcl, joinUclMatchStats } from "./uclModel";
import { assertFrozenUclHistoricalStats } from "./uclChronologicalManifest";
import { canonicalUclOpeningOdds, type CompleteUclOpening } from "./uclOpeningOdds";

export { canonicalUclOpeningOdds } from "./uclOpeningOdds";

type ResultSide = "home" | "draw" | "away";
type EvaluatedRow = {
  matchId: number;
  side: ResultSide;
  modelProbability: number;
  price: number;
  vendor: string;
  ev: number;
  won: boolean;
  profit: number;
  breakEven: number;
};

const PROBABILITY_FLOORS = [0.4, 0.45, 0.5, 0.55, 0.6, 0.65] as const;
const EV_FLOORS = [0, 0.02, 0.04, 0.06, 0.08] as const;

function decimalOdds(value: number): number {
  return value > 0 ? 1 + value / 100 : 1 + 100 / Math.abs(value);
}

function implied(value: number): number {
  return 1 / decimalOdds(value);
}

function forecastSide(probabilities: Record<ResultSide, number>): ResultSide {
  return (["home", "draw", "away"] as const).reduce((best, side) => probabilities[side] > probabilities[best] ? side : best, "home");
}

function evaluatedRows(matches: BdlUclMatch[], all: BdlUclMatch[], stats: BdlUclTeamMatchStats[], openings: Map<number, CompleteUclOpening[]>): EvaluatedRow[] {
  const training = joinUclMatchStats(all, stats);
  const contexts = buildUclCompetitionContexts(all);
  return matches.flatMap((match): EvaluatedRow[] => {
    const score = regulationScore(match).score;
    const context = contexts.get(match.id);
    const books = openings.get(match.id) ?? [];
    if (!score || !context || !books.length) return [];
    const prediction = fitAndPredictUcl({ training, match, history: all, context });
    const side = forecastSide(prediction.probabilities);
    const selected = [...books].sort((left, right) => right.prices[side] - left.prices[side]
      || left.vendor.toLowerCase().localeCompare(right.vendor.toLowerCase()) || left.id - right.id)[0]!;
    const price = selected.prices[side];
    const won = side === "home" ? score.home > score.away : side === "away" ? score.away > score.home : score.home === score.away;
    return [{
      matchId: match.id,
      side,
      modelProbability: prediction.probabilities[side],
      price,
      vendor: selected.vendor,
      ev: prediction.probabilities[side] * decimalOdds(price) - 1,
      won,
      profit: won ? decimalOdds(price) - 1 : -1,
      breakEven: implied(price),
    }];
  });
}

function summarize(rows: EvaluatedRow[]) {
  const plays = rows.length;
  const wins = rows.filter((row) => row.won).length;
  const units = rows.reduce((sum, row) => sum + row.profit, 0);
  const breakEven = plays ? rows.reduce((sum, row) => sum + row.breakEven, 0) / plays : 0;
  return { plays, wins, losses: plays - wins, units, roi: plays ? units / plays : 0, hitRate: plays ? wins / plays : 0, breakEven };
}

export function assessUclOpeningOddsCoverage(matches: BdlUclMatch[], odds: BdlUclOdds[]) {
  const partition = partitionUclChronologicalMatches(matches);
  const openings = canonicalUclOpeningOdds(odds);
  const calibrationQuoted = partition.calibration.filter((match) => openings.has(match.id)).length;
  const holdoutQuoted = partition.holdout.filter((match) => openings.has(match.id)).length;
  const coverage = {
    calibration: { quoted: calibrationQuoted, total: partition.calibration.length, rate: calibrationQuoted / Math.max(1, partition.calibration.length) },
    holdout: { quoted: holdoutQuoted, total: partition.holdout.length, rate: holdoutQuoted / Math.max(1, partition.holdout.length) },
  };
  return {
    partition,
    openings,
    coverage,
    coverageQualified: coverage.calibration.rate >= 0.8 && coverage.holdout.rate >= 0.8 && coverage.holdout.quoted >= 40,
  };
}

export function evaluateUclOpeningOddsActionability(input: { matches: BdlUclMatch[]; stats: BdlUclTeamMatchStats[]; odds: BdlUclOdds[] }) {
  const { partition, openings, coverage, coverageQualified } = assessUclOpeningOddsCoverage(input.matches, input.odds);
  const holdoutMarketRows = partition.holdout.length * 4;
  const base = {
    coverage,
    coverageQualified,
    eligibleVendors: [...new Set([...openings.values()].flat().map((row) => row.vendor))].sort(),
    boardCounts: {
      before: { bestAngle: 0, lean: 0, watchlist: 0, noPlay: holdoutMarketRows },
      after: { bestAngle: 0, lean: 0, watchlist: 0, noPlay: holdoutMarketRows },
      promotions: 0,
      demotions: 0,
      sideChanges: 0,
    },
  };
  if (!coverageQualified) return { ...base, calibrationCandidate: null, holdout: null, accepted: false };
  assertFrozenUclHistoricalStats(input.matches, input.stats);

  const calibrationRows = evaluatedRows(partition.calibration, partition.finalRows, input.stats, openings);
  const candidates = PROBABILITY_FLOORS.flatMap((probabilityFloor) => EV_FLOORS.map((evFloor) => {
    const rows = calibrationRows.filter((row) => row.modelProbability >= probabilityFloor && row.ev >= evFloor);
    const summary = summarize(rows);
    return { probabilityFloor, evFloor, ...summary, qualified: summary.plays >= 30 && summary.units > 0 && summary.roi > 0 && summary.hitRate > summary.breakEven };
  }));
  const selected = candidates.filter((candidate) => candidate.qualified).sort((left, right) =>
    right.units - left.units || right.roi - left.roi || right.evFloor - left.evFloor || right.probabilityFloor - left.probabilityFloor)[0] ?? null;
  if (!selected) return { ...base, calibrationCandidate: null, holdout: null, accepted: false };

  // This is the only point where untouched holdout outcomes are materialized:
  // after coverage qualification and the calibration-only candidate freeze.
  const holdoutRows = evaluatedRows(partition.holdout, partition.finalRows, input.stats, openings);
  const selectedHoldoutRows = holdoutRows.filter((row) => row.modelProbability >= selected.probabilityFloor && row.ev >= selected.evFloor);
  const holdout = summarize(selectedHoldoutRows);
  const accepted = holdout.plays >= 20 && holdout.units > 0 && holdout.roi > 0 && holdout.hitRate > holdout.breakEven;
  const promoted = accepted ? holdout.plays : 0;
  return {
    ...base,
    calibrationCandidate: selected,
    holdout,
    accepted,
    boardCounts: {
      ...base.boardCounts,
      after: { bestAngle: 0, lean: promoted, watchlist: 0, noPlay: holdoutMarketRows - promoted },
      promotions: promoted,
      demotions: 0,
      sideChanges: 0,
    },
  };
}
