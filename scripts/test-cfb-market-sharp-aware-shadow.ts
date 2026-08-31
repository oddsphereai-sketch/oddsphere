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
const playbookLine = { provider: "playbook" as const, capturedAt: observedAt, sourceTier: "consensus", homeMoneyline: -180, awayMoneyline: 155, homeSpread: -4, awaySpread: 4, total: 48.5 };

const noSharp = buildCfbMarketSharpAwareShadowForecast({ independentForecast: independent, anchor, sharpSplits: [], evaluatedAt: observedAt });
assert.equal(noSharp.marketWeight, CFB_MARKET_SHADOW_WEIGHT);
assert.equal(noSharp.sharpAdjustment.source, null);
assert.equal(noSharp.sharpAdjustment.homeMarginShiftPoints, 0);
assert.equal(noSharp.sharpAdjustment.totalShiftPoints, 0);
assert.ok(noSharp.expectedMarginHome > independent.expectedMarginHome, "the market-dominant forecast moves the Hawaii margin toward Stanford");

const publicHomeOver = publicSplitSet({ homeTickets: 40, homeMoney: 60, overTickets: 40, overMoney: 60 });
const withPublic = buildCfbMarketSharpAwareShadowForecast({ independentForecast: independent, anchor, sharpSplits: [], playbookLine, publicSplits: publicHomeOver, evaluatedAt: observedAt });
assert.equal(withPublic.publicConsensusAdjustment.source, "playbook_public_consensus");
assert.equal(withPublic.publicConsensusAdjustment.homeMarginShiftPoints, 0.75);
assert.equal(withPublic.publicConsensusAdjustment.totalShiftPoints, 0.75);
assert.ok(withPublic.expectedMarginHome > noSharp.expectedMarginHome, "public home money-versus-ticket divergence must move the coherent margin at bounded lower strength");
assert.ok(withPublic.expectedTotal > noSharp.expectedTotal, "public Over money-versus-ticket divergence must move the coherent total at bounded lower strength");
const stalePublic = Object.fromEntries(Object.entries(publicHomeOver).map(([market, split]) => [market, { ...split, capturedAt: "2026-08-28T05:29:59.000Z" }])) as typeof publicHomeOver;
const stalePublicForecast = buildCfbMarketSharpAwareShadowForecast({ independentForecast: independent, anchor, sharpSplits: [], playbookLine, publicSplits: stalePublic, evaluatedAt: observedAt });
assert.equal(stalePublicForecast.publicConsensusAdjustment.source, null, "public evidence older than the far-game cadence is unavailable");
const futurePublic = Object.fromEntries(Object.entries(publicHomeOver).map(([market, split]) => [market, { ...split, capturedAt: "2026-08-28T12:00:00.001Z" }])) as typeof publicHomeOver;
const futurePublicForecast = buildCfbMarketSharpAwareShadowForecast({ independentForecast: independent, anchor, sharpSplits: [], playbookLine, publicSplits: futurePublic, evaluatedAt: observedAt });
assert.equal(futurePublicForecast.publicConsensusAdjustment.source, null, "future public evidence cannot move the forecast");
const lineOnlyPublic = {
  ...publicHomeOver,
  moneyline: { ...publicHomeOver.moneyline, homeMoneyPct: null, awayMoneyPct: null, homeBetsPct: null, awayBetsPct: null },
};
const mismatchedPublicForecast = buildCfbMarketSharpAwareShadowForecast({
  independentForecast: independent,
  anchor,
  sharpSplits: [],
  playbookLine: { ...playbookLine, homeSpread: -6, awaySpread: 6, total: 51 },
  publicSplits: lineOnlyPublic,
  evaluatedAt: observedAt,
});
assert.equal(mismatchedPublicForecast.publicConsensusAdjustment.homeMarginShiftPoints, 0, "mismatched public Spread evidence cannot move the margin anchor");
assert.equal(mismatchedPublicForecast.publicConsensusAdjustment.totalShiftPoints, 0, "mismatched public Total evidence cannot move the total anchor");

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

const publicAwayUnder = publicSplitSet({ homeTickets: 60, homeMoney: 40, overTickets: 60, overMoney: 40 });
const opposingInputs = buildCfbMarketSharpAwareShadowForecast({ independentForecast: independent, anchor, sharpSplits: [sharpHomeOver], playbookLine, publicSplits: publicAwayUnder, evaluatedAt: observedAt });
assert.equal(opposingInputs.sharpAdjustment.homeMarginShiftPoints, 1.5);
assert.equal(opposingInputs.publicConsensusAdjustment.homeMarginShiftPoints, -0.75);
assert.ok(opposingInputs.expectedMarginHome > noSharp.expectedMarginHome, "full-strength Circa support must remain stronger than opposing public consensus");
const weakSharpHomeOver = sharpRecord({ homeTickets: 44, homeMoney: 56, overTickets: 44, overMoney: 56 });
const weakSharpOpposed = buildCfbMarketSharpAwareShadowForecast({ independentForecast: independent, anchor, sharpSplits: [weakSharpHomeOver], playbookLine, publicSplits: publicAwayUnder, evaluatedAt: observedAt });
assert.ok(weakSharpOpposed.sharpAdjustment.homeMarginShiftPoints > 0);
assert.ok(weakSharpOpposed.sharpAdjustment.adjustedAnchor.homeSpread <= anchor.homeSpread, "opposing public consensus cannot reverse a qualifying Circa anchor direction");

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

const dominantFavorite = buildCfbMarketSharpAwareForecast({
  independentForecast: {
    ...independent,
    providerGameId: "unit-probability-bound",
    homeWinProbability: 1,
    pmf: [{ home: 70, away: 0, probability: 1 }],
  },
  anchor: { homeSpread: -54, totalLine: 61.75, namedBookCount: 4, source: "named_book_median" },
  sharpSplits: [],
  evaluatedAt: observedAt,
});
assert.equal(dominantFavorite.homeWinProbability, 1, "floating PMF mass within 1e-12 of unity is published as an exact unit probability");
assert.throws(() => buildCfbMarketSharpAwareForecast({
  independentForecast: {
    ...independent,
    providerGameId: "invalid-probability",
    pmf: [{ home: 70, away: 0, probability: Number.NaN }],
  },
  anchor: { homeSpread: -54, totalLine: 61.75, namedBookCount: 4, source: "named_book_median" },
  sharpSplits: [],
  evaluatedAt: observedAt,
}), /invalid winner probability/, "materially invalid PMF probability remains fail-closed");

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
  decision: { ...moneyline, grade: "Watchlist", probabilityGrade: "Watchlist", modelProbability: 0.54, edgePercentagePoints: 2.5, expectedValue: 0.01, evaluatedQuote: { ...moneyline.evaluatedQuote, price: 155 } },
  selectedSide: "away",
  sharpSplits: [sharpAwaySupport],
  operationalOpening: null,
});
assert.equal(promoted.sharpDirection, "support");
assert.equal(promoted.finalGrade, "Lean", "strict sharp support promotes a positive near-threshold Watchlist");

const publicPromoted = buildCfbMarketEvidenceGradeShadow({
  decision: { ...moneyline, grade: "Watchlist", probabilityGrade: "Watchlist", modelProbability: 0.54, edgePercentagePoints: 2.5, expectedValue: 0.01, evaluatedQuote: { ...moneyline.evaluatedQuote, price: 155 } },
  selectedSide: "away",
  sharpSplits: [],
  playbookLine,
  publicSplits: publicAwayUnder,
  operationalOpening: null,
});
assert.equal(publicPromoted.publicDirection, "support");
assert.equal(publicPromoted.finalGrade, "Lean", "positive-EV near-threshold public money support promotes a complete Watchlist");
assert.deepEqual(publicPromoted.reasonCodes, ["public_consensus_near_threshold_promotion"]);

const circaPriorityPromotion = buildCfbMarketEvidenceGradeShadow({
  decision: { ...moneyline, grade: "Watchlist", probabilityGrade: "Watchlist", modelProbability: 0.54, edgePercentagePoints: 2.5, expectedValue: 0.01, evaluatedQuote: { ...moneyline.evaluatedQuote, price: 155 } },
  selectedSide: "away",
  sharpSplits: [sharpAwaySupport],
  playbookLine,
  publicSplits: publicHomeOver,
  operationalOpening: null,
});
assert.equal(circaPriorityPromotion.sharpDirection, "support");
assert.equal(circaPriorityPromotion.publicDirection, "resistance");
assert.equal(circaPriorityPromotion.finalGrade, "Lean", "qualifying Circa support takes priority over opposing public consensus");

const publicResisted = buildCfbMarketEvidenceGradeShadow({
  decision: { ...moneyline, grade: "Lean" },
  selectedSide: "away",
  sharpSplits: [],
  playbookLine,
  publicSplits: publicHomeOver,
  operationalOpening: null,
});
assert.equal(publicResisted.publicDirection, "resistance");
assert.equal(publicResisted.finalGrade, "Watchlist", "strong public money resistance must remain the paired adverse safety path");

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
  decision: { ...moneyline, market: "spread", grade: "Lean", probabilityGrade: "Lean", side: "HAW +4", modelProbability: 0.54, edgePercentagePoints: 3, expectedValue: 0.03, evaluatedQuote: { ...moneyline.evaluatedQuote, line: 4 } },
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
    probabilityGrade: "Watchlist",
    side: "TCU -8.5",
    modelProbability: 0.52,
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
      modelProbability: 0.52,
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

const provisionalMoneylineLean = buildCfbMarketEvidenceGradeShadow({
  decision: { ...moneyline, grade: "Watchlist", modelProbability: 0.56, edgePercentagePoints: 2.2, expectedValue: 0.015, evaluatedQuote: { ...moneyline.evaluatedQuote, price: 155 } },
  selectedSide: "away",
  sharpSplits: [],
  operationalOpening: null,
});
assert.equal(provisionalMoneylineLean.finalGrade, "Lean", "a complete positive-EV playable Moneyline Watchlist has a bounded Lean lane");
assert.deepEqual(provisionalMoneylineLean.reasonCodes, ["provisional_complete_tuple_moneyline_lean"]);

const provisionalLargeSpreadLean = buildCfbMarketEvidenceGradeShadow({
  decision: { ...moneyline, market: "spread", grade: "Watchlist", side: "STAN -20.5", modelProbability: 0.55, edgePercentagePoints: 3.2, expectedValue: 0.035, evaluatedQuote: { ...moneyline.evaluatedQuote, line: -20.5, price: -110 } },
  selectedSide: "home",
  sharpSplits: [],
  operationalOpening: null,
});
assert.equal(provisionalLargeSpreadLean.finalGrade, "Lean", "a stronger exact-economics lane supports spreads from 10.5 through 24 points");
assert.deepEqual(provisionalLargeSpreadLean.reasonCodes, ["provisional_complete_tuple_large_spread_lean"]);

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
    side: "STAN -24.5",
    edgePercentagePoints: 5.5,
    expectedValue: 0.07,
    evaluatedQuote: { ...moneyline.evaluatedQuote, line: -24.5, price: -105 },
  },
  selectedSide: "home",
  sharpSplits: [],
  operationalOpening: null,
});
assert.equal(excessiveSpread.finalGrade, "Watchlist", "the larger-spread recalibration stays capped at 24 points");

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

function publicSplitSet(args: {
  homeTickets: number;
  homeMoney: number;
  overTickets: number;
  overMoney: number;
}) {
  const common = { provider: "playbook" as const, capturedAt: observedAt, booksUsed: 11 };
  return {
    moneyline: { ...common, homeMoneyPct: args.homeMoney, awayMoneyPct: 100 - args.homeMoney, homeBetsPct: args.homeTickets, awayBetsPct: 100 - args.homeTickets, overMoneyPct: null, underMoneyPct: null, overBetsPct: null, underBetsPct: null },
    spread: { ...common, homeMoneyPct: args.homeMoney, awayMoneyPct: 100 - args.homeMoney, homeBetsPct: args.homeTickets, awayBetsPct: 100 - args.homeTickets, overMoneyPct: null, underMoneyPct: null, overBetsPct: null, underBetsPct: null },
    total: { ...common, homeMoneyPct: null, awayMoneyPct: null, homeBetsPct: null, awayBetsPct: null, overMoneyPct: args.overMoney, underMoneyPct: 100 - args.overMoney, overBetsPct: args.overTickets, underBetsPct: 100 - args.overTickets },
  };
}
