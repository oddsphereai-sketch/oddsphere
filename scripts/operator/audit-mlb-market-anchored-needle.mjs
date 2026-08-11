/**
 * READ ONLY. MLB Moneyline market-anchored needle audit.
 *
 * Reconstructs both priced sides from frozen lines-at-lock, anchors probability
 * to the two-sided no-vig market, and compares market-only architectures with
 * architectures that admit projection and model residuals. Architecture is
 * selected on chronological validation calibration; holdout is untouched.
 *
 * Usage:
 *   node scripts/operator/audit-mlb-market-anchored-needle.mjs
 */
import { readdir, readFile, writeFile } from "node:fs/promises";

const AUDIT_DIR = "/tmp/oddsphere-audit";
const OUTPUT = `${AUDIT_DIR}/mlb-market-anchored-needle.json`;
const MONEYLINE_HEAD = "mlb_moneyline_regularized_k01_cap6_champion_guardrails_2026_07_11";
const MIN_PRICE = -220;
const MAX_PRICE = 200;

const clamp = (value, low = 0.001, high = 0.999) => Math.max(low, Math.min(high, value));
const sigmoid = (value) => value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value));
const logit = (value) => Math.log(clamp(value) / (1 - clamp(value)));
const implied = (odds) => odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
const pct = (value) => Number.isFinite(value) ? (value <= 1 ? value * 100 : value) : null;
const median = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const opposite = (side) => side === "home" ? "away" : "home";

function relationResult(row, outcomes) {
  const value = outcomes.get(row.id);
  return value === "win" || value === "loss" ? value : null;
}

function latestBookPairs(row) {
  const lines = (row.snapshot_json?.lines_at_lock ?? []).filter((line) =>
    line.market_type === "moneyline" &&
    (line.side === "home" || line.side === "away") &&
    Number.isFinite(line.odds_american)
  );
  const latest = new Map();
  for (const line of lines) {
    const key = `${line.sportsbook}:${line.side}`;
    const previous = latest.get(key);
    if (!previous || String(line.fetched_at ?? "") > String(previous.fetched_at ?? "")) latest.set(key, line);
  }
  const books = new Map();
  for (const line of latest.values()) {
    const pair = books.get(line.sportsbook) ?? {};
    pair[line.side] = line;
    books.set(line.sportsbook, pair);
  }
  return [...books.entries()].flatMap(([sportsbook, pair]) => {
    if (!pair.home || !pair.away) return [];
    const homeRaw = implied(pair.home.odds_american);
    const awayRaw = implied(pair.away.odds_american);
    const total = homeRaw + awayRaw;
    return [{
      sportsbook,
      homeOdds: pair.home.odds_american,
      awayOdds: pair.away.odds_american,
      homeNoVig: homeRaw / total,
      awayNoVig: awayRaw / total,
    }];
  });
}

function sourceSplit(row, provider, side) {
  const hit = (row.snapshot_json?.source_aware_split_rows_at_lock ?? []).find((split) =>
    split.market_type === "moneyline" &&
    split.provider === provider &&
    String(split.selection_key ?? "").split(":").at(-1) === side
  );
  return { bets: pct(hit?.bets_pct), money: pct(hit?.money_pct) };
}

function projectionGap(row, side) {
  const snapshot = row.snapshot_json ?? {};
  const scores = snapshot.predicted_scores_at_lock ?? {};
  const audit = snapshot.v2_2_audit ?? {};
  const home = Number(scores.home ?? audit.posterior_home_runs ?? audit.projected_home_runs);
  const away = Number(scores.away ?? audit.posterior_away_runs ?? audit.projected_away_runs);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return 0;
  return side === "home" ? home - away : away - home;
}

function movementFor(row, side) {
  const direction = row.snapshot_json?.line_movement?.direction ?? "unknown";
  if (side === row.side) return direction;
  if (direction === "toward_pick") return "against_pick";
  if (direction === "against_pick") return "toward_pick";
  return direction;
}

function candidateRows(row, outcomes) {
  const selectedResult = relationResult(row, outcomes);
  const pairs = latestBookPairs(row);
  if (!selectedResult || !pairs.length) return [];
  const gameHasAction = row.no_bet !== true && row.held !== true &&
    (row.best_angle === true || row.play_grade === "lean");
  return ["home", "away"].flatMap((side) => {
    const sharp = sourceSplit(row, "sharpapi", side);
    const publicSplit = sourceSplit(row, "playbook", side);
    if ([sharp.bets, sharp.money, publicSplit.bets, publicSplit.money].some((value) => value === null)) return [];
    const prices = pairs.map((pair) => side === "home" ? pair.homeOdds : pair.awayOdds);
    const odds = Math.max(...prices);
    if (odds < MIN_PRICE || odds > MAX_PRICE) return [];
    const marketP = median(pairs.map((pair) => side === "home" ? pair.homeNoVig : pair.awayNoVig));
    if (marketP === null) return [];
    const modelP = side === row.side ? row.model_probability : 1 - row.model_probability;
    const result = side === row.side ? selectedResult : selectedResult === "win" ? "loss" : "win";
    return [{
      id: `${row.id}:${side}`,
      recordId: row.id,
      gameId: row.game_id,
      slateDate: row.slate_date,
      side,
      odds,
      breakEven: implied(odds),
      marketP,
      modelP,
      projectionGap: projectionGap(row, side),
      movement: movementFor(row, side),
      sharp,
      public: publicSplit,
      result,
      y: result === "win" ? 1 : 0,
      gameHasAction,
      isPipelineSide: side === row.side,
    }];
  });
}

function features(row) {
  const movement = row.movement === "toward_pick" ? 1 : row.movement === "against_pick" ? -1 : 0;
  return {
    market: logit(row.marketP),
    price: logit(row.breakEven),
    sharpBets: (row.sharp.bets - 50) / 25,
    sharpMoney: (row.sharp.money - 50) / 25,
    sharpGap: (row.sharp.money - row.sharp.bets) / 25,
    publicBets: (row.public.bets - 50) / 25,
    publicMoney: (row.public.money - 50) / 25,
    publicGap: (row.public.money - row.public.bets) / 25,
    crossMoney: ((row.sharp.money - 50) * (row.public.money - 50)) > 0 ? 1 : -1,
    crossTickets: ((row.sharp.bets - 50) * (row.public.bets - 50)) > 0 ? 1 : -1,
    movement,
    projection: Math.max(-3, Math.min(3, row.projectionGap)) / 3,
    modelResidual: logit(row.modelP) - logit(row.marketP),
    pipelineSide: row.isPipelineSide ? 1 : 0,
  };
}

const architectures = {
  market_price_only: (row) => {
    const f = features(row); return [f.market, f.price];
  },
  market_splits_movement: (row) => {
    const f = features(row); return [
      f.market, f.price, f.sharpBets, f.sharpMoney, f.sharpGap,
      f.publicBets, f.publicMoney, f.publicGap, f.crossMoney,
      f.crossTickets, f.movement,
    ];
  },
  market_plus_projection: (row) => {
    const f = features(row); return [...architectures.market_splits_movement(row), f.projection];
  },
  market_plus_weak_model: (row) => {
    const f = features(row); return [...architectures.market_plus_projection(row), f.modelResidual, f.pipelineSide];
  },
};

function fit(train, feature, lambda = 12, maxIterations = 16000) {
  const raw = train.map(feature);
  const means = raw[0].map((_, index) => raw.reduce((sum, values) => sum + values[index], 0) / raw.length);
  const scales = means.map((mean, index) => Math.sqrt(raw.reduce((sum, values) => sum + (values[index] - mean) ** 2, 0) / raw.length) || 1);
  const transform = (row) => [1, ...feature(row).map((value, index) => (value - means[index]) / scales[index])];
  let beta = Array(transform(train[0]).length).fill(0);
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const gradient = Array(beta.length).fill(0);
    for (const row of train) {
      const x = transform(row);
      const p = sigmoid(x.reduce((sum, value, index) => sum + value * beta[index], 0));
      for (let index = 0; index < beta.length; index++) gradient[index] += (p - row.y) * x[index];
    }
    for (let index = 1; index < beta.length; index++) gradient[index] += lambda * beta[index];
    const next = beta.map((value, index) => value - 0.04 * gradient[index] / train.length);
    const delta = Math.max(...next.map((value, index) => Math.abs(value - beta[index])));
    beta = next;
    if (delta < 1e-9) break;
  }
  return {
    beta,
    predict: (row) => sigmoid(transform(row).reduce((sum, value, index) => sum + value * beta[index], 0)),
  };
}

function metrics(rows, predict = (row) => row.prediction) {
  if (!rows.length) return { n: 0, record: "0-0", units: 0, roiPct: null, brier: null, logLoss: null };
  const wins = rows.filter((row) => row.result === "win").length;
  const units = rows.reduce((sum, row) => sum + (row.result === "win" ? (row.odds > 0 ? row.odds / 100 : 100 / Math.abs(row.odds)) : -1), 0);
  const brier = rows.reduce((sum, row) => sum + (predict(row) - row.y) ** 2, 0) / rows.length;
  const logLoss = rows.reduce((sum, row) => {
    const p = clamp(predict(row)); return sum - (row.y * Math.log(p) + (1 - row.y) * Math.log(1 - p));
  }, 0) / rows.length;
  return {
    n: rows.length,
    record: `${wins}-${rows.length - wins}`,
    units: +units.toFixed(3),
    roiPct: +(100 * units / rows.length).toFixed(1),
    brier: +brier.toFixed(5),
    logLoss: +logLoss.toFixed(5),
  };
}

function unitProfit(row) {
  return row.result === "win" ? (row.odds > 0 ? row.odds / 100 : 100 / Math.abs(row.odds)) : -1;
}

function clusteredBootstrap(rows, iterations = 20000) {
  const byDate = [...Map.groupBy(rows, (row) => row.slateDate).values()];
  let state = 0x6d2b79f5;
  const random = () => {
    state = (Math.imul(state ^ (state >>> 15), 1 | state) + 0x6d2b79f5) | 0;
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
  const rois = [];
  for (let iteration = 0; iteration < iterations; iteration++) {
    const sample = [];
    for (let index = 0; index < byDate.length; index++) sample.push(...byDate[Math.floor(random() * byDate.length)]);
    rois.push(100 * sample.reduce((sum, row) => sum + unitProfit(row), 0) / sample.length);
  }
  rois.sort((left, right) => left - right);
  const quantile = (value) => rois[Math.min(rois.length - 1, Math.floor(value * rois.length))];
  return {
    iterations,
    dates: byDate.length,
    roiP05: +quantile(0.05).toFixed(1),
    roiMedian: +quantile(0.5).toFixed(1),
    roiP95: +quantile(0.95).toFixed(1),
    probabilityPositiveRoi: +(rois.filter((value) => value > 0).length / rois.length).toFixed(4),
  };
}

function candidatePool(row, pool) {
  if (pool === "pipelineSide") return row.isPipelineSide;
  const marketAligned = row.sharp.money > 50 && row.public.money > 50 && row.movement !== "against_pick";
  if (pool === "marketAligned") return marketAligned;
  if (pool === "pipelineMarketAligned") return row.isPipelineSide && marketAligned;
  return true;
}

function selectDaily(rows, model, limit, incrementalOnly, pool = "allSides") {
  const byDate = Map.groupBy(rows, (row) => row.slateDate);
  const selected = [];
  for (const dateRows of byDate.values()) {
    const byGame = new Map();
    for (const row of dateRows) {
      if (incrementalOnly && row.gameHasAction) continue;
      if (!candidatePool(row, pool)) continue;
      const prediction = model.predict(row);
      const candidate = { ...row, prediction, learnedEdge: prediction - row.breakEven };
      const previous = byGame.get(row.gameId);
      if (!previous || candidate.learnedEdge > previous.learnedEdge) byGame.set(row.gameId, candidate);
    }
    selected.push(...[...byGame.values()]
      .filter((row) => row.learnedEdge >= 0)
      .sort((left, right) => right.learnedEdge - left.learnedEdge || right.prediction - left.prediction)
      .slice(0, limit));
  }
  return selected;
}

function nestedWalkForward(pool) {
  const dates = [...new Set(rows.map((row) => row.slateDate))].sort();
  const selections = [];
  const architectureCounts = {};
  for (let dateIndex = 12; dateIndex < dates.length; dateIndex++) {
    const date = dates[dateIndex];
    const priorDates = dates.slice(0, dateIndex);
    const validationDates = new Set(priorDates.slice(-5));
    const fitRows = rows.filter((row) => priorDates.includes(row.slateDate) && !validationDates.has(row.slateDate));
    const validationRows = rows.filter((row) => validationDates.has(row.slateDate));
    const allPriorRows = rows.filter((row) => priorDates.includes(row.slateDate));
    const dayRows = rows.filter((row) => row.slateDate === date);
    if (fitRows.length < 80 || validationRows.length < 20 || !dayRows.length) continue;
    const fitted = Object.fromEntries(Object.entries(architectures).map(([name, feature]) => [name, fit(fitRows, feature, 12, 400)]));
    const selectedName = Object.entries(fitted)
      .map(([name, model]) => [name, metrics(validationRows, model.predict).brier])
      .sort((left, right) => left[1] - right[1])[0][0];
    architectureCounts[selectedName] = (architectureCounts[selectedName] ?? 0) + 1;
    const refit = fit(allPriorRows, architectures[selectedName], 12, 400);
    selections.push(...selectDaily(dayRows, refit, 1, true, pool).map((row) => ({ ...row, selectedArchitecture: selectedName })));
  }
  return {
    metrics: metrics(selections),
    clusteredBootstrap: clusteredBootstrap(selections),
    architectureCounts,
    rows: selections.map((row) => ({ ...compactCandidate(row), selectedArchitecture: row.selectedArchitecture })),
  };
}

const files = (await readdir(AUDIT_DIR)).filter((name) => /^cache-prediction-records-mlb-.*\.json$/.test(name));
const byId = new Map();
for (const file of files) {
  const rows = JSON.parse(await readFile(`${AUDIT_DIR}/${file}`, "utf8"));
  for (const row of rows) byId.set(row.id, row);
}
const reconstructed = JSON.parse(await readFile(`${AUDIT_DIR}/deep-market-history-reconstructed-rows-2026-08-11.json`, "utf8"));
const outcomes = new Map(reconstructed.map((row) => [row.id, row.result]));
const currentHeadRecords = [...byId.values()].filter((row) => {
  const head = row.snapshot_json?.model_layer_versions?.active_probability_head;
  return !(
    row.market !== "moneyline" || head !== MONEYLINE_HEAD || row.launch_day === true ||
    row.no_bet === true || row.held === true || !Number.isFinite(row.model_probability)
  );
});
const rows = currentHeadRecords
  .flatMap((row) => candidateRows(row, outcomes))
  .sort((left, right) => left.slateDate.localeCompare(right.slateDate) || left.recordId - right.recordId || left.side.localeCompare(right.side));

const train = rows.filter((row) => row.slateDate <= "2026-07-27");
const validation = rows.filter((row) => row.slateDate >= "2026-07-28" && row.slateDate <= "2026-08-02");
const holdout = rows.filter((row) => row.slateDate >= "2026-08-03");
const models = Object.fromEntries(Object.entries(architectures).map(([name, feature]) => [name, fit(train, feature)]));
const architectureResults = Object.fromEntries(Object.entries(models).map(([name, model]) => [name, {
  train: metrics(train, model.predict),
  validation: metrics(validation, model.predict),
  holdout: metrics(holdout, model.predict),
}]));
const selectedArchitecture = Object.entries(architectureResults)
  .sort((left, right) => left[1].validation.brier - right[1].validation.brier)[0][0];
const selectedModel = models[selectedArchitecture];

const selectionResults = {};
for (const limit of [1, 2, 3]) {
  selectionResults[`top${limit}`] = {};
  for (const incrementalOnly of [false, true]) {
    const label = incrementalOnly ? "incrementalNonactionable" : "allGames";
    selectionResults[`top${limit}`][label] = Object.fromEntries([
      ["train", train], ["validation", validation], ["holdout", holdout],
    ].map(([split, values]) => [split, metrics(selectDaily(values, selectedModel, limit, incrementalOnly))]));
  }
}

const fixedPoolArchitectureResults = Object.fromEntries(Object.entries(models).map(([name, model]) => [
  name,
  Object.fromEntries(["allSides", "pipelineSide", "marketAligned", "pipelineMarketAligned"].map((pool) => [
    pool,
    Object.fromEntries([
      ["train", train], ["validation", validation], ["holdout", holdout],
    ].map(([split, values]) => [split, metrics(selectDaily(values, model, 1, true, pool))])),
  ])),
]));

const holdoutTopOne = selectDaily(holdout, selectedModel, 1, true).map((row) => ({
  date: row.slateDate,
  recordId: row.recordId,
  gameId: row.gameId,
  side: row.side,
  price: row.odds,
  marketP: +row.marketP.toFixed(4),
  modelP: +row.modelP.toFixed(4),
  learnedP: +row.prediction.toFixed(4),
  learnedEdgePp: +(100 * row.learnedEdge).toFixed(2),
  sharp: row.sharp,
  public: row.public,
  movement: row.movement,
  projectionGap: +row.projectionGap.toFixed(3),
  pipelineSide: row.isPipelineSide,
  result: row.result,
}));

const marketProjectionAlignedModel = models.market_plus_projection;
const marketProjectionAlignedRows = {
  train: selectDaily(train, marketProjectionAlignedModel, 1, true, "marketAligned"),
  validation: selectDaily(validation, marketProjectionAlignedModel, 1, true, "marketAligned"),
  holdout: selectDaily(holdout, marketProjectionAlignedModel, 1, true, "marketAligned"),
};
const marketProjectionAlignedAll = Object.values(marketProjectionAlignedRows).flat();
const marketProjectionAlignedScoredPool = rows
  .filter((row) => !row.gameHasAction && candidatePool(row, "marketAligned"))
  .map((row) => ({ ...row, prediction: marketProjectionAlignedModel.predict(row) }))
  .map((row) => ({ ...row, learnedEdge: row.prediction - row.breakEven }))
  .filter((row) => row.learnedEdge >= 0);
const marketProjectionAlignedSensitivity = Object.fromEntries([1, 2, 3].map((limit) => {
  const splitRows = {
    train: selectDaily(train, marketProjectionAlignedModel, limit, true, "marketAligned"),
    validation: selectDaily(validation, marketProjectionAlignedModel, limit, true, "marketAligned"),
    holdout: selectDaily(holdout, marketProjectionAlignedModel, limit, true, "marketAligned"),
  };
  const combined = Object.values(splitRows).flat();
  return [`top${limit}`, {
    metrics: Object.fromEntries(Object.entries(splitRows).map(([split, values]) => [split, metrics(values)])),
    combined: metrics(combined),
    clusteredBootstrap: clusteredBootstrap(combined),
  }];
}));
const compactCandidate = (row) => ({
  date: row.slateDate,
  recordId: row.recordId,
  gameId: row.gameId,
  side: row.side,
  price: row.odds,
  marketP: +row.marketP.toFixed(4),
  modelP: +row.modelP.toFixed(4),
  learnedP: +row.prediction.toFixed(4),
  learnedEdgePp: +(100 * row.learnedEdge).toFixed(2),
  sharp: row.sharp,
  public: row.public,
  movement: row.movement,
  projectionGap: +row.projectionGap.toFixed(3),
  pipelineSide: row.isPipelineSide,
  result: row.result,
});

const output = {
  generatedAt: new Date().toISOString(),
  databaseWrites: false,
  policy: {
    train: "through 2026-07-27",
    validation: "2026-07-28..2026-08-02",
    untouchedHoldout: "2026-08-03..latest settled",
    architectureSelection: "lowest validation Brier; holdout never selects architecture",
    candidateUniverse: "both real priced moneyline sides reconstructed from frozen lines_at_lock with Playbook and SharpAPI evidence",
    priceRange: [MIN_PRICE, MAX_PRICE],
  },
  universe: { train: train.length, validation: validation.length, holdout: holdout.length },
  coverageFunnel: {
    settledCurrentHeadGameRecords: currentHeadRecords.length,
    reconstructedPricedSideCandidates: rows.length,
    reconstructedGames: new Set(rows.map((row) => row.gameId)).size,
    reconstructedDates: new Set(rows.map((row) => row.slateDate)).size,
    incrementalMarketAlignedPositiveEdgeSides: marketProjectionAlignedScoredPool.length,
    incrementalMarketAlignedPositiveEdgeGames: new Set(marketProjectionAlignedScoredPool.map((row) => row.gameId)).size,
    incrementalMarketAlignedPositiveEdgeDates: new Set(marketProjectionAlignedScoredPool.map((row) => row.slateDate)).size,
    topOneSelections: marketProjectionAlignedAll.length,
  },
  architectureResults,
  selectedArchitecture,
  selectionResults,
  fixedPoolArchitectureResults,
  holdoutTopOne,
  marketProjectionAlignedCandidate: {
    status: "research_only_multiple_candidates_examined",
    metrics: Object.fromEntries(Object.entries(marketProjectionAlignedRows).map(([split, values]) => [split, metrics(values)])),
    combined: metrics(marketProjectionAlignedAll),
    clusteredBootstrap: clusteredBootstrap(marketProjectionAlignedAll),
    pipelineSideCount: marketProjectionAlignedAll.filter((row) => row.isPipelineSide).length,
    oppositeSideCount: marketProjectionAlignedAll.filter((row) => !row.isPipelineSide).length,
    rows: Object.fromEntries(Object.entries(marketProjectionAlignedRows).map(([split, values]) => [split, values.map(compactCandidate)])),
  },
  marketProjectionAlignedSensitivity,
  nestedWalkForward: {
    marketAligned: nestedWalkForward("marketAligned"),
    pipelineMarketAligned: nestedWalkForward("pipelineMarketAligned"),
  },
};
await writeFile(OUTPUT, JSON.stringify(output, null, 2));
console.log(JSON.stringify({ output: OUTPUT, ...output }, null, 2));
