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
  reason: "qualified_named_price_and_independent_flow",
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

const outcomeCorrection = applyNflThreeStateMarketReader({
  forecast: base,
  authority: authority({ side: -1, outcomeBoundarySide: -1 }),
});
assert.equal(outcomeCorrection.expectedHomeScore - outcomeCorrection.expectedAwayScore, -4);
assert.equal(outcomeCorrection.threeStateMarketReader?.state, "outcome_correction");
assert.ok(Math.abs(outcomeCorrection.expectedHomeScore + outcomeCorrection.expectedAwayScore - 44) < 1e-6,
  "Moneyline correction must leave the validated Total reader unchanged");

const valueResistance = applyNflThreeStateMarketReader({
  forecast: base,
  authority: authority({ side: -1, outcomeBoundarySide: 1, spreadBoundary: 3 }),
});
assert.equal(valueResistance.expectedHomeScore - valueResistance.expectedAwayScore, 2);
assert.equal(valueResistance.threeStateMarketReader?.state, "value_resistance");
assert.equal(valueResistance.threeStateMarketReader?.spreadBoundaryCorrectionApplied, true);

const rejectedWinnerCross = applyNflThreeStateMarketReader({
  forecast: base,
  authority: authority({ side: -1, outcomeBoundarySide: 1, spreadBoundary: 1 }),
});
assert.equal(rejectedWinnerCross.expectedHomeScore - rejectedWinnerCross.expectedAwayScore, 4,
  "value resistance cannot cross the outright winner boundary");
assert.equal(rejectedWinnerCross.threeStateMarketReader?.spreadBoundaryCorrectionApplied, false);

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
  sharpSplits: null,
  excludedFamilies: ["fanduel"],
});
assert.equal(builtAuthority.status, "available");
assert.equal(builtAuthority.side, 1, "persistent named-book price movement plus independent flow authorizes the read");
assert.equal(builtAuthority.outcomeBoundarySide, -1,
  "target-excluded fair Moneyline probability owns the natural outright-winner boundary");
assert.equal(builtAuthority.spreadBoundary, 3);
assert.deepEqual(builtAuthority.excludedFamilies, ["fanduel"]);

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
    modelPromotionStatus: "nfl_v1_member_release_2026_10_25_r34_three_state_market_reader",
    publicationEnabled: true,
    trackingEnabled: false,
    modelRelease: "nfl_v1_daily_edge_model_2026_10_25_r29_three_state_market_reader",
    calibrationRelease: "nfl_v1_daily_edge_calibration_2026_10_25_r28_three_state_market_reader",
    decisionRelease: "nfl_v1_daily_edge_decision_2026_10_25_r37_three_state_market_reader",
    policyRelease: "nfl_v1_grade_policy_2026_10_25_r37_three_state_market_reader",
  };
}
