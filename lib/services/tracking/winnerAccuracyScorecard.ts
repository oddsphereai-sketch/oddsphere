export const WINNER_ACCURACY_SCORECARD_CONTRACT =
  "winner_accuracy_scorecard_v1_release_pure_locked_window_2026_09_02" as const;

export type WinnerScorecardSport = "mlb" | "nfl" | "cfb" | "wnba" | "epl" | "ucl";
export type WinnerOutcome = "home" | "away" | "draw";

export type WinnerAccuracyObservation = {
  recordId: number;
  sport: WinnerScorecardSport;
  gameKey: string;
  releaseKey: string;
  lockedAt: string;
  settledAt: string;
  modelPick: WinnerOutcome;
  actualOutcome: WinnerOutcome;
  modelProbabilities: Partial<Record<WinnerOutcome, number>>;
  marketProbabilities: Partial<Record<WinnerOutcome, number>> | null;
  exactPriceAmerican: number | null;
  playGrade: string | null;
  noBet: boolean;
  closingPriceAmerican: number | null;
  clvPct: number | null;
};

export type CalibrationBucket = {
  lower: number;
  upper: number;
  sample: number;
  meanProbability: number;
  observedAccuracy: number;
  absoluteGap: number;
};

export type AccuracyMetrics = {
  sample: number;
  correct: number;
  accuracyPct: number | null;
};

export type ProbabilityMetrics = {
  sample: number;
  brierScore: number | null;
  logLoss: number | null;
  calibrationBuckets: CalibrationBucket[];
  expectedCalibrationError: number | null;
};

export type ReturnMetrics = {
  eligible: number;
  resolved: number;
  units: number;
  roiPct: number | null;
};

export type ClvMetrics = {
  eligible: number;
  covered: number;
  coveragePct: number | null;
  averageClvPct: number | null;
  beatClose: number;
  beatClosePct: number | null;
};

export type ReleaseWinnerScorecard = {
  sport: WinnerScorecardSport;
  releaseKey: string;
  lockedFrom: string;
  lockedTo: string;
  winnerAccuracy: AccuracyMetrics;
  marketFavoriteBenchmark: AccuracyMetrics;
  modelProbability: ProbabilityMetrics;
  marketProbability: ProbabilityMetrics;
  favoriteSelections: AccuracyMetrics;
  underdogSelections: AccuracyMetrics;
  upsetDetection: {
    actualUpsets: number;
    correctlyCalledUpsets: number;
    recallPct: number | null;
    underdogPicks: number;
    correctUnderdogPicks: number;
    precisionPct: number | null;
  };
  drawDetection: {
    actualDraws: number;
    drawPicks: number;
    correctDrawPicks: number;
    recallPct: number | null;
    precisionPct: number | null;
  } | null;
  modelMarketDisagreements: {
    sample: number;
    modelCorrect: number;
    marketFavoriteCorrect: number;
    neitherCorrect: number;
    modelAccuracyPct: number | null;
    marketFavoriteAccuracyPct: number | null;
  };
  exactPriceReturns: {
    allDirectionalCalls: ReturnMetrics;
    actionableOnly: ReturnMetrics;
  };
  clv: {
    allDirectionalCalls: ClvMetrics;
    actionableOnly: ClvMetrics;
  };
};

const CALIBRATION_CUTS = [0, 0.4, 0.5, 0.55, 0.6, 0.65, 0.7, 0.8, 1.000000001] as const;
const EPSILON = 1e-12;

function percentage(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : (numerator / denominator) * 100;
}

function accuracy(sample: number, correct: number): AccuracyMetrics {
  return { sample, correct, accuracyPct: percentage(correct, sample) };
}

function assertProbability(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be finite and in [0, 1].`);
  }
}

function outcomesFor(sport: WinnerScorecardSport): WinnerOutcome[] {
  return sport === "epl" || sport === "ucl" ? ["home", "draw", "away"] : ["home", "away"];
}

function normalizedVector(
  probabilities: Partial<Record<WinnerOutcome, number>>,
  outcomes: WinnerOutcome[],
  label: string,
): Record<WinnerOutcome, number> | null {
  const values = outcomes.map((outcome) => probabilities[outcome]);
  if (values.some((value) => typeof value !== "number")) return null;
  for (const [index, value] of values.entries()) assertProbability(value as number, `${label}.${outcomes[index]}`);
  const sum = values.reduce<number>((total, value) => total + (value as number), 0);
  if (Math.abs(sum - 1) > 1e-5) throw new Error(`${label} must sum to one.`);
  return Object.fromEntries(outcomes.map((outcome, index) => [outcome, values[index]])) as Record<WinnerOutcome, number>;
}

function plurality(vector: Record<WinnerOutcome, number>, outcomes: WinnerOutcome[]): WinnerOutcome | null {
  const ranked = outcomes.map((outcome) => ({ outcome, probability: vector[outcome] }))
    .sort((a, b) => b.probability - a.probability);
  if (ranked.length < 2 || Math.abs(ranked[0].probability - ranked[1].probability) <= 1e-12) return null;
  return ranked[0].outcome;
}

function probabilityMetrics(
  rows: Array<{ vector: Record<WinnerOutcome, number>; actual: WinnerOutcome; pick: WinnerOutcome }>,
  outcomes: WinnerOutcome[],
): ProbabilityMetrics {
  if (rows.length === 0) {
    return { sample: 0, brierScore: null, logLoss: null, calibrationBuckets: [], expectedCalibrationError: null };
  }
  let brier = 0;
  let logLoss = 0;
  const buckets = CALIBRATION_CUTS.slice(0, -1).map((lower, index) => ({
    lower,
    upper: CALIBRATION_CUTS[index + 1],
    probabilities: [] as number[],
    outcomes: [] as number[],
  }));
  for (const row of rows) {
    if (outcomes.length === 2) {
      const observed = row.actual === row.pick ? 1 : 0;
      const probability = row.vector[row.pick];
      brier += Math.pow(probability - observed, 2);
      logLoss += -(observed * Math.log(Math.max(EPSILON, probability))
        + (1 - observed) * Math.log(Math.max(EPSILON, 1 - probability)));
    } else {
      for (const outcome of outcomes) {
        const observed = row.actual === outcome ? 1 : 0;
        brier += Math.pow(row.vector[outcome] - observed, 2);
      }
      logLoss += -Math.log(Math.max(EPSILON, row.vector[row.actual]));
    }
    const displayedProbability = row.vector[row.pick];
    const bucket = buckets.find((candidate) =>
      displayedProbability >= candidate.lower && displayedProbability < candidate.upper,
    );
    if (bucket !== undefined) {
      bucket.probabilities.push(displayedProbability);
      bucket.outcomes.push(row.pick === row.actual ? 1 : 0);
    }
  }
  const calibrationBuckets = buckets.filter((bucket) => bucket.probabilities.length > 0).map((bucket) => {
    const sample = bucket.probabilities.length;
    const meanProbability = bucket.probabilities.reduce((sum, value) => sum + value, 0) / sample;
    const observedAccuracy = bucket.outcomes.reduce((sum, value) => sum + value, 0) / sample;
    return {
      lower: bucket.lower,
      upper: Math.min(1, bucket.upper),
      sample,
      meanProbability,
      observedAccuracy,
      absoluteGap: Math.abs(meanProbability - observedAccuracy),
    };
  });
  const expectedCalibrationError = calibrationBuckets.reduce(
    (total, bucket) => total + bucket.absoluteGap * (bucket.sample / rows.length),
    0,
  );
  return {
    sample: rows.length,
    brierScore: brier / rows.length,
    logLoss: logLoss / rows.length,
    calibrationBuckets,
    expectedCalibrationError,
  };
}

function isActionable(row: WinnerAccuracyObservation): boolean {
  const grade = String(row.playGrade ?? "").trim().toLowerCase();
  return row.noBet !== true && (grade === "best_angle" || grade === "lean");
}

function profitForOneUnit(price: number, won: boolean): number {
  if (!Number.isFinite(price) || price === 0) throw new Error("Exact American price must be finite and non-zero.");
  if (!won) return -1;
  return price > 0 ? price / 100 : 100 / Math.abs(price);
}

function returnMetrics(rows: WinnerAccuracyObservation[]): ReturnMetrics {
  const priced = rows.filter((row) => row.exactPriceAmerican !== null);
  const units = priced.reduce(
    (total, row) => total + profitForOneUnit(row.exactPriceAmerican as number, row.modelPick === row.actualOutcome),
    0,
  );
  return {
    eligible: rows.length,
    resolved: priced.length,
    units,
    roiPct: percentage(units, priced.length),
  };
}

function clvMetrics(rows: WinnerAccuracyObservation[]): ClvMetrics {
  const values = rows.filter((row) => row.clvPct !== null).map((row) => row.clvPct as number);
  const beatClose = values.filter((value) => value > 0).length;
  return {
    eligible: rows.length,
    covered: values.length,
    coveragePct: percentage(values.length, rows.length),
    averageClvPct: values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length,
    beatClose,
    beatClosePct: percentage(beatClose, values.length),
  };
}

function exactIdentity(row: WinnerAccuracyObservation): string {
  return [row.sport, row.gameKey, row.releaseKey, row.lockedAt].join("::");
}

export function buildWinnerAccuracyScorecards(
  observations: WinnerAccuracyObservation[],
): ReleaseWinnerScorecard[] {
  const seen = new Set<string>();
  for (const row of observations) {
    if (!row.releaseKey.trim()) throw new Error("Every observation requires a release key.");
    if (!Number.isFinite(Date.parse(row.lockedAt))) throw new Error("Every observation requires a valid lockedAt.");
    if (!Number.isFinite(Date.parse(row.settledAt))) throw new Error("Every observation requires a valid settledAt.");
    const identity = exactIdentity(row);
    if (seen.has(identity)) throw new Error(`Duplicate locked release identity: ${identity}`);
    seen.add(identity);
  }

  const groups = new Map<string, WinnerAccuracyObservation[]>();
  for (const row of observations) {
    const key = `${row.sport}::${row.releaseKey}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  return [...groups.values()].map((rows): ReleaseWinnerScorecard => {
    const sport = rows[0].sport;
    const outcomes = outcomesFor(sport);
    const modelRows: Array<{ vector: Record<WinnerOutcome, number>; actual: WinnerOutcome; pick: WinnerOutcome }> = [];
    const marketRows: Array<{ vector: Record<WinnerOutcome, number>; actual: WinnerOutcome; pick: WinnerOutcome }> = [];
    let winnerCorrect = 0;
    let favoriteSample = 0;
    let favoriteCorrect = 0;
    let modelFavoriteSelections = 0;
    let correctModelFavoriteSelections = 0;
    let modelUnderdogSelections = 0;
    let correctModelUnderdogSelections = 0;
    let actualUpsets = 0;
    let correctlyCalledUpsets = 0;
    let actualDraws = 0;
    let drawPicks = 0;
    let correctDrawPicks = 0;
    let disagreements = 0;
    let disagreementModelCorrect = 0;
    let disagreementMarketCorrect = 0;
    let disagreementNeitherCorrect = 0;

    for (const row of rows) {
      if (!outcomes.includes(row.modelPick) || !outcomes.includes(row.actualOutcome)) {
        throw new Error(`${sport} received an invalid winner outcome.`);
      }
      const model = normalizedVector(row.modelProbabilities, outcomes, "modelProbabilities");
      if (model !== null) modelRows.push({ vector: model, actual: row.actualOutcome, pick: row.modelPick });
      const market = row.marketProbabilities === null
        ? null
        : normalizedVector(row.marketProbabilities, outcomes, "marketProbabilities");
      if (market !== null) {
        const marketFavorite = plurality(market, outcomes);
        marketRows.push({ vector: market, actual: row.actualOutcome, pick: marketFavorite ?? row.modelPick });
        if (marketFavorite !== null) {
          favoriteSample++;
          if (marketFavorite === row.actualOutcome) favoriteCorrect++;
          if (row.modelPick === marketFavorite) {
            modelFavoriteSelections++;
            if (row.modelPick === row.actualOutcome) correctModelFavoriteSelections++;
          } else {
            modelUnderdogSelections++;
            if (row.modelPick === row.actualOutcome) correctModelUnderdogSelections++;
            disagreements++;
            const modelWon = row.modelPick === row.actualOutcome;
            const marketWon = marketFavorite === row.actualOutcome;
            if (modelWon) disagreementModelCorrect++;
            if (marketWon) disagreementMarketCorrect++;
            if (!modelWon && !marketWon) disagreementNeitherCorrect++;
          }
          if (marketFavorite !== row.actualOutcome) {
            actualUpsets++;
            if (row.modelPick === row.actualOutcome) correctlyCalledUpsets++;
          }
        }
      }
      if (row.modelPick === row.actualOutcome) winnerCorrect++;
      if (sport === "epl") {
        if (row.actualOutcome === "draw") actualDraws++;
        if (row.modelPick === "draw") {
          drawPicks++;
          if (row.actualOutcome === "draw") correctDrawPicks++;
        }
      }
    }

    const sortedLocks = rows.map((row) => row.lockedAt).sort();
    const actionable = rows.filter(isActionable);
    return {
      sport,
      releaseKey: rows[0].releaseKey,
      lockedFrom: sortedLocks[0],
      lockedTo: sortedLocks[sortedLocks.length - 1],
      winnerAccuracy: accuracy(rows.length, winnerCorrect),
      marketFavoriteBenchmark: accuracy(favoriteSample, favoriteCorrect),
      modelProbability: probabilityMetrics(modelRows, outcomes),
      marketProbability: probabilityMetrics(marketRows, outcomes),
      favoriteSelections: accuracy(modelFavoriteSelections, correctModelFavoriteSelections),
      underdogSelections: accuracy(modelUnderdogSelections, correctModelUnderdogSelections),
      upsetDetection: {
        actualUpsets,
        correctlyCalledUpsets,
        recallPct: percentage(correctlyCalledUpsets, actualUpsets),
        underdogPicks: modelUnderdogSelections,
        correctUnderdogPicks: correctModelUnderdogSelections,
        precisionPct: percentage(correctModelUnderdogSelections, modelUnderdogSelections),
      },
      drawDetection: sport === "epl" ? {
        actualDraws,
        drawPicks,
        correctDrawPicks,
        recallPct: percentage(correctDrawPicks, actualDraws),
        precisionPct: percentage(correctDrawPicks, drawPicks),
      } : null,
      modelMarketDisagreements: {
        sample: disagreements,
        modelCorrect: disagreementModelCorrect,
        marketFavoriteCorrect: disagreementMarketCorrect,
        neitherCorrect: disagreementNeitherCorrect,
        modelAccuracyPct: percentage(disagreementModelCorrect, disagreements),
        marketFavoriteAccuracyPct: percentage(disagreementMarketCorrect, disagreements),
      },
      exactPriceReturns: {
        allDirectionalCalls: returnMetrics(rows),
        actionableOnly: returnMetrics(actionable),
      },
      clv: {
        allDirectionalCalls: clvMetrics(rows),
        actionableOnly: clvMetrics(actionable),
      },
    };
  }).sort((a, b) => a.sport.localeCompare(b.sport) || a.lockedFrom.localeCompare(b.lockedFrom));
}
