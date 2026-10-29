/** Private, read-only CBB calibration falsification. No writer or grade authority. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cbbImpliedProbability } from "../../lib/cbb/marketEvidence";
import { cbbThresholdProbabilities, normalCdf, settleCbbMarket } from "../../lib/cbb/model";
import type { CbbForecast, CbbMarket, CbbQuote, CbbTrainingGame } from "../../lib/cbb/types";

type Row = { game: CbbTrainingGame; forecast: CbbForecast; targets: CbbQuote[];
  context: { centers: Record<CbbMarket, number[]> } };
type Sample = { date: string; actualFirst: number; priceFirst: number; priceSecond: number;
  modelFirst: number; marketFirst: number; referenceFirst: number | null; push: boolean };
const dir = resolve(process.argv.find(arg => arg.startsWith("--data="))?.slice(7) ?? "/private/tmp/oddsphere-cbb-data");
const rows = JSON.parse(readFileSync(resolve(dir, "market-reader-feature-rows.json"), "utf8")) as Row[];
if (rows.length !== 353 || new Set(rows.map(r => r.game.id)).size !== rows.length)
  throw new Error("CBB opening cohort changed; requalify audit");
const markets: CbbMarket[] = ["moneyline", "spread", "total"];
const clipped = (p: number) => Math.max(0.001, Math.min(0.999, p));
const logit = (p: number) => Math.log(clipped(p) / (1 - clipped(p)));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, x))));
const median = (a: number[]) => { const b = [...a].sort((x, y) => x - y), i = Math.floor(b.length / 2);
  return b.length % 2 ? b[i] : (b[i - 1] + b[i]) / 2; };
const profit = (price: number) => price > 0 ? price / 100 : 100 / -price;
const probability = (forecast: CbbForecast, market: CbbMarket, line: number | null) => {
  const p = cbbThresholdProbabilities(forecast, market, line);
  return p.first / (p.first + p.second);
};
function sample(row: Row, market: CbbMarket): Sample {
  const q = row.targets.find(t => t.market === market);
  if (!q || q.gameId !== row.game.id || Date.parse(q.providerObservedAt) > Date.parse(row.forecast.asOf))
    throw new Error(`missing or future exact ${market} target for ${row.game.id}`);
  const centers = row.context.centers[market];
  let referenceFirst: number | null = null;
  if (centers.length) {
    const center = median(centers);
    const sd = row.forecast.uncertainty.marginSd;
    const zero = normalCdf((0.5 - center) / sd) - normalCdf((-0.5 - center) / sd);
    const reference = { ...row.forecast, ...(market === "total" ? { total: center } : { margin: center,
      homeWinProbability: (1 - normalCdf((0.5 - center) / sd)) / (1 - zero) }) };
    referenceFirst = probability(reference, market, q.line);
  }
  const actual = settleCbbMarket(market, "first", q.line, row.game.homeScore, row.game.awayScore);
  const impliedFirst = cbbImpliedProbability(q.firstPrice);
  const impliedSecond = cbbImpliedProbability(q.secondPrice);
  return { date: row.game.date.slice(0, 10), actualFirst: actual === "win" ? 1 : 0,
    push: actual === "push", priceFirst: q.firstPrice, priceSecond: q.secondPrice,
    modelFirst: probability(row.forecast, market, q.line),
    marketFirst: impliedFirst / (impliedFirst + impliedSecond), referenceFirst };
}
// A single predeclared ridge-logistic residual model per market. The target-book-excluded
// reference is the offset; target fair price is the fallback only when no reference exists.
// No parameter search or outcome-based threshold choice on selection/later blocks.
function features(s: Sample) {
  const offset = s.referenceFirst ?? s.marketFirst;
  return { offset: logit(offset), x: [1, logit(s.modelFirst) - logit(offset),
    logit(s.marketFirst) - logit(offset), Number(s.referenceFirst === null)] };
}
function fit(samples: Sample[]) {
  const beta = [0, 0, 0, 0];
  const penalty = 20;
  for (let iteration = 0; iteration < 1200; iteration++) {
    const gradient = beta.map((b, i) => i === 0 ? 0 : penalty * b / samples.length);
    for (const s of samples) {
      if (s.push) continue;
      const f = features(s), p = sigmoid(f.offset + f.x.reduce((sum, x, i) => sum + x * beta[i], 0));
      f.x.forEach((x, i) => { gradient[i] += (p - s.actualFirst) * x / samples.length; });
    }
    beta.forEach((_, i) => { beta[i] -= 0.03 * gradient[i]; });
  }
  return beta;
}
function predict(s: Sample, beta: number[]) {
  const f = features(s);
  return sigmoid(f.offset + f.x.reduce((sum, x, i) => sum + x * beta[i], 0));
}
function scoring(samples: Sample[], getP: (s: Sample) => number) {
  const settled = samples.filter(s => !s.push);
  const losses = settled.map(s => { const p = clipped(getP(s)); return {
    brier: (p - s.actualFirst) ** 2,
    logLoss: -(s.actualFirst ? Math.log(p) : Math.log(1 - p)),
    correct: Number((p >= 0.5) === Boolean(s.actualFirst)),
  }; });
  return { n: settled.length,
    brier: Number((losses.reduce((a, b) => a + b.brier, 0) / losses.length).toFixed(4)),
    logLoss: Number((losses.reduce((a, b) => a + b.logLoss, 0) / losses.length).toFixed(4)),
    sideCorrect: losses.reduce((a, b) => a + b.correct, 0) };
}
function lane(samples: Sample[], getP: (s: Sample) => number, minEv: number, bestCut: number, market: CbbMarket) {
  const stats = { bets: 0, wins: 0, losses: 0, pushes: 0, units: 0, gameDays: new Set<string>() };
  const grades = { best: { ...stats, gameDays: new Set<string>() }, lean: { ...stats, gameDays: new Set<string>() }, remainder: { ...stats, gameDays: new Set<string>() } };
  let flips = 0, flipWins = 0, flipHarms = 0;
  for (const s of samples) {
    const p = getP(s), sideFirst = p >= 0.5, modelFirst = s.modelFirst >= 0.5;
    const price = sideFirst ? s.priceFirst : s.priceSecond;
    const ev = (sideFirst ? p : 1 - p) * profit(price) - (sideFirst ? 1 - p : p);
    // Price economics and directional confidence are distinct. The -350 moneyline
    // ceiling is an audit lane, not an endorsed product rule or forced daily quota.
    const eligible = market !== "moneyline" || price >= -350;
    const grade = eligible && ev >= bestCut ? "best" : eligible && ev >= minEv ? "lean" : "remainder";
    const g = grades[grade]; g.bets++; g.gameDays.add(s.date);
    if (s.push) { g.pushes++; continue; }
    const won = sideFirst === Boolean(s.actualFirst);
    if (won) { g.wins++; g.units += profit(price); } else { g.losses++; g.units--; }
    if (sideFirst !== modelFirst) { flips++; if (won) flipWins++; else flipHarms++; }
  }
  return { ...Object.fromEntries(Object.entries(grades).map(([name, g]) => [name, {
    bets: g.bets, wins: g.wins, losses: g.losses, pushes: g.pushes,
    units: Number(g.units.toFixed(2)), gameDaysWithPick: g.gameDays.size }])),
    flips, flipWins, flipHarms };
}
const report: Record<string, unknown> = { scope: "private_opened_exact_opening_quotes", productionWrites: 0,
  decision: "diagnostic_only_not_a_live_score_or_grade_policy", training: "early_151_two_dates_only",
  limitations: ["opened retrospective data; no untouched holdout", "opening prices only; no movement or splits",
    "market-specific probabilities are not yet a coherent score projection", "two training dates make reliability fragile"] };
for (const market of markets) {
  const samples = rows.map(r => sample(r, market));
  const early = samples.filter(s => s.date < "2026-02-15");
  const beta = fit(early);
  const earlyEv = early.map(s => {
    const p = predict(s, beta), sideFirst = p >= 0.5, price = sideFirst ? s.priceFirst : s.priceSecond;
    return (sideFirst ? p : 1 - p) * profit(price) - (sideFirst ? 1 - p : p);
  }).sort((a, b) => a - b);
  const bestCut = Math.max(0, earlyEv[Math.floor(earlyEv.length * 2 / 3)]);
  const periods = { early, selection: samples.filter(s => s.date >= "2026-02-21" && s.date < "2026-03-01"),
    later: samples.filter(s => s.date >= "2026-03-01") };
  report[market] = { coefficients: beta.map(x => Number(x.toFixed(4))), earlyBestCut: Number(bestCut.toFixed(4)),
    periods: Object.fromEntries(Object.entries(periods).map(([name, block]) => [name, {
      rawModel: scoring(block, s => s.modelFirst), targetBookFair: scoring(block, s => s.marketFirst),
      referenceFairOrTargetFallback: scoring(block, s => s.referenceFirst ?? s.marketFirst),
      calibrated: scoring(block, s => predict(s, beta)),
      provisionalLanes: lane(block, s => predict(s, beta), 0, bestCut, market),
    }])) };
}
console.log(JSON.stringify(report, null, 2));
