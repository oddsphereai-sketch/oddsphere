/** Read-only, opened-cohort diagnostic. This is not a CBB prediction candidate. */
import { readFileSync } from "node:fs";

const dir = process.argv.find(arg => arg.startsWith("--data-dir="))?.slice(11) ?? "/private/tmp/oddsphere-cbb-data";
const read = name => JSON.parse(readFileSync(`${dir}/${name}`, "utf8"));
const rows = read("market-reader-feature-rows.json");
const movement = read("market-reader-movement-cases.json");
const totalRows = read("opening-total-benchmark-report.json").rows;
const r12Ledger = read("cbb-decision-repair-quote-ledgers.json").matched_total;
const privatePreview = read("preview-market-2026-11-01.json");
const markets = ["moneyline", "spread", "total"];
const median = values => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const assert = (condition, message) => { if (!condition) throw new Error(message); };

assert(rows.length === 353, "CBB three-market cohort changed; requalify the audit");
assert(new Set(rows.map(row => `${row.game.id}|${row.forecast.asOf}`)).size === rows.length, "duplicate fixture/cutoff");
for (const row of rows) {
  assert(row.targets.length === 3 && markets.every(market => row.targets.some(target => target.market === market)), "incomplete target markets");
  assert(row.context.inferenceScope === "opening_price_context_only", "market evidence scope changed");
  assert(row.context.retained.every(item => Date.parse(item.quote.providerObservedAt) <= Date.parse(row.forecast.asOf)), "post-cutoff reference");
  assert(row.context.retained.every(item => item.quote.sportsbook !== row.targets[0].sportsbook), "target-book leakage");
}

const result = { scope: "private_opened_2025_season_diagnostic_only", productionWrites: 0,
  methodology: "At exact target opening time, compare frozen r2 score with the median of qualified earlier target-book-excluded reference centers. This is a reference-price sensitivity diagnostic, not a movement/splits reader or a proposed rule.",
  coverage: { allThreeMarkets: rows.length, moneylineReferences: rows.filter(row => row.context.centers.moneyline.length).length,
    spreadReferences: rows.filter(row => row.context.centers.spread.length).length,
    totalReferences: rows.filter(row => row.context.centers.total.length).length },
  cohorts: {}, errors: {}, r12Flips: {}, movement: {}, preview: {} };

const cohorts = {
  all353: rows,
  earlyFit151: rows.filter(row => row.game.date < "2026-02-15"),
  selection162: rows.filter(row => row.game.date >= "2026-02-21" && row.game.date < "2026-03-01"),
  later40: rows.filter(row => row.game.date >= "2026-03-01"),
};
for (const [name, cohort] of Object.entries(cohorts)) {
  const summary = { games: cohort.length, markets: {} };
  for (const market of markets) {
    const eligible = cohort.filter(row => row.context.centers[market].length);
    const counts = { eligible: eligible.length, r2Wins: 0, referenceWins: 0, flips: 0, correctedLosses: 0, harmedWins: 0 };
    for (const row of eligible) {
      const target = row.targets.find(quote => quote.market === market);
      const actualMargin = row.game.homeScore - row.game.awayScore;
      const actualTotal = row.game.homeScore + row.game.awayScore;
      const actual = market === "total" ? actualTotal - target.line : actualMargin + (market === "spread" ? target.line : 0);
      const independent = market === "total" ? row.forecast.total - target.line : row.forecast.margin + (market === "spread" ? target.line : 0);
      const reference = median(row.context.centers[market]) + (market === "spread" ? target.line : market === "total" ? -target.line : 0);
      assert(actual !== 0 && independent !== 0 && reference !== 0, "push/tie needs separate handling");
      const before = Math.sign(independent) === Math.sign(actual), after = Math.sign(reference) === Math.sign(actual);
      counts.r2Wins += Number(before); counts.referenceWins += Number(after);
      counts.flips += Number(Math.sign(independent) !== Math.sign(reference));
      counts.correctedLosses += Number(!before && after);
      counts.harmedWins += Number(before && !after);
    }
    assert(counts.r2Wins + counts.correctedLosses - counts.harmedWins === counts.referenceWins, "unreconciled flips");
    summary.markets[market] = counts;
  }
  result.cohorts[name] = summary;
}

result.errors.threeMarket353 = { games: rows.length,
  r2MarginMae: mean(rows.map(row => Math.abs(row.game.homeScore - row.game.awayScore - row.forecast.margin))),
  targetOpeningSpreadMarginMae: mean(rows.map(row => Math.abs(row.game.homeScore - row.game.awayScore + row.targets.find(quote => quote.market === "spread").line))),
  r2TotalMae: mean(rows.map(row => Math.abs(row.game.homeScore + row.game.awayScore - row.forecast.total))),
  targetOpeningTotalMae: mean(rows.map(row => Math.abs(row.game.homeScore + row.game.awayScore - row.targets.find(quote => quote.market === "total").line))) };
result.errors.totalOnly635 = { games: totalRows.length, r2TotalMae: mean(totalRows.map(row => row.r2Error)),
  targetOpeningTotalMae: mean(totalRows.map(row => row.openingError)) };
const byFixtureCutoff = new Map(rows.map(row => [`${row.game.id}|${row.forecast.asOf}`, row]));
for (const market of markets) {
  const seen = new Set();
  const exactRows = r12Ledger.filter(entry => {
    const key = `${entry.gameId}|${entry.asOf}|${entry.market}`;
    if (entry.market !== market || seen.has(key)) return false;
    const row = byFixtureCutoff.get(`${entry.gameId}|${entry.asOf}`);
    const target = row?.targets.find(quote => quote.market === market);
    if (!target || target.sportsbook !== entry.quote.sportsbook || target.line !== entry.quote.line ||
      target.firstPrice !== entry.quote.firstPrice || target.secondPrice !== entry.quote.secondPrice) return false;
    seen.add(key);
    return true;
  });
  assert(exactRows.length === rows.length, "R12 exact-target quote match changed");
  const flips = exactRows.filter(entry => entry.baseline.pick !== entry.candidate.pick);
  const resultByMarket = { exactTargets: exactRows.length, flips: flips.length, correctedLosses: 0, harmedWins: 0,
    referenceAgreesWithCandidate: { flips: 0, correctedLosses: 0, harmedWins: 0 },
    referenceAgreesWithR2: { flips: 0, correctedLosses: 0, harmedWins: 0 },
    noSameMarketReference: { flips: 0, correctedLosses: 0, harmedWins: 0 } };
  for (const entry of flips) {
    const row = byFixtureCutoff.get(`${entry.gameId}|${entry.asOf}`);
    const center = median(row.context.centers[market]);
    const referenceEdge = center === null ? null : center +
      (market === "spread" ? entry.quote.line : market === "total" ? -entry.quote.line : 0);
    const referenceSide = referenceEdge === null ? null : referenceEdge > 0 ? "first" : "second";
    const bucket = center === null ? resultByMarket.noSameMarketReference : referenceSide === entry.candidate.pick ?
      resultByMarket.referenceAgreesWithCandidate : resultByMarket.referenceAgreesWithR2;
    bucket.flips++;
    bucket.correctedLosses += Number(entry.correction);
    bucket.harmedWins += Number(entry.harm);
    resultByMarket.correctedLosses += Number(entry.correction);
    resultByMarket.harmedWins += Number(entry.harm);
  }
  result.r12Flips[market] = resultByMarket;
}
result.movement = { probedFixtures: movement.cases.length, fixturesWithQualifiedPairs: movement.cases.filter(item => item.pairedQuotes > 0).length,
  qualifiedPairs: movement.totalQualifiedPairs, fixturesWithChangedSharpPath: movement.cases.filter(item => item.paths.some(path =>
    ["circa", "pinnacle"].includes(path.book) && path.distinctStates > 1)).length,
  trueOpeningVerified: movement.cases.filter(item => item.paths.some(path => path.trueOpeningKnown)).length };
result.preview = { activation: privatePreview.activation.status, appliedMarketCards: privatePreview.cards.filter(card => card.marketInference?.applied).length,
  totalCards: privatePreview.cards.length };
console.log(JSON.stringify(result, null, 2));
