import type { BdlUclMatch, BdlUclTeamMatchStats } from "@/lib/providers/real_api/BallDontLieUclProvider";
import { buildUclCompetitionContexts, regulationScore } from "./uclCompetitionContext";
import { fitAndPredictUcl, joinUclMatchStats } from "./uclModel";
import { deriveUclMatchResultDecision, deriveUclPreviewGrade } from "./uclPreviewGrade";
import { assertFrozenUclChronologicalManifest, assertFrozenUclHistoricalStats, regulationFinalUclRows, UCL_CHRONOLOGICAL_MANIFEST } from "./uclChronologicalManifest";

type Metrics = {
  matches: number;
  matchResultAccuracy: number;
  matchResultBrier: number;
  matchResultLogLoss: number;
  totalBrier: number;
  totalLogLoss: number;
  bttsBrier: number;
  bttsLogLoss: number;
  teamScoreMae: number;
};

const clip = (value: number) => Math.max(1e-12, Math.min(1 - 1e-12, value));

function actualResult(home: number, away: number): "home" | "draw" | "away" {
  return home > away ? "home" : home < away ? "away" : "draw";
}

function scoreBlock(rows: BdlUclMatch[], all: BdlUclMatch[], stats: BdlUclTeamMatchStats[]): Metrics {
  const training = joinUclMatchStats(all, stats);
  const contexts = buildUclCompetitionContexts(all);
  let correct = 0;
  let mrBrier = 0;
  let mrLog = 0;
  let totalBrier = 0;
  let totalLog = 0;
  let bttsBrier = 0;
  let bttsLog = 0;
  let scoreAbs = 0;
  let matches = 0;
  for (const match of rows) {
    const settled = regulationScore(match).score;
    const context = contexts.get(match.id);
    if (!settled || !context) continue;
    const prediction = fitAndPredictUcl({ training, match, history: all, context });
    const actual = actualResult(settled.home, settled.away);
    const forecast = (["home", "draw", "away"] as const).reduce((best, side) =>
      prediction.probabilities[side] > prediction.probabilities[best] ? side : best, "home");
    if (forecast === actual) correct++;
    const y = { home: actual === "home" ? 1 : 0, draw: actual === "draw" ? 1 : 0, away: actual === "away" ? 1 : 0 };
    mrBrier += ((prediction.probabilities.home - y.home) ** 2
      + (prediction.probabilities.draw - y.draw) ** 2
      + (prediction.probabilities.away - y.away) ** 2) / 3;
    mrLog -= Math.log(clip(prediction.probabilities[actual]));
    const totalActual = settled.home + settled.away > 2.5 ? 1 : 0;
    totalBrier += (prediction.probabilities.over25 - totalActual) ** 2;
    totalLog -= totalActual ? Math.log(clip(prediction.probabilities.over25)) : Math.log(clip(prediction.probabilities.under25));
    const bttsActual = settled.home > 0 && settled.away > 0 ? 1 : 0;
    bttsBrier += (prediction.probabilities.bttsYes - bttsActual) ** 2;
    bttsLog -= bttsActual ? Math.log(clip(prediction.probabilities.bttsYes)) : Math.log(clip(prediction.probabilities.bttsNo));
    scoreAbs += Math.abs(prediction.lambdaHome - settled.home) + Math.abs(prediction.lambdaAway - settled.away);
    matches++;
  }
  const denominator = Math.max(1, matches);
  return {
    matches,
    matchResultAccuracy: correct / denominator,
    matchResultBrier: mrBrier / denominator,
    matchResultLogLoss: mrLog / denominator,
    totalBrier: totalBrier / denominator,
    totalLogLoss: totalLog / denominator,
    bttsBrier: bttsBrier / denominator,
    bttsLogLoss: bttsLog / denominator,
    teamScoreMae: scoreAbs / (2 * denominator),
  };
}

export function evaluateUclChronologically(matches: BdlUclMatch[], stats: BdlUclTeamMatchStats[]) {
  const { train, calibration, holdout, cutoff: provisionalCutoff, finalRows } = partitionUclChronologicalMatches(matches);
  assertFrozenUclHistoricalStats(matches, stats);
  if (!train.length || calibration.length < 20 || holdout.length < 20) {
    throw new Error(`insufficient UCL chronological blocks: train=${train.length} calibration=${calibration.length} holdout=${holdout.length}`);
  }
  const gradeReplay = {
    match_result: deriveUclMatchResultDecision({ model: { home: 0.5, draw: 0.3, away: 0.2 }, market: null, prices: null, promotedProxy: false }).grade.verdict.label,
    double_chance: deriveUclPreviewGrade({ market: "double_chance", modelProbability: 0.8, edgePp: 8, priceAmerican: 100, coherentMarket: true, promotedProxy: false }).verdict.label,
    total: deriveUclPreviewGrade({ market: "total", modelProbability: 0.65, edgePp: 8, priceAmerican: 100, coherentMarket: true, promotedProxy: false }).verdict.label,
    btts: deriveUclPreviewGrade({ market: "btts", modelProbability: 0.65, edgePp: 8, priceAmerican: 100, coherentMarket: true, promotedProxy: false }).verdict.label,
    actionables: 0,
    policy: "forecast-only; calibration-period exact-price evidence is unavailable, so no promotion rule is validated",
  } as const;
  return {
    releaseBoundary: { trainSeason: 2024, calibrationSeason: 2025, cutoff: provisionalCutoff, holdoutUntouched: true },
    rowCounts: { train: train.length, calibration: calibration.length, holdout: holdout.length },
    calibration: scoreBlock(calibration, finalRows, stats),
    holdout: scoreBlock(holdout, finalRows, stats),
    gradeReplay,
  };
}

export function partitionUclChronologicalMatches(matches: BdlUclMatch[]) {
  assertFrozenUclChronologicalManifest(matches);
  const finalRows = regulationFinalUclRows(matches);
  const train = finalRows.filter((match) => match.season === UCL_CHRONOLOGICAL_MANIFEST.trainSeason);
  const confirmation = finalRows.filter((match) => match.season === UCL_CHRONOLOGICAL_MANIFEST.confirmationSeason);
  const calibration = confirmation.filter((match) => match.date < UCL_CHRONOLOGICAL_MANIFEST.cutoff);
  const holdout = confirmation.filter((match) => match.date >= UCL_CHRONOLOGICAL_MANIFEST.cutoff);
  return { finalRows, train, calibration, holdout, cutoff: UCL_CHRONOLOGICAL_MANIFEST.cutoff };
}
