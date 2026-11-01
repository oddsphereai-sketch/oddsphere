import assert from "node:assert/strict";
import type { NflPreviewBookOdds } from "../lib/services/football/balldontlieNflPreviewSlate";
import {
  NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  NFL_FORWARD_EVIDENCE_COLLECTOR_RELEASE,
  type NflForwardEvidencePayload,
  type NflForwardTeamDepthSnapshot,
} from "../lib/services/football/nflForwardEvidence";
import { NFL_REGULAR_DECISION_EVIDENCE_SCHEMA, type NflRegularEvaluatedBetDecision } from "../lib/services/football/nflRegularDecisionEvidence";
import { auditNflReaderProductContract, nflReaderMeanBoundaryCases } from "../lib/services/football/nflReaderProductContractAudit";
import { getNflV1WeekOneOutcomeForecast, nflV1WeekOneLineProbabilities } from "../lib/services/football/nflV1WeekOneOutcome";
import {
  NFL_V1_PRODUCTION_MODEL_RELEASE, NFL_V1_PRODUCTION_CALIBRATION_RELEASE,
  NFL_V1_PRODUCTION_DECISION_RELEASE, NFL_V1_MEMBER_RELEASE,
} from "../lib/services/football/nflV1ProductionDecision";
import { NFL_TARGET_EXCLUDED_MARKET_OUTCOME_RELEASE } from "../lib/services/football/nflTargetExcludedMarketOutcome";

const capturedAt = "2026-11-01T12:00:00.000Z";
const providerGameId = "reader-contract-unit";
const homeTeam = "SEA";
const awayTeam = "NE";
const startsAt = "2026-11-02T00:00:00.000Z";
const forecast = getNflV1WeekOneOutcomeForecast({
  providerGameId, awayTeam, homeTeam,
  weeklyFallback: { projectedHomeMargin: 4.5, marketTotal: 45.5 },
});
forecast.targetExclusion = {
  release: NFL_TARGET_EXCLUDED_MARKET_OUTCOME_RELEASE,
  status: "target_excluded_market", reason: "stable_complete_tuple",
  marginFamilyCount: 3, totalFamilyCount: 3,
  marginExcludedSportsbooks: ["unit"], totalExcludedSportsbooks: ["unit"],
};
const book: NflPreviewBookOdds = {
  providerGameId, sportsbook: "unit", observedAt: capturedAt,
  moneyline: { awayPrice: -110, homePrice: -110 },
  spread: { homeLine: -3.5, awayLine: 3.5, homePrice: -110, awayPrice: -110 },
  total: { line: 45.5, overPrice: -110, underPrice: -110 },
};
const lines = nflV1WeekOneLineProbabilities({ forecast, homeSpread: -3.5, totalLine: 45.5 });
const margin = forecast.expectedHomeScore - forecast.expectedAwayScore;
const scoreTotal = forecast.expectedHomeScore + forecast.expectedAwayScore;
const depth = (team: string): NflForwardTeamDepthSnapshot => ({
  provider: "balldontlie", team, capturedAt, sourceSnapshotId: null,
  starterStatus: "projected", expectedStartingQuarterback: null, quarterbackDepth: [], roster: [],
});
const bets: NflRegularEvaluatedBetDecision[] = (["moneyline", "spread", "total"] as const).map((market) => {
  const home = market === "moneyline" ? forecast.homeWinProbability >= forecast.awayWinProbability
    : lines.spread.homeCoverProbability >= lines.spread.awayCoverProbability;
  const over = lines.total.overProbability >= lines.total.underProbability;
  const probability = market === "moneyline"
    ? (home ? forecast.homeWinProbability : forecast.awayWinProbability) /
      (forecast.homeWinProbability + forecast.awayWinProbability)
    : market === "spread" ? home ? lines.spread.homeCoverProbability : lines.spread.awayCoverProbability
      : over ? lines.total.overProbability : lines.total.underProbability;
  const push = market === "moneyline" ? 0 : market === "spread" ? lines.spread.pushProbability : lines.total.pushProbability;
  return {
    schemaRelease: NFL_REGULAR_DECISION_EVIDENCE_SCHEMA, decisionKind: "exact_price_bet",
    providerGameId, market, side: market === "total" ? `${over ? "Over" : "Under"} 45.5` : home ? homeTeam : awayTeam,
    modelProbability: probability, marketFairProbability: 0.5,
    evaluatedQuote: { sportsbook: "unit", observedAt: capturedAt, price: -110,
      line: market === "moneyline" ? null : market === "total" ? 45.5 : home ? -3.5 : 3.5 },
    expectedValue: (1 - push) * (probability * (100 / 110) - (1 - probability)),
    grade: "Watchlist", stage: "unlocked", evaluatedAt: capturedAt, gameStartsAt: startsAt,
    modelRelease: NFL_V1_PRODUCTION_MODEL_RELEASE, calibrationRelease: NFL_V1_PRODUCTION_CALIBRATION_RELEASE,
    decisionRelease: NFL_V1_PRODUCTION_DECISION_RELEASE, lockedAt: null,
  };
});
const valid: NflForwardEvidencePayload = {
  schemaRelease: NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE, collectorRelease: NFL_FORWARD_EVIDENCE_COLLECTOR_RELEASE,
  runId: "unit", season: 2026, week: 8, slateGameCount: 1, stage: "unlocked", captureTiming: "on_time",
  capturedAt, cutoffAt: null, t60LagMinutes: null,
  game: { providerGameId, providerWeek: 8, season: 2026, scheduledStart: startsAt, status: "scheduled",
    home: { id: 1, abbreviation: homeTeam, name: "Seattle" }, away: { id: 2, abbreviation: awayTeam, name: "New England" } },
  market: { current: book, currentBooks: [book], comparableCurrentBooks: [book],
    providerOpening: book, providerOpeningBooks: [book], comparableProviderOpeningBooks: [book],
    operationalOpening: { provenance: "first_observed", capturedAt, quote: book },
    playbookLine: null, playbookSplits: null, sharpApiSplits: null },
  startersAndDepth: { home: depth(homeTeam), away: depth(awayTeam) },
  injuries: null, weather: { venueTeam: homeTeam, venueName: "unit", roofType: "outdoor",
    status: "not_captured_for_unlocked", capturedAt, forecast: null },
  outcomeForecast: forecast,
  decisions: { evaluatedBets: bets, outcomeConfidence: [], modelPromotionStatus: NFL_V1_MEMBER_RELEASE,
    publicationEnabled: true, trackingEnabled: false },
  coverage: { currentOdds: true, currentBookCount: 1, comparableCurrentBookCount: 1,
    multibookConsensusReady: false, operationalOpening: true, rosterAndDepth: false,
    expectedQuarterbacks: false, injuries: false, playbookSplits: false, sharpApiSplits: false,
    weather: false, healthHolds: [] },
  requestBudget: { balldontlieSlate: 0, balldontlieRoster: 0, balldontlieInjuriesMaximum: 0,
    playbook: 0, sharpApi: 0, weather: 0, totalMaximum: 0 },
};
assert.deepEqual(auditNflReaderProductContract(valid), [],
  "a complete real joint-distribution tuple has no product-contract findings");
const distributionMean = (name: "marginDistribution" | "totalDistribution") =>
  forecast[name].values.reduce((sum, value, index) => sum + value * forecast[name].probabilities[index]!, 0);
assert.ok(Math.abs(distributionMean("marginDistribution") - margin) < 1e-8);
assert.ok(Math.abs(distributionMean("totalDistribution") - scoreTotal) < 1e-8,
  "displayed expected scores retain the actual distribution means");
assert.ok(scoreTotal > 45.5 && lines.total.underProbability > 0.5,
  "the real discrete score fixture has a mean above the line but a majority Under");
const informationalBefore = structuredClone(valid);
assert.ok(nflReaderMeanBoundaryCases(valid).some((value) => value.startsWith("total:Under 45.5:")),
  "mean-versus-majority boundary cases are surfaced explicitly as information");
assert.deepEqual(auditNflReaderProductContract(valid), [],
  "a skewed final PMF majority is not an instruction to change the forecast to its mean-sign side");
assert.deepEqual(valid, informationalBefore,
  "neither audit nor boundary reporting mutates forecasts, probabilities, sides or grades");
const findingsAfter = (mutate: (value: NflForwardEvidencePayload) => void) => {
  const value = structuredClone(valid);
  mutate(value);
  return auditNflReaderProductContract(value);
};
assert.ok(findingsAfter((v) => { v.decisions.evaluatedBets[0]!.evaluatedQuote.observedAt = "2026-11-01T09:59:59.999Z"; })
  .includes("moneyline:stale_or_future_execution_quote"));
assert.ok(findingsAfter((v) => { v.decisions.evaluatedBets[0]!.evaluatedQuote.observedAt = "2026-11-01T12:00:00.001Z"; })
  .includes("moneyline:stale_or_future_execution_quote"));
assert.ok(findingsAfter((v) => { v.market.comparableCurrentBooks = []; })
  .includes("moneyline:execution_tuple_not_in_source_books"));
assert.notDeepEqual(findingsAfter((v) => { v.market.comparableCurrentBooks[0]!.observedAt = "2026-11-01T09:59:59.999Z"; }), [],
  "a fresh execution stamp cannot conceal a stale matching source quote");
assert.notDeepEqual(findingsAfter((v) => { v.market.comparableCurrentBooks[0]!.observedAt = "2026-11-01T12:00:00.001Z"; }), [],
  "a future source quote cannot confirm an execution tuple");
assert.ok(findingsAfter((v) => { v.decisions.evaluatedBets[1]!.modelProbability += 0.05; })
  .includes("spread:probability_not_from_final_distribution"));
assert.ok(findingsAfter((v) => { v.decisions.evaluatedBets[2]!.expectedValue += 0.05; })
  .includes("total:ev_not_from_final_distribution"));
assert.notDeepEqual(findingsAfter((v) => { v.decisions.evaluatedBets[1]!.modelProbability = Number.NaN; }), [],
  "non-finite probability cannot evade an absolute-difference comparison");
assert.notDeepEqual(findingsAfter((v) => { v.decisions.evaluatedBets[2]!.expectedValue = Number.NaN; }), [],
  "non-finite EV cannot evade an absolute-difference comparison");
assert.ok(findingsAfter((v) => { v.decisions.evaluatedBets[0]!.providerGameId = "wrong"; })
  .includes("moneyline:wrong_event"));
assert.ok(findingsAfter((v) => { v.decisions.evaluatedBets[0]!.side = "OTHER"; })
  .includes("moneyline:score_pick_disagreement"));
assert.notDeepEqual(findingsAfter((v) => {
  v.decisions.evaluatedBets.find((bet) => bet.market === "total")!.side = "OTHER 45.5";
}), [], "an invalid label cannot masquerade as the majority Under side");
assert.ok(findingsAfter((v) => { v.outcomeForecast.targetExclusion!.marginExcludedSportsbooks = ["other"]; })
  .includes("moneyline:evaluated_book_not_excluded"));
assert.ok(findingsAfter((v) => { v.decisions.evaluatedBets.pop(); }).includes("incomplete_market_tuple"));
assert.ok(findingsAfter((v) => {
  const totalBet = v.decisions.evaluatedBets.find((bet) => bet.market === "total")!;
  totalBet.side = "Over 45.5";
  totalBet.modelProbability = lines.total.overProbability;
  totalBet.expectedValue = (1 - lines.total.pushProbability) *
    (lines.total.overProbability * (100 / 110) - (1 - lines.total.overProbability));
}).includes("total:score_pick_disagreement"),
"a minority-side pick is rejected even when its own probability and EV are calculated correctly");
assert.notDeepEqual(findingsAfter((v) => { v.outcomeForecast.expectedHomeScore += 1; }), [],
  "displayed expected scores cannot depart from the frozen PMF means without a finding");
console.log("NFL reader product contract: real PMF, source clocks, exact tuples, identity, probability/EV and exclusion checks passed");
