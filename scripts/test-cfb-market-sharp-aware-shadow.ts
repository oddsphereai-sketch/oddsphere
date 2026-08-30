import assert from "node:assert/strict";
import type { NcaafBookOdds } from "../lib/services/football/balldontlieNcaafSlate";
import {
  CFB_MARKET_SHARP_AWARE_CANDIDATE_RELEASE,
  CFB_MARKET_SHARP_AWARE_PRODUCTION_RELEASE,
  annotateCfbCrossMarketGradeCoherence,
  applyCfbMarketSharpAwareGrades,
  buildCfbMarketEvidenceGradeShadow,
  buildCfbMarketSharpAwareForecast,
  buildCfbMarketSharpAwareShadowForecast,
  CFB_MARKET_SHADOW_WEIGHT,
} from "../lib/services/football/cfbMarketSharpAwareShadow";
import { CFB_SHARP_API_SPLITS_RELEASE, type CfbSharpApiSplitRecord } from "../lib/services/football/cfbSharpApiSplits";
import { buildCfbV1DecisionBundle, getCfbV1Forecast } from "../lib/services/football/cfbV1Decision";
import { resolveCfbCanonicalMarketAnchor } from "../lib/services/football/cfbMarketInformedOutcome";

const observedAt = "2026-08-28T12:00:00.000Z";
const books = [
  book("draftkings", -4, 48.5),
  book("fanduel", -4, 48.5),
  book("caesars", -3.5, 49),
];
const independent = getCfbV1Forecast("457159");
const anchor = resolveCfbCanonicalMarketAnchor({ books });
assert.ok(anchor);

const noSharp = buildCfbMarketSharpAwareShadowForecast({ independentForecast: independent, anchor, sharpSplits: [], evaluatedAt: observedAt });
assert.equal(noSharp.marketWeight, CFB_MARKET_SHADOW_WEIGHT);
assert.equal(noSharp.sharpAdjustment.source, null);
assert.equal(noSharp.sharpAdjustment.homeMarginShiftPoints, 0);
assert.equal(noSharp.sharpAdjustment.totalShiftPoints, 0);
assert.ok(noSharp.expectedMarginHome > independent.expectedMarginHome, "the market-dominant forecast moves the Hawaii margin toward Stanford");

const sharpHomeOver = sharpRecord({
  homeTickets: 40,
  homeMoney: 60,
  overTickets: 42,
  overMoney: 62,
});
const withSharp = buildCfbMarketSharpAwareShadowForecast({ independentForecast: independent, anchor, sharpSplits: [sharpHomeOver], evaluatedAt: observedAt });
assert.equal(withSharp.sharpAdjustment.source, "circa");
assert.equal(withSharp.sharpAdjustment.homeMarginShiftPoints, 1.5);
assert.equal(withSharp.sharpAdjustment.totalShiftPoints, 1.5);
assert.ok(withSharp.expectedMarginHome > noSharp.expectedMarginHome, "strict home sharp support moves the coherent margin toward Stanford");
assert.ok(withSharp.expectedTotal > noSharp.expectedTotal, "strict Over sharp support moves the coherent total upward");

const mass = withSharp.pmf.reduce((sum, cell) => sum + cell.probability, 0);
const expectedHome = withSharp.pmf.reduce((sum, cell) => sum + cell.home * cell.probability, 0);
const expectedAway = withSharp.pmf.reduce((sum, cell) => sum + cell.away * cell.probability, 0);
assert.ok(Math.abs(mass - 1) < 1e-12);
assert.ok(Math.abs(expectedHome - withSharp.expectedHomePoints) < 1e-12);
assert.ok(Math.abs(expectedAway - withSharp.expectedAwayPoints) < 1e-12);
assert.ok(Math.abs(expectedHome - expectedAway - withSharp.expectedMarginHome) < 1e-12);
assert.ok(Math.abs(expectedHome + expectedAway - withSharp.expectedTotal) < 1e-12);
const authoritative = buildCfbMarketSharpAwareForecast({ independentForecast: independent, anchor, sharpSplits: [sharpHomeOver], evaluatedAt: observedAt });
assert.equal(authoritative.release, CFB_MARKET_SHARP_AWARE_PRODUCTION_RELEASE);
assert.equal(authoritative.candidateRelease, CFB_MARKET_SHARP_AWARE_CANDIDATE_RELEASE);
assert.equal(authoritative.marketWeight, 0.75);

const staleSharp = buildCfbMarketSharpAwareForecast({
  independentForecast: independent,
  anchor,
  sharpSplits: [{ ...sharpHomeOver, capturedAt: "2026-08-28T09:59:59.000Z" }],
  evaluatedAt: observedAt,
});
assert.equal(staleSharp.sharpAdjustment.source, null, "a Circa split older than 120 minutes cannot move the forecast");
const futureSharp = buildCfbMarketSharpAwareForecast({
  independentForecast: independent,
  anchor,
  sharpSplits: [{ ...sharpHomeOver, capturedAt: "2026-08-28T12:00:00.001Z" }],
  evaluatedAt: observedAt,
});
assert.equal(futureSharp.sharpAdjustment.source, null, "future-dated Circa evidence cannot move the forecast");

const baseBundle = buildCfbV1DecisionBundle({
  providerGameId: "457159",
  awayTeam: "HAW",
  homeTeam: "STAN",
  gameStartsAt: "2026-08-29T23:00:00.000Z",
  comparableCurrentBooks: books,
  evaluatedAt: observedAt,
});
const moneyline = baseBundle.evaluatedBets.find((decision) => decision.market === "moneyline");
assert.ok(moneyline);
assert.match(moneyline.side, /^HAW/);

const sharpAwayResistance = sharpRecord({ homeTickets: 40, homeMoney: 60, overTickets: 50, overMoney: 50 });
const resisted = buildCfbMarketEvidenceGradeShadow({
  decision: { ...moneyline, grade: "Best Angle" },
  selectedSide: "away",
  sharpSplits: [sharpAwayResistance],
  operationalOpening: { quote: { ...books.find((row) => row.sportsbook === moneyline.evaluatedQuote.sportsbook)!, moneyline: { homePrice: -155, awayPrice: 130 } } },
});
assert.equal(resisted.sharpDirection, "resistance");
assert.equal(resisted.movementDirection, "resistance");
assert.equal(resisted.finalGrade, "Watchlist", "joint strict-sharp and same-book resistance demotes Best Angle two rungs");

const sharpAwaySupport = sharpRecord({ homeTickets: 60, homeMoney: 40, overTickets: 50, overMoney: 50 });
const promoted = buildCfbMarketEvidenceGradeShadow({
  decision: { ...moneyline, grade: "Watchlist", edgePercentagePoints: 2.5, expectedValue: 0.01, evaluatedQuote: { ...moneyline.evaluatedQuote, price: 155 } },
  selectedSide: "away",
  sharpSplits: [sharpAwaySupport],
  operationalOpening: null,
});
assert.equal(promoted.sharpDirection, "support");
assert.equal(promoted.finalGrade, "Lean", "strict sharp support promotes a positive near-threshold Watchlist");

const negative = buildCfbMarketEvidenceGradeShadow({
  decision: { ...moneyline, grade: "No Play", edgePercentagePoints: -3.1, expectedValue: -0.11 },
  selectedSide: "away",
  sharpSplits: [sharpAwaySupport],
  operationalOpening: null,
});
assert.equal(negative.finalGrade, "No Play", "materially negative value remains No Play despite sharp support");

const nearNeutral = buildCfbMarketEvidenceGradeShadow({
  decision: { ...moneyline, grade: "No Play", edgePercentagePoints: 0.5, expectedValue: -0.02 },
  selectedSide: "away",
  sharpSplits: [],
  operationalOpening: null,
});
assert.equal(nearNeutral.finalGrade, "Watchlist", "near-neutral exact-price value is monitored rather than flattened to No Play");
assert.deepEqual(nearNeutral.reasonCodes, ["near_neutral_price_monitoring"]);

const supportedDisagreement = buildCfbMarketEvidenceGradeShadow({
  decision: { ...moneyline, grade: "No Play", edgePercentagePoints: -2.5, expectedValue: -0.09 },
  selectedSide: "away",
  sharpSplits: [sharpAwaySupport],
  operationalOpening: null,
});
assert.equal(supportedDisagreement.finalGrade, "Watchlist", "qualified sharp support can create a non-actionable disagreement monitor");
assert.deepEqual(supportedDisagreement.reasonCodes, ["supportive_market_evidence_disagreement_monitoring"]);

const resistedNearNeutral = buildCfbMarketEvidenceGradeShadow({
  decision: { ...moneyline, grade: "No Play", edgePercentagePoints: 0.5, expectedValue: -0.02 },
  selectedSide: "away",
  sharpSplits: [sharpAwayResistance],
  operationalOpening: null,
});
assert.equal(resistedNearNeutral.finalGrade, "No Play", "sharp resistance blocks a cosmetic Watchlist promotion");

const spreadLean = buildCfbMarketEvidenceGradeShadow({
  decision: { ...moneyline, market: "spread", grade: "Lean", side: "HAW +4", evaluatedQuote: { ...moneyline.evaluatedQuote, line: 4 } },
  selectedSide: "away",
  sharpSplits: [],
  operationalOpening: null,
});
const coherent = annotateCfbCrossMarketGradeCoherence([nearNeutral, spreadLean]);
assert.equal(coherent[0]?.finalGrade, "Watchlist");
assert.equal(coherent[1]?.finalGrade, "Lean");
assert.ok(coherent.every((row) => row.reasonCodes.includes("spread_value_can_exceed_moneyline_price_value")),
  "a Spread Lean and same-team Moneyline Watchlist is explained as price value, not forced into matching grades");

const borderlineLargerSpread = buildCfbMarketEvidenceGradeShadow({
  decision: {
    ...moneyline,
    market: "spread",
    grade: "Watchlist",
    side: "TCU -8.5",
    edgePercentagePoints: 4.9939,
    expectedValue: 0.062,
    evaluatedQuote: { ...moneyline.evaluatedQuote, line: -8.5, price: -105 },
  },
  selectedSide: "home",
  sharpSplits: [],
  operationalOpening: null,
});
assert.equal(borderlineLargerSpread.finalGrade, "Lean", "a positive-EV spread through ten points clears the recalibrated 4.99pp boundary");
assert.deepEqual(borderlineLargerSpread.reasonCodes, ["recalibrated_borderline_spread_lean"]);

const productionAdjusted = applyCfbMarketSharpAwareGrades({
  homeTeam: "TCU",
  bundle: {
    ...baseBundle,
    evaluatedBets: [{
      ...moneyline,
      market: "spread",
      grade: "Watchlist",
      probabilityGrade: "Watchlist",
      side: "TCU -8.5",
      edgePercentagePoints: 4.9939,
      expectedValue: 0.06205,
      evaluatedQuote: { ...moneyline.evaluatedQuote, line: -8.5, price: -105 },
    }],
  },
  sharpSplits: [],
  operationalOpening: null,
});
assert.equal(productionAdjusted.evaluatedBets[0]?.grade, "Lean", "TCU -8.5 must be promoted in the writer-owned production decision tuple");
assert.equal(productionAdjusted.evaluatedBets[0]?.gradeAdjustment?.release, CFB_MARKET_SHARP_AWARE_PRODUCTION_RELEASE);
assert.deepEqual(productionAdjusted.evaluatedBets[0]?.gradeAdjustment?.reasonCodes, ["recalibrated_borderline_spread_lean"]);

const abbreviationMapped = applyCfbMarketSharpAwareGrades({
  homeTeam: "UVA",
  bundle: {
    ...baseBundle,
    forecast: { ...baseBundle.forecast, homeTeam: "Virginia Cavaliers" },
    evaluatedBets: [{ ...moneyline, side: "UVA", grade: "Watchlist" }],
  },
  sharpSplits: [sharpHomeOver],
  operationalOpening: null,
});
assert.equal(abbreviationMapped.evaluatedBets[0]?.gradeAdjustment?.sharpDirection, "support", "the writer must map an abbreviated home decision to the home split rather than the away split");

const provisionalBestAngle = buildCfbMarketEvidenceGradeShadow({
  decision: {
    ...moneyline,
    market: "total",
    grade: "Lean",
    side: "Under 60.5",
    modelProbability: 0.56,
    edgePercentagePoints: 5.2,
    expectedValue: 0.07,
    evaluatedQuote: { ...moneyline.evaluatedQuote, line: 60.5, price: -110 },
  },
  selectedSide: "under",
  sharpSplits: [],
  operationalOpening: null,
});
assert.equal(provisionalBestAngle.finalGrade, "Best Angle", "a complete high-probability, high-edge, high-EV Lean advances to Best Angle");
assert.deepEqual(provisionalBestAngle.reasonCodes, ["provisional_complete_tuple_best_angle"]);

const provisionalSpreadLean = buildCfbMarketEvidenceGradeShadow({
  decision: {
    ...moneyline,
    market: "spread",
    grade: "Watchlist",
    side: "TCU -4",
    modelProbability: 0.54,
    edgePercentagePoints: 3,
    expectedValue: 0.03,
    evaluatedQuote: { ...moneyline.evaluatedQuote, line: -4, price: -200 },
  },
  selectedSide: "home",
  sharpSplits: [],
  operationalOpening: null,
});
assert.equal(provisionalSpreadLean.finalGrade, "Lean", "the provisional playable-price band permits a qualified exact-price Spread favorite");
assert.deepEqual(provisionalSpreadLean.reasonCodes, ["provisional_complete_tuple_spread_lean"]);

const provisionalTotalLean = buildCfbMarketEvidenceGradeShadow({
  decision: {
    ...moneyline,
    market: "total",
    grade: "Watchlist",
    side: "Under 53.5",
    modelProbability: 0.53,
    edgePercentagePoints: 3,
    expectedValue: 0.02,
    evaluatedQuote: { ...moneyline.evaluatedQuote, line: 53.5, price: 260 },
  },
  selectedSide: "under",
  sharpSplits: [],
  operationalOpening: null,
});
assert.equal(provisionalTotalLean.finalGrade, "Lean", "the owner-approved exact-price band permits a qualified plus-money Total");
assert.deepEqual(provisionalTotalLean.reasonCodes, ["provisional_complete_tuple_total_lean"]);

const widenedRecalibratedSpread = buildCfbMarketEvidenceGradeShadow({
  decision: {
    ...moneyline,
    market: "spread",
    grade: "Watchlist",
    side: "TCU -4",
    modelProbability: 0.52,
    edgePercentagePoints: 5,
    expectedValue: 0.01,
    evaluatedQuote: { ...moneyline.evaluatedQuote, line: -4, price: 260 },
  },
  selectedSide: "home",
  sharpSplits: [],
  operationalOpening: null,
});
assert.equal(widenedRecalibratedSpread.finalGrade, "Lean", "the bounded spread recalibration is not restricted to -125 through +125");

const pathologicalPrice = buildCfbMarketEvidenceGradeShadow({
  decision: {
    ...moneyline,
    market: "spread",
    grade: "Watchlist",
    side: "TCU -4",
    modelProbability: 0.54,
    edgePercentagePoints: 3,
    expectedValue: 0.03,
    evaluatedQuote: { ...moneyline.evaluatedQuote, line: -4, price: -600 },
  },
  selectedSide: "home",
  sharpSplits: [],
  operationalOpening: null,
});
assert.equal(pathologicalPrice.finalGrade, "Watchlist", "pathological prices remain outside the provisional actionable ladder");

const excessiveSpread = buildCfbMarketEvidenceGradeShadow({
  decision: {
    ...moneyline,
    market: "spread",
    grade: "Watchlist",
    side: "STAN -10.5",
    edgePercentagePoints: 5.5,
    expectedValue: 0.07,
    evaluatedQuote: { ...moneyline.evaluatedQuote, line: -10.5, price: -105 },
  },
  selectedSide: "home",
  sharpSplits: [],
  operationalOpening: null,
});
assert.equal(excessiveSpread.finalGrade, "Watchlist", "the larger-spread recalibration stays capped at ten points");

console.log("CFB market/sharp-aware shadow coherence and balanced grade tests passed.");

function book(sportsbook: string, homeSpread: number, totalLine: number): NcaafBookOdds {
  return {
    providerGameId: "457159",
    sportsbook,
    observedAt,
    provider: "balldontlie",
    targetEligible: true,
    moneyline: { homePrice: -180, awayPrice: 155 },
    spread: { homeLine: homeSpread, homePrice: -110, awayLine: -homeSpread, awayPrice: -110 },
    total: { line: totalLine, overPrice: -110, underPrice: -110 },
  };
}

function sharpRecord(args: {
  homeTickets: number;
  homeMoney: number;
  overTickets: number;
  overMoney: number;
}): CfbSharpApiSplitRecord {
  return {
    release: CFB_SHARP_API_SPLITS_RELEASE,
    providerGameId: "457159",
    providerEventId: "ncaaf_hawaii_stanford_2026-08-29",
    sportsbook: "circa",
    sourceSemantics: "sharp_adjacent",
    capturedAt: observedAt,
    moneyline: {
      home: { ticketsPct: args.homeTickets, moneyPct: args.homeMoney },
      away: { ticketsPct: 100 - args.homeTickets, moneyPct: 100 - args.homeMoney },
    },
    spread: {
      homeLine: -4,
      awayLine: 4,
      home: { ticketsPct: args.homeTickets, moneyPct: args.homeMoney },
      away: { ticketsPct: 100 - args.homeTickets, moneyPct: 100 - args.homeMoney },
    },
    total: {
      line: 48.5,
      over: { ticketsPct: args.overTickets, moneyPct: args.overMoney },
      under: { ticketsPct: 100 - args.overTickets, moneyPct: 100 - args.overMoney },
    },
  };
}
