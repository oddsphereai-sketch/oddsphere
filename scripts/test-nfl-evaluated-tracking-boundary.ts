import assert from "node:assert/strict";
import type { DailyEdgeResponse } from "../app/lab/lib/labTypes";
import { buildNflRegularEvaluatedBetDecision } from "../lib/services/football/nflRegularDecisionEvidence";
import {
  buildNflTrackingProposalsFromEvaluatedDecisions,
  NFL_EVALUATED_TUPLE_TRACKING_BOUNDARY_RELEASE,
} from "../lib/services/football/nflTrackingLifecycle";

const snapshot = {
  sport: "nfl",
  games: [{
    id: "nfl-1001",
    external_id: 1001,
    awayTeam: "NE",
    homeTeam: "SEA",
    gameStartAt: "2026-09-10T00:20:00.000Z",
  }],
} as unknown as DailyEdgeResponse;
const game = snapshot.games[0];
const startsAt = game.gameStartAt as string;
const lockedAt = new Date(Date.parse(startsAt) - 45 * 60_000).toISOString();
const common = {
  providerGameId: String(game.external_id),
  modelProbability: 0.56,
  marketFairProbability: 0.515,
  evaluatedQuote: { sportsbook: "pinnacle", line: null as number | null, price: -108, observedAt: lockedAt },
  grade: "LEAN",
  stage: "t60_locked" as const,
  evaluatedAt: lockedAt,
  gameStartsAt: startsAt,
  modelRelease: "validated_model_release",
  calibrationRelease: "validated_calibration_release",
  decisionRelease: "validated_decision_release",
  lockedAt,
};
const decisions = [
  buildNflRegularEvaluatedBetDecision({ ...common, market: "moneyline", side: game.homeTeam }),
  buildNflRegularEvaluatedBetDecision({ ...common, market: "spread", side: game.homeTeam, evaluatedQuote: { ...common.evaluatedQuote, line: -3 } }),
  buildNflRegularEvaluatedBetDecision({ ...common, market: "total", side: "Over", evaluatedQuote: { ...common.evaluatedQuote, line: 44.5 } }),
];
const rows = buildNflTrackingProposalsFromEvaluatedDecisions({
  snapshot,
  decisions,
  seasonPhase: "regular",
  week: 1,
  modelApproved: true,
  officialRegistryLaunched: true,
});
assert.equal(rows.length, 3);
assert.equal(rows.every((row) => row.tupleBoundaryRelease === NFL_EVALUATED_TUPLE_TRACKING_BOUNDARY_RELEASE), true);
assert.equal(rows.every((row) => row.evaluatedSportsbook === "pinnacle" && row.priceAmerican === -108), true);
assert.equal(rows.every((row) => row.trackingEligible && row.appendToExistingLifetime), true);

const thirtyMinutesBeforeKick = new Date(Date.parse(startsAt) - 30 * 60_000).toISOString();
assert.throws(() => buildNflRegularEvaluatedBetDecision({
  ...common,
  market: "moneyline",
  side: game.homeTeam,
  evaluatedAt: thirtyMinutesBeforeKick,
  evaluatedQuote: { ...common.evaluatedQuote, observedAt: thirtyMinutesBeforeKick },
  lockedAt: thirtyMinutesBeforeKick,
}), /exceeds the 20-minute maximum T-60 capture lag/);

const forgedLateDecisions = decisions.map((decision) => ({
  ...decision,
  evaluatedAt: thirtyMinutesBeforeKick,
  lockedAt: thirtyMinutesBeforeKick,
  evaluatedQuote: { ...decision.evaluatedQuote, observedAt: thirtyMinutesBeforeKick },
}));
assert.throws(() => buildNflTrackingProposalsFromEvaluatedDecisions({
  snapshot,
  decisions: forgedLateDecisions,
  seasonPhase: "regular",
  week: 1,
  modelApproved: true,
  officialRegistryLaunched: true,
}), /exceeds the 20-minute maximum T-60 capture lag/);
assert.throws(() => buildNflTrackingProposalsFromEvaluatedDecisions({
  snapshot,
  decisions: decisions.slice(0, 2),
  seasonPhase: "regular",
  week: 1,
  modelApproved: true,
  officialRegistryLaunched: true,
}), /exactly three unique T-60 market tuples/);

console.log("NFL tracking consumes the coherent frozen evaluated-price tuple and rejects incomplete locks.");
