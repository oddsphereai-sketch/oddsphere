/** Private grade-outcome calibration; never changes a pick, score, grade or stake. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cbbImpliedProbability, reviewCbbQuote } from "../../lib/cbb/marketEvidence";
import { cbbThresholdProbabilities, normalCdf, settleCbbMarket } from "../../lib/cbb/model";
import type { CbbForecast, CbbMarket, CbbQuote, CbbTrainingGame } from "../../lib/cbb/types";

type Row = { game: CbbTrainingGame; forecast: CbbForecast; targets: CbbQuote[];
  context: { centers: Record<CbbMarket, number[]> } };
type SourceRow = Row & { source: "baseline" | "added" | "weekdays" | "saturation" };
type Sample = { date: string; source: SourceRow["source"]; won: boolean; push: boolean; price: number;
  modelP: number; targetFairP: number; referenceP: number | null };
const dir = resolve(process.argv.find(arg => arg.startsWith("--data="))?.slice(7) ?? "/private/tmp/oddsphere-cbb-data");
const files = ["market-reader-feature-rows.json", "date-diverse-feature-rows.json", "weekdays-feature-rows.json",
  "saturation-feature-rows.json"];
const rows = files.flatMap((file, i) => (JSON.parse(readFileSync(resolve(dir, file), "utf8")) as Row[])
  .map(row => ({ ...row, source: (["baseline", "added", "weekdays", "saturation"] as const)[i] })));
if (rows.length !== 1070 || new Set(rows.map(r => r.game.id)).size !== rows.length)
  throw new Error("CBB grade calibration cohort changed");
const median = (a: number[]) => { const b = [...a].sort((x, y) => x - y), i = Math.floor(b.length / 2);
  return b.length % 2 ? b[i] : (b[i - 1] + b[i]) / 2; };
const clamp = (p: number) => Math.max(0.001, Math.min(0.999, p));
const logit = (p: number) => Math.log(clamp(p) / (1 - clamp(p)));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, x))));
const profit = (price: number) => price > 0 ? price / 100 : 100 / -price;
function sample(row: SourceRow, market: CbbMarket): Sample {
  const q = row.targets.find(item => item.market === market);
  if (!q || q.gameId !== row.game.id || Date.parse(q.providerObservedAt) > Date.parse(row.forecast.asOf))
    throw new Error(`invalid CBB exact opening target ${row.game.id}/${market}`);
  const review = reviewCbbQuote(row.forecast, q), sideFirst = review.selection === "first";
  const price = sideFirst ? q.firstPrice : q.secondPrice;
  const targetFirst = cbbImpliedProbability(q.firstPrice), targetSecond = cbbImpliedProbability(q.secondPrice);
  const targetFairP = (sideFirst ? targetFirst : targetSecond) / (targetFirst + targetSecond);
  const modelP = review.probability / (1 - review.pushProbability);
  const centers = row.context.centers[market];
  let referenceP: number | null = null;
  if (centers.length) {
    const center = median(centers), sd = row.forecast.uncertainty.marginSd;
    const zero = normalCdf((0.5 - center) / sd) - normalCdf((-0.5 - center) / sd);
    const forecast = { ...row.forecast, ...(market === "total" ? { total: center } : { margin: center,
      homeWinProbability: (1 - normalCdf((0.5 - center) / sd)) / (1 - zero) }) };
    const p = cbbThresholdProbabilities(forecast, market, q.line);
    referenceP = (sideFirst ? p.first : p.second) / (p.first + p.second);
  }
  const result = settleCbbMarket(market, review.selection as "first" | "second", q.line, row.game.homeScore, row.game.awayScore);
  return { date: row.game.date.slice(0, 10), source: row.source, won: result === "win", push: result === "push",
    price, modelP, targetFairP, referenceP };
}
// Calibrate the existing forecast-selected side only. The target book is an economic
// comparator, not an authority to flip the side. Fixed ridge strength, no sweep.
function feature(s: Sample) { const base = logit(s.modelP); return [1, base,
  logit(s.targetFairP) - base, s.referenceP === null ? 0 : logit(s.referenceP) - base,
  Number(s.referenceP === null)]; }
function fit(samples: Sample[]) {
  const b = [0, 0, 0, 0, 0], penalty = 20;
  for (let iteration = 0; iteration < 1800; iteration++) {
    const gradient = b.map((v, i) => i === 0 ? 0 : penalty * v / samples.length);
    for (const s of samples) {
      if (s.push) continue;
      const x = feature(s), p = sigmoid(x.reduce((sum, value, i) => sum + value * b[i], 0));
      x.forEach((value, i) => { gradient[i] += (p - Number(s.won)) * value / samples.length; });
    }
    b.forEach((_, i) => { b[i] -= 0.02 * gradient[i]; });
  }
  return b;
}
const predict = (s: Sample, b: number[]) => sigmoid(feature(s).reduce((sum, value, i) => sum + value * b[i], 0));
function metrics(samples: Sample[], getP: (s: Sample) => number) {
  const settled = samples.filter(s => !s.push);
  return { bets: samples.length, wins: settled.filter(s => s.won).length,
    losses: settled.filter(s => !s.won).length, pushes: samples.length - settled.length,
    units: Number(settled.reduce((sum, s) => sum + (s.won ? profit(s.price) : -1), 0).toFixed(2)),
    brier: Number((settled.reduce((sum, s) => sum + (getP(s) - Number(s.won)) ** 2, 0) / Math.max(1, settled.length)).toFixed(4)),
    logLoss: Number((settled.reduce((sum, s) => { const p = clamp(getP(s));
      return sum - (s.won ? Math.log(p) : Math.log(1 - p)); }, 0) / Math.max(1, settled.length)).toFixed(4)),
    daysWithPick: new Set(samples.map(s => s.date)).size };
}
const markets: CbbMarket[] = ["moneyline", "spread", "total"];
const report: Record<string, unknown> = { scope: "private_1070_exact_opening_outcome_grade_calibration",
  productionWrites: 0, decision: "diagnostic_not_approved_grade_policy",
  caveat: "The early training dates and later blocks are retrospective; no untouched prospective locked record exists." };
const baselineTrainOnly = process.argv.includes("--train=baseline-early");
report.training = baselineTrainOnly ? "baseline_first_151_only" : "all_first_285";
for (const market of markets) {
  const samples = rows.map(r => sample(r, market));
  const early = samples.filter(s => s.date < "2026-02-15"),
    selection = samples.filter(s => s.date >= "2026-02-15" && s.date < "2026-03-01"),
    later = samples.filter(s => s.date >= "2026-03-01");
  const training = baselineTrainOnly ? early.filter(s => s.source === "baseline") : early;
  if (training.length !== (baselineTrainOnly ? 151 : 433)) throw new Error("CBB grade training block changed");
  const beta = fit(training);
  const ev = (s: Sample) => { const p = predict(s, beta); return p * profit(s.price) - (1 - p); };
  const rawEv = (s: Sample) => s.modelP * profit(s.price) - (1 - s.modelP);
  const earlyPositiveEv = training.map(ev).filter(v => v > 0).sort((a, b) => a - b);
  const earlyPositiveRawEv = training.map(rawEv).filter(v => v > 0).sort((a, b) => a - b);
  const earlyPositiveP = training.filter(s => ev(s) > 0).map(s => predict(s, beta)).sort((a, b) => a - b);
  const bestCut = earlyPositiveEv.length ? earlyPositiveEv[Math.floor(earlyPositiveEv.length / 2)] : Infinity;
  const rawBestCut = earlyPositiveRawEv.length ? earlyPositiveRawEv[Math.floor(earlyPositiveRawEv.length / 2)] : Infinity;
  const confidenceCut = earlyPositiveP.length ? earlyPositiveP[Math.floor(earlyPositiveP.length / 2)] : Infinity;
  report[market] = { coefficients: beta.map(v => Number(v.toFixed(4))), earlyPositiveEvCount: earlyPositiveEv.length,
    earlyBestEvCut: Number(bestCut.toFixed(4)), earlyRawBestEvCut: Number(rawBestCut.toFixed(4)),
    earlyPositiveConfidenceMedian: Number(confidenceCut.toFixed(4)),
    byDate: Object.fromEntries([...new Set(samples.map(s => s.date))].sort().map(date => {
      const items = samples.filter(s => s.date === date && ev(s) > 0);
      return [date, { positiveValue: metrics(items, s => predict(s, beta)),
        corroboratedHighConfidence: metrics(items.filter(s => predict(s, beta) >= confidenceCut &&
          s.referenceP !== null && s.referenceP >= 0.5), s => predict(s, beta)) }];
    })),
    periods: Object.fromEntries(Object.entries({ early, selection, later,
      newlyCaptured: samples.filter(s => s.source !== "baseline"),
      weekdayOnly: samples.filter(s => s.source === "weekdays"),
      newMarchOnly: samples.filter(s => s.source !== "baseline" && s.date >= "2026-03-01"),
      saturationOnly: samples.filter(s => s.source === "saturation"),
      saturationMarch: samples.filter(s => s.source === "saturation" && s.date >= "2026-03-01") }).map(([name, block]) => [name, {
      all: metrics(block, s => predict(s, beta)), rawModel: metrics(block, s => s.modelP),
      best: metrics(block.filter(s => ev(s) >= bestCut), s => predict(s, beta)),
      lean: metrics(block.filter(s => ev(s) > 0 && ev(s) < bestCut), s => predict(s, beta)),
      remainder: metrics(block.filter(s => ev(s) <= 0), s => predict(s, beta)),
      rawBest: metrics(block.filter(s => rawEv(s) >= rawBestCut), s => s.modelP),
      rawLean: metrics(block.filter(s => rawEv(s) > 0 && rawEv(s) < rawBestCut), s => s.modelP),
      positiveEvReferenceAgrees: metrics(block.filter(s => ev(s) > 0 && s.referenceP !== null && s.referenceP >= 0.5),
        s => predict(s, beta)),
      positiveEvReferenceOpposes: metrics(block.filter(s => ev(s) > 0 && s.referenceP !== null && s.referenceP < 0.5),
        s => predict(s, beta)),
      confidenceBest: metrics(block.filter(s => ev(s) > 0 && predict(s, beta) >= confidenceCut), s => predict(s, beta)),
      confidenceLean: metrics(block.filter(s => ev(s) > 0 && predict(s, beta) < confidenceCut), s => predict(s, beta)),
      corroboratedHighConfidence: metrics(block.filter(s => ev(s) > 0 && predict(s, beta) >= confidenceCut &&
        s.referenceP !== null && s.referenceP >= 0.5), s => predict(s, beta)),
      otherPositiveValue: metrics(block.filter(s => ev(s) > 0 && !(predict(s, beta) >= confidenceCut &&
        s.referenceP !== null && s.referenceP >= 0.5)), s => predict(s, beta)),
    }])) };
}
console.log(JSON.stringify(report, null, 2));
