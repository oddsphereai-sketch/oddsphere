/** Private exact-opening side comparison on the baseline plus predeclared added dates. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { reviewCbbQuote } from "../../lib/cbb/marketEvidence";
import { cbbThresholdProbabilities, normalCdf, settleCbbMarket } from "../../lib/cbb/model";
import { assertCbbR2ResearchCohort } from "../../lib/cbb/researchCohort";
import type { CbbForecast, CbbMarket, CbbQuote, CbbTrainingGame } from "../../lib/cbb/types";

type Row = { game: CbbTrainingGame; forecast: CbbForecast; targets: CbbQuote[];
  context: { centers: Record<CbbMarket, number[]> } };
type Sample = { date: string; source: "baseline" | "added" | "weekdays" | "saturation"; referenceBooks: number;
  model: "win" | "loss" | "push"; reference: "win" | "loss" | "push" | null;
  modelUnits: number; referenceUnits: number | null; flipped: boolean;
  modelError: number; referenceError: number | null };
const dir = resolve(process.argv.find(arg => arg.startsWith("--data="))?.slice(7) ?? "/private/tmp/oddsphere-cbb-data");
const read = (name: string) => JSON.parse(readFileSync(resolve(dir, name), "utf8")) as Row[];
const base = read("market-reader-feature-rows.json"), added = read("date-diverse-feature-rows.json"),
  weekdays = read("weekdays-feature-rows.json"), saturation = read("saturation-feature-rows.json");
assertCbbR2ResearchCohort([...base, ...added, ...weekdays, ...saturation]);
if (base.length !== 353 || added.length < 1 || weekdays.length < 1 || saturation.length < 1 ||
  new Set([...base, ...added, ...weekdays, ...saturation].map(r => r.game.id)).size !==
    base.length + added.length + weekdays.length + saturation.length)
  throw new Error("CBB combined exact-opening cohort invalid");
const markets: CbbMarket[] = ["moneyline", "spread", "total"];
const median = (values: number[]) => { const s = [...values].sort((a, b) => a - b), i = Math.floor(s.length / 2);
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2; };
const unit = (result: "win" | "loss" | "push", price: number) => result === "push" ? 0 :
  result === "loss" ? -1 : price > 0 ? price / 100 : 100 / -price;
function sample(row: Row, market: CbbMarket, source: Sample["source"]): Sample {
  const quote = row.targets.find(q => q.market === market);
  if (!quote || quote.gameId !== row.game.id || Date.parse(quote.providerObservedAt) > Date.parse(row.forecast.asOf))
    throw new Error(`invalid CBB exact pregame target: ${row.game.id}/${market}`);
  const modelSide = reviewCbbQuote(row.forecast, quote).selection as "first" | "second";
  const model = settleCbbMarket(market, modelSide, quote.line, row.game.homeScore, row.game.awayScore);
  const modelPrice = modelSide === "first" ? quote.firstPrice : quote.secondPrice;
  const centers = row.context.centers[market], center = centers.length ? median(centers) : null;
  let reference: Sample["reference"] = null, referenceUnits: number | null = null, flipped = false;
  if (center !== null) {
    const sd = row.forecast.uncertainty.marginSd;
    const zero = normalCdf((0.5 - center) / sd) - normalCdf((-0.5 - center) / sd);
    const forecast = { ...row.forecast, ...(market === "total" ? { total: center } : { margin: center,
      homeWinProbability: (1 - normalCdf((0.5 - center) / sd)) / (1 - zero) }) };
    const probabilities = cbbThresholdProbabilities(forecast, market, quote.line);
    const referenceSide = probabilities.first >= probabilities.second ? "first" : "second";
    flipped = referenceSide !== modelSide;
    reference = settleCbbMarket(market, referenceSide, quote.line, row.game.homeScore, row.game.awayScore);
    referenceUnits = unit(reference, referenceSide === "first" ? quote.firstPrice : quote.secondPrice);
  }
  const actual = market === "total" ? row.game.homeScore + row.game.awayScore : row.game.homeScore - row.game.awayScore;
  return { date: row.game.date.slice(0, 10), source, referenceBooks: centers.length,
    model, reference, modelUnits: unit(model, modelPrice), referenceUnits, flipped,
    modelError: Math.abs(actual - (market === "total" ? row.forecast.total : row.forecast.margin)),
    referenceError: center === null ? null : Math.abs(actual - center) };
}
function summary(items: Sample[]) {
  const paired = items.filter(s => s.reference !== null);
  const figures = (rows: Sample[], side: "model" | "reference") => ({ bets: rows.length,
    wins: rows.filter(s => s[side] === "win").length, losses: rows.filter(s => s[side] === "loss").length,
    pushes: rows.filter(s => s[side] === "push").length,
    units: Number(rows.reduce((sum, s) => sum + (side === "model" ? s.modelUnits : s.referenceUnits ?? 0), 0).toFixed(2)),
    coordinateMae: rows.length ? Number((rows.reduce((sum, s) => sum + (side === "model" ? s.modelError : s.referenceError ?? 0), 0) / rows.length).toFixed(2)) : null });
  return { allIndependent: figures(items, "model"), covered: paired.length, pairedIndependent: figures(paired, "model"),
    reference: figures(paired, "reference"), flips: paired.filter(s => s.flipped).length,
    correctedFlips: paired.filter(s => s.flipped && s.reference === "win").length,
    harmedFlips: paired.filter(s => s.flipped && s.reference === "loss").length,
    twoOrMoreReferenceBooks: paired.filter(s => s.referenceBooks >= 2).length };
}
const report: Record<string, unknown> = { scope: "private_retro_exact_opening_only", productionWrites: 0,
  baselineGames: base.length, addedGames: added.length, weekdayGames: weekdays.length, saturationGames: saturation.length,
  caveat: "Retrospective dates and opening prices only; no qualified movement/splits; no live score, side, grade or stake change." };
for (const market of markets) {
  const samples = [...base.map(r => sample(r, market, "baseline")), ...added.map(r => sample(r, market, "added")),
    ...weekdays.map(r => sample(r, market, "weekdays")), ...saturation.map(r => sample(r, market, "saturation"))];
  report[market] = { combined: summary(samples), early: summary(samples.filter(s => s.date < "2026-02-15")),
    selection: summary(samples.filter(s => s.date >= "2026-02-15" && s.date < "2026-03-01")),
    later: summary(samples.filter(s => s.date >= "2026-03-01")),
    added: summary(samples.filter(s => s.source === "added")),
    addedLater: summary(samples.filter(s => s.source === "added" && s.date >= "2026-03-01")),
    weekdays: summary(samples.filter(s => s.source === "weekdays")),
    saturation: summary(samples.filter(s => s.source === "saturation")),
    byDate: Object.fromEntries([...new Set(samples.map(s => s.date))].sort().map(date =>
      [date, summary(samples.filter(s => s.date === date))])) };
}
console.log(JSON.stringify(report, null, 2));
