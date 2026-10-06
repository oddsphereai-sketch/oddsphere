/**
 * SELECT/read-only UCL opening-market score arbitration tournament.
 *
 * The historical provider has authenticated opening 1X2 prices for only a
 * subset of the 2025 cohort. This audit therefore creates a second,
 * explicitly priced chronological split inside that cohort: the first two
 * thirds select a fixed arbitration rule and the final third remains an
 * untouched confirmation block. It never writes, publishes, grades, or locks.
 */

import { BallDontLieUclProvider, type BdlUclOdds } from "../../lib/providers/real_api/BallDontLieUclProvider";
import { bivariatePoissonScoreDistribution } from "../../lib/services/soccer/dixonColes";
import { buildUclCompetitionContexts, regulationScore } from "../../lib/services/ucl/uclCompetitionContext";
import { canonicalUclOpeningOdds } from "../../lib/services/ucl/uclOpeningOddsEvaluation";
import { fitAndPredictUcl, joinUclMatchStats, UCL_MODEL_CONFIG } from "../../lib/services/ucl/uclModel";
import { deriveUclOpeningMarketScoreArbitration } from "../../lib/services/ucl/uclOpeningMarketScoreArbitration";

type Side = "home" | "draw" | "away";
type ProbabilityVector = Record<Side, number>;
type Candidate = {
  id: string;
  weight: number;
  crossingOnly: boolean;
  minimumMarketLead: number;
};
type Evaluated = {
  matchId: number;
  date: string;
  actualHome: number;
  actualAway: number;
  books: number;
  evaluatedBook: string;
  alternativeBooks: number;
  independent: Forecast;
  market: ProbabilityVector;
  candidates: Record<string, Forecast>;
  runtime: Forecast;
};
type Forecast = {
  probabilities: ProbabilityVector;
  lambdaHome: number;
  lambdaAway: number;
  side: Side;
  marketUsed: boolean;
};

const SIDES = ["home", "draw", "away"] as const;
const CANDIDATES: Candidate[] = [
  { id: "continuous_w10", weight: 0.10, crossingOnly: false, minimumMarketLead: 0 },
  { id: "continuous_w20", weight: 0.20, crossingOnly: false, minimumMarketLead: 0 },
  { id: "continuous_w30", weight: 0.30, crossingOnly: false, minimumMarketLead: 0 },
  { id: "crossing_w20", weight: 0.20, crossingOnly: true, minimumMarketLead: 0 },
  { id: "crossing_w30", weight: 0.30, crossingOnly: true, minimumMarketLead: 0 },
  { id: "corroborated_crossing_w20", weight: 0.20, crossingOnly: true, minimumMarketLead: 0.05 },
  { id: "corroborated_crossing_w30", weight: 0.30, crossingOnly: true, minimumMarketLead: 0.05 },
];

function clampProbability(value: number): number {
  return Math.max(1e-9, Math.min(1 - 1e-9, value));
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function normalize(probabilities: ProbabilityVector): ProbabilityVector {
  const total = probabilities.home + probabilities.draw + probabilities.away;
  return {
    home: probabilities.home / total,
    draw: probabilities.draw / total,
    away: probabilities.away / total,
  };
}

function strongest(probabilities: ProbabilityVector): Side {
  return SIDES.reduce((best, side) => probabilities[side] > probabilities[best] ? side : best, "home");
}

function marketLead(probabilities: ProbabilityVector): number {
  const sorted = SIDES.map((side) => probabilities[side]).sort((left, right) => right - left);
  return sorted[0]! - sorted[1]!;
}

function scoreProbabilities(lambdaHome: number, lambdaAway: number): ProbabilityVector {
  const joint = bivariatePoissonScoreDistribution(lambdaHome, lambdaAway, UCL_MODEL_CONFIG.dixonColesTau);
  let home = 0;
  let draw = 0;
  let away = 0;
  for (let homeGoals = 0; homeGoals < joint.length; homeGoals += 1) {
    for (let awayGoals = 0; awayGoals < joint[homeGoals]!.length; awayGoals += 1) {
      const mass = joint[homeGoals]![awayGoals]!;
      if (homeGoals > awayGoals) home += mass;
      else if (homeGoals < awayGoals) away += mass;
      else draw += mass;
    }
  }
  return normalize({ home, draw, away });
}

function logPool(model: ProbabilityVector, market: ProbabilityVector, weight: number): ProbabilityVector {
  const pooled = Object.fromEntries(SIDES.map((side) => [
    side,
    Math.exp((1 - weight) * Math.log(clampProbability(model[side])) + weight * Math.log(clampProbability(market[side]))),
  ])) as ProbabilityVector;
  return normalize(pooled);
}

/**
 * Preserve the independent expected total while solving a coherent pair of
 * Poisson rates whose 1X2 vector is closest to the arbitrated target.
 */
function solveScore(total: number, target: ProbabilityVector): { lambdaHome: number; lambdaAway: number; probabilities: ProbabilityVector } {
  const lower = Math.max(-total + 0.4, -4);
  const upper = Math.min(total - 0.4, 4);
  let best: { lambdaHome: number; lambdaAway: number; probabilities: ProbabilityVector; error: number } | null = null;
  for (let margin = lower; margin <= upper + 1e-9; margin += 0.01) {
    const lambdaHome = (total + margin) / 2;
    const lambdaAway = (total - margin) / 2;
    const probabilities = scoreProbabilities(lambdaHome, lambdaAway);
    const error = SIDES.reduce((sum, side) => sum + (probabilities[side] - target[side]) ** 2, 0);
    if (best === null || error < best.error) best = { lambdaHome, lambdaAway, probabilities, error };
  }
  if (best === null) throw new Error("UCL score solver produced no candidate");
  return best;
}

function candidateForecast(independent: Forecast, market: ProbabilityVector, candidate: Candidate): Forecast {
  const crosses = strongest(independent.probabilities) !== strongest(market);
  const qualified = (!candidate.crossingOnly || crosses) && marketLead(market) >= candidate.minimumMarketLead;
  if (!qualified) return independent;
  const target = logPool(independent.probabilities, market, candidate.weight);
  const solved = solveScore(independent.lambdaHome + independent.lambdaAway, target);
  return {
    probabilities: solved.probabilities,
    lambdaHome: solved.lambdaHome,
    lambdaAway: solved.lambdaAway,
    side: strongest(solved.probabilities),
    marketUsed: true,
  };
}

function actualSide(row: Evaluated): Side {
  return row.actualHome > row.actualAway ? "home" : row.actualHome < row.actualAway ? "away" : "draw";
}

function metrics(rows: Evaluated[], forecast: (row: Evaluated) => Forecast) {
  let correct = 0;
  let brier = 0;
  let logLoss = 0;
  let teamScoreAbsoluteError = 0;
  let marketUsed = 0;
  let flips = 0;
  let corrections = 0;
  let regressions = 0;
  for (const row of rows) {
    const selected = forecast(row);
    const actual = actualSide(row);
    if (selected.side === actual) correct += 1;
    const target = { home: actual === "home" ? 1 : 0, draw: actual === "draw" ? 1 : 0, away: actual === "away" ? 1 : 0 };
    brier += SIDES.reduce((sum, side) => sum + (selected.probabilities[side] - target[side]) ** 2, 0) / 3;
    logLoss -= Math.log(clampProbability(selected.probabilities[actual]));
    teamScoreAbsoluteError += Math.abs(selected.lambdaHome - row.actualHome) + Math.abs(selected.lambdaAway - row.actualAway);
    if (selected.marketUsed) marketUsed += 1;
    if (selected.side !== row.independent.side) {
      flips += 1;
      if (selected.side === actual && row.independent.side !== actual) corrections += 1;
      if (selected.side !== actual && row.independent.side === actual) regressions += 1;
    }
  }
  const denominator = Math.max(1, rows.length);
  return {
    matches: rows.length,
    accuracy: correct / denominator,
    correct,
    brier: brier / denominator,
    logLoss: logLoss / denominator,
    teamScoreMae: teamScoreAbsoluteError / (2 * denominator),
    marketUsed,
    flips,
    corrections,
    regressions,
  };
}

async function oddsInBatches(provider: BallDontLieUclProvider, matchIds: number[]): Promise<BdlUclOdds[]> {
  const rows: BdlUclOdds[] = [];
  for (let index = 0; index < matchIds.length; index += 40) {
    rows.push(...await provider.listOdds({ matchIds: matchIds.slice(index, index + 40), opening: true }));
  }
  return rows;
}

async function main(): Promise<void> {
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) throw new Error("BALLDONTLIE_API_KEY is required");
  const provider = new BallDontLieUclProvider(apiKey);
  const history = await provider.listHistoricalMatches([2024, 2025]);
  const finalRows = history.matches.filter((match) => regulationScore(match).score !== null);
  const stats = await provider.listTeamMatchStats(finalRows.map((match) => match.id));
  const openingRows = await oddsInBatches(provider, finalRows.filter((match) => match.season === 2025).map((match) => match.id));
  const openings = canonicalUclOpeningOdds(openingRows);
  const rawOpeningsByMatch = new Map<number, BdlUclOdds[]>();
  for (const row of openingRows) rawOpeningsByMatch.set(row.match_id, [...(rawOpeningsByMatch.get(row.match_id) ?? []), row]);
  const training = joinUclMatchStats(finalRows, stats);
  const contexts = buildUclCompetitionContexts(finalRows);

  const evaluated = finalRows
    .filter((match) => match.season === 2025 && openings.has(match.id))
    .sort((left, right) => Date.parse(left.date) - Date.parse(right.date) || left.id - right.id)
    .flatMap((match): Evaluated[] => {
      const score = regulationScore(match).score;
      const context = contexts.get(match.id);
      const books = openings.get(match.id) ?? [];
      if (!score || !context || books.length < 2) return [];
      const prediction = fitAndPredictUcl({ training, match, history: finalRows, context });
      const independent: Forecast = {
        probabilities: { home: prediction.probabilities.home, draw: prediction.probabilities.draw, away: prediction.probabilities.away },
        lambdaHome: prediction.lambdaHome,
        lambdaAway: prediction.lambdaAway,
        side: strongest({ home: prediction.probabilities.home, draw: prediction.probabilities.draw, away: prediction.probabilities.away }),
        marketUsed: false,
      };
      // Production grades one exact sportsbook quote. That target may never
      // validate its own forecast, so the historical tournament fixes the
      // evaluated book from the independent side and excludes it before
      // constructing the market distribution.
      const evaluatedBook = [...books].sort((left, right) => (
        right.prices[independent.side] - left.prices[independent.side]
        || left.vendor.toLowerCase().localeCompare(right.vendor.toLowerCase())
        || left.id - right.id
      ))[0]!;
      const alternatives = books.filter((book) => book.vendor.toLowerCase() !== evaluatedBook.vendor.toLowerCase());
      if (alternatives.length < 2) return [];
      const market = normalize({
        home: median(alternatives.map((book) => book.noVig.home)),
        draw: median(alternatives.map((book) => book.noVig.draw)),
        away: median(alternatives.map((book) => book.noVig.away)),
      });
      const runtime = deriveUclOpeningMarketScoreArbitration({
        matchId: match.id,
        independentLambdaHome: independent.lambdaHome,
        independentLambdaAway: independent.lambdaAway,
        openingOdds: rawOpeningsByMatch.get(match.id) ?? [],
        evaluatedMatchResultCanonicalBook: evaluatedBook.vendor,
      });
      return [{
        matchId: match.id,
        date: match.date,
        actualHome: score.home,
        actualAway: score.away,
        books: books.length,
        evaluatedBook: evaluatedBook.vendor,
        alternativeBooks: alternatives.length,
        independent,
        market,
        candidates: Object.fromEntries(CANDIDATES.map((candidate) => [candidate.id, candidateForecast(independent, market, candidate)])),
        runtime: {
          probabilities: runtime.probabilities,
          lambdaHome: runtime.lambdaHome,
          lambdaAway: runtime.lambdaAway,
          side: runtime.finalSide,
          marketUsed: runtime.applied,
        },
      }];
    });

  if (evaluated.length < 30) throw new Error(`insufficient multi-book priced UCL matches: ${evaluated.length}`);
  const split = Math.floor(evaluated.length * 2 / 3);
  const selection = evaluated.slice(0, split);
  const confirmation = evaluated.slice(split);
  const incumbentSelection = metrics(selection, (row) => row.independent);
  const trials = CANDIDATES.map((candidate) => ({ candidate, metrics: metrics(selection, (row) => row.candidates[candidate.id]!) }));
  const eligible = trials.filter((trial) => (
    trial.metrics.accuracy >= incumbentSelection.accuracy
    && trial.metrics.brier <= incumbentSelection.brier
    && trial.metrics.logLoss <= incumbentSelection.logLoss
    && trial.metrics.teamScoreMae <= incumbentSelection.teamScoreMae
  ));
  const selected = [...eligible].sort((left, right) => (
    left.metrics.teamScoreMae - right.metrics.teamScoreMae
    || right.metrics.accuracy - left.metrics.accuracy
    || left.metrics.logLoss - right.metrics.logLoss
    || left.metrics.brier - right.metrics.brier
  ))[0] ?? null;
  const incumbentConfirmation = metrics(confirmation, (row) => row.independent);
  const trialConfirmation = CANDIDATES.map((candidate) => ({
    candidate,
    metrics: metrics(confirmation, (row) => row.candidates[candidate.id]!),
  }));
  const candidateConfirmation = selected === null ? null : metrics(confirmation, (row) => row.candidates[selected.candidate.id]!);
  const runtimeParity = selected?.candidate.id === "corroborated_crossing_w30" && evaluated.every((row) => {
    const expected = row.candidates.corroborated_crossing_w30!;
    return expected.side === row.runtime.side
      && expected.marketUsed === row.runtime.marketUsed
      && Math.abs(expected.lambdaHome - row.runtime.lambdaHome) < 1e-12
      && Math.abs(expected.lambdaAway - row.runtime.lambdaAway) < 1e-12
      && SIDES.every((side) => Math.abs(expected.probabilities[side] - row.runtime.probabilities[side]) < 1e-12);
  });
  const accepted = selected !== null && candidateConfirmation !== null
    && candidateConfirmation.accuracy >= incumbentConfirmation.accuracy
    && candidateConfirmation.brier < incumbentConfirmation.brier
    && candidateConfirmation.logLoss < incumbentConfirmation.logLoss
    && candidateConfirmation.teamScoreMae <= incumbentConfirmation.teamScoreMae
    && candidateConfirmation.corrections >= candidateConfirmation.regressions
    && runtimeParity;

  console.log(JSON.stringify({
    mode: "read_only_zero_write",
    release: "ucl_opening_market_score_arbitration_audit_2026_10_06_r1",
    contract: "target_excluded_multi_book_opening_1x2_chronological_selection_then_untouched_confirmation",
    providerHistory: history.telemetry,
    pricedMatches: evaluated.length,
    split: { selection: selection.length, confirmation: confirmation.length, cutoff: confirmation[0]?.date ?? null },
    incumbent: { selection: incumbentSelection, confirmation: incumbentConfirmation },
    trials,
    trialConfirmation,
    selected: selected?.candidate ?? null,
    selectedMetrics: selected === null ? null : { selection: selected.metrics, confirmation: candidateConfirmation },
    runtimeParity,
    accepted,
    productionImpact: { writes: 0, predictions: 0, grades: 0, boardCount: 0 },
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
