import assert from "node:assert/strict";
import { assessConfidenceLeanPrice } from "../lib/services/dailyEdge/confidenceLeanPrice";
import { gradeNbaMarket, gradeNbaR28MarketForAudit, type GradeInput } from "../lib/services/nba/nbaMarketReview";
import { pairedNbaOpposingPrice, type NbaLineRow } from "../lib/services/nba/nbaMarketIntelligence";
import { buildCbbInterpretedDecision } from "../lib/cbb/contextualInterpretedDecision";
import { buildCbbContextualMarketInterpretation } from "../lib/cbb/contextualMarketInterpretation";

const priceInput = { winProbability: .58, loseProbability: .42, price: -150, opposingPrice: 130, minimumWinProbability: .55 };
assert.equal(assessConfidenceLeanPrice(priceInput).qualified, true, "negative offered value can be a confidence Lean");
assert.equal(assessConfidenceLeanPrice({ ...priceInput, winProbability: .54, loseProbability: .46 }).qualified, false);
assert.equal(assessConfidenceLeanPrice({ ...priceInput, price: -300, opposingPrice: 250 }).qualified, false, "actual price disagreement still matters");
assert.equal(assessConfidenceLeanPrice({ ...priceInput, opposingPrice: NaN }).qualified, false);
assert.equal(assessConfidenceLeanPrice({ ...priceInput, opposingPrice: -500 }).qualified, false, "an incoherent pair cannot lend a wide margin allowance");
const push = assessConfidenceLeanPrice({ ...priceInput, loseProbability: .35 });
assert.equal(push.requiredUnconditionalWinProbability, (.6 - (.6 + 100 / 230 - 1)) * .93, "pushes are refunded, not counted as wins");

const nba: GradeInput = { market: "moneyline", pick: "home", confidence: 58, band: "mild_conflict", edge: -.02,
  dataQualityTier: "high", injuriesKnown: true, currentPriceAmerican: -150, pairedOpposingPriceAmerican: 130, modelProbabilityOnPick: .58 };
for (const market of ["moneyline", "spread", "total"] as const) {
  const x = { ...nba, market, pick: market === "total" ? "over" : "home" };
  assert.equal(gradeNbaR28MarketForAudit(x).grade, "watch");
  assert.equal(gradeNbaMarket(x).grade, "lean");
  assert.equal(gradeNbaMarket({ ...x, dataQualityTier: "low" }).grade, "watch");
  assert.equal(gradeNbaMarket({ ...x, pairedOpposingPriceAmerican: undefined }).grade, "watch");
  const posture = { release: "nba_named_book_posture_2026_11_04_r9_own_book_pressure" as const,
    evaluatedAt: "2026-11-06T18:00:00Z", market, pickedSide: x.pick as "home" | "over", supportingSources: ["circa"],
    opposingSources: [], conflictingSources: [], consequence: "correct", scoreEffectApplied: true, forecastAuthorityGranted: false as const };
  assert.equal(gradeNbaMarket({ ...x, namedBookPosture: posture }).grade, "lean", "confirmation cannot call a confidence-only Lean a positive-value Best");
  assert.equal(gradeNbaMarket({ ...x, namedBookPosture: { ...posture, supportingSources: [], opposingSources: ["circa", "pinnacle"] } }).grade, "watch", "real corroborated opposition still tempers confidence");
  const betterPrice = { ...x, band: "support" as const, currentPriceAmerican: -110, pairedOpposingPriceAmerican: -110, edge: .08 };
  assert.equal(gradeNbaMarket({ ...betterPrice, namedBookPosture: posture }).grade, "lean", "market confirmation cannot waive Best confidence");
  assert.equal(gradeNbaMarket({ ...betterPrice, confidence: 65, modelProbabilityOnPick: .65 }).grade, "best_angle", "stronger confidence can reach Best at the same sound price");
}
const first: NbaLineRow = { market_type: "spread", side: "home", line_value: -3.5, sportsbook: "draftkings", odds_american: -150, fetched_at: "2026-11-06T18:00:00Z" };
const other = { ...first, side: "away", line_value: 3.5, odds_american: 130 };
assert.equal(pairedNbaOpposingPrice([first, other], first), 130);
for (const bad of [{ ...other, sportsbook: "fanduel" }, { ...other, line_value: 4.5 }, { ...other, fetched_at: "2026-11-06T18:01:00Z" }])
  assert.equal(pairedNbaOpposingPrice([first, bad], first), null, "cross-book/line/capture prices cannot be paired");
assert.equal(pairedNbaOpposingPrice([first, other, { ...other, odds_american: 125 }], first), null, "conflicting prices fail closed");

const at = "2026-11-06T18:00:00Z";
const quote = { gameId: 7, market: "moneyline" as const, line: null, sportsbook: "draftkings", provider: "owls" as const,
  firstPrice: -150, secondPrice: 130, phase: "current" as const, orientationVerified: true,
  requestedAt: "2026-11-06T17:58:59Z", providerObservedAt: "2026-11-06T17:58:00Z", fetchedAt: "2026-11-06T17:59:00Z" };
const input = { asOf: at, startsAt: "2026-11-06T23:00:00Z", currentQuotes: [quote], independent: {
  gameId: 7, asOf: at, release: "test", inputStatus: "complete" as const, margin: 2.5, total: 145 } };
const latent = { marginMean: 2.5, totalMean: 145, marginSd: 12, totalSd: 15, correlation: 0 };
const build = (marginLocationSd: number, q = quote) => {
  const i = { ...input, currentQuotes: [q] };
  return buildCbbInterpretedDecision({ input: i, interpretation: buildCbbContextualMarketInterpretation(i),
    latent, targets: [q], recommendationRisk: { calibrationGames: 137, marginLocationSd, totalLocationSd: .1 } });
};
const stable = build(.1), row = stable.marketDecisions[0];
assert(row.expectedValue! < 0 && row.probability! > .55);
assert.equal(row.grade, "Lean");
assert.equal(row.recommendationBasis, "outcome_confidence");
assert.equal(row.recommendationRisk!.supported, false, "negative price economics stay truthfully recorded");
assert.equal(row.confidenceLeanAssessment!.supported, true);
const fragile = build(30);
assert.notEqual(fragile.marketDecisions[0].grade, "Lean", "location uncertainty can withhold the same nominal-confidence Lean");
assert.deepEqual(stable.finalScore, fragile.finalScore);
assert.equal(row.probability, fragile.marketDecisions[0].probability);
assert.equal(row.expectedValue, fragile.marketDecisions[0].expectedValue);
assert.equal(build(.1, { ...quote, firstPrice: -300, secondPrice: 250 }).marketDecisions[0].grade, "No Play", "price still limits materially out-of-envelope offers");
assert.equal(build(.1, { ...quote, providerObservedAt: "2026-11-06T16:00:00Z" }).marketDecisions[0].grade, "Held");
console.log("Confidence-led CBB/NBA Lean, real price envelope, uncertainty, paired promotion/opposition and exact quote tests passed");
