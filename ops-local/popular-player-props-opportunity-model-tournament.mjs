import fs from "node:fs";

const observations = read(process.env.PLAYER_PROPS_OBSERVATIONS
  ?? "/private/tmp/all-player-props-observations.json");
const mappings = read(process.env.PLAYER_PROPS_MAPPINGS
  ?? "/private/tmp/oddsphere-mlb-all-props-research/bdl-to-mlbstats.json");
const hitterLogs = read(process.env.PLAYER_PROPS_HITTER_LOGS
  ?? "/private/tmp/oddsphere-mlb-all-props-research/mlb-hitter-logs.json");
const pitcherLogs = read(process.env.PLAYER_PROPS_PITCHER_LOGS
  ?? "/private/tmp/oddsphere-mlb-all-props-research/mlb-pitcher-logs.json");
const battingOrders = read(process.env.PLAYER_PROPS_BATTING_ORDERS
  ?? "/private/tmp/oddsphere-mlb-all-props-research/mlb-batting-orders.json");

const definitions = [
  { market: "batter_hits", channel: "two_way", stat: "hits", exposure: "at_bats", leagueRate: 0.245 },
  { market: "batter_hits", channel: "milestone", stat: "hits", exposure: "at_bats", leagueRate: 0.245 },
  { market: "batter_home_runs", channel: "milestone", stat: "home_runs", exposure: "plate_appearances", leagueRate: 0.031 },
  { market: "batter_total_bases", channel: "two_way", stat: "total_bases", exposure: "at_bats", leagueRate: 0.405 },
  { market: "batter_hits_runs_rbis", channel: "two_way", stat: "hits_runs_rbis", exposure: "plate_appearances", leagueRate: 0.43 },
  { market: "pitcher_strikeouts", channel: "two_way", stat: "strikeouts", exposure: "batters_faced", leagueRate: 0.225 },
  { market: "pitcher_outs", channel: "two_way", stat: "outs", exposure: null, leagueRate: null },
];

const folds = [
  { trainThrough: "2026-06-21", from: "2026-06-22", through: "2026-06-30" },
  { trainThrough: "2026-06-30", from: "2026-07-01", through: "2026-07-07" },
  { trainThrough: "2026-07-07", from: "2026-07-08", through: "2026-07-12" },
  { trainThrough: "2026-07-12", from: "2026-07-16", through: "2026-07-23" },
];

const variants = [
  ...[5, 10, 20].flatMap((window) => [10, 25, 50].flatMap((priorStrength) =>
    [0.35, 0.65].map((opportunityWeight) => ({
      kind: "opportunity_rate",
      name: `opp_w${window}_s${priorStrength}_o${opportunityWeight}`,
      window,
      priorStrength,
      opportunityWeight,
    })))),
  ...[5, 10, 20].flatMap((window) => [2, 5, 10, 20].map((priorStrength) => ({
    kind: "survival",
    name: `survival_w${window}_s${priorStrength}`,
    window,
    priorStrength,
  }))),
];

const reports = {};
for (const definition of definitions) {
  const key = `${definition.market}|${definition.channel}`;
  const rows = buildRows(definition, observations[key] ?? []);
  reports[key] = evaluate(definition, rows);
  process.stderr.write(`${key}: ${rows.length} leakage-safe rows\n`);
}

const output = {
  generatedAt: new Date().toISOString(),
  methodology: {
    objective: "Improve event probability accuracy before testing any betting or promotion policy.",
    opportunityModels: "Pregame batting order plus prior-only opportunity history for hitters; prior-only batters faced for pitchers.",
    eventRateModels: "Prior-only per-opportunity event rates with shrinkage, plus a threshold-survival family.",
    selection: "Each forward fold selects a fixed candidate only on the trailing portion of its training period, then evaluates the untouched next date block.",
    marketStack: "A separately reported ridge stack may use the no-vig market as an offset. Independent and stacked accuracy are never conflated.",
    writesToProduction: false,
  },
  reports,
};

console.log(JSON.stringify(process.env.SUMMARY_ONLY === "1" ? {
  generatedAt: output.generatedAt,
  methodology: output.methodology,
  reports: Object.fromEntries(Object.entries(reports).map(([key, report]) => [key, {
    observations: report.observations,
    dateRange: report.dateRange,
    summary: report.summary,
    perFold: report.folds.filter((fold) => fold.status === "evaluated").map((fold) => ({
      window: [fold.from, fold.through],
      selected: fold.selected,
      projectionMae: fold.pointProjection.mae,
      recentMeanMae: fold.recentMeanProjection.mae,
      marketBrier: fold.market.brier,
      currentApproxBrier: fold.currentApprox.brier,
      independentBrier: fold.independent.brier,
      stackedBrier: fold.stacked.brier,
    })),
  }])),
} : output, null, 2));

function buildRows(definition, rawRows) {
  const isPitcher = definition.market.startsWith("pitcher_");
  const logsByPlayer = isPitcher ? pitcherLogs : hitterLogs;
  return rawRows.flatMap((row) => {
    const bdlId = String(row.playerId).replace("balldontlie-player-", "");
    const mlbId = mappings[bdlId]?.mlbStatsPlayerId;
    const logs = mlbId ? logsByPlayer[mlbId] ?? [] : [];
    const target = logs.find((log) => log.gameDate === row.date);
    const prior = logs
      .filter((log) => log.gameDate < row.date)
      .sort((left, right) => right.gameDate.localeCompare(left.gameDate));
    if (!target || prior.length < 10) return [];
    const priorValues = prior.map((log) => Number(log.stats?.[definition.stat])).filter(Number.isFinite);
    if (priorValues.length < 10) return [];
    const priorExposures = definition.exposure
      ? prior.map((log) => Number(log.stats?.[definition.exposure])).filter(Number.isFinite)
      : [];
    if (definition.exposure && priorExposures.length !== prior.length) return [];
    const gamePk = String(target.gameId ?? "").replace("mlbstats-game-", "");
    const playerPk = String(mlbId ?? "").replace("mlbstats-player-", "");
    const battingOrder = Number(battingOrders[gamePk]?.[playerPk]);
    return [{
      ...row,
      priorValues,
      priorExposures,
      battingOrder: Number.isInteger(battingOrder) ? battingOrder : null,
      home: target.stats?.home_away === "home" ? 1 : 0,
    }];
  });
}

function evaluate(definition, rows) {
  const foldReports = [];
  for (const fold of folds) {
    const train = rows.filter((row) => row.date <= fold.trainThrough);
    const test = rows.filter((row) => row.date >= fold.from && row.date <= fold.through);
    const trainDates = [...new Set(train.map((row) => row.date))].sort();
    const calibrationStart = trainDates[Math.max(0, Math.floor(trainDates.length * 0.7))];
    const discovery = train.filter((row) => row.date < calibrationStart);
    const calibration = train.filter((row) => row.date >= calibrationStart);
    if (discovery.length < 100 || calibration.length < 50 || test.length < 30) {
      foldReports.push({ ...fold, status: "insufficient", discovery: discovery.length, calibration: calibration.length, test: test.length });
      continue;
    }
    const linePriors = buildLinePriors(discovery);
    const tournament = variants.map((variant) => {
      const predict = (row) => independentProbability(definition, row, variant, linePriors);
      return { variant, metrics: probabilityMetrics(calibration, predict) };
    }).sort((left, right) => left.metrics.brier - right.metrics.brier || left.metrics.logLoss - right.metrics.logLoss);
    const selected = tournament[0];
    const independent = (row) => independentProbability(definition, row, selected.variant, linePriors);
    const stack = fitMarketOffset(discovery, independent);
    const stacked = (row) => stackPredict(row, independent(row), stack);
    foldReports.push({
      ...fold,
      status: "evaluated",
      discovery: discovery.length,
      calibration: calibration.length,
      test: test.length,
      selected: selected.variant.name,
      calibrationSelection: selected.metrics,
      pointProjection: pointMetrics(test, (row) => projection(definition, row, selected.variant)),
      recentMeanProjection: pointMetrics(test, (row) => mean(row.priorValues.slice(0, 10))),
      marketLineAsPoint: pointMetrics(test, (row) => row.line),
      independent: probabilityMetrics(test, independent),
      market: probabilityMetrics(test, (row) => row.marketOver),
      currentApprox: probabilityMetrics(test, (row) => row.currentApproxOver),
      stacked: probabilityMetrics(test, stacked),
      stack,
    });
  }
  const evaluated = foldReports.filter((fold) => fold.status === "evaluated");
  return {
    observations: rows.length,
    dateRange: rows.length ? [rows[0].date, rows.at(-1).date] : null,
    folds: foldReports,
    summary: {
      evaluatedFolds: evaluated.length,
      independentBeatsCurrentFolds: countWins(evaluated, "independent", "currentApprox"),
      independentBeatsMarketFolds: countWins(evaluated, "independent", "market"),
      stackedBeatsMarketFolds: countWins(evaluated, "stacked", "market"),
      projectionBeatsRecentMeanFolds: evaluated.filter((fold) => fold.pointProjection.mae < fold.recentMeanProjection.mae).length,
      aggregate: aggregateFoldMetrics(evaluated),
    },
  };
}

function independentProbability(definition, row, variant, linePriors) {
  if (variant.kind === "survival") {
    const history = row.priorValues.slice(0, variant.window);
    const successes = history.filter((value) => value > row.line).length;
    const prior = linePriors.get(row.line) ?? 0.5;
    return clamp((successes + prior * variant.priorStrength) / (history.length + variant.priorStrength));
  }
  return poissonOver(projection(definition, row, variant), Math.floor(row.line) + 1);
}

function projection(definition, row, variant) {
  const window = variant.window ?? 10;
  if (!definition.exposure) {
    const recent = mean(row.priorValues.slice(0, window));
    const season = mean(row.priorValues);
    return clamp(recent * 0.6 + season * 0.4, 0.05, 30);
  }
  const recentValues = row.priorValues.slice(0, window);
  const recentExposures = row.priorExposures.slice(0, window);
  const seasonRate = sum(row.priorValues) / Math.max(1, sum(row.priorExposures));
  const rate = (sum(recentValues) + seasonRate * variant.priorStrength)
    / Math.max(1, sum(recentExposures) + variant.priorStrength);
  const recentOpportunity = mean(recentExposures);
  const lineupOpportunity = expectedOpportunity(definition, row.battingOrder, recentOpportunity);
  const opportunity = recentOpportunity * variant.opportunityWeight
    + lineupOpportunity * (1 - variant.opportunityWeight);
  return clamp(opportunity * rate, 0.001, 30);
}

function expectedOpportunity(definition, battingOrder, fallback) {
  if (definition.market.startsWith("pitcher_")) return fallback;
  if (!battingOrder) return fallback;
  const plateAppearances = [4.72, 4.62, 4.54, 4.45, 4.36, 4.27, 4.18, 4.08, 3.98][battingOrder - 1] ?? fallback;
  return definition.exposure === "at_bats" ? plateAppearances * 0.89 : plateAppearances;
}

function buildLinePriors(rows) {
  const groups = new Map();
  for (const row of rows) {
    const group = groups.get(row.line) ?? { wins: 0, rows: 0 };
    group.wins += row.overWon;
    group.rows++;
    groups.set(row.line, group);
  }
  return new Map([...groups].map(([line, group]) => [line, (group.wins + 2) / (group.rows + 4)]));
}

function fitMarketOffset(rows, independent) {
  const coefficients = [0, 0, 0, 0];
  const lambda = 50;
  for (let iteration = 0; iteration < 1500; iteration++) {
    const gradient = [0, 0, 0, 0];
    for (const row of rows) {
      const x = stackFeatures(row, independent(row));
      const p = sigmoid(logit(row.marketOver) + dot(coefficients, x));
      const error = p - row.overWon;
      for (let index = 0; index < coefficients.length; index++) gradient[index] += error * x[index];
    }
    for (let index = 0; index < coefficients.length; index++) {
      gradient[index] += lambda * coefficients[index];
      coefficients[index] -= 0.2 * gradient[index] / rows.length;
    }
  }
  return coefficients.map(round);
}

function stackPredict(row, independent, coefficients) {
  return clamp(sigmoid(logit(row.marketOver) + dot(coefficients, stackFeatures(row, independent))));
}

function stackFeatures(row, independent) {
  return [1, logit(independent) - logit(row.marketOver), row.line, row.home];
}

function probabilityMetrics(rows, predict) {
  const probabilities = rows.map((row) => clamp(predict(row)));
  return {
    rows: rows.length,
    brier: round(mean(rows.map((row, index) => (probabilities[index] - row.overWon) ** 2))),
    logLoss: round(mean(rows.map((row, index) => -(
      row.overWon * Math.log(probabilities[index]) + (1 - row.overWon) * Math.log(1 - probabilities[index])
    )))),
    calibrationGap: round(mean(rows.map((row, index) => probabilities[index] - row.overWon))),
  };
}

function pointMetrics(rows, predict) {
  return {
    mae: round(mean(rows.map((row) => Math.abs(predict(row) - row.actual)))),
    rmse: round(Math.sqrt(mean(rows.map((row) => (predict(row) - row.actual) ** 2)))),
    bias: round(mean(rows.map((row) => predict(row) - row.actual)), 6),
  };
}

function aggregateFoldMetrics(folds) {
  const total = folds.reduce((sumValue, fold) => sumValue + fold.test, 0);
  const weighted = (key, metric) => total
    ? round(folds.reduce((sumValue, fold) => sumValue + fold[key][metric] * fold.test, 0) / total)
    : null;
  return {
    rows: total,
    marketBrier: weighted("market", "brier"),
    currentApproxBrier: weighted("currentApprox", "brier"),
    independentBrier: weighted("independent", "brier"),
    stackedBrier: weighted("stacked", "brier"),
    projectionMae: weighted("pointProjection", "mae"),
    recentMeanMae: weighted("recentMeanProjection", "mae"),
  };
}

function countWins(folds, left, right) {
  return folds.filter((fold) => fold[left].brier < fold[right].brier).length;
}

function poissonOver(lambda, threshold) {
  let term = Math.exp(-lambda);
  let cumulative = term;
  for (let value = 1; value < threshold; value++) {
    term *= lambda / value;
    cumulative += term;
  }
  return clamp(1 - cumulative);
}

function logit(value) {
  const bounded = clamp(value);
  return Math.log(bounded / (1 - bounded));
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

function dot(left, right) {
  return left.reduce((value, item, index) => value + item * right[index], 0);
}

function read(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function mean(values) {
  return values.length ? sum(values) / values.length : 0;
}

function sum(values) {
  return values.reduce((value, item) => value + item, 0);
}

function clamp(value, low = 0.001, high = 0.999) {
  return Math.min(high, Math.max(low, value));
}

function round(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
