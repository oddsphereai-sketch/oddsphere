/** Private, opened-season Total grade discrimination test. No pick, grade, stake or publication writer. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cbbImpliedProbability } from "../../lib/cbb/marketEvidence";
import { cbbInverseNormal } from "../../lib/cbb/marketReaderResearch";
import { normalCdf } from "../../lib/cbb/model";
import type { CbbOdds } from "../../lib/cbb/types";

const dir = resolve(process.argv.find(arg => arg.startsWith("--data="))?.slice(7) ?? "/private/tmp/oddsphere-cbb-data");
const read = (name: string) => JSON.parse(readFileSync(resolve(dir, name), "utf8"));
type Row = { gameId: number; date: string; asOf: string; sportsbook: string; quoteId: number; line: number; actual: number;
  overPrice: number; underPrice: number; r2Total: number; r2: { pick: string; result: string; units: number } };
const rows = read("opening-total-benchmark-report.json").rows as Row[];
const raw = read("opening-total-benchmark-raw.json").data as CbbOdds[];
const sd = Number(read("candidate-r2-artifact.json").uncertainty.totalSd);
if (rows.length !== 635 || !(sd > 0)) throw new Error("expanded CBB Total cohort or uncertainty changed");
const byQuoteId = new Map(raw.map(quote => [quote.id, quote]));
const references = new Set(["draftkings", "fanduel", "betmgm", "caesars", "pinnacle", "circa", "bet365", "bovada", "betrivers", "espnbet"]);
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const probabilities = (center: number, line: number) => {
  const upper = Number.isInteger(line) ? line + 0.5 : Math.ceil(line) - 0.5;
  const lower = Number.isInteger(line) ? line - 0.5 : upper;
  return { over: 1 - normalCdf((upper - center) / sd), under: normalCdf((lower - center) / sd) };
};
const evaluation = rows.map(row => {
  const target = byQuoteId.get(row.quoteId);
  if (!target || target.game_id !== row.gameId || target.vendor !== row.sportsbook || target.opened_at !== row.asOf ||
    Number(target.total_value) !== row.line || target.total_over_odds !== row.overPrice || target.total_under_odds !== row.underPrice)
    throw new Error(`expanded CBB Total target identity mismatch ${row.gameId}`);
  const pick = row.r2.pick;
  if (!(["over", "under"].includes(pick))) throw new Error(`unsupported expanded CBB Total pick ${row.gameId}`);
  const price = pick === "over" ? row.overPrice : row.underPrice;
  const p = probabilities(row.r2Total, row.line);
  const modelEv = (pick === "over" ? p.over : p.under) * (price > 0 ? price / 100 : 100 / -price) - (pick === "over" ? p.under : p.over);
  const referenceRows = raw.filter(quote => quote.game_id === row.gameId && quote.vendor !== row.sportsbook && references.has(quote.vendor) &&
    Number.isFinite(Date.parse(quote.opened_at ?? "")) && Date.parse(quote.opened_at!) <= Date.parse(row.asOf) &&
    Date.parse(row.asOf) - Date.parse(quote.opened_at!) <= 48 * 3600000 &&
    quote.total_value !== null && Number.isFinite(Number(quote.total_value)) &&
    typeof quote.total_over_odds === "number" && typeof quote.total_under_odds === "number" &&
    Math.abs(quote.total_over_odds) >= 100 && Math.abs(quote.total_under_odds) >= 100)
    .map(quote => {
      const first = cbbImpliedProbability(quote.total_over_odds!);
      const second = cbbImpliedProbability(quote.total_under_odds!);
      if (first + second < 0.98 || first + second > 1.3) return null;
      return { vendor: quote.vendor, center: Number(quote.total_value) + sd * cbbInverseNormal(first / (first + second)) };
    }).filter((value): value is { vendor: string; center: number } => value !== null);
  const centers = referenceRows.map(item => item.center);
  const center = centers.length ? median(centers) : null;
  const agrees = center === null || center === row.line ? null : (center > row.line) === (pick === "over");
  const referencePick = center === null || center === row.line ? null : center > row.line ? "over" : "under";
  const referenceResult = referencePick === null || row.r2.result === "push" ? row.r2.result :
    referencePick === pick ? row.r2.result : row.r2.result === "win" ? "loss" : "win";
  const referencePrice = referencePick === "over" ? row.overPrice : row.underPrice;
  const referenceUnits = referencePick === null ? null : referenceResult === "push" ? 0 :
    referenceResult === "loss" ? -1 : referencePrice > 0 ? referencePrice / 100 : 100 / -referencePrice;
  return { gameId: row.gameId, date: row.date.slice(0, 10), result: row.r2.result, units: row.r2.units, modelEv, referenceBooks: centers.length,
    agrees, referencePick, referenceResult, referenceUnits, singleReferenceBook: referenceRows.length === 1 ? referenceRows[0].vendor : null,
    modelPick: pick, actual: row.actual, targetLine: row.line, modelTotal: row.r2Total, referenceCenter: center,
    modelTotalError: Math.abs(row.actual - row.r2Total), referenceTotalError: center === null ? null : Math.abs(row.actual - center) };
});
const dates = [...new Set(evaluation.map(row => row.date))].sort();
if (dates.length !== 8) throw new Error("expanded CBB Total dates changed");
const early = new Set(dates.slice(0, 2)), selection = new Set(dates.slice(2, 6)), later = new Set(dates.slice(6));
const earlyEv = evaluation.filter(row => early.has(row.date)).map(row => row.modelEv).sort((a, b) => a - b);
const cut = Math.max(0, earlyEv[Math.floor(earlyEv.length * 2 / 3)]);
const summary = (items: typeof evaluation) => ({ bets: items.length, wins: items.filter(row => row.result === "win").length,
  losses: items.filter(row => row.result === "loss").length, pushes: items.filter(row => row.result === "push").length,
  units: Number(items.reduce((sum, row) => sum + row.units, 0).toFixed(2)),
  gameDaysWithPick: new Set(items.map(row => row.date)).size });
const report: Record<string, unknown> = { scope: "private_opened_2025_total_only_archived_opening_quotes", productionWrites: 0,
  decision: "diagnostic_only_no_grade_policy_approved", dates, earlyDistributionCut: Number(cut.toFixed(4)), periods: {} };
for (const [period, included] of Object.entries({ early, selection, later })) {
  const subset = evaluation.filter(row => included.has(row.date));
  const high = subset.filter(row => row.modelEv >= cut);
  (report.periods as Record<string, unknown>)[period] = {
    all: summary(subset), highModelEv: summary(high), highEvReferenceAgrees: summary(high.filter(row => row.agrees === true)),
    highEvReferenceOpposes: summary(high.filter(row => row.agrees === false)),
    highEvNoReference: summary(high.filter(row => row.agrees === null)),
    referenceSide: { covered: subset.filter(row => row.referencePick !== null).length,
      pairedModel: summary(subset.filter(row => row.referencePick !== null)),
      pairedModelTotalMae: Number((subset.filter(row => row.referencePick !== null)
        .reduce((sum, row) => sum + row.modelTotalError, 0) / Math.max(1, subset.filter(row => row.referencePick !== null).length)).toFixed(2)),
      referenceTotalMae: Number((subset.filter(row => row.referencePick !== null)
        .reduce((sum, row) => sum + (row.referenceTotalError ?? 0), 0) / Math.max(1, subset.filter(row => row.referencePick !== null).length)).toFixed(2)),
      wins: subset.filter(row => row.referencePick !== null && row.referenceResult === "win").length,
      losses: subset.filter(row => row.referencePick !== null && row.referenceResult === "loss").length,
      pushes: subset.filter(row => row.referencePick !== null && row.referenceResult === "push").length,
      units: Number(subset.reduce((sum, row) => sum + (row.referenceUnits ?? 0), 0).toFixed(2)),
      flips: subset.filter(row => row.agrees === false).length,
      correctedFlips: subset.filter(row => row.agrees === false && row.referenceResult === "win").length,
      harmedFlips: subset.filter(row => row.agrees === false && row.referenceResult === "loss").length,
      corroboration: Object.fromEntries(["oneBook", "twoOrMoreBooks"].map((name, index) => {
        const items = subset.filter(row => row.referencePick !== null && (index === 0 ? row.referenceBooks === 1 : row.referenceBooks >= 2));
        return [name, { model: summary(items), reference: { bets: items.length,
          wins: items.filter(row => row.referenceResult === "win").length,
          losses: items.filter(row => row.referenceResult === "loss").length,
          units: Number(items.reduce((sum, row) => sum + (row.referenceUnits ?? 0), 0).toFixed(2)) },
          flips: items.filter(row => row.agrees === false).length,
          correctedFlips: items.filter(row => row.agrees === false && row.referenceResult === "win").length,
          harmedFlips: items.filter(row => row.agrees === false && row.referenceResult === "loss").length }];
      })),
      singleBookByProvider: Object.fromEntries([...new Set(subset.map(row => row.singleReferenceBook).filter((book): book is string => book !== null))]
        .map(book => { const items = subset.filter(row => row.singleReferenceBook === book);
          return [book, { model: summary(items), reference: { bets: items.length,
            wins: items.filter(row => row.referenceResult === "win").length,
            losses: items.filter(row => row.referenceResult === "loss").length,
            units: Number(items.reduce((sum, row) => sum + (row.referenceUnits ?? 0), 0).toFixed(2)) } }]; })),
      ...(period === "later" ? { cases: subset.filter(row => row.referencePick !== null).map(row => ({
        gameId: row.gameId, date: row.date, actual: row.actual, targetLine: row.targetLine,
        modelTotal: Number(row.modelTotal.toFixed(2)), modelPick: row.modelPick,
        referenceCenter: Number(row.referenceCenter!.toFixed(2)), referencePick: row.referencePick,
        referenceBooks: row.referenceBooks, modelResult: row.result, referenceResult: row.referenceResult })) } : {}),
      byDate: Object.fromEntries([...included].map(date => [date, {
        pairedModel: summary(subset.filter(row => row.date === date && row.referencePick !== null)),
        reference: { bets: subset.filter(row => row.date === date && row.referencePick !== null).length,
          wins: subset.filter(row => row.date === date && row.referenceResult === "win" && row.referencePick !== null).length,
          losses: subset.filter(row => row.date === date && row.referenceResult === "loss" && row.referencePick !== null).length,
          units: Number(subset.filter(row => row.date === date).reduce((sum, row) => sum + (row.referenceUnits ?? 0), 0).toFixed(2)) } }])) },
    byDate: Object.fromEntries([...included].map(date => [date, { all: summary(subset.filter(row => row.date === date)),
      highEvReferenceAgrees: summary(high.filter(row => row.date === date && row.agrees === true)) }])),
  };
}
console.log(JSON.stringify(report, null, 2));
