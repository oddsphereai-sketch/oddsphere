import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildWnbaMaximumEntropyMarginDistribution,
  buildWnbaResolvedMarketDecision,
  classifyWnbaMarketSource,
  pairWnbaCompleteMarketRows,
  selectWnbaUpperMedianEvaluatedRow,
  uniqueWnbaModalLine,
  wnbaExactPriceValueGate,
  wnbaMarginDistributionCdf,
  wnbaMarginProbabilityAbove,
  wnbaNoVigProbabilityForSide,
  type WnbaTargetExcludedPriceRow,
} from "../lib/services/wnba/wnbaTargetExcludedMarketDecision";
import {
  computeWnbaPrediction,
  type ModelState,
  type OddRow,
} from "../lib/services/wnba/buildWnbaDailyEdgePreview";

const decisionAt = "2026-09-02T18:00:00.000Z";
const startsAt = "2026-09-02T20:00:00.000Z";

function spreadPair(
  sportsbook: string,
  line: number,
  homePrice: number,
  awayPrice: number,
  homeAt = "2026-09-02T17:59:40.000Z",
  awayAt = "2026-09-02T17:59:55.000Z",
): WnbaTargetExcludedPriceRow[] {
  return [
    { market: "spread", side: "home", sportsbook, line, priceAmerican: homePrice, observedAt: homeAt, sharp: sportsbook === "circa" },
    { market: "spread", side: "away", sportsbook, line: -line, priceAmerican: awayPrice, observedAt: awayAt, sharp: sportsbook === "circa" },
  ];
}

function moneylinePair(
  sportsbook: string,
  homePrice: number,
  awayPrice: number,
): WnbaTargetExcludedPriceRow[] {
  return [
    { market: "moneyline", side: "home", sportsbook, line: null, priceAmerican: homePrice, observedAt: "2026-09-02T17:59:40.000Z", sharp: false },
    { market: "moneyline", side: "away", sportsbook, line: null, priceAmerican: awayPrice, observedAt: "2026-09-02T17:59:50.000Z", sharp: false },
  ];
}

const rows: WnbaTargetExcludedPriceRow[] = [
  ...spreadPair("draftkings", -4.5, -110, -110),
  ...spreadPair("fanduel", -4.5, -108, -112),
  ...spreadPair("circa", -4.5, -105, -115),
  ...spreadPair("betmgm", -5.5, -110, -110),
  // Repeated alternate rows from one book cannot become a second observation.
  ...spreadPair("draftkings", -7.5, -110, -110, "2026-09-02T17:58:00.000Z", "2026-09-02T17:58:29.000Z"),
  // Beyond-skew, stale and future rows are rejected.
  ...spreadPair("beyond", -4.5, -110, -110, "2026-09-02T17:58:00.000Z", "2026-09-02T17:58:31.000Z"),
  ...spreadPair("stale", -4.5, -110, -110, "2026-09-02T17:40:00.000Z", "2026-09-02T17:40:10.000Z"),
  ...spreadPair("future", -4.5, -110, -110, "2026-09-02T18:00:01.000Z", "2026-09-02T18:00:02.000Z"),
  // Same-book but non-complementary line identity is unavailable.
  { market: "spread", side: "home", sportsbook: "mismatch", line: -4.5, priceAmerican: -110, observedAt: "2026-09-02T17:59:45.000Z", sharp: false },
  { market: "spread", side: "away", sportsbook: "mismatch", line: 5.5, priceAmerican: -110, observedAt: "2026-09-02T17:59:50.000Z", sharp: false },
];

const pairs = pairWnbaCompleteMarketRows({ rows, market: "spread", decisionAt, startsAt });
assert.equal(pairs.length, 4, "only four valid independent sportsbook pairs remain");
assert.equal(new Set(pairs.map((pair) => pair.sportsbook)).size, pairs.length, "one book cannot manufacture breadth");
assert.equal(pairs.find((pair) => pair.sportsbook === "draftkings")?.canonicalLine, -4.5, "nearest/newest deterministic pairing wins");
assert.equal(pairs.find((pair) => pair.sportsbook === "draftkings")?.pairSkewMs, 15_000, "truthful nonzero pair skew is retained");
assert.equal(uniqueWnbaModalLine(pairs, 2)?.line, -4.5, "complete-pair breadth selects the unique modal line");

const evaluated = selectWnbaUpperMedianEvaluatedRow(pairs, "home", -4.5);
assert.equal(evaluated?.sportsbook, "fanduel", "upper-median exact price resolves a deterministic named book");
const decision = buildWnbaResolvedMarketDecision({ market: "spread", pairs, line: -4.5, evaluated });
assert.equal(decision.target_excluded_consensus_qualified, true, "target-excluded alternatives confirm the evaluated exact line");
assert.equal(decision.target_excluded_book_count, 2, "evaluated book is absent from same-line fair probability breadth");
assert.ok(decision.target_excluded_lines.length === 3, "all target-excluded book lines remain visible for quality audit");

const tied = pairWnbaCompleteMarketRows({
  rows: [...spreadPair("a", -4.5, -110, -110), ...spreadPair("b", -5.5, -110, -110)],
  market: "spread",
  decisionAt,
  startsAt,
});
assert.equal(uniqueWnbaModalLine(tied, 1), null, "a tied line board is unavailable rather than arbitrarily resolved");

const currentPairWins = pairWnbaCompleteMarketRows({
  rows: [
    ...spreadPair("recency", -4.5, -110, -110, "2026-09-02T17:58:00.000Z", "2026-09-02T17:58:00.000Z"),
    ...spreadPair("recency", -5.5, -108, -112, "2026-09-02T17:59:30.000Z", "2026-09-02T17:59:45.000Z"),
  ],
  market: "spread",
  decisionAt,
  startsAt,
});
assert.equal(currentPairWins[0]?.canonicalLine, -5.5, "the newest coherent pair beats an older zero-skew pair");
assert.equal(currentPairWins[0]?.pairSkewMs, 15_000, "newest-pair selection retains its truthful nonzero skew");

const retailOnly = pairWnbaCompleteMarketRows({
  rows: [
    ...spreadPair("draftkings", -4.5, -110, -110),
    ...spreadPair("fanduel", -4.5, -110, -110),
    ...spreadPair("betmgm", -4.5, -110, -110),
  ],
  market: "spread",
  decisionAt,
  startsAt,
});
assert.equal(classifyWnbaMarketSource("DraftKings").sourceClass, "named_retail", "named retail is not labeled sharp");
assert.equal(uniqueWnbaModalLine(retailOnly, 2, 2), null, "correlated retail labels cannot manufacture independent-family authority");
assert.equal(
  buildWnbaResolvedMarketDecision({ market: "spread", pairs: retailOnly, line: -4.5, evaluated: retailOnly[0]!.first }).unavailable_reason,
  "insufficient_independent_source_families",
  "correlated retail fallback records the exact provenance blocker",
);
assert.equal(
  new Set(buildWnbaResolvedMarketDecision({ market: "spread", pairs: retailOnly, line: -4.5, evaluated: retailOnly[0]!.first }).target_excluded_sources.map((source) => source.source_family)).size,
  1,
  "stored alternative provenance exposes the single correlated retail family",
);
const originatorRetail = pairWnbaCompleteMarketRows({
  rows: [...spreadPair("circa", -4.5, -110, -110), ...spreadPair("draftkings", -4.5, -110, -110)],
  market: "spread",
  decisionAt,
  startsAt,
});
assert.equal(uniqueWnbaModalLine(originatorRetail, 2, 2)?.independentFamilyCount, 2, "originator plus retail supplies two explicit source families");

const opposingOriginators = pairWnbaCompleteMarketRows({
  rows: [
    ...moneylinePair("circa", -900, 600),
    ...moneylinePair("pinnacle", 500, -800),
    ...moneylinePair("draftkings", -110, -110),
  ],
  market: "moneyline",
  decisionAt,
  startsAt,
});
const circaPair = opposingOriginators.find((pair) => pair.sportsbook === "circa");
const pinnaclePair = opposingOriginators.find((pair) => pair.sportsbook === "pinnacle");
assert.ok(circaPair && pinnaclePair, "opposed leave-one-out fixture retains both originator pairs");
assert.ok(
  wnbaNoVigProbabilityForSide(circaPair!, "home")! > 0.5 &&
  wnbaNoVigProbabilityForSide(pinnaclePair!, "home")! < 0.5,
  "different leave-one-out sharp boards imply opposite sides, so target identity must be frozen before posterior inference",
);

const distribution = buildWnbaMaximumEntropyMarginDistribution({
  desiredMean: 3.25,
  independentMean: 2.75,
  standardDeviation: 12.8,
  positiveProbability: 0.61,
});
assert.equal(distribution.kind, "maximum_entropy_sign_tilt", "feasible constraints produce the maximum-entropy sign tilt");
assert.ok(Math.abs(distribution.mean - 3.25) < 1e-12, "distribution preserves the requested expected margin");
assert.ok(Math.abs(distribution.variance - 12.8 ** 2) < 1e-12, "distribution preserves incumbent variance");
assert.ok(Math.abs(wnbaMarginProbabilityAbove(distribution, 0) - 0.61) < 1e-9, "distribution preserves exact Moneyline win probability");
assert.ok(Math.abs(wnbaMarginDistributionCdf(distribution, 0) - 0.39) < 1e-9, "CDF and Moneyline head are one distribution");
assert.ok(
  wnbaMarginProbabilityAbove(distribution, 4.5) < wnbaMarginProbabilityAbove(distribution, 0),
  "Spread probabilities are derived monotonically from the same margin CDF",
);

const infeasible = buildWnbaMaximumEntropyMarginDistribution({
  desiredMean: 20,
  independentMean: 1.75,
  standardDeviation: 8,
  positiveProbability: 0.1,
});
assert.equal(infeasible.kind, "independent_normal_fallback", "Cantelli-infeasible constraints fail back to the independent normal");
assert.equal(infeasible.mean, 1.75, "infeasible market context cannot move the independent center");

const promotion = wnbaExactPriceValueGate({ modelProbability: 0.61, evaluatedPriceAmerican: -110, pointEdge: 4.5 });
assert.equal(promotion.grade, "Best Angle", "existing point/probability/EV thresholds create a promotion path");
assert.ok((promotion.expectedReturn ?? 0) > 0, "promotion requires positive exact-price EV");
const demotion = wnbaExactPriceValueGate({ modelProbability: 0.61, evaluatedPriceAmerican: -200, pointEdge: 4.5 });
assert.equal(demotion.grade, "Watchlist", "the same strong projection demotes when the exact quote has negative EV");
assert.ok((demotion.expectedReturn ?? 0) < 0, "demotion is exact-price economics, not missing evidence");
assert.deepEqual(
  wnbaExactPriceValueGate({ modelProbability: 0.61, evaluatedPriceAmerican: -110, pointEdge: 4.5 }),
  promotion,
  "optional alternative evidence is absent from and therefore identity-neutral to exact-price economics",
);

const model: ModelState = {
  elo: new Map([[30, 1650], [10, 1450]]),
  games: new Map([[30, 30], [10, 30]]),
  pf: new Map([[30, Array(10).fill(90)], [10, Array(10).fill(75)]]),
  pa: new Map([[30, Array(10).fill(75)], [10, Array(10).fill(90)]]),
  margins: new Map([[30, Array(10).fill(12)], [10, Array(10).fill(-12)]]),
  lastGameDate: new Map([[30, "2026-08-31"], [10, "2026-08-31"]]),
  leagueAvgScore: 82.5,
  leagueAvgTotal: 165,
  nameById: new Map([[30, "Toronto Tempo"], [10, "Phoenix Mercury"]]),
  mascot: [],
  rawGames: [],
  computedAt: Date.parse(decisionAt),
};
const books = ["circa", "draftkings", "fanduel", "betmgm", "caesars"];
const integratedRows: OddRow[] = books.flatMap((book, index) => {
  const observedAt = new Date(Date.parse(decisionAt) - 20_000 + index * 1_000).toISOString();
  return [
    { book, sharp: book === "circa", mkt: "moneyline", selType: "home", odds: -210 - index, line: null, date: "2026-09-02", observedAt, startsAt, h: 30, a: 10 },
    { book, sharp: book === "circa", mkt: "moneyline", selType: "away", odds: 175 + index, line: null, date: "2026-09-02", observedAt, startsAt, h: 30, a: 10 },
    { book, sharp: book === "circa", mkt: "point_spread", selType: "home", odds: -110, line: 8.5, date: "2026-09-02", observedAt, startsAt, h: 30, a: 10 },
    { book, sharp: book === "circa", mkt: "point_spread", selType: "away", odds: -110, line: -8.5, date: "2026-09-02", observedAt, startsAt, h: 30, a: 10 },
    { book, sharp: book === "circa", mkt: "total_points", selType: "over", odds: -110, line: 150.5, date: "2026-09-02", observedAt, startsAt, h: 30, a: 10 },
    { book, sharp: book === "circa", mkt: "total_points", selType: "under", odds: -110, line: 150.5, date: "2026-09-02", observedAt, startsAt, h: 30, a: 10 },
  ];
});
const context = { decisionAt, startsAt, marketRows: integratedRows };
const promoted = computeWnbaPrediction(
  model,
  { id: 88, date: "2026-09-02", h: 30, a: 10 },
  integratedRows,
  {},
  undefined,
  undefined,
  context,
);
assert.equal(promoted.target_excluded_market_decision.moneyline.target_excluded_book_count, 4, "ML final inference excludes its evaluated sportsbook");
assert.equal(
  new Set(promoted.target_excluded_market_decision.moneyline.target_excluded_sources.map((source) => source.source_family)).size,
  2,
  "ML audit retains the exact originator and correlated-retail source families used by the posterior",
);
assert.equal(promoted.target_excluded_market_decision.spread.target_excluded_consensus_qualified, true, "Spread final inference excludes its evaluated sportsbook");
assert.equal(promoted.target_excluded_market_decision.total.target_excluded_consensus_qualified, true, "Total value consensus excludes its evaluated sportsbook");
assert.ok(Math.abs(promoted.projected_score.home + promoted.projected_score.away - promoted.model.total) < 1e-12, "decimal expected scores exactly generate Total mean");
assert.ok(Math.abs(promoted.projected_score.home - promoted.projected_score.away - promoted.model.margin) < 1e-12, "decimal expected scores exactly generate margin mean");
assert.ok(
  Math.abs(
    promoted.model.final_home_win_prob -
    promoted.target_excluded_market_decision.spread.margin_distribution.positiveProbability,
  ) < 1e-12,
  "Moneyline probability and score margin use the same maximum-entropy distribution",
);
assert.ok(
  promoted.model.margin !== Math.round(promoted.model.margin * 10) / 10 &&
  promoted.projected_score.home !== Math.round(promoted.projected_score.home * 10) / 10,
  "writer-facing projections preserve natural precision",
);
assert.ok(
  promoted.moneyline.confidence !== Math.round(promoted.moneyline.confidence) &&
  promoted.spread.confidence !== null &&
  promoted.spread.confidence !== Math.round(promoted.spread.confidence) &&
  promoted.total.confidence !== null &&
  promoted.total.confidence !== Math.round(promoted.total.confidence),
  "writer-facing Moneyline, Spread and Total probabilities preserve natural precision",
);
assert.equal(promoted.spread.grade, "Best Angle", "positive exact-price Spread clears the former flat cap");
assert.equal(promoted.total.grade, "Best Angle", "positive exact-price Total clears the former flat cap");

const evaluatedMlBook = promoted.target_excluded_market_decision.moneyline.evaluated?.sportsbook;
assert.ok(evaluatedMlBook, "integrated ML decision records an exact named-book target");
const changedExcludedMlOpposite = integratedRows.map((row) => ({
  ...row,
  odds: row.book === evaluatedMlBook && row.mkt === "moneyline" && row.selType === "away"
    ? 1000
    : row.odds,
}));
const excludedMlReplay = computeWnbaPrediction(
  model,
  { id: 88, date: "2026-09-02", h: 30, a: 10 },
  changedExcludedMlOpposite,
  {},
  undefined,
  undefined,
  { ...context, marketRows: changedExcludedMlOpposite },
);
assert.equal(
  excludedMlReplay.target_excluded_market_decision.moneyline.evaluated?.sportsbook,
  evaluatedMlBook,
  "fixed-point target remains stable when only its excluded opposing quote changes",
);
assert.equal(
  excludedMlReplay.model.final_home_win_prob,
  promoted.model.final_home_win_prob,
  "the evaluated ML book cannot self-validate through forecast consensus",
);
const changedFixedMlPrice = integratedRows.map((row) => ({
  ...row,
  odds: row.book === evaluatedMlBook && row.mkt === "moneyline" && row.selType === "home"
    ? (row.odds ?? 0) + 0.25
    : row.odds,
}));
const fixedPriceReplay = computeWnbaPrediction(
  model,
  { id: 88, date: "2026-09-02", h: 30, a: 10 },
  changedFixedMlPrice,
  {},
  undefined,
  undefined,
  { ...context, marketRows: changedFixedMlPrice },
);
assert.equal(
  fixedPriceReplay.target_excluded_market_decision.moneyline.evaluated?.sportsbook,
  evaluatedMlBook,
  "a bounded exact-price perturbation keeps the independently selected evaluated-book identity fixed",
);
assert.equal(
  fixedPriceReplay.model.final_home_win_prob,
  promoted.model.final_home_win_prob,
  "an exact-price perturbation with fixed target identity has zero forecast effect",
);

const expensiveRows = integratedRows.map((row) => ({
  ...row,
  odds: row.mkt === "point_spread" && row.selType === "home" || row.mkt === "total_points" && row.selType === "over"
    ? -2000
    : row.odds,
}));
const demoted = computeWnbaPrediction(
  model,
  { id: 88, date: "2026-09-02", h: 30, a: 10 },
  expensiveRows,
  {},
  undefined,
  undefined,
  { ...context, marketRows: expensiveRows },
);
assert.equal(demoted.spread.grade, "Watchlist", "negative exact-price Spread EV produces a tested demotion");
assert.equal(demoted.total.grade, "Watchlist", "negative exact-price Total EV produces a tested demotion");
assert.equal(demoted.model.margin, promoted.model.margin, "price-only demotion cannot move the forecast margin");
assert.equal(demoted.model.total, promoted.model.total, "price-only demotion cannot move the forecast total");

const elevenBookExpensiveRows: OddRow[] = Array.from({ length: 11 }, (_, index) => `book-${index}`).flatMap((book, index) => {
  const observedAt = new Date(Date.parse(decisionAt) - 20_000 + index * 500).toISOString();
  return [
    { book, sharp: index === 0, mkt: "moneyline", selType: "home", odds: -210, line: null, date: "2026-09-02", observedAt, startsAt, h: 30, a: 10 },
    { book, sharp: index === 0, mkt: "moneyline", selType: "away", odds: 175, line: null, date: "2026-09-02", observedAt, startsAt, h: 30, a: 10 },
    { book, sharp: index === 0, mkt: "point_spread", selType: "home", odds: -2000, line: 8.5, date: "2026-09-02", observedAt, startsAt, h: 30, a: 10 },
    { book, sharp: index === 0, mkt: "point_spread", selType: "away", odds: -110, line: -8.5, date: "2026-09-02", observedAt, startsAt, h: 30, a: 10 },
    { book, sharp: index === 0, mkt: "total_points", selType: "over", odds: -2000, line: 150.5, date: "2026-09-02", observedAt, startsAt, h: 30, a: 10 },
    { book, sharp: index === 0, mkt: "total_points", selType: "under", odds: -110, line: 150.5, date: "2026-09-02", observedAt, startsAt, h: 30, a: 10 },
  ];
});
const structuralDemotion = computeWnbaPrediction(
  model,
  { id: 89, date: "2026-09-02", h: 30, a: 10 },
  elevenBookExpensiveRows,
  {},
  undefined,
  undefined,
  { decisionAt, startsAt, marketRows: elevenBookExpensiveRows },
);
assert.ok(
  (structuralDemotion.spread_grade_policy.selected_projection_gap ?? 0) > 0 &&
  structuralDemotion.spread_grade_policy.rest_difference === 0 &&
  structuralDemotion.target_excluded_market_decision.spread.target_excluded_book_count >= 10,
  "the historical projection/rest Lean prerequisites are present after target exclusion",
);
assert.equal(structuralDemotion.spread.grade, "Watchlist", "negative exact-price EV demotes the formerly promotable Spread path");
assert.equal(structuralDemotion.spread_grade_policy.projection_rest_promoted, false, "the legacy Spread exception cannot bypass exact-price economics");

const singletonRows = integratedRows.filter((row) => row.book === "draftkings");
const singleton = computeWnbaPrediction(
  model,
  { id: 88, date: "2026-09-02", h: 30, a: 10 },
  singletonRows,
  {},
  undefined,
  undefined,
  { ...context, marketRows: singletonRows },
);
const absent = computeWnbaPrediction(
  model,
  { id: 88, date: "2026-09-02", h: 30, a: 10 },
  [],
  {},
  undefined,
  undefined,
  { ...context, marketRows: [] },
);
assert.equal(singleton.model.margin, absent.model.margin, "singleton optional evidence is exact independent-forecast identity");
assert.equal(singleton.model.total, absent.model.total, "missing optional evidence cannot flatten or move Total");
assert.equal(singleton.model.final_home_win_prob, absent.model.final_home_win_prob, "insufficient ML alternatives use the exact independent coherent probability");
assert.equal(
  singleton.moneyline.grade,
  "Best Angle",
  "a positive exact-price independent Moneyline edge remains actionable without alternative breadth",
);
assert.notEqual(singleton.spread.side, null, "an exact singleton pair still supplies a downstream evaluated Spread quote");
assert.notEqual(singleton.total.side, null, "an exact singleton pair still supplies a downstream evaluated Total quote");

const coldStartModel: ModelState = {
  ...model,
  games: new Map([[30, 2], [10, 3]]),
};
const coldStartIndependent = computeWnbaPrediction(
  coldStartModel,
  { id: 90, date: "2026-09-02", h: 30, a: 10 },
  [],
  {},
  undefined,
  undefined,
  { ...context, marketRows: [] },
);
const compatibleColdStartRows = integratedRows.map((row) => ({
  ...row,
  line: row.mkt === "point_spread"
    ? row.selType === "home" ? -8.5 : 8.5
    : row.line,
}));
const coldStartQualified = computeWnbaPrediction(
  coldStartModel,
  { id: 90, date: "2026-09-02", h: 30, a: 10 },
  compatibleColdStartRows,
  {},
  undefined,
  undefined,
  { ...context, marketRows: compatibleColdStartRows },
);
assert.deepEqual(
  computeWnbaPrediction(
    coldStartModel,
    { id: 90, date: "2026-09-02", h: 30, a: 10 },
    compatibleColdStartRows,
    {},
    undefined,
    undefined,
    { ...context, marketRows: compatibleColdStartRows },
  ),
  coldStartQualified,
  "the frozen target selection, source arbitration and posterior replay deterministically",
);
assert.equal(
  coldStartQualified.model.components.cold_start_market_prior_applied,
  false,
  "qualified target-excluded Moneyline evidence cannot enter through the cold-start anchor",
);
assert.equal(
  coldStartQualified.model.components.post_cold_anchor_home_win_probability,
  coldStartQualified.model.components.pre_market_home_win_probability,
  "the post-sport-model probability remains exact independent identity before the one dynamic market interpretation",
);
assert.equal(
  coldStartQualified.model.components.pre_market_home_win_probability,
  coldStartIndependent.model.final_home_win_prob,
  "cold-start sport evidence is identical to the no-market independent forecast",
);
assert.equal(
  coldStartQualified.model.components.moneyline_market_interpretation_count,
  1,
  "qualified target-excluded Moneyline evidence enters exactly once",
);
assert.notEqual(
  coldStartQualified.model.final_home_win_prob,
  coldStartIndependent.model.final_home_win_prob,
  "the retained dynamic Moneyline interpretation can still change the final posterior",
);
assert.equal(
  coldStartQualified.model.total,
  coldStartIndependent.model.total,
  "qualified market evidence leaves the independently modeled Total head byte/number-identical",
);
assert.ok(
  Math.abs(
    coldStartQualified.model.final_home_win_prob -
    coldStartQualified.target_excluded_market_decision.spread.margin_distribution.positiveProbability,
  ) < 1e-12 &&
    Math.abs(
      coldStartQualified.projected_score.home - coldStartQualified.projected_score.away -
      coldStartQualified.model.margin,
    ) < 1e-12,
  "the single-entry posterior still drives one coherent ML/Spread/score margin distribution",
);
assert.equal(
  Math.sign(coldStartQualified.model.final_home_win_prob - 0.5),
  Math.sign(coldStartQualified.model.margin),
  "a non-conflicting qualified favorite regime retains one publication-side winner",
);

const contradictoryColdStart = computeWnbaPrediction(
  coldStartModel,
  { id: 91, date: "2026-09-02", h: 30, a: 10 },
  integratedRows,
  {},
  undefined,
  undefined,
  context,
);
assert.equal(
  contradictoryColdStart.model.components.cross_market_context_regime,
  "cross_market_contradictory_independent_fallback",
  "opposing qualified Moneyline and Spread regimes reject market authority as a whole",
);
assert.equal(
  contradictoryColdStart.model.components.moneyline_market_interpretation_count,
  0,
  "a rejected cross-market story cannot enter the posterior",
);
assert.equal(
  contradictoryColdStart.target_excluded_market_decision.moneyline.market_authority_qualified,
  false,
  "cross-market contradiction rejects Moneyline authority while retaining its provenance",
);
assert.equal(
  contradictoryColdStart.target_excluded_market_decision.spread.forecast_used_target_excluded_market,
  false,
  "cross-market contradiction rejects the qualified Spread center as forecast authority",
);
assert.equal(
  contradictoryColdStart.model.final_home_win_prob,
  coldStartIndependent.model.final_home_win_prob,
  "cross-market contradiction returns the exact independent Moneyline probability",
);
assert.equal(
  contradictoryColdStart.model.margin,
  coldStartIndependent.model.margin,
  "cross-market contradiction returns the exact independent margin",
);
assert.equal(
  contradictoryColdStart.model.total,
  coldStartIndependent.model.total,
  "cross-market contradiction retains the exact independent Total",
);
assert.deepEqual(
  contradictoryColdStart.projected_score,
  coldStartIndependent.projected_score,
  "cross-market contradiction returns the exact independent decimal score decomposition",
);
assert.notEqual(
  contradictoryColdStart.target_excluded_market_decision.moneyline.evaluated,
  null,
  "fallback retains a genuine evaluated pair for downstream exact-price economics",
);
assert.notEqual(
  contradictoryColdStart.model.final_home_win_prob,
  0.5,
  "cross-market fallback never flattens the sport forecast to 0.5",
);

const compatibleFlipRows = integratedRows.map((row) => ({
  ...row,
  odds: row.mkt === "moneyline"
    ? row.selType === "home" ? 300 : -400
    : row.odds,
}));
const compatibleFlip = computeWnbaPrediction(
  coldStartModel,
  { id: 92, date: "2026-09-02", h: 30, a: 10 },
  compatibleFlipRows,
  {},
  undefined,
  undefined,
  { ...context, marketRows: compatibleFlipRows },
);
assert.ok(
  coldStartIndependent.model.final_home_win_prob > 0.5 &&
    compatibleFlip.model.final_home_win_prob < 0.5,
  "a non-conflicting qualified regime may legitimately flip the independent side",
);
assert.equal(
  compatibleFlip.model.components.moneyline_market_interpretation_count,
  1,
  "the legitimate side flip still uses exactly one dynamic market interpretation",
);
assert.equal(
  compatibleFlip.target_excluded_market_decision.moneyline.evaluated?.side,
  "away",
  "a posterior side flip reprices the complementary side from the fixed complete pair",
);
assert.equal(
  Math.sign(compatibleFlip.model.final_home_win_prob - 0.5),
  Math.sign(compatibleFlip.model.margin),
  "the non-conflicting flip preserves one publication-side winner",
);

const writerSource = readFileSync(new URL("../lib/services/wnba/runWnbaModel.ts", import.meta.url), "utf8");
const trackingSource = readFileSync(new URL("../lib/services/wnba/buildWnbaPredictionRecords.ts", import.meta.url), "utf8");
const cronSource = readFileSync(new URL("../app/api/cron/wnba-daily-refresh/route.ts", import.meta.url), "utf8");
assert.ok(
  writerSource.indexOf("if (lockedSet.has(g.id as number))") < writerSource.indexOf("payloads.push({"),
  "the sole model writer still skips immutable locked games before constructing an upsert payload",
);
assert.ok(
  trackingSource.includes("const lockedRec = new Set") && trackingSource.includes("!lockedRec.has"),
  "tracking still excludes every locked game-market identity from replacement",
);
assert.ok(
  cronSource.includes('leaseGroup: "prediction_pipeline"') && cronSource.includes("requireLease: true"),
  "the sole scheduled writer retains the shared WNBA prediction lease",
);

const gradeCounts = (prediction: typeof promoted) =>
  [prediction.moneyline.grade, prediction.spread.grade, prediction.total.grade]
    .reduce<Record<string, number>>((counts, grade) => {
      const key = grade ?? "No Pick";
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {});
console.log("WNBA target-excluded market decision tests passed", JSON.stringify({
  cold_start_independent_home_probability: coldStartIndependent.model.final_home_win_prob,
  cold_start_independent_margin: coldStartIndependent.model.margin,
  cold_start_independent_scores: coldStartIndependent.projected_score,
  cold_start_candidate_home_probability: coldStartQualified.model.final_home_win_prob,
  cold_start_candidate_margin: coldStartQualified.model.margin,
  cold_start_candidate_total: coldStartQualified.model.total,
  contradiction_fallback_home_probability: contradictoryColdStart.model.final_home_win_prob,
  legitimate_flip_home_probability: compatibleFlip.model.final_home_win_prob,
  promoted_grade_counts: gradeCounts(promoted),
  exact_price_demoted_grade_counts: gradeCounts(demoted),
}));
