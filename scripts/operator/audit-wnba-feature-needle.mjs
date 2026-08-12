/**
 * READ ONLY. Exhaustive interpretable WNBA promotion-pool feature audit.
 * Uses immutable locked/settled rows from the lifetime methodology artifact.
 */
import { readFile, writeFile } from "node:fs/promises";

const INPUT = "/tmp/oddsphere-audit/lifetime-mlb-wnba-methodology-2026-08-09.json";
const OUTPUT = "/tmp/oddsphere-audit/wnba-feature-needle-2026-08-12.json";
const artifact = JSON.parse(await readFile(INPUT, "utf8"));

const profit = (row) => row.result === "push" ? 0 : row.result === "loss" ? -1
  : row.price > 0 ? row.price / 100 : 100 / Math.abs(row.price);
function metrics(rows) {
  const priced = rows.filter((row) => Number.isFinite(row.price));
  const wins = priced.filter((row) => row.result === "win").length;
  const losses = priced.filter((row) => row.result === "loss").length;
  const pushes = priced.filter((row) => row.result === "push").length;
  const units = priced.reduce((sum, row) => sum + profit(row), 0);
  return {
    n: priced.length,
    dates: new Set(priced.map((row) => row.date)).size,
    record: `${wins}-${losses}${pushes ? `-${pushes}` : ""}`,
    units: +units.toFixed(3),
    roiPct: priced.length ? +(100 * units / priced.length).toFixed(1) : null,
  };
}
function partitions(rows) {
  const dates = [...new Set(rows.map((row) => row.date))].sort();
  const a = Math.floor(dates.length * 0.6), b = Math.floor(dates.length * 0.8);
  const train = new Set(dates.slice(0, a)), validation = new Set(dates.slice(a, b));
  return {
    boundaries: { dates: dates.length, train: [dates[0], dates[a - 1]], validation: [dates[a], dates[b - 1]], holdout: [dates[b], dates.at(-1)] },
    train: rows.filter((row) => train.has(row.date)),
    validation: rows.filter((row) => validation.has(row.date)),
    holdout: rows.filter((row) => !train.has(row.date) && !validation.has(row.date)),
  };
}
function bootstrap(rows, iterations = 10000) {
  const groups = [...Map.groupBy(rows, (row) => row.date).values()];
  if (!groups.length) return null;
  let state = 0x45d9f3b;
  const random = () => ((state = Math.imul(state ^ (state >>> 16), 0x45d9f3b)) >>> 0) / 4294967296;
  const rois = [];
  for (let i = 0; i < iterations; i++) {
    const sample = [];
    for (let j = 0; j < groups.length; j++) sample.push(...groups[Math.floor(random() * groups.length)]);
    rois.push(100 * sample.reduce((sum, row) => sum + profit(row), 0) / sample.length);
  }
  rois.sort((a, b) => a - b);
  return {
    p05: +rois[Math.floor(iterations * 0.05)].toFixed(1),
    median: +rois[Math.floor(iterations * 0.5)].toFixed(1),
    probabilityPositive: +(rois.filter((value) => value > 0).length / iterations).toFixed(4),
  };
}
const atom = (id, kind, test) => ({ id, kind, test });
function projectionGap(row) {
  if (!Number.isFinite(row.line)) return null;
  if (row.market === "total" && Number.isFinite(row.projection?.total)) return row.side === "over" ? row.projection.total - row.line : row.line - row.projection.total;
  if (row.market === "spread" && Number.isFinite(row.projection?.margin)) return (row.side === "home" ? row.projection.margin : -row.projection.margin) + row.line;
  return null;
}
function definitions(market) {
  const common = [
    atom("price_gte_-160", "price", (r) => r.price >= -160),
    atom("price_gte_-130", "price", (r) => r.price >= -130),
    atom("plus_price", "price", (r) => r.price >= 100),
    atom("prob_lt_55", "probability", (r) => r.probability < 0.55),
    atom("prob_55_to_60", "probability", (r) => r.probability >= 0.55 && r.probability < 0.60),
    atom("prob_gte_60", "probability", (r) => r.probability >= 0.60),
    atom("market_weight_lt_50", "marketWeight", (r) => r.features?.marketWeight < 0.5),
    atom("market_weight_lte_40", "marketWeight", (r) => r.features?.marketWeight <= 0.4),
    atom("books_gte_10", "books", (r) => r.features?.bookCount >= 10),
    atom("books_gte_15", "books", (r) => r.features?.bookCount >= 15),
    atom("cold_start_false", "cold", (r) => r.features?.coldStart === false),
  ];
  if (market === "moneyline") return [...common,
    atom("home", "side", (r) => r.side === "home"), atom("away", "side", (r) => r.side === "away"),
    atom("favorite", "favorite", (r) => r.price < 0), atom("underdog", "favorite", (r) => r.price > 0),
  ];
  if (market === "total") return [...common,
    atom("over", "side", (r) => r.side === "over"), atom("under", "side", (r) => r.side === "under"),
    atom("projection_gap_gt_0", "projection", (r) => projectionGap(r) > 0),
    atom("projection_gap_gte_3", "projection", (r) => projectionGap(r) >= 3),
    atom("dispersion_lt_1", "dispersion", (r) => r.features?.dispersion < 1),
    atom("dispersion_gte_1", "dispersion", (r) => r.features?.dispersion >= 1),
  ];
  return [...common,
    atom("home", "side", (r) => r.side === "home"), atom("away", "side", (r) => r.side === "away"),
    atom("projection_gap_gt_0", "projection", (r) => projectionGap(r) > 0),
    atom("projection_gap_gte_2", "projection", (r) => projectionGap(r) >= 2),
    atom("elo_stat_gap_lt_3", "eloStat", (r) => r.features?.eloStatGap < 3),
    atom("elo_stat_gap_lt_5", "eloStat", (r) => r.features?.eloStatGap < 5),
    atom("rest_with_pick", "rest", (r) => Number.isFinite(r.features?.restDifference) && (r.side === "home" ? r.features.restDifference > 0 : r.features.restDifference < 0)),
    atom("rest_not_against", "rest", (r) => !Number.isFinite(r.features?.restDifference) || (r.side === "home" ? r.features.restDifference >= 0 : r.features.restDifference <= 0)),
    atom("public_no_resistance", "public", (r) => r.features?.publicAdjustment === "none"),
  ];
}
function combinations(values) {
  const out = values.map((value) => [value]);
  for (let i = 0; i < values.length; i++) for (let j = i + 1; j < values.length; j++) {
    if (values[i].kind !== values[j].kind) out.push([values[i], values[j]]);
    for (let k = j + 1; k < values.length; k++) {
      if (new Set([values[i].kind, values[j].kind, values[k].kind]).size === 3) out.push([values[i], values[j], values[k]]);
    }
  }
  return out;
}

function byField(rows, field) {
  return Object.fromEntries([...Map.groupBy(rows, (row) => row[field] ?? "missing").entries()]
    .map(([value, group]) => [value, metrics(group)]));
}

function diagnostic(rows, test) {
  const matched = rows.filter(test);
  const split = partitions(rows);
  return {
    results: metrics(matched),
    chronology: {
      boundaries: split.boundaries,
      train: metrics(matched.filter((row) => split.train.includes(row))),
      validation: metrics(matched.filter((row) => split.validation.includes(row))),
      holdout: metrics(matched.filter((row) => split.holdout.includes(row))),
    },
    bootstrap: bootstrap(matched),
    byProjectionEra: byField(matched, "projectionEra"),
    byDecisionEra: byField(matched, "decisionEra"),
    rowIds: matched.map((row) => row.id),
  };
}

const all = artifact.analysisRows.filter((row) => row.sport === "wnba" && ["win", "loss", "push"].includes(row.result) && Number.isFinite(row.price));
const output = { generatedAt: new Date().toISOString(), databaseWrites: false, markets: {} };
for (const market of ["moneyline", "total", "spread"]) {
  const universe = all.filter((row) => row.market === market);
  const pool = universe.filter((row) => !row.actionable && !row.noBet);
  const split = partitions(pool);
  const seen = new Set(), candidates = [];
  for (const conditions of combinations(definitions(market))) {
    const matched = pool.filter((row) => conditions.every((condition) => condition.test(row)));
    const signature = matched.map((row) => row.id).sort().join(",");
    if (!signature || seen.has(signature)) continue;
    seen.add(signature);
    const train = matched.filter((row) => split.train.includes(row));
    const validation = matched.filter((row) => split.validation.includes(row));
    const holdout = matched.filter((row) => split.holdout.includes(row));
    if (train.length < 10 || validation.length < 5 || holdout.length < 5) continue;
    const t = metrics(train), v = metrics(validation), h = metrics(holdout);
    if (t.roiPct <= 0 || v.roiPct <= 0 || h.roiPct <= 0) continue;
    candidates.push({ id: conditions.map((c) => c.id).join("__"), train: t, validation: v, holdout: h, combined: metrics(matched), matched });
  }
  const ranked = candidates.sort((a, b) => b.combined.n - a.combined.n).slice(0, 100)
    .map((candidate) => ({ ...candidate, bootstrap: bootstrap(candidate.matched) }));
  output.markets[market] = {
    boundaries: split.boundaries,
    universe: metrics(universe), promotionPool: metrics(pool), uniqueRowSets: seen.size,
    positiveAllSegments: candidates.length,
    robust: ranked.filter((candidate) => candidate.bootstrap.p05 > 0).map(({ matched, ...rest }) => rest),
    largestPositiveAllSegments: ranked.slice(0, 30).map(({ matched, ...rest }) => rest),
  };
}
const totalPool = all.filter((row) => row.market === "total" && !row.actionable && !row.noBet);
const spreadPool = all.filter((row) => row.market === "spread" && !row.actionable && !row.noBet);
const liveSpreadAgreement = (row) => row.grade === "watchlist" && row.side === "home" &&
  row.price != null && row.features?.eloStatGap < 3 && row.features?.bookCount >= 10 &&
  row.features?.publicAdjustment === "none";
const spreadHomeProjection = (row) => row.price >= -160 && row.side === "home" && projectionGap(row) > 0;
const spreadProjectionRest = (row) => row.features?.bookCount >= 10 && projectionGap(row) > 0 &&
  row.grade === "watchlist" && row.features?.publicAdjustment === "none" &&
  (!Number.isFinite(row.features?.restDifference) || (row.side === "home" ? row.features.restDifference >= 0 : row.features.restDifference <= 0));
output.namedDiagnostics = {
  totalLowMarketWeightOver: diagnostic(totalPool, (row) => row.price >= -160 && row.features?.marketWeight < 0.5 && row.side === "over"),
  spreadLiveAgreement: diagnostic(spreadPool, liveSpreadAgreement),
  spreadHomeProjection: diagnostic(spreadPool, spreadHomeProjection),
  spreadProjectionRest: diagnostic(spreadPool, spreadProjectionRest),
  overlaps: {
    liveAgreementAndHomeProjection: metrics(spreadPool.filter((row) => liveSpreadAgreement(row) && spreadHomeProjection(row))),
    homeProjectionOutsideLiveAgreement: metrics(spreadPool.filter((row) => spreadHomeProjection(row) && !liveSpreadAgreement(row))),
    projectionRestOutsideLiveAgreement: metrics(spreadPool.filter((row) => spreadProjectionRest(row) && !liveSpreadAgreement(row))),
  },
};
await writeFile(OUTPUT, JSON.stringify(output, null, 2));
console.log(JSON.stringify({ output: OUTPUT, summary: Object.fromEntries(Object.entries(output.markets).map(([market, value]) => [market, { universe: value.universe, promotionPool: value.promotionPool, uniqueRowSets: value.uniqueRowSets, positiveAllSegments: value.positiveAllSegments, robust: value.robust.length }])) }, null, 2));
