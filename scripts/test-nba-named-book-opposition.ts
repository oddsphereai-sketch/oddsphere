import assert from "node:assert/strict";
import type { NbaPortableModelArtifact } from "../lib/automodel/nba/nbaPortableScoreModel";
import { buildNbaProfessionalCandidate } from "../lib/services/nba/nbaProfessionalCandidate";
import { buildNbaProfessionalMarketReader, type NbaReaderPriceRow } from "../lib/services/nba/nbaProfessionalMarketReader";
import { resolveNbaNamedBookPosture } from "../lib/services/nba/nbaNamedBookPosture";
import { gradeNbaMarket, type GradeInput } from "../lib/services/nba/nbaMarketReview";

const at = "2026-10-30T22:30:00Z";
const pair = (market: "moneyline" | "spread" | "total", book: string, observed: string,
  line: number | null, prices: [number, number] = [-110, -110]): NbaReaderPriceRow[] =>
  (market === "total" ? ["over", "under"] : ["home", "away"]).map((side, i) => ({
    market, sportsbook: book, sharpBook: ["circa", "pinnacle"].includes(book),
    provider: "owls", providerEventId: "fixture", ingestionRunId: `fixture:${observed}`,
    selectionKey: `fixture:${market}:${side}`, line: market === "spread" && i === 1 ? -line! : line,
    americanPrice: prices[i]!, providerTimestamp: observed, fetchedAt: observed,
  }));
const rows = [
  ...pair("spread", "circa", "2026-10-30T12:00:00Z", -6),
  ...pair("spread", "circa", "2026-10-30T21:30:00Z", -5.5),
  ...pair("spread", "draftkings", "2026-10-30T12:00:00Z", -5),
  ...pair("spread", "draftkings", "2026-10-30T21:30:00Z", -5.5),
  ...pair("moneyline", "pinnacle", "2026-10-30T12:00:00Z", null, [-250, 210]),
  ...pair("moneyline", "pinnacle", "2026-10-30T21:30:00Z", null, [-210, 180]),
  ...pair("moneyline", "draftkings", "2026-10-30T12:00:00Z", null, [-210, 180]),
  ...pair("moneyline", "draftkings", "2026-10-30T21:30:00Z", null, [-250, 210]),
  ...pair("total", "circa", "2026-10-30T12:00:00Z", 224),
  ...pair("total", "circa", "2026-10-30T21:30:00Z", 225),
];
const reader = buildNbaProfessionalMarketReader({ evaluatedAt: at, priceRows: rows, splitRows: [],
  selectedLines: { spreadHome: -5.5, total: 225 } });
const original = JSON.stringify(reader);
assert.equal(reader.reads.spread.reason, "book_disagreement");
assert.equal(reader.reads.moneyline.reason, "book_disagreement");
const spread = resolveNbaNamedBookPosture({ reader, market: "spread", pickedSide: "home" });
const moneyline = resolveNbaNamedBookPosture({ reader, market: "moneyline", pickedSide: "home" });
assert.deepEqual(spread.opposingSources, ["circa"]);
assert.deepEqual(moneyline.opposingSources, ["pinnacle"]);
assert.equal(spread.forecastAuthorityGranted, false);
assert.deepEqual(resolveNbaNamedBookPosture({ reader, market: "spread", pickedSide: "away" }).supportingSources, ["circa"]);
assert.deepEqual(resolveNbaNamedBookPosture({ reader, market: "total", pickedSide: "under" }).opposingSources, ["circa"]);
assert.equal(JSON.stringify(reader), original, "source facts are immutable");

const base: GradeInput = { market: "spread", pick: "home", confidence: 60, band: "support", edge: 0.1,
  dataQualityTier: "high", injuriesKnown: true, independentEdgePoints: 3.2432965576,
  currentPriceAmerican: -110, modelProbabilityOnPick: 0.6043613020 };
const incumbent = gradeNbaMarket(base);
const corrected = gradeNbaMarket({ ...base, namedBookPosture: spread });
assert.equal(incumbent.grade, "best_angle"); assert.equal(corrected.grade, "lean");
assert.equal(corrected.effectiveConfidence, incumbent.effectiveConfidence);
const mlBase: GradeInput = { ...base, market: "moneyline", confidence: 75.9, currentPriceAmerican: -210, modelProbabilityOnPick: 0.7592529226 };
assert.equal(gradeNbaMarket(mlBase).grade, "best_angle");
assert.equal(gradeNbaMarket({ ...mlBase, namedBookPosture: moneyline }).grade, "lean");
assert.deepEqual(gradeNbaMarket({ ...mlBase, namedBookPosture: spread }), gradeNbaMarket(mlBase), "wrong-market context cannot apply");

for (const mutate of [
  (r: typeof reader) => { r.evidenceStatus = "unavailable"; },
  (r: typeof reader) => { r.reads.spread.excludedSportsbooks = ["CIRCA"]; },
  (r: typeof reader) => { r.reads.spread.namedBookPostureTrails![0]!.currentAt = "2026-10-30T22:31:00Z"; },
  (r: typeof reader) => { r.reads.spread.namedBookPostureTrails![0]!.currentAt = "2026-10-30T20:29:59Z"; },
  (r: typeof reader) => { r.reads.spread.namedBookPostureTrails![0]!.buybackToOpening = true; },
  (r: typeof reader) => { r.reads.spread.namedBookPostureTrails![0]!.reversalMagnitude = 1; },
  (r: typeof reader) => { r.reads.spread.namedBookPostureTrails![0]!.persistenceTimeShare = NaN; },
  (r: typeof reader) => { delete r.reads.spread.namedBookPostureTrails![0]!.openingFairFirstProbability; },
]) {
  const copy = structuredClone(reader); mutate(copy);
  const posture = resolveNbaNamedBookPosture({ reader: copy, market: "spread", pickedSide: "home" });
  assert.deepEqual(posture.opposingSources, []);
  assert.deepEqual(gradeNbaMarket({ ...base, namedBookPosture: posture }), incumbent);
}
const compensated = structuredClone(reader);
compensated.reads.spread.namedBookPostureTrails![0]!.currentFairFirstProbability = 0.8;
const ambiguous = resolveNbaNamedBookPosture({ reader: compensated, market: "spread", pickedSide: "home" });
assert.deepEqual(ambiguous.opposingSources, []); assert.deepEqual(ambiguous.conflictingSources, ["circa"]);
assert.equal(gradeNbaMarket({ ...base, namedBookPosture: ambiguous }).grade, "lean", "unresolved economics tempers Best without removing the actionable pick");
assert.deepEqual(resolveNbaNamedBookPosture({ reader: null, market: "spread", pickedSide: "home" }).opposingSources, []);

// Mirror roles AND favorite/underdog prices, not just the preferred-side label.
const mirrored = buildNbaProfessionalMarketReader({ evaluatedAt: at, splitRows: [],
  selectedLines: { spreadHome: 5.5, total: 225 },
  priceRows: rows.map(row => ({ ...row, selectionKey: row.selectionKey.endsWith(":home")
    ? row.selectionKey.replace(/:home$/, ":away") : row.selectionKey.endsWith(":away")
      ? row.selectionKey.replace(/:away$/, ":home") : row.selectionKey })),
});
for (const [market, source] of [["spread", "circa"], ["moneyline", "pinnacle"]] as const) {
  const posture = resolveNbaNamedBookPosture({ reader: mirrored, market, pickedSide: "away" });
  assert.deepEqual(posture.opposingSources, [source]);
  assert.equal(gradeNbaMarket({ ...(market === "spread" ? base : mlBase), pick: "away",
    independentEdgePoints: -3.2432965576, namedBookPosture: posture }).grade, "lean");
}
for (const mutate of [
  (p: NbaReaderPriceRow[]) => { p[0]!.provider = "canonical_lines"; },
  (p: NbaReaderPriceRow[]) => { p[0]!.ingestionRunId = "different-run"; },
  (p: NbaReaderPriceRow[]) => { p[0]!.providerEventId = "wrong-event"; },
  (p: NbaReaderPriceRow[]) => { p.push({ ...p[0]! }); },
  (p: NbaReaderPriceRow[]) => { p.forEach(row => { delete row.provider; }); },
]) {
  const prices = rows.filter(r => r.market === "spread" && r.sportsbook === "circa").map(r => ({ ...r })); mutate(prices);
  const invalid = buildNbaProfessionalMarketReader({ evaluatedAt: at, splitRows: [], priceRows: prices,
    selectedLines: { spreadHome: -5.5, total: 225 } });
  assert.deepEqual(resolveNbaNamedBookPosture({ reader: invalid, market: "spread", pickedSide: "home" }).opposingSources, []);
}

let comparisons = 0, bestToLean = 0;
const actionable = (g: string) => g === "best_angle" || g === "lean";
for (const market of ["moneyline", "spread", "total"] as const)
for (const confidence of [40, 55, 58, 60, 65, 80])
for (const edge of [-0.1, 0, 0.04, 0.1])
for (const currentPriceAmerican of [-450, -210, -110, 110]) {
  const pick = market === "total" ? "under" : "home";
  const posture = resolveNbaNamedBookPosture({ reader, market, pickedSide: pick });
  const input: GradeInput = { ...base, market, pick, confidence, edge, currentPriceAmerican,
    independentEdgePoints: market === "total" ? -6 : 3, readerCorrectionApplied: market === "total" };
  const old = gradeNbaMarket(input), next = gradeNbaMarket({ ...input, namedBookPosture: posture });
  assert.equal(actionable(old.grade), actionable(next.grade));
  assert.equal(old.effectiveConfidence, next.effectiveConfidence);
  if (old.grade !== next.grade) { assert.equal(old.grade, "best_angle"); assert.equal(next.grade, "lean"); bestToLean++; }
  comparisons++;
}
console.log(`NBA observed opposition: mixed-market source retention, priced-contract ambiguity, source/clock/exclusion negatives and ${comparisons} grade pairs passed (${bestToLean} Best Angle→Lean; zero actionable changes).`);

// The owner explicitly rejected an automatic favorite follower OR automatic
// contrarian. Reflect the complete scoring/reader input, not just a pick label.
// This is an implementation symmetry proof, not an accuracy experiment.
const artifact: NbaPortableModelArtifact = {
  release: "side_symmetry_fixture", featureRelease: "side_symmetry_fixture",
  architecture: "margin_total", model: { family: "ridge", alpha: 1000 },
  design: { features: ["strength"], missingIndicatorColumns: [], rawFeatureMedians: [0],
    designMeans: [0], designStandardDeviations: [1], designColumns: 1, splineKnots: [] },
  coefficients: { target_home_margin: [1, 0], target_total: [0, 220] },
  distribution: { family: "normal_residual", marginSigma: 11.5, totalSigma: 16, calibratedOn: "fixture" },
};
const close = (a: number, b: number, label: string) => assert.ok(Math.abs(a - b) < 1e-9, `${label}: ${a} != ${b}`);
function sideCase(independentMargin: number, marketMargin: number, move: number, totalMove: number, reversePriceFavorite = false) {
  const homePriceFavorite = reversePriceFavorite ? marketMargin < 0 : marketMargin > 0;
  const current = ["circa", "pinnacle"].flatMap(sportsbook => [
    { market_type: "moneyline", sportsbook, side: "home", line_value: null, odds_american: homePriceFavorite ? -210 : 180, fetched_at: at },
    { market_type: "moneyline", sportsbook, side: "away", line_value: null, odds_american: homePriceFavorite ? 180 : -210, fetched_at: at },
    { market_type: "spread", sportsbook, side: "home", line_value: -marketMargin, odds_american: -110, fetched_at: at },
    { market_type: "spread", sportsbook, side: "away", line_value: marketMargin, odds_american: -110, fetched_at: at },
    { market_type: "total", sportsbook, side: "over", line_value: 220, odds_american: -110, fetched_at: at },
    { market_type: "total", sportsbook, side: "under", line_value: 220, odds_american: -110, fetched_at: at },
  ]);
  const historyRows = ["circa", "pinnacle"].flatMap(book => [
    ...pair("spread", book, "2026-10-30T20:30:00Z", -marketMargin + move),
    ...pair("spread", book, "2026-10-30T22:00:00Z", -marketMargin),
    ...pair("total", book, "2026-10-30T20:30:00Z", 220 - totalMove),
    ...pair("total", book, "2026-10-30T22:00:00Z", 220),
  ]);
  const read = buildNbaProfessionalMarketReader({ evaluatedAt: at, priceRows: historyRows, splitRows: [],
    selectedLines: { spreadHome: -marketMargin, total: 220 } });
  const candidate = buildNbaProfessionalCandidate({ artifact, featureRow: { strength: independentMargin },
    lines: current, history: [], externalGameId: 9, marketReader: read });
  return { candidate, read };
}
let mirroredForecastCases = 0, favoritePriceOnlyCases = 0;
let underdogWinnerCases = 0, favoriteWinnerCases = 0;
let underdogSpreadCases = 0, favoriteSpreadCases = 0;
for (const margin of [-8, -3, -0.25, 0.25, 3, 8])
for (const marketMargin of [-6, -2, 2, 6])
for (const move of [-3, -0.5, 0, 0.5, 3])
for (const totalMove of [-5, 0, 5]) {
  const originalCase = sideCase(margin, marketMargin, move, totalMove);
  const reflectedCase = sideCase(-margin, -marketMargin, -move, totalMove);
  const left = originalCase.candidate, right = reflectedCase.candidate;
  close(left.final.marginHome, -right.final.marginHome, "reflected margin");
  close(left.final.total, right.final.total, "invariant Total");
  close(left.final.homeScore, right.final.awayScore, "reflected home score");
  close(left.final.awayScore, right.final.homeScore, "reflected away score");
  close(left.probabilities.ml_home_win_prob, right.probabilities.ml_away_win_prob, "reflected ML probability");
  close(left.probabilities.spread_home_cover_prob!, right.probabilities.spread_away_cover_prob!, "reflected Spread probability");
  close(left.probabilities.total_over_prob!, right.probabilities.total_over_prob!, "invariant Total probability");
  if (Math.abs(left.final.marginHome) > 1e-9) assert.notEqual(left.picks.moneyline, right.picks.moneyline);
  if (Math.abs(left.final.marginHome - marketMargin) > 1e-9) assert.notEqual(left.picks.spread, right.picks.spread);
  assert.equal(left.picks.total, right.picks.total);
  assert.equal(left.final.movementApplied, right.final.movementApplied);
  assert.equal(left.final.totalMovementApplied, right.final.totalMovementApplied);
  for (const market of ["moneyline", "spread", "total"] as const) {
    const a = resolveNbaNamedBookPosture({ reader: originalCase.read, market, pickedSide: left.picks[market]! });
    const b = resolveNbaNamedBookPosture({ reader: reflectedCase.read, market, pickedSide: right.picks[market]! });
    for (const key of ["supportingSources", "opposingSources", "conflictingSources"] as const) assert.deepEqual(a[key], b[key]);
  }
  const winnerIsFavorite = (left.picks.moneyline === "home") === (marketMargin > 0);
  if (winnerIsFavorite) favoriteWinnerCases++; else underdogWinnerCases++;
  const spreadIsFavorite = (left.picks.spread === "home") === (marketMargin > 0);
  if (spreadIsFavorite) favoriteSpreadCases++; else underdogSpreadCases++;
  mirroredForecastCases++;

  // Changing only current ML favorite prices is economics evidence, not a
  // direction command. A future qualified ML head must update this contract
  // explicitly rather than silently following the shorter quote.
  const quoteOnly = sideCase(margin, marketMargin, move, totalMove, true).candidate;
  assert.deepEqual(left.final, quoteOnly.final);
  assert.deepEqual(left.picks, quoteOnly.picks);
  assert.deepEqual(left.probabilities, quoteOnly.probabilities);
  favoritePriceOnlyCases++;
}
assert.ok(underdogWinnerCases > 0 && favoriteWinnerCases > 0);
assert.ok(underdogSpreadCases > 0 && favoriteSpreadCases > 0);
console.log(`NBA side neutrality: ${mirroredForecastCases} complete forecast reflections and ${favoritePriceOnlyCases} quote-only controls passed; both favorite/underdog winners and Spread sides are possible. Not predictive qualification.`);
