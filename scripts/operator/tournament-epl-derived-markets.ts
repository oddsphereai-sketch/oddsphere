import { BallDontLieEplProvider } from "../../lib/providers/real_api/BallDontLieEplProvider";
import { fitEplShadowModel, joinEplMatchStats, predictEplMatch, type EplTrainingMatch } from "../../lib/services/epl/eplShadowModel";

type BinaryMarket = "total" | "btts";
type Example = { season: number; id: number; date: string; x: number[]; y: number; raw: number };
type Scaler = { mean: number[]; sd: number[] };
type Fit = { weights: number[]; scaler: Scaler };

const CONFIG = { halfLifeDays: 365, shrinkageMatches: 4, xgWeight: 0, dixonColesTau: -0.1 };
const safeLog = (value: number) => Math.log(Math.max(1e-9, Math.min(1 - 1e-9, value)));
const logit = (value: number) => safeLog(value) - safeLog(1 - value);
const sigmoid = (value: number) => value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value));

function teamWindow(history: EplTrainingMatch[], teamId: number, count: number) {
  const rows = history.filter((match) => match.home_team_id === teamId || match.away_team_id === teamId).slice(-count);
  const values = rows.map((match) => {
    const home = match.home_team_id === teamId;
    const gf = home ? match.home_score! : match.away_score!;
    const ga = home ? match.away_score! : match.home_score!;
    return { gf, ga, scored: Number(gf > 0), conceded: Number(ga > 0), over: Number(gf + ga > 2.5), btts: Number(gf > 0 && ga > 0) };
  });
  const avg = (key: keyof (typeof values)[number], fallback: number) => values.length ? values.reduce((sum, row) => sum + row[key], 0) / values.length : fallback;
  return { gf: avg("gf", 1.35), ga: avg("ga", 1.35), scored: avg("scored", 0.72), conceded: avg("conceded", 0.72), over: avg("over", 0.52), btts: avg("btts", 0.55) };
}

function features(market: BinaryMarket, prediction: ReturnType<typeof predictEplMatch>, history: EplTrainingMatch[], match: EplTrainingMatch): number[] {
  const home5 = teamWindow(history, match.home_team_id, 5);
  const away5 = teamWindow(history, match.away_team_id, 5);
  const home10 = teamWindow(history, match.home_team_id, 10);
  const away10 = teamWindow(history, match.away_team_id, 10);
  const raw = market === "total" ? prediction.rawDerivedProbabilities.over25 : prediction.rawDerivedProbabilities.bttsYes;
  const common = [
    logit(raw), prediction.expectedTotal, Math.min(prediction.lambdaHome, prediction.lambdaAway),
    Math.abs(prediction.lambdaHome - prediction.lambdaAway), prediction.lambdaHome * prediction.lambdaAway,
  ];
  return market === "total"
    ? [...common, home5.gf + home5.ga, away5.gf + away5.ga, home10.over, away10.over, (home10.gf + away10.gf + home10.ga + away10.ga) / 4]
    : [...common, home5.scored, away5.scored, home5.conceded, away5.conceded, home10.btts, away10.btts];
}

function examples(matches: EplTrainingMatch[], market: BinaryMarket): Example[] {
  const ordered = [...matches].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  return ordered.map((match, index) => {
    const history = ordered.slice(0, index);
    const prediction = predictEplMatch(fitEplShadowModel(history, match.date, CONFIG), match.home_team_id, match.away_team_id);
    return {
      season: match.season, id: match.id, date: match.date,
      x: features(market, prediction, history, match),
      y: market === "total" ? Number(match.home_score! + match.away_score! > 2.5) : Number(match.home_score! > 0 && match.away_score! > 0),
      raw: market === "total" ? prediction.rawDerivedProbabilities.over25 : prediction.rawDerivedProbabilities.bttsYes,
    };
  }).filter((row) => row.x.every(Number.isFinite) && Number.isFinite(row.raw));
}

function scale(rows: Example[]): Scaler {
  const width = rows[0]!.x.length;
  const mean = Array.from({ length: width }, (_, j) => rows.reduce((sum, row) => sum + row.x[j]!, 0) / rows.length);
  const sd = mean.map((m, j) => Math.max(1e-6, Math.sqrt(rows.reduce((sum, row) => sum + (row.x[j]! - m) ** 2, 0) / rows.length)));
  return { mean, sd };
}

function vector(row: Example, scaler: Scaler): number[] { return [1, ...row.x.map((value, j) => (value - scaler.mean[j]!) / scaler.sd[j]!)]; }

function train(rows: Example[], l2: number): Fit {
  const scaler = scale(rows);
  const weights = Array(rows[0]!.x.length + 1).fill(0);
  for (let iteration = 0; iteration < 5000; iteration++) {
    const gradient = Array(weights.length).fill(0);
    for (const row of rows) {
      const x = vector(row, scaler);
      const p = sigmoid(x.reduce((sum, value, j) => sum + value * weights[j], 0));
      for (let j = 0; j < weights.length; j++) gradient[j] += (p - row.y) * x[j]!;
    }
    for (let j = 1; j < weights.length; j++) gradient[j] += l2 * weights[j];
    const rate = 0.08 / Math.sqrt(1 + iteration / 250);
    const magnitude = Math.max(...gradient.map((value) => Math.abs(value / rows.length)));
    for (let j = 0; j < weights.length; j++) weights[j] -= rate * gradient[j] / rows.length;
    if (magnitude < 1e-7) break;
  }
  return { weights, scaler };
}

function predict(fit: Fit, row: Example): number { const x = vector(row, fit.scaler); return sigmoid(x.reduce((sum, value, j) => sum + value * fit.weights[j], 0)); }

function report(rows: Example[], probability: (row: Example) => number) {
  const probabilities = rows.map(probability);
  const accuracy = rows.filter((row, i) => (probabilities[i]! >= 0.5) === Boolean(row.y)).length / rows.length;
  const yes = probabilities.filter((value) => value >= 0.5).length;
  const brier = rows.reduce((sum, row, i) => sum + (probabilities[i]! - row.y) ** 2, 0) / rows.length;
  const logLoss = rows.reduce((sum, row, i) => sum - (row.y ? safeLog(probabilities[i]!) : safeLog(1 - probabilities[i]!)), 0) / rows.length;
  const buckets = [[0, .45], [.45, .5], [.5, .55], [.55, .6], [.6, 1.01]].map(([min, max]) => {
    const selected = rows.filter((_, i) => probabilities[i]! >= min! && probabilities[i]! < max!);
    return { band: `${min}-${max}`, n: selected.length, forecast: selected.length ? selected.reduce((sum, row) => sum + probabilities[rows.indexOf(row)]!, 0) / selected.length : null, actual: selected.length ? selected.reduce((sum, row) => sum + row.y, 0) / selected.length : null };
  });
  return { n: rows.length, brier, logLoss, accuracy, sides: { yes, no: rows.length - yes }, mean: probabilities.reduce((a, b) => a + b, 0) / rows.length, buckets };
}

async function main() {
  const key = process.env.BALLDONTLIE_API_KEY;
  if (!key) throw new Error("BALLDONTLIE_API_KEY is required");
  const provider = new BallDontLieEplProvider(key);
  const seasons = [2022, 2023, 2024, 2025];
  const lists = await Promise.all(seasons.map((season) => provider.listMatches({ season })));
  const finals = lists.flat().filter((match) => match.status_state === "final");
  const stats = await provider.listTeamMatchStats(finals.map((match) => match.id));
  const joined = joinEplMatchStats(finals, stats);
  const output: Record<string, unknown> = {};
  for (const market of ["total", "btts"] as const) {
    const rows = examples(joined, market);
    const trainRows = rows.filter((row) => row.season === 2022 || row.season === 2023);
    const validation = rows.filter((row) => row.season === 2024);
    const holdout = rows.filter((row) => row.season === 2025);
    const baseRate = trainRows.reduce((sum, row) => sum + row.y, 0) / trainRows.length;
    const trials = [0, .01, .03, .1, .3, 1, 3, 10].map((l2) => {
      const fit = train(trainRows, l2);
      return { l2, fit, validation: report(validation, (row) => predict(fit, row)) };
    }).sort((a, b) => a.validation.logLoss - b.validation.logLoss || a.validation.brier - b.validation.brier);
    const selected = trials[0]!;
    const finalFit = train([...trainRows, ...validation], selected.l2);
    const combinedBaseRate = [...trainRows, ...validation].reduce((sum, row) => sum + row.y, 0) / (trainRows.length + validation.length);
    output[market] = {
      selectedL2: selected.l2,
      validation: selected.validation,
      holdout: report(holdout, (row) => predict(finalFit, row)),
      baselines: {
        constant: report(holdout, () => combinedBaseRate),
        rawPoisson: report(holdout, (row) => row.raw),
      },
      rates: { train: baseRate, trainPlusValidation: combinedBaseRate, holdoutActual: holdout.reduce((sum, row) => sum + row.y, 0) / holdout.length },
      weights: finalFit.weights,
      scaler: finalFit.scaler,
      validationTrials: trials.map((trial) => ({ l2: trial.l2, validation: trial.validation })),
    };
  }
  console.log(JSON.stringify({ protocol: "2022_23_train__2024_validation__2025_untouched_holdout", output }, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
