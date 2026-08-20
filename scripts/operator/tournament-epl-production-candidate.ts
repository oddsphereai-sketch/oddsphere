import { BallDontLieEplProvider, type BdlEplOdds } from "../../lib/providers/real_api/BallDontLieEplProvider";
import {
  fitEplShadowModel,
  joinEplMatchStats,
  predictEplMatch,
  type EplModelConfig,
  type EplTrainingMatch,
} from "../../lib/services/epl/eplShadowModel";

type ProbabilityVector = [number, number, number];
type Evaluated = {
  index: number;
  outcome: number;
  probabilities: ProbabilityVector;
  over25: number;
  bttsYes: number;
  totalOutcome: boolean;
  bttsOutcome: boolean;
  scoreError: number;
  lambdaHome: number;
  lambdaAway: number;
  actualHome: number;
  actualAway: number;
  confidenceLimited: boolean;
  opener: { prices: [number, number, number]; market: ProbabilityVector } | null;
};

const safeLog = (value: number) => Math.log(Math.max(1e-12, Math.min(1 - 1e-12, value)));
const decimal = (american: number) => american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american);
const BOOKS = ["pinnacle", "fanduel", "draftkings", "betmgm", "caesars", "bet365"];

function opener(rows: BdlEplOdds[]): Evaluated["opener"] {
  const row = [...rows]
    .filter((item) => item.moneyline_home_odds && item.moneyline_draw_odds && item.moneyline_away_odds && item.vendor !== "polymarket")
    .sort((a, b) => {
      const ai = BOOKS.indexOf(a.vendor.toLowerCase());
      const bi = BOOKS.indexOf(b.vendor.toLowerCase());
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    })[0];
  if (!row) return null;
  const prices: [number, number, number] = [row.moneyline_home_odds!, row.moneyline_draw_odds!, row.moneyline_away_odds!];
  const raw = prices.map((price) => 1 / decimal(price)) as ProbabilityVector;
  const total = raw.reduce((sum, value) => sum + value, 0);
  return { prices, market: raw.map((value) => value / total) as ProbabilityVector };
}

function evaluateSeason(input: {
  history: EplTrainingMatch[];
  season: EplTrainingMatch[];
  config: EplModelConfig;
  oddsByMatch: Map<number, BdlEplOdds[]>;
}): Evaluated[] {
  const ordered = [...input.season].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  return ordered.map((match, index) => {
    const fit = fitEplShadowModel([...input.history, ...ordered.slice(0, index)], match.date, input.config);
    const prediction = predictEplMatch(fit, match.home_team_id, match.away_team_id);
    const outcome = match.home_score! > match.away_score! ? 0 : match.home_score! === match.away_score! ? 1 : 2;
    return {
      index,
      outcome,
      probabilities: [prediction.probabilities.home, prediction.probabilities.draw, prediction.probabilities.away],
      over25: prediction.rawDerivedProbabilities.over25,
      bttsYes: prediction.rawDerivedProbabilities.bttsYes,
      totalOutcome: match.home_score! + match.away_score! > 2.5,
      bttsOutcome: match.home_score! > 0 && match.away_score! > 0,
      scoreError: (Math.abs(prediction.lambdaHome - match.home_score!) + Math.abs(prediction.lambdaAway - match.away_score!)) / 2,
      lambdaHome: prediction.lambdaHome,
      lambdaAway: prediction.lambdaAway,
      actualHome: match.home_score!,
      actualAway: match.away_score!,
      confidenceLimited: prediction.confidence === "limited",
      opener: opener(input.oddsByMatch.get(match.id) ?? []),
    };
  });
}

function projectionSpread(rows: Evaluated[]) {
  const projected = rows.flatMap((row) => [row.lambdaHome, row.lambdaAway]);
  const actual = rows.flatMap((row) => [row.actualHome, row.actualAway]);
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const projectedMean = mean(projected);
  const actualMean = mean(actual);
  const projectedSd = Math.sqrt(mean(projected.map((value) => (value - projectedMean) ** 2)));
  const actualSd = Math.sqrt(mean(actual.map((value) => (value - actualMean) ** 2)));
  const covariance = mean(projected.map((value, index) => (value - projectedMean) * (actual[index]! - actualMean)));
  const actualProjectionCorrelation = projectedSd > 0 && actualSd > 0 ? covariance / (projectedSd * actualSd) : null;
  const sorted = [...projected].sort((a, b) => a - b);
  const quantile = (q: number) => sorted[Math.round((sorted.length - 1) * q)] ?? null;
  return {
    projectedMean,
    actualMean,
    projectedSd,
    actualSd,
    actualProjectionCorrelation,
    projectedRange: { min: sorted[0] ?? null, p10: quantile(0.1), median: quantile(0.5), p90: quantile(0.9), max: sorted.at(-1) ?? null },
  };
}

function metrics(rows: Evaluated[]) {
  let correct = 0;
  let brier = 0;
  let logLoss = 0;
  let scoreMae = 0;
  for (const row of rows) {
    const selected = row.probabilities.indexOf(Math.max(...row.probabilities));
    if (selected === row.outcome) correct++;
    brier += row.probabilities.reduce((sum, probability, side) => sum + (probability - Number(side === row.outcome)) ** 2, 0);
    logLoss -= safeLog(row.probabilities[row.outcome]);
    scoreMae += row.scoreError;
  }
  return { matches: rows.length, accuracy: correct / rows.length, brier: brier / rows.length, logLoss: logLoss / rows.length, scoreMae: scoreMae / rows.length };
}

function binary(rows: Evaluated[], probability: (row: Evaluated) => number, outcome: (row: Evaluated) => boolean) {
  return {
    brier: rows.reduce((sum, row) => sum + (probability(row) - Number(outcome(row))) ** 2, 0) / rows.length,
    logLoss: rows.reduce((sum, row) => sum - safeLog(outcome(row) ? probability(row) : 1 - probability(row)), 0) / rows.length,
  };
}

function calibratedBinaryTrial(
  calibrationRows: Evaluated[],
  holdoutRows: Evaluated[],
  baseRate: number,
  probability: (row: Evaluated) => number,
  outcome: (row: Evaluated) => boolean,
) {
  const candidates = Array.from({ length: 21 }, (_, index) => index / 20).map((modelWeight) => {
    const blended = (row: Evaluated) => modelWeight * probability(row) + (1 - modelWeight) * baseRate;
    return { modelWeight, calibration: binary(calibrationRows, blended, outcome) };
  });
  const selected = [...candidates].sort((a, b) => a.calibration.logLoss - b.calibration.logLoss || a.calibration.brier - b.calibration.brier)[0];
  const blended = (row: Evaluated) => selected.modelWeight * probability(row) + (1 - selected.modelWeight) * baseRate;
  const sideRead = (rows: Evaluated[], forecast: (row: Evaluated) => number) => ({
    yes: rows.filter((row) => forecast(row) >= 0.5).length,
    no: rows.filter((row) => forecast(row) < 0.5).length,
    accuracy: rows.length ? rows.filter((row) => (forecast(row) >= 0.5) === outcome(row)).length / rows.length : null,
  });
  const logit = (value: number) => Math.log(Math.max(1e-6, Math.min(1 - 1e-6, value)) / Math.max(1e-6, 1 - Math.min(1 - 1e-6, value)));
  const logistic = (value: number) => 1 / (1 + Math.exp(-value));
  const plattCandidates = Array.from({ length: 21 }, (_, index) => 0.5 + index * 0.05).flatMap((slope) =>
    Array.from({ length: 41 }, (_, index) => -1 + index * 0.05).map((intercept) => {
      const forecast = (row: Evaluated) => logistic(slope * logit(probability(row)) + intercept);
      return { slope, intercept, calibration: binary(calibrationRows, forecast, outcome) };
    }),
  );
  const selectedPlatt = [...plattCandidates].sort((a, b) => a.calibration.logLoss - b.calibration.logLoss || a.calibration.brier - b.calibration.brier)[0];
  const platt = (row: Evaluated) => logistic(selectedPlatt.slope * logit(probability(row)) + selectedPlatt.intercept);
  const neutralCandidates = Array.from({ length: 21 }, (_, index) => index / 20).map((modelWeight) => {
    const forecast = (row: Evaluated) => modelWeight * probability(row) + (1 - modelWeight) * 0.5;
    return { modelWeight, calibration: binary(calibrationRows, forecast, outcome) };
  });
  const selectedNeutral = [...neutralCandidates].sort((a, b) => a.calibration.logLoss - b.calibration.logLoss || a.calibration.brier - b.calibration.brier)[0];
  const neutral = (row: Evaluated) => selectedNeutral.modelWeight * probability(row) + (1 - selectedNeutral.modelWeight) * 0.5;
  return {
    baseRate,
    raw: { calibration: binary(calibrationRows, probability, outcome), finalHoldout: binary(holdoutRows, probability, outcome), finalSides: sideRead(holdoutRows, probability) },
    selectedModelWeight: selected.modelWeight,
    calibration: selected.calibration,
    finalHoldout: binary(holdoutRows, blended, outcome),
    baselineFinalHoldout: binary(holdoutRows, () => baseRate, outcome),
    finalSides: sideRead(holdoutRows, blended),
    platt: {
      slope: selectedPlatt.slope,
      intercept: selectedPlatt.intercept,
      calibration: selectedPlatt.calibration,
      finalHoldout: binary(holdoutRows, platt, outcome),
      finalSides: sideRead(holdoutRows, platt),
    },
    neutralShrink: {
      modelWeight: selectedNeutral.modelWeight,
      calibration: selectedNeutral.calibration,
      finalHoldout: binary(holdoutRows, neutral, outcome),
      finalSides: sideRead(holdoutRows, neutral),
    },
  };
}

function forecastCohort(rows: Evaluated[], probabilityFloor: number, requireMarketFavorite: boolean) {
  const selected = rows.flatMap((row) => {
    const side = row.probabilities.indexOf(Math.max(...row.probabilities));
    const probability = row.probabilities[side];
    if (probability < probabilityFloor || row.confidenceLimited || !row.opener) return [];
    const marketSide = row.opener.market.indexOf(Math.max(...row.opener.market));
    if (requireMarketFavorite && marketSide !== side) return [];
    const price = row.opener.prices[side];
    if (price <= -300) return [];
    const won = side === row.outcome;
    return [{ won, units: won ? decimal(price) - 1 : -1, probability, price }];
  });
  const units = selected.reduce((sum, row) => sum + row.units, 0);
  return {
    plays: selected.length,
    wins: selected.filter((row) => row.won).length,
    accuracy: selected.length ? selected.filter((row) => row.won).length / selected.length : null,
    meanProbability: selected.length ? selected.reduce((sum, row) => sum + row.probability, 0) / selected.length : null,
    units,
    roi: selected.length ? units / selected.length : null,
    heavyChalk: selected.filter((row) => row.price <= -300).length,
  };
}

function heavyFavoriteCohort(rows: Evaluated[], probabilityFloor: number, includeLimited: boolean) {
  const selected = rows.flatMap((row) => {
    const side = row.probabilities.indexOf(Math.max(...row.probabilities));
    const probability = row.probabilities[side];
    if (probability < probabilityFloor || !includeLimited && row.confidenceLimited || !row.opener) return [];
    const marketSide = row.opener.market.indexOf(Math.max(...row.opener.market));
    const price = row.opener.prices[side];
    if (marketSide !== side || price > -300) return [];
    return [{ won: side === row.outcome, probability, price, limited: row.confidenceLimited }];
  });
  const wins = selected.filter((row) => row.won).length;
  return {
    plays: selected.length,
    wins,
    accuracy: selected.length ? wins / selected.length : null,
    meanProbability: selected.length ? selected.reduce((sum, row) => sum + row.probability, 0) / selected.length : null,
    meanPrice: selected.length ? selected.reduce((sum, row) => sum + row.price, 0) / selected.length : null,
    limited: selected.filter((row) => row.limited).length,
  };
}

function valueCohort(rows: Evaluated[], edgeFloor: number) {
  const selected = rows.flatMap((row) => {
    if (!row.opener || row.confidenceLimited) return [];
    const edges = row.probabilities.map((probability, side) => probability - row.opener!.market[side]);
    const side = edges.indexOf(Math.max(...edges));
    const edge = edges[side] * 100;
    const price = row.opener.prices[side];
    if (edge < edgeFloor || price <= -300) return [];
    const won = side === row.outcome;
    return [{ won, units: won ? decimal(price) - 1 : -1 }];
  });
  const units = selected.reduce((sum, row) => sum + row.units, 0);
  return { plays: selected.length, wins: selected.filter((row) => row.won).length, units, roi: selected.length ? units / selected.length : null };
}

function forecastReliability(rows: Evaluated[]) {
  const bands = [
    { key: "under_40", min: 0, max: 0.4 },
    { key: "40_50", min: 0.4, max: 0.5 },
    { key: "50_60", min: 0.5, max: 0.6 },
    { key: "60_plus", min: 0.6, max: 1.01 },
  ];
  return Object.fromEntries(bands.map((band) => {
    const cohort = rows.filter((row) => {
      const probability = Math.max(...row.probabilities);
      return probability >= band.min && probability < band.max;
    });
    const wins = cohort.filter((row) => row.probabilities.indexOf(Math.max(...row.probabilities)) === row.outcome).length;
    return [band.key, { matches: cohort.length, wins, actualRate: cohort.length ? wins / cohort.length : null, meanProbability: cohort.length ? cohort.reduce((sum, row) => sum + Math.max(...row.probabilities), 0) / cohort.length : null }];
  }));
}

async function main() {
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) throw new Error("BALLDONTLIE_API_KEY is required");
  const provider = new BallDontLieEplProvider(apiKey);
  const seasons = [2022, 2023, 2024, 2025] as const;
  const matchLists = await Promise.all(seasons.map((season) => provider.listMatches({ season })));
  const finals = matchLists.map((matches) => matches.filter((match) => match.status_state === "final"));
  const allMatches = finals.flat();
  const stats = await provider.listTeamMatchStats(allMatches.map((match) => match.id));
  const joined = joinEplMatchStats(allMatches, stats);
  const bySeason = new Map(seasons.map((season) => [season, joined.filter((match) => match.season === season)]));
  const [validationOdds, holdoutOdds] = await Promise.all([
    provider.listOdds({ matchIds: finals[2].map((match) => match.id), opening: true }),
    provider.listOdds({ matchIds: finals[3].map((match) => match.id), opening: true }),
  ]);
  const oddsMap = (rows: BdlEplOdds[]) => {
    const map = new Map<number, BdlEplOdds[]>();
    for (const row of rows) map.set(row.match_id, [...(map.get(row.match_id) ?? []), row]);
    return map;
  };
  const validationOddsByMatch = oddsMap(validationOdds);
  const holdoutOddsByMatch = oddsMap(holdoutOdds);
  const history = [...(bySeason.get(2022) ?? []), ...(bySeason.get(2023) ?? [])];
  const validation = bySeason.get(2024) ?? [];
  const holdout = bySeason.get(2025) ?? [];
  const configs: EplModelConfig[] = [];
  for (const halfLifeDays of [90, 120, 180, 240, 365]) {
    for (const shrinkageMatches of [4, 8, 12, 16]) {
      for (const xgWeight of [0, 0.35, 0.7, 1]) {
        for (const dixonColesTau of [-0.05, -0.1, -0.15]) configs.push({ halfLifeDays, shrinkageMatches, xgWeight, dixonColesTau });
      }
    }
  }
  const trials = configs.map((config, index) => {
    if (index % 20 === 0) console.error(`Evaluating config ${index + 1}/${configs.length}`);
    const rows = evaluateSeason({ history, season: validation, config, oddsByMatch: validationOddsByMatch });
    return { config, metrics: metrics(rows) };
  }).sort((a, b) => a.metrics.logLoss - b.metrics.logLoss || a.metrics.brier - b.metrics.brier);
  const champion = trials[0];
  const validationRows = evaluateSeason({ history, season: validation, config: champion.config, oddsByMatch: validationOddsByMatch });
  const xgTrials = [0, 0.35, 0.7, 1].map((xgWeight) => {
    const config = { ...champion.config, xgWeight };
    const rows = evaluateSeason({ history: [...history, ...validation], season: holdout, config, oddsByMatch: holdoutOddsByMatch });
    const split = Math.floor(rows.length * 0.75);
    return { config, rows, calibration: metrics(rows.slice(0, split)), finalHoldout: metrics(rows.slice(split)) };
  });
  const xgChampion = [...xgTrials].sort((a, b) => a.calibration.logLoss - b.calibration.logLoss || a.calibration.brier - b.calibration.brier)[0];
  const finalRows = xgChampion.rows;
  const gradeSplit = Math.floor(finalRows.length * 0.75);
  const gradeCalibrationRows = finalRows.slice(0, gradeSplit);
  const gradeHoldoutRows = finalRows.slice(gradeSplit);
  const priorSeasonOverRate = validationRows.filter((row) => row.totalOutcome).length / validationRows.length;
  const priorSeasonBttsRate = validationRows.filter((row) => row.bttsOutcome).length / validationRows.length;
  const forecastTrials = [0.4, 0.45, 0.5, 0.55, 0.6].flatMap((probabilityFloor) => [false, true].map((requireMarketFavorite) => ({
    probabilityFloor,
    requireMarketFavorite,
    calibration: forecastCohort(gradeCalibrationRows, probabilityFloor, requireMarketFavorite),
    finalHoldout: forecastCohort(gradeHoldoutRows, probabilityFloor, requireMarketFavorite),
  })));
  const valueTrials = [2, 3, 4, 5, 6, 8].map((edgeFloor) => ({ edgeFloor, calibration: valueCohort(gradeCalibrationRows, edgeFloor), finalHoldout: valueCohort(gradeHoldoutRows, edgeFloor) }));
  const heavyFavoriteTrials = [0.55, 0.6, 0.65, 0.7].flatMap((probabilityFloor) => [false, true].map((includeLimited) => ({ probabilityFloor, includeLimited, calibration: heavyFavoriteCohort(gradeCalibrationRows, probabilityFloor, includeLimited), finalHoldout: heavyFavoriteCohort(gradeHoldoutRows, probabilityFloor, includeLimited) })));
  console.log(JSON.stringify({
    evaluation: "2022_23_train__2024_25_validation__2025_26_untouched_holdout",
    sourceCoverage: Object.fromEntries(seasons.map((season) => {
      const rows = bySeason.get(season) ?? [];
      return [season, { matches: rows.length, bothTeamXg: rows.filter((row) => row.home_xg !== null && row.away_xg !== null).length }];
    })),
    configsTested: configs.length,
    champion,
    topTen: trials.slice(0, 10),
    validation: { metrics: metrics(validationRows), over25: binary(validationRows, (row) => row.over25, (row) => row.totalOutcome), bttsYes: binary(validationRows, (row) => row.bttsYes, (row) => row.bttsOutcome) },
    xgWeightSelection: { note: "2024-25 has no provider xG. The first three chronological quarters of 2025-26 select xG weight; the final quarter remains untouched.", selected: { config: xgChampion.config, calibration: xgChampion.calibration, finalHoldout: xgChampion.finalHoldout }, trials: xgTrials.map(({ config, calibration, finalHoldout }) => ({ config, calibration, finalHoldout })) },
    untouchedHoldout: { fullSeason: metrics(finalRows), finalQuarter: metrics(gradeHoldoutRows), projectionSpread: { fullSeason: projectionSpread(finalRows), finalQuarter: projectionSpread(gradeHoldoutRows) }, forecastReliability: forecastReliability(gradeHoldoutRows), over25: binary(gradeHoldoutRows, (row) => row.over25, (row) => row.totalOutcome), bttsYes: binary(gradeHoldoutRows, (row) => row.bttsYes, (row) => row.bttsOutcome) },
    derivedMarketCalibration: {
      over25: calibratedBinaryTrial(gradeCalibrationRows, gradeHoldoutRows, priorSeasonOverRate, (row) => row.over25, (row) => row.totalOutcome),
      bttsYes: calibratedBinaryTrial(gradeCalibrationRows, gradeHoldoutRows, priorSeasonBttsRate, (row) => row.bttsYes, (row) => row.bttsOutcome),
    },
    gradeCandidates: { forecastTrials, heavyFavoriteTrials, valueTrials },
    status: "selected_production_candidate_disabled_pending_founder_approval",
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
