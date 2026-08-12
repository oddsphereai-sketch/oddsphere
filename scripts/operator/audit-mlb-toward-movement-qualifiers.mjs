/** READ ONLY. Search interpretable Lean qualifiers inside MLB ML movement-toward Watchlists. */
import { readdir, readFile, writeFile } from "node:fs/promises";

const DIR = "/tmp/oddsphere-audit";
const OUTPUT = `${DIR}/mlb-toward-movement-qualifiers-2026-08-12.json`;
const RANKER_OUTPUT = `${DIR}/mlb-cross-market-portfolio-ranker-2026-08-11.json`;
const HEAD = "mlb_moneyline_regularized_k01_cap6_champion_guardrails_2026_07_11";
const pct = (value) => Number.isFinite(value) ? Math.round(value <= 1 ? value * 100 : value) : null;
const implied = (odds) => odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
const profit = (row) => row.result === "loss" ? -1 : row.odds > 0 ? row.odds / 100 : 100 / Math.abs(row.odds);

function split(row) {
  const hit = (row.snapshot_json?.source_aware_split_rows_at_lock ?? []).find((item) =>
    item.market_type === "moneyline" && item.provider === "sharpapi" &&
    String(item.selection_key ?? "").split(":").at(-1) === row.side);
  return { tickets: pct(hit?.bets_pct), money: pct(hit?.money_pct) };
}
function projection(row) {
  const snapshot = row.snapshot_json ?? {}, scores = snapshot.predicted_scores_at_lock ?? {}, audit = snapshot.v2_2_audit ?? {};
  const home = Number(scores.home ?? audit.posterior_home_runs ?? audit.projected_home_runs);
  const away = Number(scores.away ?? audit.posterior_away_runs ?? audit.projected_away_runs);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  return row.side === "home" ? home - away : away - home;
}
function features(row) {
  const s = split(row), movement = row.snapshot_json?.line_movement ?? {}, integrity = row.snapshot_json?.data_integrity ?? {};
  const decision = row.snapshot_json?.decision_pipeline ?? {};
  return {
    probability: row.model_probability,
    edge: row.model_probability - implied(row.odds),
    projection: projection(row),
    magnitude: Number(movement.magnitude_pp),
    tickets: s.tickets,
    money: s.money,
    gap: s.tickets === null || s.money === null ? null : s.money - s.tickets,
    side: row.side,
    favorite: row.odds < 0,
    highQuality: row.snapshot_json?.v2_data_quality_tier === "high",
    starterConfirmed: integrity.starter_confirmed === "yes",
    lineupConfirmed: integrity.lineup_confirmed === "yes",
    modelPreferredSide: row.model_probability >= .5,
    finalSideChanged: decision.final_side_changed === true,
  };
}
function metrics(rows) {
  const units = rows.reduce((sum, row) => sum + profit(row), 0), wins = rows.filter((row) => row.result === "win").length;
  return { n: rows.length, dates: new Set(rows.map((r) => r.slate_date)).size, record: `${wins}-${rows.length - wins}`, units: +units.toFixed(3), roiPct: rows.length ? +(100 * units / rows.length).toFixed(1) : null, winPct: rows.length ? +(100 * wins / rows.length).toFixed(1) : null };
}
function windows(rows) {
  return {
    all: metrics(rows),
    train: metrics(rows.filter((r) => r.slate_date <= "2026-07-27")),
    validation: metrics(rows.filter((r) => r.slate_date >= "2026-07-28" && r.slate_date <= "2026-08-02")),
    holdout: metrics(rows.filter((r) => r.slate_date >= "2026-08-03")),
  };
}
function thresholdSensitivity(rows) {
  return Array.from({ length: 21 }, (_, index) => .50 + index * .005).map((threshold) => ({
    threshold: +threshold.toFixed(3),
    ...windows(rows.filter((row) => row.f.probability >= threshold)),
  }));
}
function rollingThresholdReplay(rows) {
  const dates = [...new Set(rows.map((row) => row.slate_date))].sort();
  const thresholds = Array.from({ length: 21 }, (_, index) => .50 + index * .005);
  const selections = [];
  for (const date of dates) {
    const prior = rows.filter((row) => row.slate_date < date);
    if (prior.length < 25) continue;
    const eligible = thresholds.map((threshold) => {
      const sample = prior.filter((row) => row.f.probability >= threshold);
      return { threshold, sample, performance: metrics(sample) };
    }).filter((item) => item.sample.length >= 20);
    if (!eligible.length) continue;
    eligible.sort((a, b) => b.performance.roiPct - a.performance.roiPct || a.threshold - b.threshold);
    const chosen = eligible[0];
    for (const row of rows.filter((item) => item.slate_date === date && item.f.probability >= chosen.threshold)) {
      selections.push({ ...row, selectedThreshold: chosen.threshold });
    }
  }
  return {
    performance: metrics(selections),
    rows: selections.map((row) => ({ id: row.id, date: row.slate_date, threshold: row.selectedThreshold })),
    thresholdCounts: Object.fromEntries([...new Set(selections.map((row) => row.selectedThreshold))]
      .sort((a, b) => a - b)
      .map((threshold) => [threshold.toFixed(3), selections.filter((row) => row.selectedThreshold === threshold).length])),
  };
}
function marketLedSensitivity(rows) {
  const priceFloors = [-160, -150, -140, -130, -120, -110, 100];
  const movementFloors = [0, .5, 1, 1.5, 2, 3];
  return priceFloors.flatMap((priceFloor) => movementFloors.map((movementFloor) => {
    const sample = rows.filter((row) => row.odds >= priceFloor && row.f.magnitude >= movementFloor);
    return { priceFloor, movementFloor, ...windows(sample) };
  }));
}
function splitDiagnostics(rows) {
  const buckets = [
    ["tickets_lte_35", (row) => row.f.tickets !== null && row.f.tickets <= 35],
    ["tickets_36_to_50", (row) => row.f.tickets > 35 && row.f.tickets <= 50],
    ["tickets_gt_50", (row) => row.f.tickets > 50],
    ["money_lte_35", (row) => row.f.money !== null && row.f.money <= 35],
    ["money_36_to_50", (row) => row.f.money > 35 && row.f.money <= 50],
    ["money_gt_50", (row) => row.f.money > 50],
    ["gap_lte_minus10", (row) => row.f.gap !== null && row.f.gap <= -10],
    ["gap_minus10_to_0", (row) => row.f.gap > -10 && row.f.gap < 0],
    ["gap_0_to_10", (row) => row.f.gap >= 0 && row.f.gap < 10],
    ["gap_gte_10", (row) => row.f.gap >= 10],
  ];
  return buckets.map(([id, test]) => ({ id, ...windows(rows.filter(test)) }));
}
function gapSensitivity(rows) {
  return [-10, -5, 0, 5, 10, 15, 20].map((gapExclusive) => ({
    gapExclusive,
    ...windows(rows.filter((row) => row.f.gap !== null && row.f.gap < gapExclusive)),
  }));
}
function clusterBootstrap(rows, iterations = 10000) {
  const dates = [...new Set(rows.map((row) => row.slate_date))];
  const byDate = new Map(dates.map((date) => [date, rows.filter((row) => row.slate_date === date)]));
  let state = 0x5eed1234;
  const random = () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  const rois = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const sample = [];
    for (let index = 0; index < dates.length; index += 1) {
      sample.push(...byDate.get(dates[Math.floor(random() * dates.length)]));
    }
    rois.push(metrics(sample).roiPct);
  }
  rois.sort((a, b) => a - b);
  return {
    cluster: "slate_date",
    iterations,
    roiPct95: [rois[Math.floor(iterations * .025)], rois[Math.floor(iterations * .975)]],
  };
}
const atom = (id, kind, test) => ({ id, kind, test });
const atoms = [
  ...[.52,.54,.56,.58,.60].map((v) => atom(`prob_gte_${v*100}`, "prob", (r) => r.f.probability >= v)),
  ...[-200,-180,-160,-140,-120].map((v) => atom(`price_gte_${Math.abs(v)}`, "priceFloor", (r) => r.odds >= v)),
  atom("favorite", "priceSide", (r) => r.f.favorite), atom("underdog", "priceSide", (r) => !r.f.favorite),
  ...[0,.02,.04,.06,.08].map((v) => atom(`edge_gte_${Math.round(v*100)}`, "edge", (r) => r.f.edge >= v)),
  ...[1,2,3,5].map((v) => atom(`movement_gte_${v}pp`, "movement", (r) => r.f.magnitude >= v)),
  ...[35,45,50,60].map((v) => atom(`tickets_lte_${v}`, "tickets", (r) => r.f.tickets !== null && r.f.tickets <= v)),
  atom("gap_gte_0", "gap", (r) => r.f.gap !== null && r.f.gap >= 0),
  atom("gap_gte_5", "gap", (r) => r.f.gap !== null && r.f.gap >= 5),
  atom("gap_gte_10", "gap", (r) => r.f.gap !== null && r.f.gap >= 10),
  atom("gap_lte_minus5", "gap", (r) => r.f.gap !== null && r.f.gap <= -5),
  atom("projection_positive", "projection", (r) => r.f.projection > 0),
  atom("projection_gte_0_5", "projection", (r) => r.f.projection >= .5),
  atom("projection_gte_1", "projection", (r) => r.f.projection >= 1),
  atom("home", "side", (r) => r.f.side === "home"), atom("away", "side", (r) => r.f.side === "away"),
  atom("high_quality", "quality", (r) => r.f.highQuality),
  atom("starter_confirmed", "starter", (r) => r.f.starterConfirmed),
  atom("lineup_confirmed", "lineup", (r) => r.f.lineupConfirmed),
];
function combinations(values) {
  const out = values.map((v) => [v]);
  for (let i=0;i<values.length;i++) for(let j=i+1;j<values.length;j++) {
    if (values[i].kind !== values[j].kind) out.push([values[i],values[j]]);
    for(let k=j+1;k<values.length;k++) if(new Set([values[i].kind,values[j].kind,values[k].kind]).size===3) out.push([values[i],values[j],values[k]]);
  }
  return out;
}

const files = (await readdir(DIR)).filter((name) => /^cache-prediction-records-mlb-.*\.json$/.test(name));
const records = new Map(); for (const file of files) for (const row of JSON.parse(await readFile(`${DIR}/${file}`, "utf8"))) records.set(row.id,row);
const reconstructed = JSON.parse(await readFile(`${DIR}/deep-market-history-reconstructed-rows-2026-08-11.json`, "utf8"));
const outcomes = new Map(reconstructed.map((row) => [row.id,row.result]));
const base = [...records.values()].flatMap((row) => {
  const result=outcomes.get(row.id), movement=row.snapshot_json?.line_movement?.direction, head=row.snapshot_json?.model_layer_versions?.active_probability_head;
  const actionable=row.best_angle===true||row.play_grade==="lean";
  if(row.market!=="moneyline"||head!==HEAD||!["win","loss"].includes(result)||actionable||row.no_bet||row.held||movement!=="toward_pick"||!Number.isFinite(row.odds_american)||row.odds_american < -220||row.odds_american > 200||!Number.isFinite(row.model_probability)) return [];
  const enriched={...row,result,odds:row.odds_american}; return [{...enriched,f:features(enriched)}];
}).sort((a,b)=>a.slate_date.localeCompare(b.slate_date)||a.id-b.id);

const candidates=[], seen=new Set();
for(const conditions of combinations(atoms)) {
  const rows=base.filter((row)=>conditions.every((c)=>c.test(row))), signature=rows.map((r)=>r.id).sort().join(",");
  if(!signature||seen.has(signature)) continue; seen.add(signature);
  const w=windows(rows); if(w.train.n<8||w.validation.n<3||w.holdout.n<3||w.all.roiPct<=0) continue;
  candidates.push({id:conditions.map((c)=>c.id).join("__"),...w,averagePerDate:+(w.all.n/w.all.dates).toFixed(2),rowIds:rows.map((r)=>r.id)});
}
const robust=candidates.filter((c)=>c.train.roiPct>0&&c.validation.roiPct>0&&c.holdout.roiPct>0).sort((a,b)=>b.all.n-a.all.n||b.all.roiPct-a.all.roiPct);
const longRun=candidates.filter((c)=>c.all.n>=20&&c.all.roiPct>=8&&c.holdout.roiPct>=0).sort((a,b)=>b.all.roiPct-a.all.roiPct||b.all.n-a.all.n);
const highQuality = base.filter((row) => row.f.highQuality);
const marketLedCandidate = highQuality.filter((row) => row.odds >= -120 && row.f.magnitude >= 1);
let existingRankerIds = new Set();
try {
  const ranker = JSON.parse(await readFile(RANKER_OUTPUT, "utf8"));
  existingRankerIds = new Set(Object.values(ranker.markets?.moneyline?.rows ?? {}).flat().map((row) => row.id));
} catch {}
const comparisonRules = [
  { id: "high_quality_no_probability_cutoff", rows: highQuality },
  { id: "high_quality_model_preferred_side", rows: highQuality.filter((row) => row.f.modelPreferredSide) },
  { id: "high_quality_market_corrected_side", rows: highQuality.filter((row) => !row.f.modelPreferredSide) },
  { id: "high_quality_probability_gte_53", rows: highQuality.filter((row) => row.f.probability >= .53) },
  { id: "high_quality_probability_gte_53_gap_below20", rows: highQuality.filter((row) => row.f.probability >= .53 && row.f.gap !== null && row.f.gap < 20) },
  { id: "high_quality_probability_gte_53_price_gte_minus160_gap_below20", rows: highQuality.filter((row) => row.f.probability >= .53 && row.odds >= -160 && row.f.gap !== null && row.f.gap < 20) },
  { id: "high_quality_probability_gte_54", rows: highQuality.filter((row) => row.f.probability >= .54) },
  { id: "high_quality_price_gte_minus120_movement_gte_1pp", rows: highQuality.filter((row) => row.odds >= -120 && row.f.magnitude >= 1) },
  { id: "market_led_split_gap_below_10", rows: marketLedCandidate.filter((row) => row.f.gap !== null && row.f.gap < 10) },
  { id: "market_led_split_gap_gte_10", rows: marketLedCandidate.filter((row) => row.f.gap !== null && row.f.gap >= 10) },
  { id: "market_led_minus120_move1_gap_below20", rows: marketLedCandidate.filter((row) => row.f.gap !== null && row.f.gap < 20) },
  { id: "market_led_minus120_move1_gap_below20_probability_gte53", rows: marketLedCandidate.filter((row) => row.f.gap !== null && row.f.gap < 20 && row.f.probability >= .53) },
  { id: "tier_near_even_any_move_gap_below20_probability_gte53", rows: highQuality.filter((row) => row.odds >= -120 && row.f.gap !== null && row.f.gap < 20 && row.f.probability >= .53) },
  { id: "tier_heavy_price_move1_gap_below20_probability_gte53", rows: highQuality.filter((row) => row.odds < -120 && row.f.magnitude >= 1 && row.f.gap !== null && row.f.gap < 20 && row.f.probability >= .53) },
  { id: "tier_heavy_price_sub1move_gap_below20_probability_gte53", rows: highQuality.filter((row) => row.odds < -120 && row.f.magnitude < 1 && row.f.gap !== null && row.f.gap < 20 && row.f.probability >= .53) },
  { id: "market_led_minus130_move1_5_gap_below10", rows: highQuality.filter((row) => row.odds >= -130 && row.f.magnitude >= 1.5 && row.f.gap !== null && row.f.gap < 10) },
  { id: "market_led_minus130_move1_5_gap_below20", rows: highQuality.filter((row) => row.odds >= -130 && row.f.magnitude >= 1.5 && row.f.gap !== null && row.f.gap < 20) },
].map(({ id, rows }) => ({
  id,
  ...windows(rows),
  uncertainty: clusterBootstrap(rows),
  existingRankerOverlap: metrics(rows.filter((row) => existingRankerIds.has(row.id))),
  incrementalOutsideExistingRanker: windows(rows.filter((row) => !existingRankerIds.has(row.id))),
}));
const output={generatedAt:new Date().toISOString(),databaseWrites:false,base:windows(base),baseRows:base.map((row)=>({id:row.id,date:row.slate_date,odds:row.odds,result:row.result,probability:row.f.probability,edge:row.f.edge,magnitude:row.f.magnitude,highQuality:row.f.highQuality,side:row.side})),probabilityAudit:{highQualitySensitivity:thresholdSensitivity(highQuality),rollingPriorOnlySelection:rollingThresholdReplay(highQuality)},marketLedAudit:{sensitivity:marketLedSensitivity(highQuality),splitDiagnostics:splitDiagnostics(marketLedCandidate),gapSensitivity:gapSensitivity(marketLedCandidate)},existingRankerComparison:comparisonRules,uniqueRowSets:seen.size,positiveOverall:candidates.length,robust:robust.slice(0,100),longRun:longRun.slice(0,100)};
await writeFile(OUTPUT,JSON.stringify(output,null,2));
console.log(JSON.stringify({output,summary:{base:output.base,uniqueRowSets:output.uniqueRowSets,positiveOverall:output.positiveOverall,robust:output.robust.length,longRun:output.longRun.length},topRobust:output.robust.slice(0,12),topLongRun:output.longRun.slice(0,12)},null,2));
