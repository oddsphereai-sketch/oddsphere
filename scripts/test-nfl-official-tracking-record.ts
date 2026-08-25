import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isPublicallyTracked } from "../lib/config/officialTrackingStart";
import {
  NFL_FORWARD_EVIDENCE_COLLECTOR_RELEASE,
  NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  type NflForwardEvidencePayload,
} from "../lib/services/football/nflForwardEvidence";
import { buildNflOfficialTrackingRecords } from "../lib/services/football/nflOfficialTrackingRecord";
import { buildNflRegularEvaluatedBetDecision } from "../lib/services/football/nflRegularDecisionEvidence";
import { nflForwardT60TrackingEligibility } from "../lib/services/football/nflTrackingLifecycle";

const capturedAt = "2026-09-09T23:30:00.000Z";
const gameStartsAt = "2026-09-10T00:20:00.000Z";
const common = {
  providerGameId: "1392216",
  stage: "t60_locked" as const,
  evaluatedAt: capturedAt,
  gameStartsAt,
  decisionRelease: "nfl_v1_daily_edge_decision_2026_08_25_r9_actionable_grades",
  lockedAt: capturedAt,
  modelRelease: "nfl_test_model",
  calibrationRelease: "nfl_test_calibration",
};
const decisions = [
  buildNflRegularEvaluatedBetDecision({
    ...common,
    market: "moneyline",
    side: "SEA",
    modelProbability: 0.57,
    marketFairProbability: 0.52,
    evaluatedQuote: { sportsbook: "fanduel", line: null, price: -110, observedAt: capturedAt },
    grade: "Best Angle",
  }),
  buildNflRegularEvaluatedBetDecision({
    ...common,
    market: "spread",
    side: "SEA",
    modelProbability: 0.54,
    marketFairProbability: 0.51,
    evaluatedQuote: { sportsbook: "draftkings", line: -2.5, price: -105, observedAt: capturedAt },
    grade: "Lean",
  }),
  buildNflRegularEvaluatedBetDecision({
    ...common,
    market: "total",
    side: "Over 44.5",
    modelProbability: 0.53,
    marketFairProbability: 0.52,
    evaluatedQuote: { sportsbook: "caesars", line: 44.5, price: -108, observedAt: capturedAt },
    grade: "Watchlist",
  }),
];

assert.equal(isPublicallyTracked("nfl", "2026-09-08"), false);
assert.equal(isPublicallyTracked("nfl", "2026-09-09"), true);
const eligible = nflForwardT60TrackingEligibility({
  stage: "t60",
  captureTiming: "on_time",
  t60LagMinutes: 10,
  capturedAt,
  providerGameId: "1392216",
  gameStartsAt,
  decisions,
  publicationApproved: true,
  officialRegistryLaunched: true,
});
assert.deepEqual(eligible, { eligible: true, reason: "eligible_regular_t60" });
assert.equal(nflForwardT60TrackingEligibility({
  stage: "t60",
  captureTiming: "on_time",
  t60LagMinutes: 21,
  capturedAt: "2026-09-09T23:41:00.000Z",
  providerGameId: "1392216",
  gameStartsAt,
  decisions,
  publicationApproved: true,
  officialRegistryLaunched: true,
}).reason, "late_or_invalid_t60_capture");
assert.equal(nflForwardT60TrackingEligibility({
  stage: "unlocked",
  captureTiming: "on_time",
  t60LagMinutes: null,
  capturedAt,
  providerGameId: "1392216",
  gameStartsAt,
  decisions,
  publicationApproved: true,
  officialRegistryLaunched: true,
}).eligible, false);

const payload = {
  schemaRelease: NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  collectorRelease: NFL_FORWARD_EVIDENCE_COLLECTOR_RELEASE,
  runId: "test-t60-run",
  season: 2026,
  week: 1,
  slateGameCount: 16,
  stage: "t60",
  captureTiming: "on_time",
  capturedAt,
  cutoffAt: "2026-09-09T23:20:00.000Z",
  t60LagMinutes: 10,
  game: {
    providerGameId: "1392216",
    providerWeek: 1,
    season: 2026,
    scheduledStart: gameStartsAt,
    status: "scheduled",
    away: { id: 1, abbreviation: "NE", name: "New England Patriots" },
    home: { id: 2, abbreviation: "SEA", name: "Seattle Seahawks" },
  },
  market: {
    current: {}, currentBooks: [], comparableCurrentBooks: [], providerOpening: null,
    providerOpeningBooks: [], comparableProviderOpeningBooks: [],
    operationalOpening: { provenance: "first_observed", capturedAt, quote: {} },
    playbookLine: null, playbookSplits: null, sharpApiSplits: null,
  },
  startersAndDepth: {
    away: { starterStatus: "confirmed" },
    home: { starterStatus: "confirmed" },
  },
  injuries: null,
  weather: {},
  decisions: {
    evaluatedBets: decisions,
    outcomeConfidence: [],
    modelPromotionStatus: "nfl_v1_member_release_2026_08_25_r6_actionable_grades",
    publicationEnabled: true,
    trackingEnabled: true,
  },
  coverage: { healthHolds: [] },
  requestBudget: {},
} as unknown as NflForwardEvidencePayload;
const records = buildNflOfficialTrackingRecords({ payload, gameId: 5001 });
assert.equal(records.length, 3);
assert.deepEqual(records.map((record) => record.market), ["moneyline", "spread", "total"]);
assert.deepEqual(records.map((record) => record.side), ["home", "home", "over"]);
assert.deepEqual(records.map((record) => record.line_value), [null, -2.5, 44.5]);
assert.deepEqual(records.map((record) => record.play_grade), ["best_angle", "lean", "watchlist"]);
assert.deepEqual(records.map((record) => record.no_bet), [false, false, true]);
assert.equal(records.every((record) => record.locked_at === capturedAt), true);
assert.equal(records.every((record) => record.model_version === common.decisionRelease), true);
assert.equal(records.every((record) => record.slate_date === "2026-09-09"), true);

const writerSource = readFileSync("lib/services/football/nflForwardEvidenceWriter.ts", "utf8");
assert.match(writerSource, /writeOfficialTrackingFromPayloads/);
assert.match(writerSource, /currentT60Payloads/);
assert.match(writerSource, /\.from\("prediction_records"\)/);
assert.match(writerSource, /\.insert\(records/);
const trackingSource = readFileSync("lib/services/trackingRefreshService.ts", "utf8");
assert.match(trackingSource, /sport === "nfl"/);
assert.match(trackingSource, /ingestNflFinalScores/);
const cronSource = readFileSync("app/api/cron/tracking-refresh/route.ts", "utf8");
assert.match(cronSource, /"soccer", "nfl"/);

console.log("NFL official tracking: Week 1 boundary, strict T-60 tuple, immutable records, and score-settlement wiring passed");
