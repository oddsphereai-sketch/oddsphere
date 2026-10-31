import assert from "node:assert/strict";
import type { NflPreviewBookOdds } from "../lib/services/football/balldontlieNflPreviewSlate";
import type { NflForwardContextMarket } from "../lib/services/football/nflForwardEvidenceCapture";
import {
  buildNflThreeStateMarketAuthority,
  applyNflThreeStateMarketReader,
  NFL_THREE_STATE_MARKET_READER_RELEASE,
  type NflThreeStateMarketAuthority,
} from "../lib/services/football/nflThreeStateMarketReader";
import {
  applyNflThreeStateGradePolicy,
} from "../lib/services/football/nflTargetExcludedMarketOutcome";
import {
  buildNflIndependentScoreBaseForecast,
  getNflV1WeekOneOutcomeForecast,
} from "../lib/services/football/nflV1WeekOneOutcome";
import type { NflV1ActionableGradeBundle } from "../lib/services/football/nflV1ActionableGradeCandidate";
import type { NflRegularEvaluatedBetDecision } from "../lib/services/football/nflRegularDecisionEvidence";
import {
  NFL_V1_MEMBER_RELEASE,
  NFL_V1_PRODUCTION_MODEL_RELEASE,
  NFL_V1_PRODUCTION_CALIBRATION_RELEASE,
  NFL_V1_PRODUCTION_DECISION_RELEASE,
  NFL_V1_GRADE_POLICY_RELEASE,
} from "../lib/services/football/nflV1ProductionDecision";

const evaluatedAt = "2026-10-25T16:00:00.000Z";
const gameStartsAt = "2026-10-26T20:00:00.000Z";
const base = buildNflIndependentScoreBaseForecast({
  baseForecast: getNflV1WeekOneOutcomeForecast({
    providerGameId: "three-state-test",
    awayTeam: "AWY",
    homeTeam: "HME",
    weeklyFallback: { projectedHomeMargin: 4, marketTotal: 44 },
  }),
  independentScore: {
    expectedHomeMargin: 4,
    expectedTotal: 44,
    marketInputPolicy: "prohibited_from_independent_score",
  },
});

const authority = (overrides: Partial<NflThreeStateMarketAuthority>): NflThreeStateMarketAuthority => ({
  release: NFL_THREE_STATE_MARKET_READER_RELEASE,
  status: "available",
  reason: "qualified_named_price_and_two_source_flow",
  side: 1,
  outcomeBoundarySide: 1,
  spreadBoundary: 3,
  namedSources: ["circa", "pinnacle"],
  confirmingSplitSources: ["public_consensus"],
  excludedFamilies: ["fanduel"],
  ...overrides,
});

const confirmation = applyNflThreeStateMarketReader({ forecast: base, authority: authority({ side: 1 }) });
assert.equal(confirmation.expectedHomeScore - confirmation.expectedAwayScore, 4);
assert.equal(confirmation.threeStateMarketReader?.state, "confirmation");

const narrowHomeWinner = buildNflIndependentScoreBaseForecast({
  baseForecast: getNflV1WeekOneOutcomeForecast({
    providerGameId: "winner-cover-disagreement-test",
    awayTeam: "AWY",
    homeTeam: "HME",
    weeklyFallback: { projectedHomeMargin: 2, marketTotal: 44 },
  }),
  independentScore: {
    expectedHomeMargin: 2,
    expectedTotal: 44,
    marketInputPolicy: "prohibited_from_independent_score",
  },
});
const favoriteCoverCorrection = applyNflThreeStateMarketReader({
  forecast: narrowHomeWinner,
  authority: authority({ side: 1, outcomeBoundarySide: 1, spreadBoundary: 3 }),
  marketImpliedHomeMargin: 4,
});
assert.equal(favoriteCoverCorrection.threeStateMarketReader?.state, "value_resistance",
  "agreeing on the outright winner is not confirmation when the qualified sharp side opposes the projected cover");
assert.equal(favoriteCoverCorrection.expectedHomeScore - favoriteCoverCorrection.expectedAwayScore, 4,
  "a qualified favorite-cover read may cross the spread boundary while preserving the independent winner");
assert.equal(favoriteCoverCorrection.threeStateMarketReader?.spreadBoundaryCorrectionApplied, true);
assert.ok(Math.abs(favoriteCoverCorrection.expectedHomeScore +
  favoriteCoverCorrection.expectedAwayScore - 44) < 1e-6,
"a cover-side correction cannot alter the Total projection");

const outcomeCorrection = applyNflThreeStateMarketReader({
  forecast: base,
  authority: authority({ side: -1, outcomeBoundarySide: -1 }),
  marketImpliedHomeMargin: -4,
});
assert.equal(outcomeCorrection.expectedHomeScore - outcomeCorrection.expectedAwayScore, -4);
assert.equal(outcomeCorrection.threeStateMarketReader?.state, "outcome_correction");
assert.ok(Math.abs(outcomeCorrection.expectedHomeScore + outcomeCorrection.expectedAwayScore - 44) < 1e-6,
  "Moneyline correction must leave the validated Total reader unchanged");

const valueResistance = applyNflThreeStateMarketReader({
  forecast: base,
  authority: authority({ side: -1, outcomeBoundarySide: 1, spreadBoundary: 3 }),
  marketImpliedHomeMargin: 1.5,
});
assert.equal(valueResistance.expectedHomeScore - valueResistance.expectedAwayScore, 1.5);
assert.equal(valueResistance.threeStateMarketReader?.state, "value_resistance");
assert.equal(valueResistance.threeStateMarketReader?.spreadBoundaryCorrectionApplied, true);
assert.ok(Math.abs(valueResistance.expectedHomeScore + valueResistance.expectedAwayScore - 44) < 1e-6,
  "a qualified underdog-cover read must preserve the Total projection");

const rejectedWinnerCross = applyNflThreeStateMarketReader({
  forecast: base,
  authority: authority({ side: -1, outcomeBoundarySide: 1, spreadBoundary: -1 }),
  marketImpliedHomeMargin: -2,
});
assert.equal(rejectedWinnerCross.expectedHomeScore - rejectedWinnerCross.expectedAwayScore, 4,
  "value resistance cannot cross the outright winner boundary");
assert.equal(rejectedWinnerCross.threeStateMarketReader?.spreadBoundaryCorrectionApplied, false);
const noPairedPrice = applyNflThreeStateMarketReader({
  forecast: base,
  authority: authority({ side: -1, outcomeBoundarySide: -1, spreadBoundary: 3 }),
});
assert.equal(noPairedPrice.expectedHomeScore - noPairedPrice.expectedAwayScore, 4,
  "a categorical signal without a target-excluded paired price cannot reflect a score across zero or a line");
assert.equal(noPairedPrice.threeStateMarketReader?.outcomeCorrectionApplied, false);

const moneylineFamilies: NflForwardContextMarket["families"] = [
  ["circa", "s", "c", null,
    ["2026-10-25T14:00:00.000Z", 120, "f", null, -120, 110],
    ["2026-10-25T15:00:00.000Z", 60, "f", null, 105, -115]],
  ["pinnacle", "s", "c", null,
    ["2026-10-25T14:00:00.000Z", 120, "f", null, -118, 108],
    ["2026-10-25T15:00:00.000Z", 60, "f", null, 102, -112]],
];
const books: NflPreviewBookOdds[] = [
  book("fanduel", -145, 125, -2.5),
  book("draftkings", -140, 120, -3),
  book("betmgm", -138, 118, -3),
  book("caesars", -142, 122, -3.5),
];
const builtAuthority = buildNflThreeStateMarketAuthority({
  evaluatedAt,
  snapshots: [{
    capturedAt: evaluatedAt,
    markets: {
      moneyline: { families: moneylineFamilies },
      spread: { families: [] },
      total: { families: [] },
    },
  }],
  current: books[0]!,
  comparableCurrentBooks: books,
  playbookLine: null,
  playbookSplits: splitSet(65, 45),
  sharpSplits: sharpSplitSet(64, 44),
  excludedFamilies: ["fanduel"],
});
assert.equal(builtAuthority.status, "available");
assert.equal(builtAuthority.side, 1, "persistent named-book price movement plus independent flow authorizes the read");
assert.equal(builtAuthority.outcomeBoundarySide, -1,
  "target-excluded fair Moneyline probability owns the natural outright-winner boundary");
assert.equal(builtAuthority.spreadBoundary, 3);
assert.deepEqual(builtAuthority.excludedFamilies, ["fanduel"]);

const subtleTwoSourceAuthority = buildNflThreeStateMarketAuthority({
  evaluatedAt,
  snapshots: [{
    capturedAt: evaluatedAt,
    markets: {
      moneyline: { families: moneylineFamilies },
      spread: { families: [] },
      total: { families: [] },
    },
  }],
  current: books[0]!,
  comparableCurrentBooks: books,
  playbookLine: null,
  playbookSplits: splitSet(47, 45),
  sharpSplits: sharpSplitSet(48, 45),
  excludedFamilies: ["fanduel"],
});
assert.equal(subtleTwoSourceAuthority.status, "available",
  "two independent agreeing 2pp/3pp flows confirm a persistent named-book move");

const oneSourceAuthority = buildNflThreeStateMarketAuthority({
  evaluatedAt,
  snapshots: [{
    capturedAt: evaluatedAt,
    markets: {
      moneyline: { families: moneylineFamilies },
      spread: { families: [] },
      total: { families: [] },
    },
  }],
  current: books[0]!,
  comparableCurrentBooks: books,
  playbookLine: null,
  playbookSplits: splitSet(47, 45),
  sharpSplits: null,
  excludedFamilies: ["fanduel"],
});
assert.equal(oneSourceAuthority.reason, "no_independent_flow_confirmation",
  "one subtle source cannot authorize a side read");

const opposingFlowAuthority = buildNflThreeStateMarketAuthority({
  evaluatedAt,
  snapshots: [{
    capturedAt: evaluatedAt,
    markets: {
      moneyline: { families: moneylineFamilies },
      spread: { families: [] },
      total: { families: [] },
    },
  }],
  current: books[0]!,
  comparableCurrentBooks: books,
  playbookLine: null,
  playbookSplits: splitSet(47, 45),
  sharpSplits: sharpSplitSet(43, 45),
  excludedFamilies: ["fanduel"],
});
assert.equal(opposingFlowAuthority.reason, "opposing_flow",
  "an opposing second source vetoes the side read");

const resistanceBooks: NflPreviewBookOdds[] = [
  book("fanduel", -145, 125, 2.5),
  book("draftkings", -140, 120, 3),
  book("betmgm", -138, 118, 3),
  book("caesars", -142, 122, 3.5),
];
const crossMarketResistanceAuthority = buildNflThreeStateMarketAuthority({
  evaluatedAt,
  snapshots: [{
    capturedAt: evaluatedAt,
    markets: {
      moneyline: { families: moneylineFamilies },
      spread: { families: [] },
      total: { families: [] },
    },
  }],
  current: resistanceBooks[0]!,
  comparableCurrentBooks: resistanceBooks,
  playbookLine: null,
  playbookSplits: splitSet(43, 45),
  sharpSplits: null,
  excludedFamilies: ["fanduel"],
});
assert.equal(crossMarketResistanceAuthority.status, "available");
assert.equal(crossMarketResistanceAuthority.reason,
  "qualified_opposing_flow_and_cross_market_consensus");
assert.equal(crossMarketResistanceAuthority.side, -1,
  "opposing flow plus target-excluded Moneyline and Spread consensus identifies resistance to the named move");
assert.equal(crossMarketResistanceAuthority.outcomeBoundarySide, -1);
assert.equal(crossMarketResistanceAuthority.spreadBoundary, -3);
const crossMarketResistanceCorrection = applyNflThreeStateMarketReader({
  forecast: narrowHomeWinner,
  authority: crossMarketResistanceAuthority,
  marketImpliedHomeMargin: -8,
});
assert.equal(crossMarketResistanceCorrection.threeStateMarketReader?.state, "outcome_correction");
assert.equal(crossMarketResistanceCorrection.expectedHomeScore -
  crossMarketResistanceCorrection.expectedAwayScore, -8,
  "the resistance route selects a target-excluded price-derived score candidate");
assert.ok(Math.abs(crossMarketResistanceCorrection.expectedHomeScore +
  crossMarketResistanceCorrection.expectedAwayScore - 44) < 1e-6,
  "cross-market resistance cannot alter the independently resolved Total projection");

const baltimoreAuthority = buildNflThreeStateMarketAuthority({
  evaluatedAt,
  snapshots: [{
    capturedAt: evaluatedAt,
    markets: {
      moneyline: { families: [
        ["circa", "s", "c", null,
          ["2026-10-25T14:00:00.000Z", 120, "f", null, 146, -174],
          ["2026-10-25T15:00:00.000Z", 60, "f", null, -154, 130]],
      ] },
      spread: { families: [] },
      total: { families: [] },
    },
  }],
  current: book("fanduel", -150, 128, 3),
  comparableCurrentBooks: [
    book("fanduel", -150, 128, 3),
    book("draftkings", -154, 130, 3),
    book("betmgm", -148, 126, 2.5),
    book("caesars", -152, 129, 3.5),
  ],
  playbookLine: null,
  playbookSplits: splitSet(30, 32),
  sharpSplits: sharpSplitSet(25, 28),
  excludedFamilies: ["fanduel"],
});
assert.equal(baltimoreAuthority.reason, "qualified_named_price_and_two_source_flow");
assert.equal(baltimoreAuthority.side, -1);
assert.equal(baltimoreAuthority.outcomeBoundarySide, -1);
const baltimoreCorrection = applyNflThreeStateMarketReader({
  forecast: base, authority: baltimoreAuthority, marketImpliedHomeMargin: -4,
});
assert.equal(baltimoreCorrection.expectedHomeScore - baltimoreCorrection.expectedAwayScore, -4,
  "the Cincinnati-over-Baltimore pattern crosses the target-excluded 50% boundary and corrects the winner");

const crossMarketBaltimoreAuthority = buildNflThreeStateMarketAuthority({
  evaluatedAt,
  snapshots: [{
    capturedAt: evaluatedAt,
    markets: {
      moneyline: { families: [
        ["circa", "s", "c", null,
          ["2026-10-25T14:00:00.000Z", 120, "f", null, 146, -174],
          ["2026-10-25T15:00:00.000Z", 60, "f", null, -154, 130]],
      ] },
      spread: { families: [] },
      total: { families: [] },
    },
  }],
  current: book("fanduel", -150, 128, 3),
  comparableCurrentBooks: [
    book("fanduel", -150, 128, 3),
    book("draftkings", -154, 130, 3),
    book("betmgm", -148, 126, 2.5),
    book("caesars", -152, 129, 3.5),
  ],
  playbookLine: null,
  playbookSplits: splitSet(30, 32),
  sharpSplits: null,
  excludedFamilies: ["fanduel"],
});
assert.equal(crossMarketBaltimoreAuthority.reason,
  "qualified_named_price_flow_and_cross_market_consensus",
  "one independent flow may qualify only when target-excluded Moneyline and Spread consensus agree");
const crossMarketBaltimoreCorrection = applyNflThreeStateMarketReader({
  forecast: base,
  authority: crossMarketBaltimoreAuthority,
  marketImpliedHomeMargin: -10,
});
assert.equal(crossMarketBaltimoreCorrection.expectedHomeScore -
  crossMarketBaltimoreCorrection.expectedAwayScore, -10,
"the cross-market route selects the target-free paired-price score candidate");
assert.ok(Math.abs(crossMarketBaltimoreCorrection.expectedHomeScore +
  crossMarketBaltimoreCorrection.expectedAwayScore - 44) < 1e-6,
"the cross-market correction cannot alter the Total projection");

const sanFranciscoBase = buildNflIndependentScoreBaseForecast({
  baseForecast: getNflV1WeekOneOutcomeForecast({
    providerGameId: "sf-atl-regression",
    awayTeam: "SF",
    homeTeam: "ATL",
    weeklyFallback: { projectedHomeMargin: -7.873, marketTotal: 45 },
  }),
  independentScore: {
    expectedHomeMargin: -7.873,
    expectedTotal: 45,
    marketInputPolicy: "prohibited_from_independent_score",
  },
});
const sanFranciscoAuthority = buildNflThreeStateMarketAuthority({
  evaluatedAt,
  snapshots: [{
    capturedAt: evaluatedAt,
    markets: {
      moneyline: { families: [
        ["circa", "s", "c", null,
          ["2026-10-25T14:00:00.000Z", 120, "f", null, -178, 158],
          ["2026-10-25T15:00:00.000Z", 60, "f", null, -140, 120]],
      ] },
      spread: { families: [] },
      total: { families: [] },
    },
  }],
  current: book("fanduel", -142, 120, 2.5),
  comparableCurrentBooks: [
    book("fanduel", -142, 120, 2.5),
    book("draftkings", -140, 118, 2.5),
    book("betmgm", -145, 122, 3),
    book("caesars", -138, 116, 2.5),
  ],
  playbookLine: null,
  playbookSplits: splitSet(29, 27),
  sharpSplits: sharpSplitSet(19, 16),
  excludedFamilies: ["fanduel"],
});
assert.equal(sanFranciscoAuthority.reason, "qualified_named_price_and_two_source_flow");
assert.equal(sanFranciscoAuthority.side, 1);
assert.equal(sanFranciscoAuthority.outcomeBoundarySide, -1);
const sanFranciscoCorrection = applyNflThreeStateMarketReader({
  forecast: sanFranciscoBase,
  authority: sanFranciscoAuthority,
  marketImpliedHomeMargin: -1.25,
});
assert.equal(sanFranciscoCorrection.expectedHomeScore - sanFranciscoCorrection.expectedAwayScore, -1.25,
  "the Atlanta resistance pattern changes the cover side without blindly flipping the SF winner");
assert.equal(sanFranciscoCorrection.threeStateMarketReader?.outcomeCorrectionApplied, false);
assert.equal(sanFranciscoCorrection.threeStateMarketReader?.spreadBoundaryCorrectionApplied, true);

const baseline = bundle([
  decision("moneyline", "HME", "Lean", 0.56, 0.54, -110, null),
  decision("spread", "AWY", "Watchlist", 0.55, 0.54, -110, 3),
  decision("total", "Over 44", "Lean", 0.56, 0.54, -110, 44),
]);
const candidate = bundle(baseline.evaluatedBets.map((row) => ({ ...row })));
const graded = applyNflThreeStateGradePolicy({ baseline, candidate, outcome: valueResistance });
assert.equal(graded.evaluatedBets.find((row) => row.market === "moneyline")?.grade, "Watchlist",
  "qualified value resistance demotes a resisted actionable Moneyline");
assert.equal(graded.evaluatedBets.find((row) => row.market === "spread")?.grade, "Lean",
  "a corrected aligned positive-EV Spread Watchlist may become Lean");
assert.deepEqual(
  graded.evaluatedBets.find((row) => row.market === "total"),
  baseline.evaluatedBets.find((row) => row.market === "total"),
  "the three-state side reader cannot change Total decisions",
);

const opposedSpreadBaseline = bundle([
  decision("moneyline", "HME", "Lean", 0.56, 0.54, -110, null),
  decision("spread", "HME", "Lean", 0.56, 0.54, -110, -3),
  decision("total", "Over 44", "Lean", 0.56, 0.54, -110, 44),
]);
const opposedSpread = applyNflThreeStateGradePolicy({
  baseline: opposedSpreadBaseline,
  candidate: opposedSpreadBaseline,
  outcome: valueResistance,
  demoteOpposedSpreadActionable: true,
});
assert.equal(opposedSpread.evaluatedBets.find((row) => row.market === "spread")?.grade, "Watchlist",
  "qualified value resistance demotes an actionable Spread opposed to the reader side");
assert.deepEqual(
  opposedSpread.evaluatedBets.find((row) => row.market === "total"),
  opposedSpreadBaseline.evaluatedBets.find((row) => row.market === "total"),
  "a Spread demotion cannot leak into the Total decision",
);

const outcomeCandidate = bundle(baseline.evaluatedBets.map((row) =>
  row.market === "moneyline" ? { ...row, grade: "Lean" } : { ...row }));
const nonActionableBaseline = bundle(baseline.evaluatedBets.map((row) =>
  row.market === "moneyline" ? { ...row, grade: "Watchlist" } : { ...row }));
const promotionGuard = applyNflThreeStateGradePolicy({
  baseline: nonActionableBaseline,
  candidate: outcomeCandidate,
  outcome: outcomeCorrection,
});
assert.equal(promotionGuard.evaluatedBets.find((row) => row.market === "moneyline")?.grade, "Watchlist",
  "the same market signal cannot manufacture a new actionable Moneyline");

console.log("NFL three-state reader: authority, outcome boundary, value resistance, grade independence, and Total freeze passed");

function book(sportsbook: string, awayPrice: number, homePrice: number, homeLine: number): NflPreviewBookOdds {
  return {
    providerGameId: "three-state-test",
    sportsbook,
    observedAt: "2026-10-25T15:30:00.000Z",
    moneyline: { awayPrice, homePrice },
    spread: { awayLine: -homeLine, homeLine, awayPrice: -110, homePrice: -110 },
    total: { line: 44, overPrice: -110, underPrice: -110 },
  };
}

function splitSet(homeMoneyPct: number, homeBetsPct: number) {
  const row = {
    provider: "playbook" as const,
    capturedAt: "2026-10-25T15:30:00.000Z",
    booksUsed: 6,
    homeMoneyPct,
    awayMoneyPct: 100 - homeMoneyPct,
    homeBetsPct,
    awayBetsPct: 100 - homeBetsPct,
    overMoneyPct: 50,
    underMoneyPct: 50,
    overBetsPct: 50,
    underBetsPct: 50,
  };
  return { moneyline: row, spread: row, total: row };
}

function sharpSplitSet(homeMoneyPct: number, homeBetsPct: number) {
  const row = {
    provider: "sharpapi" as const,
    providerGameId: "three-state-test",
    sourceEventId: "three-state-test-event",
    sourceSportsbook: "draftkings",
    providerFetchedAt: "2026-10-25T15:30:00.000Z",
    capturedAt: "2026-10-25T15:30:00.000Z",
    homeMoneyPct,
    awayMoneyPct: 100 - homeMoneyPct,
    homeBetsPct,
    awayBetsPct: 100 - homeBetsPct,
    overMoneyPct: 50,
    underMoneyPct: 50,
    overBetsPct: 50,
    underBetsPct: 50,
  };
  return { moneyline: row, spread: row, total: row };
}

function decision(
  market: "moneyline" | "spread" | "total",
  side: string,
  grade: string,
  modelProbability: number,
  marketFairProbability: number,
  price: number,
  line: number | null,
): NflRegularEvaluatedBetDecision {
  return {
    schemaRelease: "nfl_regular_evaluated_decision_tuple_2026_08_21_r2",
    decisionKind: "exact_price_bet",
    providerGameId: "three-state-test",
    market,
    side,
    modelProbability,
    marketFairProbability,
    evaluatedQuote: { sportsbook: "fanduel", line, price, observedAt: evaluatedAt },
    expectedValue: modelProbability * (100 / 110) - (1 - modelProbability),
    grade,
    stage: "unlocked",
    evaluatedAt,
    gameStartsAt,
    modelRelease: "test-model",
    calibrationRelease: "test-calibration",
    decisionRelease: "test-decision",
    lockedAt: null,
  };
}

function bundle(evaluatedBets: NflRegularEvaluatedBetDecision[]): NflV1ActionableGradeBundle {
  return {
    evaluatedBets,
    outcomeConfidence: [],
    modelPromotionStatus: NFL_V1_MEMBER_RELEASE,
    publicationEnabled: true,
    trackingEnabled: false,
    modelRelease: NFL_V1_PRODUCTION_MODEL_RELEASE,
    calibrationRelease: NFL_V1_PRODUCTION_CALIBRATION_RELEASE,
    decisionRelease: NFL_V1_PRODUCTION_DECISION_RELEASE,
    policyRelease: NFL_V1_GRADE_POLICY_RELEASE,
  };
}
