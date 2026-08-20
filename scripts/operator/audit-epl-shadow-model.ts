import { BallDontLieEplProvider } from "../../lib/providers/real_api/BallDontLieEplProvider";
import { fitEplShadowModel, joinEplMatchStats, predictEplMatch } from "../../lib/services/epl/eplShadowModel";
import { deriveEplPreviewGrade } from "../../lib/services/epl/eplPreviewGrade";

const PRICE_BOOKS = ["pinnacle", "fanduel", "draftkings", "betmgm", "caesars", "bet365"];
function decimal(american: number): number { return american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american); }
function coherentOpening(rows: Awaited<ReturnType<BallDontLieEplProvider["listOdds"]>>) {
  return [...rows].filter((row) => row.moneyline_home_odds && row.moneyline_draw_odds && row.moneyline_away_odds && row.vendor !== "polymarket")
    .sort((a, b) => (PRICE_BOOKS.indexOf(a.vendor.toLowerCase()) < 0 ? 99 : PRICE_BOOKS.indexOf(a.vendor.toLowerCase())) - (PRICE_BOOKS.indexOf(b.vendor.toLowerCase()) < 0 ? 99 : PRICE_BOOKS.indexOf(b.vendor.toLowerCase())))[0] ?? null;
}

const safeLog = (value: number) => Math.log(Math.max(1e-12, Math.min(1 - 1e-12, value)));

type ProbabilityVector = [number, number, number];
type ProbabilityRead = { index: number; probabilities: ProbabilityVector; outcome: number };
type MarketComparisonRead = ProbabilityRead & { market: ProbabilityVector };

function normalize(values: ProbabilityVector): ProbabilityVector {
  const total = values[0] + values[1] + values[2];
  return values.map((value) => value / total) as ProbabilityVector;
}

function temperatureScale(probabilities: ProbabilityVector, temperature: number): ProbabilityVector {
  return normalize(probabilities.map((probability) => Math.exp(safeLog(probability) / temperature)) as ProbabilityVector);
}

function blendProbabilities(model: ProbabilityVector, market: ProbabilityVector, marketWeight: number): ProbabilityVector {
  return normalize(model.map((probability, index) => (1 - marketWeight) * probability + marketWeight * market[index]) as ProbabilityVector);
}

function multiclassMetrics(rows: ProbabilityRead[]) {
  if (rows.length === 0) return { matches: 0, accuracy: null, brier: null, logLoss: null };
  let correct = 0;
  let brier = 0;
  let logLoss = 0;
  for (const row of rows) {
    const forecast = row.probabilities.indexOf(Math.max(...row.probabilities));
    if (forecast === row.outcome) correct++;
    brier += row.probabilities.reduce((sum, probability, side) => sum + (probability - Number(side === row.outcome)) ** 2, 0);
    logLoss -= safeLog(row.probabilities[row.outcome]);
  }
  return { matches: rows.length, accuracy: correct / rows.length, brier: brier / rows.length, logLoss: logLoss / rows.length };
}

async function main() {
  const key = process.env.BALLDONTLIE_API_KEY;
  if (!key) throw new Error("BALLDONTLIE_API_KEY is required");
  const provider = new BallDontLieEplProvider(key);
  const [development, holdout] = await Promise.all([provider.listMatches({ season: 2024 }), provider.listMatches({ season: 2025 })]);
  const allFinal = [...development, ...holdout].filter((match) => match.status_state === "final");
  const [stats, openingOdds] = await Promise.all([provider.listTeamMatchStats(allFinal.map((match) => match.id)), provider.listOdds({ matchIds: holdout.map((match) => match.id), opening: true })]);
  const openingByMatch = new Map<number, typeof openingOdds>();
  for (const row of openingOdds) openingByMatch.set(row.match_id, [...(openingByMatch.get(row.match_id) ?? []), row]);
  const joined = joinEplMatchStats(allFinal, stats);
  const developmentJoined = joined.filter((match) => match.season === 2024);
  const holdoutJoined = joined.filter((match) => match.season === 2025).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const developmentOutcomes = developmentJoined.map((match) => match.home_score! > match.away_score! ? 0 : match.home_score! === match.away_score! ? 1 : 2);
  const leaguePrior = [0, 1, 2].map((outcome) => developmentOutcomes.filter((value) => value === outcome).length / developmentOutcomes.length);
  let correct = 0, brier = 0, logLoss = 0, scoreMae = 0, limited = 0;
  let uniformBrier = 0, uniformLogLoss = 0, leaguePriorBrier = 0, leaguePriorLogLoss = 0;
  const pricedReads: Array<{ index: number; edge: number; won: boolean; units: number; price: number; grade: string }> = [];
  const forecastReads: Array<{ index: number; probability: number; won: boolean }> = [];
  const totalReads: Array<{ index: number; probability: number; outcome: boolean }> = [];
  const bttsReads: Array<{ index: number; probability: number; outcome: boolean }> = [];
  const classCalibrationReads: Array<{ side: "home" | "draw" | "away"; probability: number; outcome: boolean }> = [];
  const matchMetricReads: Array<{ index: number; correct: boolean; brier: number; logLoss: number }> = [];
  const probabilityReads: ProbabilityRead[] = [];
  const marketComparisonReads: MarketComparisonRead[] = [];
  for (let index = 0; index < holdoutJoined.length; index++) {
    const match = holdoutJoined[index];
    const fit = fitEplShadowModel([...developmentJoined, ...holdoutJoined.slice(0, index)], match.date);
    const prediction = predictEplMatch(fit, match.home_team_id, match.away_team_id);
    if (prediction.confidence === "limited") limited++;
    const outcome = match.home_score! > match.away_score! ? 0 : match.home_score! === match.away_score! ? 1 : 2;
    const probabilities: ProbabilityVector = [prediction.probabilities.home, prediction.probabilities.draw, prediction.probabilities.away];
    probabilityReads.push({ index, probabilities, outcome });
    const forecastSide = probabilities.indexOf(Math.max(...probabilities));
    if (forecastSide === outcome) correct++;
    forecastReads.push({ index, probability: probabilities[forecastSide], won: forecastSide === outcome });
    totalReads.push({ index, probability: prediction.probabilities.over25, outcome: match.home_score! + match.away_score! > 2.5 });
    bttsReads.push({ index, probability: prediction.probabilities.bttsYes, outcome: match.home_score! > 0 && match.away_score! > 0 });
    (["home", "draw", "away"] as const).forEach((side, sideIndex) => classCalibrationReads.push({ side, probability: probabilities[sideIndex], outcome: outcome === sideIndex }));
    const matchBrier = probabilities.reduce((sum, probability, sideIndex) => sum + (probability - Number(outcome === sideIndex)) ** 2, 0);
    matchMetricReads.push({ index, correct: forecastSide === outcome, brier: matchBrier, logLoss: -safeLog(probabilities[outcome]) });
    for (let classIndex = 0; classIndex < 3; classIndex++) brier += (probabilities[classIndex] - Number(outcome === classIndex)) ** 2;
    logLoss -= safeLog(probabilities[outcome]);
    for (let classIndex = 0; classIndex < 3; classIndex++) {
      uniformBrier += (1 / 3 - Number(outcome === classIndex)) ** 2;
      leaguePriorBrier += (leaguePrior[classIndex] - Number(outcome === classIndex)) ** 2;
    }
    uniformLogLoss -= safeLog(1 / 3);
    leaguePriorLogLoss -= safeLog(leaguePrior[outcome]);
    scoreMae += (Math.abs(prediction.lambdaHome - match.home_score!) + Math.abs(prediction.lambdaAway - match.away_score!)) / 2;
    const opener = coherentOpening(openingByMatch.get(match.id) ?? []);
    if (opener) {
      const prices = [opener.moneyline_home_odds!, opener.moneyline_draw_odds!, opener.moneyline_away_odds!];
      const raw = prices.map((price) => 1 / decimal(price));
      const total = raw.reduce((sum, value) => sum + value, 0);
      const market = raw.map((value) => value / total) as ProbabilityVector;
      marketComparisonReads.push({ index, probabilities, market, outcome });
      const side = forecastSide;
      const edge = (probabilities[side] - market[side]) * 100;
      const won = side === outcome;
      const grade = deriveEplPreviewGrade({ market: "match_result", edgePp: edge, priceAmerican: prices[side], coherentMarket: true, promotedProxy: prediction.confidence === "limited" });
      pricedReads.push({ index, edge, won, units: won ? decimal(prices[side]) - 1 : -1, price: prices[side], grade: grade.verdict.label });
    }
  }
  const n = holdoutJoined.length;
  const bothXg = joined.filter((match) => match.home_xg !== null && match.away_xg !== null).length;
  const modelLogLoss = n > 0 ? logLoss / n : null;
  const modelBrier = n > 0 ? brier / n : null;
  const uniformLogLossValue = n > 0 ? uniformLogLoss / n : null;
  const leaguePriorLogLossValue = n > 0 ? leaguePriorLogLoss / n : null;
  const cohort = (rows: typeof pricedReads, floor: number) => { const selected = rows.filter((row) => row.edge >= floor && row.price > -300); const units = selected.reduce((sum, row) => sum + row.units, 0); return { plays: selected.length, record: `${selected.filter((row) => row.won).length}-${selected.filter((row) => !row.won).length}`, units, roi: selected.length ? units / selected.length : null }; };
  const calibrationRows = pricedReads.filter((row) => row.index < Math.floor(n / 2));
  const finalRows = pricedReads.filter((row) => row.index >= Math.floor(n / 2));
  const thresholds = Object.fromEntries([2, 3, 4, 5, 6, 8].map((floor) => [floor, { calibration: cohort(calibrationRows, floor), finalHoldout: cohort(finalRows, floor) }]));
  const forecastBand = (rows: typeof forecastReads, minimum: number, maximum: number) => {
    const selected = rows.filter((row) => row.probability >= minimum && row.probability < maximum);
    return { matches: selected.length, meanForecast: selected.length ? selected.reduce((sum, row) => sum + row.probability, 0) / selected.length : null, actualWinRate: selected.length ? selected.filter((row) => row.won).length / selected.length : null };
  };
  const forecastBands = Object.fromEntries([[0.33, 0.4], [0.4, 0.5], [0.5, 0.6], [0.6, 1.01]].map(([minimum, maximum]) => [`${Math.round(minimum * 100)}-${maximum > 1 ? 100 : Math.round(maximum * 100)}`, { fullHoldout: forecastBand(forecastReads, minimum, maximum), finalHalf: forecastBand(forecastReads.filter((row) => row.index >= Math.floor(n / 2)), minimum, maximum) }]));
  const calibration = (rows: typeof classCalibrationReads) => {
    const bins = Array.from({ length: 10 }, (_, index) => {
      const selected = rows.filter((row) => Math.min(9, Math.floor(row.probability * 10)) === index);
      const meanForecast = selected.length ? selected.reduce((sum, row) => sum + row.probability, 0) / selected.length : null;
      const actualRate = selected.length ? selected.filter((row) => row.outcome).length / selected.length : null;
      return { bin: `${index * 10}-${(index + 1) * 10}`, observations: selected.length, meanForecast, actualRate, gap: meanForecast === null || actualRate === null ? null : meanForecast - actualRate };
    });
    const ece = rows.length ? bins.reduce((sum, bin) => sum + (bin.observations / rows.length) * Math.abs(bin.gap ?? 0), 0) : null;
    return { observations: rows.length, ece, bins: bins.filter((bin) => bin.observations > 0) };
  };
  const rollingFolds = Array.from({ length: 4 }, (_, fold) => {
    const start = Math.floor((fold * n) / 4);
    const end = Math.floor(((fold + 1) * n) / 4);
    const rows = matchMetricReads.filter((row) => row.index >= start && row.index < end);
    return { fold: fold + 1, matches: rows.length, accuracy: rows.filter((row) => row.correct).length / rows.length, brier: rows.reduce((sum, row) => sum + row.brier, 0) / rows.length, logLoss: rows.reduce((sum, row) => sum + row.logLoss, 0) / rows.length };
  });
  const gradeDistribution = (rows: typeof pricedReads) => Object.fromEntries(["Best Angle", "Lean", "Watchlist", "Caution", "No Play"].map((grade) => {
    const selected = rows.filter((row) => row.grade === grade);
    const units = selected.reduce((sum, row) => sum + row.units, 0);
    return [grade, { plays: selected.length, record: `${selected.filter((row) => row.won).length}-${selected.filter((row) => !row.won).length}`, units, roi: selected.length ? units / selected.length : null }];
  }));
  const binaryAudit = (rows: typeof totalReads) => ({ matches: rows.length, meanForecast: rows.reduce((sum, row) => sum + row.probability, 0) / rows.length, actualRate: rows.filter((row) => row.outcome).length / rows.length, brier: rows.reduce((sum, row) => sum + (row.probability - Number(row.outcome)) ** 2, 0) / rows.length, logLoss: rows.reduce((sum, row) => sum - safeLog(row.outcome ? row.probability : 1 - row.probability), 0) / rows.length });
  const binaryBaseline = (rows: typeof totalReads, probability: number) => ({ probability, brier: rows.reduce((sum, row) => sum + (probability - Number(row.outcome)) ** 2, 0) / rows.length, logLoss: rows.reduce((sum, row) => sum - safeLog(row.outcome ? probability : 1 - probability), 0) / rows.length });
  const developmentOverRate = developmentJoined.filter((match) => match.home_score! + match.away_score! > 2.5).length / developmentJoined.length;
  const developmentBttsRate = developmentJoined.filter((match) => match.home_score! > 0 && match.away_score! > 0).length / developmentJoined.length;
  const splitIndex = Math.floor(n / 2);
  const temperatureGrid = Array.from({ length: 21 }, (_, index) => 0.5 + index * 0.05);
  const temperatureTrials = temperatureGrid.map((temperature) => ({
    temperature,
    calibration: multiclassMetrics(probabilityReads.filter((row) => row.index < splitIndex).map((row) => ({ ...row, probabilities: temperatureScale(row.probabilities, temperature) }))),
    finalHoldout: multiclassMetrics(probabilityReads.filter((row) => row.index >= splitIndex).map((row) => ({ ...row, probabilities: temperatureScale(row.probabilities, temperature) }))),
  }));
  const selectedTemperature = [...temperatureTrials].sort((a, b) => (a.calibration.logLoss ?? Infinity) - (b.calibration.logLoss ?? Infinity))[0];
  const marketWeights = [0, 0.1, 0.2, 0.35, 0.5, 1];
  const marketBlendTrials = marketWeights.map((marketWeight) => ({
    marketWeight,
    calibration: multiclassMetrics(marketComparisonReads.filter((row) => row.index < splitIndex).map((row) => ({ ...row, probabilities: blendProbabilities(row.probabilities, row.market, marketWeight) }))),
    finalHoldout: multiclassMetrics(marketComparisonReads.filter((row) => row.index >= splitIndex).map((row) => ({ ...row, probabilities: blendProbabilities(row.probabilities, row.market, marketWeight) }))),
  }));
  const selectedMarketBlend = [...marketBlendTrials].sort((a, b) => (a.calibration.logLoss ?? Infinity) - (b.calibration.logLoss ?? Infinity))[0];
  console.log(JSON.stringify({ release: "epl_club_dixon_coles_shadow_2026_08_18_r1", gradeRelease: "epl_grade_policy_shadow_2026_08_18_v4", evaluation: "chronological_2025_26_holdout_with_prior_only_refits", developmentMatches: developmentJoined.length, holdoutMatches: n, xgCoverage: joined.length > 0 ? bothXg / joined.length : 0, resultAccuracy: n > 0 ? correct / n : null, multiclassBrier: modelBrier, logLoss: modelLogLoss, scoreMae: n > 0 ? scoreMae / n : null, rollingFolds, probabilityCalibration: { allThreeOutcomes: calibration(classCalibrationReads), home: calibration(classCalibrationReads.filter((row) => row.side === "home")), draw: calibration(classCalibrationReads.filter((row) => row.side === "draw")), away: calibration(classCalibrationReads.filter((row) => row.side === "away")) }, worldCupLessonChallengers: { note: "Audit-only. Calibration half selects the parameter; untouched final half judges it. No runtime or grade change.", temperatureScaling: { selected: selectedTemperature, trials: temperatureTrials }, marketAnchoring: { selected: selectedMarketBlend, trials: marketBlendTrials } }, forecastReliability: { definition: "probability of the model's most likely home/draw/away result", bands: forecastBands }, derivedMarketCalibration: { over25: { fullHoldout: binaryAudit(totalReads), finalHalf: binaryAudit(totalReads.filter((row) => row.index >= Math.floor(n / 2))), developmentRateBaseline: binaryBaseline(totalReads, developmentOverRate) }, bttsYes: { fullHoldout: binaryAudit(bttsReads), finalHalf: binaryAudit(bttsReads.filter((row) => row.index >= Math.floor(n / 2))), developmentRateBaseline: binaryBaseline(bttsReads, developmentBttsRate) } }, baselines: { uniform: { logLoss: uniformLogLossValue, multiclassBrier: n > 0 ? uniformBrier / n : null }, developmentLeaguePrior: { probabilities: { home: leaguePrior[0], draw: leaguePrior[1], away: leaguePrior[2] }, logLoss: leaguePriorLogLossValue, multiclassBrier: n > 0 ? leaguePriorBrier / n : null } }, openingMarketAudit: { pricedMatches: pricedReads.length, calibrationMatches: calibrationRows.length, finalHoldoutMatches: finalRows.length, priceGate: "selected-side opening price > -300", thresholds, gradeDistribution: { fullHoldout: gradeDistribution(pricedReads), finalHalf: gradeDistribution(finalRows) } }, gates: { beatsUniformLogLoss: modelLogLoss !== null && uniformLogLossValue !== null && modelLogLoss < uniformLogLossValue, beatsLeaguePriorLogLoss: modelLogLoss !== null && leaguePriorLogLossValue !== null && modelLogLoss < leaguePriorLogLossValue, marketCalibratedActionability: false }, limitedHistoryMatches: limited, actionablePromotions: 0, actionableDemotions: 0, netBoardImpact: 0, status: "shadow_only" }, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
