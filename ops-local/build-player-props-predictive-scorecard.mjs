import fs from "node:fs";

const compactPath = process.env.PLAYER_PROPS_COMPACT_REPORT
  ?? "/private/tmp/all-player-props-calibration-compact.json";
const observationsPath = process.env.PLAYER_PROPS_OBSERVATIONS
  ?? "/private/tmp/all-player-props-observations.json";
const exactPath = process.env.PLAYER_PROPS_EXACT_REPORT
  ?? "/private/tmp/market-specific-calibration-tournament.json";

const compact = read(compactPath);
const observations = read(observationsPath);
const exact = read(exactPath);

const productPriority = [
  "batter_hits",
  "batter_home_runs",
  "batter_total_bases",
  "pitcher_strikeouts",
  "pitcher_outs",
  "batter_hits_runs_rbis",
  "batter_rbis",
  "batter_runs_scored",
  "pitcher_hits_allowed",
  "pitcher_walks",
  "pitcher_earned_runs",
  "batter_strikeouts",
  "batter_walks",
  "batter_singles",
  "batter_doubles",
  "batter_stolen_bases",
  "batter_triples",
];

const compactByMarket = new Map((compact.markets ?? []).map((row) => [row.market, row]));
const exactTournament = exact.tournament ?? {};
const rows = [];

for (const market of productPriority) {
  const channels = ["two_way", "milestone"]
    .map((channel) => buildChannel(market, channel))
    .filter((row) => row.observations > 0);
  if (!channels.length) continue;

  const preferred = channels.find((row) => row.channel === "two_way") ?? channels[0];
  const exactHoldout = exactTournament[market]?.holdout ?? null;
  const exactDelta = exactHoldout?.current && exactHoldout?.market
    ? exactHoldout.current.brier - exactHoldout.market.brier
    : null;
  const reconstructedDelta = preferred.currentApproxBrier === null || preferred.marketBrier === null
    ? null
    : preferred.currentApproxBrier - preferred.marketBrier;
  const weakness = exactDelta ?? reconstructedDelta;

  rows.push({
    market,
    productRank: productPriority.indexOf(market) + 1,
    preferredChannel: preferred.channel,
    channels,
    exactLockedHoldout: exactHoldout ? {
      rows: exactHoldout.current?.rows ?? null,
      dates: exactHoldout.current?.dates ?? null,
      marketBrier: exactHoldout.market?.brier ?? null,
      independentModelBrier: exactHoldout.model?.brier ?? null,
      finalProbabilityBrier: exactHoldout.current?.brier ?? null,
      finalVsMarketBrierDelta: exactDelta,
      marketLogLoss: exactHoldout.market?.logLoss ?? null,
      finalLogLoss: exactHoldout.current?.logLoss ?? null,
      finalCalibrationGap: exactHoldout.current?.calibrationGap ?? null,
      releaseSeparatedInSource: true,
    } : null,
    priorityDisposition: disposition({ weakness, preferred, exactHoldout }),
  });
}

const output = {
  generatedAt: new Date().toISOString(),
  scope: {
    markets: rows.length,
    channels: rows.reduce((sum, row) => sum + row.channels.length, 0),
    historicalRows: rows.reduce(
      (sum, row) => sum + row.channels.reduce((channelSum, channel) => channelSum + channel.observations, 0),
      0,
    ),
    exactLockedRows: exact.scope?.rows ?? null,
    exactLockedDates: exact.scope?.dates ?? [],
  },
  evidenceContract: {
    historical: "Immutable opening offers joined to official MLB outcomes. Current-model probabilities are reconstructed approximations and are used only for broad diagnosis.",
    exactLocked: "Stored production model, market, and final probabilities. Exact but limited to the listed tracking dates and kept attributable by immutable release in the source report.",
    leakage: compact.methodology?.leakageControl ?? null,
    writesToProduction: false,
  },
  markets: rows,
};

console.log(JSON.stringify(output, null, 2));

function buildChannel(market, channel) {
  const values = observations[`${market}|${channel}`] ?? [];
  const compactChannel = compactByMarket.get(market)?.channels?.find((row) => row.channel === channel);
  const projection = pointMetrics(values, (row) => row.projection);
  const line = pointMetrics(values, (row) => row.line);
  return {
    channel,
    observations: values.length,
    dates: new Set(values.map((row) => row.date)).size,
    dateRange: values.length ? [values[0].date, values.at(-1).date] : null,
    projectionMae: projection?.mae ?? null,
    projectionRmse: projection?.rmse ?? null,
    projectionBias: projection?.bias ?? null,
    marketLineMae: line?.mae ?? null,
    marketLineRmse: line?.rmse ?? null,
    marketBrier: compactChannel?.market?.brier ?? null,
    currentApproxBrier: compactChannel?.currentApprox?.brier ?? null,
    reconstructedBrierDelta: compactChannel?.market && compactChannel?.currentApprox
      ? round(compactChannel.currentApprox.brier - compactChannel.market.brier)
      : null,
    evaluatedFolds: compactChannel?.summary?.evaluatedFolds ?? 0,
    reconstructedWorseThanMarketFolds: compactChannel?.summary?.currentApproxWorseThanMarketFolds ?? null,
    challengerBeatsMarketFolds: compactChannel?.summary?.candidateBeatsMarketFolds ?? null,
    challengerDisposition: compactChannel?.summary?.calibrationDisposition ?? "not_evaluated",
  };
}

function disposition({ weakness, preferred, exactHoldout }) {
  if (preferred.observations < 100 || preferred.dates < 4) return "coverage_limited";
  if (weakness !== null && weakness >= 0.005) return "rebuild_high_priority";
  if (weakness !== null && weakness >= 0.001) return "rebuild_or_recalibrate";
  if (exactHoldout && weakness !== null && weakness <= -0.001) return "protect_and_verify_by_release";
  if (preferred.challengerBeatsMarketFolds >= 3) return "promising_challenger_requires_locked_holdout";
  return "no_stable_market_lift";
}

function pointMetrics(values, prediction) {
  const pairs = values
    .map((row) => ({ actual: Number(row.actual), predicted: Number(prediction(row)) }))
    .filter((row) => Number.isFinite(row.actual) && Number.isFinite(row.predicted));
  if (!pairs.length) return null;
  return {
    mae: round(mean(pairs.map((row) => Math.abs(row.predicted - row.actual)))),
    rmse: round(Math.sqrt(mean(pairs.map((row) => (row.predicted - row.actual) ** 2)))),
    bias: round(mean(pairs.map((row) => row.predicted - row.actual))),
  };
}

function read(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
