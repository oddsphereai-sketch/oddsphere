/** Functional production-path scenarios, not historical prediction testing. */
import assert from "node:assert/strict";
import { runNbaAutoModelV2 } from "../lib/automodel/nba/nbaAutoModelV2";
import type { NbaPortableModelArtifact } from "../lib/automodel/nba/nbaPortableScoreModel";
import type { NbaGameSnapshot, NbaTeamRatingPack } from "../lib/automodel/nba/types";
import { buildNbaGameIntelligence } from "../lib/services/nba/nbaMarketIntelligence";
import { applyNbaProfessionalCandidate, buildNbaProfessionalCandidate } from "../lib/services/nba/nbaProfessionalCandidate";
import { buildNbaProfessionalMarketReader, type NbaReaderPriceRow, type NbaReaderSplitRow } from "../lib/services/nba/nbaProfessionalMarketReader";
import { readNbaPricedMarketMovement } from "../lib/services/nba/nbaPricedMarketMovement";
import { buildMarketSignal, buildNbaSharpStatus } from "../lib/services/nba/adaptNbaToDailyEdgeResponse";
import { gradeNbaMarket } from "../lib/services/nba/nbaMarketReview";
import { readFileSync } from "node:fs";

const evaluatedAt = "2026-10-31T18:00:00Z", opening = "2026-10-31T14:00:00Z", current = "2026-10-31T17:00:00Z";
const artifact: NbaPortableModelArtifact = { release: "functional_fixture", featureRelease: "functional_fixture", architecture: "margin_total",
  model: { family: "ridge", alpha: 1 }, design: { features: ["margin", "total"], missingIndicatorColumns: [], rawFeatureMedians: [0, 220],
    designMeans: [0, 0], designStandardDeviations: [1, 1], designColumns: 2, splineKnots: [] },
  coefficients: { target_home_margin: [1, 0, 0], target_total: [0, 1, 0] },
  distribution: { family: "normal_residual", marginSigma: 12, totalSigma: 18, calibratedOn: "functional_fixture" } };
const pair = (market: "moneyline" | "spread" | "total", book: string, at: string, number: number | null,
  prices: [number, number] = [-110, -110]): NbaReaderPriceRow[] => (market === "total" ? ["over", "under"] : ["home", "away"]).map((side, index) => ({
    market, sportsbook: book, sharpBook: ["circa", "pinnacle"].includes(book), provider: "owls", providerEventId: "9", ingestionRunId: `run:${at}`,
    selectionKey: `9:${market}:${side}`, line: market === "spread" && index === 1 ? -number! : number,
    americanPrice: prices[index]!, providerTimestamp: book === "circa" && at !== opening ? new Date(Date.parse(at) - 1000).toISOString() : at, fetchedAt: at }));
const movement = (market: "moneyline" | "spread" | "total", from: number | null, to: number | null,
  oldPrices: [number, number] = [-110, -110], newPrices: [number, number] = [-110, -110]) => ["circa", "pinnacle"].flatMap(book => [
    ...pair(market, book, opening, from, oldPrices), ...pair(market, book, current, to, newPrices) ]);
const lines = ["draftkings", "fanduel"].flatMap(sportsbook => [
  { market_type: "moneyline", sportsbook, side: "home", line_value: null, odds_american: -160, fetched_at: evaluatedAt },
  { market_type: "moneyline", sportsbook, side: "away", line_value: null, odds_american: 140, fetched_at: evaluatedAt },
  { market_type: "spread", sportsbook, side: "home", line_value: -5.5, odds_american: -110, fetched_at: evaluatedAt },
  { market_type: "spread", sportsbook, side: "away", line_value: 5.5, odds_american: -110, fetched_at: evaluatedAt },
  { market_type: "total", sportsbook, side: "over", line_value: 220, odds_american: -110, fetched_at: evaluatedAt },
  { market_type: "total", sportsbook, side: "under", line_value: 220, odds_american: -110, fetched_at: evaluatedAt },
]);
const ratings: NbaTeamRatingPack = { off_rating: 110, def_rating: 110, net_rating: 0, pace: 100,
  four_factors: { off_efg_pct: .5, off_tov_pct: .13, off_orb_pct: .27, off_ft_rate: .24,
    def_efg_pct: .5, def_tov_pct: .13, def_drb_pct: .73, def_ft_rate_allowed: .24 },
  sample_games: 82, source: "fixture", source_url: "fixture://ratings", fetched_at: evaluatedAt };
const snapshot: NbaGameSnapshot = { game_external_id: 9, slate_date: "2026-10-31", game_time_iso: "2026-10-31T23:00:00Z", season_type: "regular",
  home_team: { team_external_id: 1, abbreviation: "HME", off_rating: 110, def_rating: 110, net_rating: 0, pace: 100,
    recent_form_10g_net_rating: null, regular_season_ratings: ratings, playoff_ratings: null },
  away_team: { team_external_id: 2, abbreviation: "AWY", off_rating: 110, def_rating: 110, net_rating: 0, pace: 100,
    recent_form_10g_net_rating: null, regular_season_ratings: ratings, playoff_ratings: null }, home_injuries: [], away_injuries: [], series: null,
  market: { ml: { home_odds_american: -160, away_odds_american: 140 },
    spread: { home_line: -5.5, home_odds_american: -110, away_odds_american: -110 },
    total: { line: 220, over_odds_american: -110, under_odds_american: -110 } },
  data_quality: { ratings_present: true, home_injuries_known: true, away_injuries_known: true, market_present: true, series_context_derived: true } };
const baseline = runNbaAutoModelV2(snapshot, "t60_locked", { bookCount: 2, skipLegacyComparison: true });
function run(rows: NbaReaderPriceRow[], splits: NbaReaderSplitRow[] = [], margin = -4, total = 210) {
  const reader = buildNbaProfessionalMarketReader({ evaluatedAt, priceRows: rows, splitRows: splits, selectedLines: { spreadHome: -5.5, total: 220 } });
  const context = { eventId: "9", inputFingerprint: `fixture:${margin}:${total}`, evaluatedAt: opening,
    priceRows: rows.filter(r => Date.parse(r.fetchedAt) <= Date.parse(opening)), splitRows: splits, pricesTrusted: true, splitsTrusted: true };
  const seed = buildNbaProfessionalCandidate({ artifact, featureRow: { margin, total }, lines, history: [], externalGameId: 9, marketContext: context });
  const candidate = buildNbaProfessionalCandidate({ artifact, featureRow: { margin, total }, lines, history: [], externalGameId: 9, marketReader: reader,
    marketContext: { ...context, evaluatedAt, priceRows: rows, previousState: seed.marketConsequence!.state } });
  const prediction = applyNbaProfessionalCandidate({ baseline, candidate });
  const intel = buildNbaGameIntelligence({ snapshot, prediction, lines, splitsRow: null, opportunities: [], injuriesSource: "espn" });
  assert.equal(prediction.predicted_home_score, candidate.final.homeScore);
  assert.equal(prediction.predicted_away_score, candidate.final.awayScore);
  assert.equal(prediction.predicted_total, candidate.final.total);
  assert.ok(Math.abs(candidate.final.homeScore - candidate.final.awayScore - candidate.final.marginHome) < 1e-9);
  for (const [market, probability] of [["ml", candidate.probabilities.ml_home_win_prob], ["spread", candidate.probabilities.spread_home_cover_prob!],
    ["total", candidate.probabilities.total_over_prob!]] as const) {
    const side = market === "total" ? probability >= .5 ? "over" : "under" : probability >= .5 ? "home" : "away";
    assert.equal(intel[market].pick_side, side);
    assert.ok(Math.abs(intel[market].model_prob_on_pick! - Math.max(probability, 1 - probability)) < 1e-9);
    assert.notEqual(intel[market].grade, "held");
  }
  return { reader, candidate, prediction, intel };
}

const aligned = run([...movement("spread", -3.5, -5.5), ...movement("total", 215, 220)]);
assert.equal(aligned.candidate.final.movementApplied, true);
assert.equal(aligned.candidate.final.totalMovementApplied, true);
assert.deepEqual(aligned.candidate.picks, { moneyline: "away", spread: "away", total: "under" });
assert.ok(aligned.candidate.final.marginHome > -4 && aligned.candidate.final.marginHome < 0,
  "real support can weaken an Away forecast without forcing a Home crossing");
assert.ok(aligned.candidate.final.total > 210 && aligned.candidate.final.total < 220);

const compensated = run([...movement("spread", -3.5, -5.5, [-200, 170]), ...movement("total", 215, 220, [-400, 300])]);
assert.equal(compensated.reader.reads.spread.status, "qualified", "raw-number label alone previously qualified");
assert.equal(compensated.reader.reads.total.status, "qualified");
assert.equal(compensated.candidate.final.movementApplied, true, "overcompensation has actual opposite direction, not a blanket no-effect rule");
assert.equal(compensated.candidate.final.totalMovementApplied, true);
assert.ok(compensated.candidate.final.marginHome < -4);
assert.ok(compensated.candidate.final.total < 210);
assert.ok(compensated.candidate.readerDecisionAudit.pricedContractChecks.spread.every(c => c.status === "price_offsets_number"));
assert.ok(compensated.candidate.readerDecisionAudit.pricedContractChecks.total.every(c => c.status === "price_offsets_number"));
assert.deepEqual(compensated.prediction.audit.professional_grade_context!.namedBookPostures!.spread!.supportingSources, ["circa", "pinnacle"],
  "the final Away pick must see the same net economic support as the score decision");

const partial = run(movement("spread", -3.5, -5.5, [-125, 105]));
assert.equal(partial.candidate.final.movementApplied, true, "small counter-juice does not automatically cancel the actual net direction");
assert.ok(partial.candidate.readerDecisionAudit.pricedContractChecks.spread.every(c => c.equivalentLocationDelta! > 0));
assert.deepEqual(partial.prediction.audit.professional_grade_context!.namedBookPostures!.spread!.opposingSources, ["circa", "pinnacle"]);
assert.deepEqual(partial.prediction.audit.professional_grade_context!.namedBookPostures!.spread!.conflictingSources, []);
const mirroredTrail = { ...partial.reader.reads.spread.trails[0]!, openingNumber: -3.5, currentNumber: -5.5, numberDelta: -2,
  numberDirection: "away" as const, openingFairFirstProbability: 1 - partial.reader.reads.spread.trails[0]!.openingFairFirstProbability!,
  currentFairFirstProbability: 1 - partial.reader.reads.spread.trails[0]!.currentFairFirstProbability! };
const mirror = readNbaPricedMarketMovement({ market: "spread", trail: mirroredTrail, law: { marginSigma: 12, totalSigma: 18 } });
assert.ok(Math.abs(mirror.equivalentLocationDelta! + partial.candidate.readerDecisionAudit.pricedContractChecks.spread[0]!.equivalentLocationDelta!) < 1e-8);

const split: NbaReaderSplitRow = { provider: "owls", sourceBook: "circa", sourceType: "sharp_adjacent_book", market: "spread",
  selectionKey: "9:spread:home", betsPct: .4, moneyPct: .7, marketLine: -5.5, sourceObservedAt: current, fetchedAt: current };
const awayNumbers = movement("spread", -7.5, -5.5);
assert.equal(run(awayNumbers, [split]).reader.reads.spread.resistance, "reverse_flow");
const wrongContract = run(awayNumbers, [{ ...split, marketLine: 5.5 }]);
assert.equal(wrongContract.reader.reads.spread.flows[0]!.exactLineMatched, false);
assert.equal(wrongContract.reader.reads.spread.resistance, "none");
const futureSplit = run(awayNumbers, [{ ...split, fetchedAt: "2026-10-31T18:01:00Z" }]);
assert.equal(futureSplit.reader.reads.spread.flows.length, 0);
assert.equal(futureSplit.reader.reads.spread.resistance, "none");
const futurePrices = movement("spread", -3.5, -5.5).map(r => r.fetchedAt === current ? { ...r, fetchedAt: "2026-10-31T18:01:00Z" } : r);
assert.equal(run(futurePrices).candidate.final.movementApplied, false);
const fabricatedPair = movement("spread", -3.5, -5.5).map(r => r.selectionKey.endsWith(":away")
  ? { ...r, provider: "canonical_lines", providerEventId: "other_fixture", ingestionRunId: `other:${r.fetchedAt}` } : r);
const fabricated = run(fabricatedPair);
assert.equal(fabricated.reader.reads.spread.trails.length, 0, "two feeds cannot manufacture one paired contract");
assert.equal(fabricated.candidate.final.movementApplied, false);
const duplicate = movement("spread", -3.5, -5.5);
assert.equal(run([...duplicate, ...duplicate]).candidate.final.marginHome, run(duplicate).candidate.final.marginHome, "identical duplicates do not add votes or erase a coherent frame");
const twoProviders = [...movement("spread", -3.5, -5.5), ...movement("spread", -3.5, -5.5).map(r => ({ ...r, provider: "canonical_lines" }))];
assert.equal(run(twoProviders).reader.reads.spread.trails.length, 2, "two providers of two books remain two sources, not four");
const stale = movement("spread", -3.5, -5.5).map(r => ({ ...r, providerTimestamp: r.fetchedAt === current ? "2026-10-31T15:00:00Z" : "2026-10-31T14:00:00Z",
  fetchedAt: r.fetchedAt === current ? "2026-10-31T15:00:00Z" : "2026-10-31T14:00:00Z" }));
assert.equal(run(stale).candidate.final.movementApplied, false);

// Active continuous production head, not legacy hard-gated score selectors.
const directMl = run(movement("moneyline", null, null, [-110, -110], [-160, 140]));
assert.equal(directMl.reader.reads.moneyline.status, "qualified");
assert.ok(directMl.candidate.final.marginHome > -4);
assert.equal(directMl.prediction.audit.professional_grade_context!.moneyline!.directReadQualified, true);
assert.equal(directMl.intel.ml.qualified_market_direction!.state, directMl.candidate.picks.moneyline === "home" ? "confirmed" : "resistance");
const priceOnly = run(movement("spread", -5.5, -5.5, [-110, -110], [-160, 140]));
assert.ok(priceOnly.reader.reads.spread.trails.every(t => t.priceDirection === "home"));
assert.equal(priceOnly.candidate.final.movementApplied, true);
const held = run(movement("spread", -5.5, -5.5), [{ ...split, sourceObservedAt: "2026-10-31T16:00:00Z", fetchedAt: "2026-10-31T16:00:00Z" }]);
assert.equal(held.reader.reads.spread.resistance, "flow_resistance");
assert.equal(held.candidate.final.movementApplied, false);
assert.equal(held.candidate.marketConsequence!.pressure[0]!.reaction, "held");
const partialBuyback = run(["circa", "pinnacle"].flatMap(book => [
  ...pair("spread", book, opening, -3.5), ...pair("spread", book, "2026-10-31T15:00:00Z", -8.5), ...pair("spread", book, current, -5.5) ]));
assert.ok(partialBuyback.reader.reads.spread.trails.every(t => t.reversalMagnitude === 0), "known opening-relative reversal blind spot");
assert.ok(partialBuyback.candidate.marketConsequence!.sequences.every(p => p.retracement > 0 && p.latestLeg < 0), "active head catches the legacy reader's partial-buyback blind spot");
const supportedButTempered = run(["circa", "pinnacle"].flatMap(book => [
  ...pair("spread", book, opening, -3.5), ...pair("spread", book, "2026-10-31T15:00:00Z", -8.5), ...pair("spread", book, current, -5.5) ]), [], 10);
assert.ok(supportedButTempered.intel.spread.named_book_posture!.supportingSources.length > 0);
assert.ok(supportedButTempered.intel.spread.named_book_posture!.convictionRiskSources!.length > 0);
assert.equal(buildMarketSignal(supportedButTempered.intel.spread), "market_neutral", "member signal must not claim unqualified confirmation over internal buyback tempering");
assert.equal(buildNbaSharpStatus(supportedButTempered.intel.spread), "mixed");
const staticOnly = run(pair("moneyline", "circa", current, null, [300, -400]), [], 10);
assert.equal(staticOnly.candidate.final.marginHome, 10);
assert.equal(staticOnly.candidate.marketConsequence!.actions.margin, "context_only");
assert.equal(staticOnly.prediction.audit.professional_grade_context!.moneyline!.directReadQualified, false);
assert.deepEqual(staticOnly.intel.ml.named_book_posture!.staticOpposingSources, ["circa"]);
const strongStatic = { market: "moneyline" as const, pick: "home" as const, confidence: 70, modelProbabilityOnPick: .8,
  band: "support" as const, edge: .1, dataQualityTier: "high" as const, injuriesKnown: true, currentPriceAmerican: -160 };
assert.equal(gradeNbaMarket(strongStatic).grade, "best_angle");
assert.equal(gradeNbaMarket({ ...strongStatic, namedBookPosture: staticOnly.intel.ml.named_book_posture }).grade, "lean",
  "static opposition affects conviction/grade without fabricated score points or destroying genuine positive value");
assert.equal(buildMarketSignal(staticOnly.intel.ml), "market_resistance");
const heldHome = run(movement("spread", -5.5, -5.5), [{ ...split,
  sourceObservedAt: "2026-10-31T16:00:00Z", fetchedAt: "2026-10-31T16:00:00Z" }], 10);
assert.equal(heldHome.candidate.final.marginHome, 10, "held pressure must not invent score points");
assert.ok(heldHome.intel.spread.named_book_posture!.convictionRiskSources!.some(r => r.includes("held_under_pressure")));
assert.equal(gradeNbaMarket({ ...strongStatic, market: "spread", namedBookPosture: heldHome.intel.spread.named_book_posture }).grade, "lean",
  "the exact held-pressure interpretation must reach the actual grade policy");
assert.equal(buildMarketSignal(heldHome.intel.spread), "market_neutral");
const heldAway = run(movement("spread", -5.5, -5.5), [{ ...split,
  sourceObservedAt: "2026-10-31T16:00:00Z", fetchedAt: "2026-10-31T16:00:00Z" }], -10);
assert.equal(heldAway.candidate.final.marginHome, -10);
assert.deepEqual(heldAway.intel.spread.named_book_posture!.heldResistanceSupportingSources, ["circa"]);
assert.ok(heldAway.intel.spread.named_book_posture!.flowInterpretations!.some(p => p.reaction === "held" && p.quoteSide === null && p.resistanceSide === "away"));
assert.equal(gradeNbaMarket({ ...strongStatic, market: "spread", pick: "away", namedBookPosture: heldAway.intel.spread.named_book_posture }).grade, "best_angle",
  "resistance to opposite-side pressure supports retaining the earned grade, not a fake score move or blanket demotion");
assert.equal(buildMarketSignal(heldAway.intel.spread), "market_neutral", "a held quote is not falsely labeled a directional sharp buy");
const timedSplit = { ...split, sourceObservedAt: "2026-10-31T16:00:00Z", fetchedAt: "2026-10-31T16:00:00Z" };
const flowAligned = run(movement("spread", -5.5, -7.5), [timedSplit], 10);
assert.ok(flowAligned.intel.spread.named_book_posture!.flowInterpretations!.some(p =>
  p.source === "circa" && p.sourceType === "sharp_adjacent_book" && p.reaction === "aligned" && p.quoteSide === "home"));
assert.ok(flowAligned.candidate.final.marginHome > 10);
const flowOpposed = run(movement("spread", -5.5, -3.5), [timedSplit], 10);
assert.ok(flowOpposed.intel.spread.named_book_posture!.flowInterpretations!.some(p =>
  p.reaction === "opposed" && p.pressureSide === "home" && p.quoteSide === "away"));
assert.ok(flowOpposed.candidate.final.marginHome < 10);
assert.equal(gradeNbaMarket({ ...strongStatic, market: "spread", namedBookPosture: flowOpposed.intel.spread.named_book_posture }).grade, "lean");
assert.equal(buildMarketSignal(flowOpposed.intel.spread), "market_resistance");
const unresolved = run(["circa", "pinnacle"].flatMap(book => [...pair("spread", book, opening, -5.5),
  ...pair("spread", book, current, book === "circa" ? -6.5 : -4.5)]));
assert.equal(unresolved.candidate.final.movementQualified, false);
assert.equal(unresolved.candidate.final.movementApplied, false);
assert.equal(unresolved.prediction.audit.professional_grade_context!.moneyline!.spreadReadQualified, false);
const equalSourceRows = movement("spread", -5.5, -6.5).map(r => ({ ...r, providerTimestamp: r.fetchedAt }));
const equalSource = run(equalSourceRows);
assert.equal(equalSource.candidate.marketConsequence!.arbitration.margin.selectedSource, null);
assert.deepEqual(equalSource.candidate.marketConsequence!.arbitration.margin.equivalentSources, ["circa", "pinnacle"]);
assert.equal(equalSource.candidate.final.movementApplied, true);
assert.equal(equalSource.candidate.final.movementQualified, true, "equivalent composite episode retains qualification without arbitrary single-book credit");
const activeBaseline = runNbaAutoModelV2(snapshot, "t60_locked", { bookCount: 3, skipLegacyComparison: true });
assert.equal(activeBaseline.v0_comparison, null);
assert.equal(activeBaseline.v0_v1_delta.comparison_skipped, true);
const writerSource = readFileSync("lib/services/nba/buildNbaDailyEdgeAdapted.ts", "utf8");
assert.match(writerSource, /skipLegacyComparison: true/);
assert.doesNotMatch(writerSource, /retainLegacyScoreReconciliation: true|blendPosterior\(|groundNba/);
const untouched = run([], [], 0);
const favoriteToUnderdog = run(movement("moneyline", null, null, [-110, -110], [900, -1500]), [], 2);
assert.equal(favoriteToUnderdog.candidate.picks.moneyline, "away");
assert.ok(favoriteToUnderdog.candidate.final.homeScore < favoriteToUnderdog.candidate.final.awayScore);
assert.equal(favoriteToUnderdog.intel.ml.current_price.odds_american, 140, "the new winner is the actual offered underdog, not an invented quote");
const underdogToFavorite = run(movement("moneyline", null, null, [-110, -110], [-1500, 900]), [], -2);
assert.equal(underdogToFavorite.candidate.picks.moneyline, "home");
const spreadFlip = run(movement("spread", -5.5, -3.5), [], 6.5);
assert.equal(spreadFlip.candidate.picks.moneyline, "home", "winner and cover are distinct predictions");
assert.equal(spreadFlip.candidate.picks.spread, "away");
const overToUnder = run(movement("total", 220, 215), [], 2, 222);
assert.equal(overToUnder.candidate.picks.total, "under");
const underToOver = run(movement("total", 220, 225), [], 2, 218);
assert.equal(underToOver.candidate.picks.total, "over");
const promoted = run(movement("moneyline", null, null, [-110, -110], [-400, 300]), [], 0);
const demoted = run(movement("moneyline", null, null, [-110, -110], [300, -400]), [], 10);
const beforeDemotion = run([], [], 10);
const grades = [untouched.intel.ml.grade, promoted.intel.ml.grade, beforeDemotion.intel.ml.grade, demoted.intel.ml.grade];
const actionable = (grade: string) => ["lean", "best_angle"].includes(grade);
assert.equal(actionable(untouched.intel.ml.grade), false);
assert.equal(actionable(promoted.intel.ml.grade), true, "same decision path can promote a genuine playable forecast, not only demote");
assert.equal(actionable(beforeDemotion.intel.ml.grade), true);
assert.equal(actionable(demoted.intel.ml.grade), false);
assert.ok(promoted.candidate.final.marginHome > untouched.candidate.final.marginHome);
assert.ok(demoted.candidate.final.marginHome < beforeDemotion.candidate.final.marginHome);
console.log(JSON.stringify({ functionalControls: "passed", finalScoreProbabilityPickGradePath: "checked",
  repaired: ["number_price_compensation", "direct_ML_score_authority", "price_only_score_response", "held_pressure_context", "partial_buyback", "causal_exact_pairs"],
  pairedGradeScenarios: grades,
  pairedBoardImpact: { before: 1, after: 1, promotions: 1, demotions: 1 },
  historicalGames: 0, providerCalls: 0, productionWrites: 0 }));
