import assert from "node:assert/strict";
import {
  determineNflForwardCollectionNeed,
  hasNflStoredLockedDecision,
  planNflForwardEvidenceCaptures,
  type NflForwardEvidencePayload,
  type NflForwardStoredEvidence,
} from "../lib/services/football/nflForwardEvidence";
import type { NflPreviewGame } from "../lib/services/football/balldontlieNflPreviewSlate";

const game: NflPreviewGame = {
  providerGameId: "future-retry-fixture", providerWeek: 8, season: 2026,
  scheduledStart: "2026-11-02T01:20:00.000Z", status: "scheduled",
  away: { id: 1, abbreviation: "PHI", name: "Philadelphia Eagles" },
  home: { id: 2, abbreviation: "WSH", name: "Washington Commanders" },
};
const stored = (stage: "opening" | "unlocked" | "t60", capturedAt: string,
  evaluatedBets: NflForwardEvidencePayload["decisions"]["evaluatedBets"] = []): NflForwardStoredEvidence => ({
  id: `${stage}-${capturedAt}`, providerGameId: game.providerGameId,
  stage, capturedAt, gameStartAt: game.scheduledStart, payloadSha256: "a".repeat(64),
  payload: {
    stage, capturedAt, slateGameCount: 1, game,
    coverage: { healthHolds: evaluatedBets.length ? [] : ["injury_report_unavailable"] },
    decisions: { evaluatedBets, publicationEnabled: true, trackingEnabled: evaluatedBets.length === 3,
      modelPromotionStatus: "older-immutable-member-release", outcomeConfidence: [] },
  } as unknown as NflForwardEvidencePayload,
});
const opening = stored("opening", "2026-11-01T23:00:00.000Z");
const failed = stored("t60", "2026-11-02T00:21:00.000Z");
const originalFailedJson = JSON.stringify(failed);
const plans = (existing: NflForwardStoredEvidence[], capturedAt: string) =>
  planNflForwardEvidenceCaptures({ games: [game], existing, capturedAt, unlockedCadenceMinutes: 60 });
const need = (existing: NflForwardStoredEvidence[], now: string) =>
  determineNflForwardCollectionNeed({ existing, now, requiredPublicRelease: {
    memberRelease: "new-member-release", decisionRelease: "new-decision-release", evaluatedBetCount: 3,
  } });

assert.equal(hasNflStoredLockedDecision(failed), false,
  "an empty held attempt has no stored locked pick, price, grade or probability to replace");
assert.deepEqual(plans([opening, failed], "2026-11-02T00:25:00.000Z").map((row) => row.stage), ["t60"],
  "a failed attempt must not consume the remaining legal capture opportunity");
assert.equal(need([opening, failed], "2026-11-02T00:25:00.000Z").reason, "t60_due",
  "provider collection and per-game planning must agree about a legal retry");
assert.equal(JSON.stringify(failed), originalFailedJson,
  "planning cannot rewrite the immutable failed-attempt evidence");
const retried = plans([opening, failed], "2026-11-02T00:25:00.000Z")[0]!;
assert.equal(retried.cutoffAt, "2026-11-02T00:20:00.000Z");
assert.equal(retried.t60LagMinutes, 5,
  "a retry retains the original cutoff rather than restarting its legal clock");

// New failures are append-only attempts stored as unlocked, not completed
// T-60 locks. This preserves their raw evidence without consuming the unique
// successful T-60 slot. Older empty T-60 rows still require the store preflight.
const failedAttempt = stored("unlocked", "2026-11-02T00:21:00.000Z");
failedAttempt.payload = {
  ...failedAttempt.payload,
  captureAttempt: { requestedStage: "t60", status: "failed", reason: "injury_report_unavailable",
    cutoffAt: "2026-11-02T00:20:00.000Z" },
  decisions: { ...failedAttempt.payload.decisions, publicationEnabled: false },
} as unknown as NflForwardEvidencePayload;
const originalAttemptJson = JSON.stringify(failedAttempt);
assert.equal(hasNflStoredLockedDecision(failedAttempt), false);
assert.deepEqual(plans([opening, failedAttempt], "2026-11-02T00:25:00.000Z").map((row) => row.stage), ["t60"],
  "an unsuccessful attempt stored unlocked must allow a legal successful T-60 retry, not another opening");
assert.equal(need([opening, failedAttempt], "2026-11-02T00:25:00.000Z").reason, "t60_due",
  "a failed attempt is not mistaken for a completed lock by collection cadence");
assert.deepEqual(plans([opening], "2026-11-02T00:19:59.999Z")
  .filter((row) => row.stage === "t60"), [], "retries cannot create a premature T-60 tuple");
assert.deepEqual(plans([opening, failedAttempt], "2026-11-02T00:40:00.001Z"), [],
  "the new attempt representation does not extend the legal window");
assert.equal(need([opening, failedAttempt], "2026-11-02T00:40:00.001Z").collect, false);
assert.equal(need([failedAttempt], "2026-11-02T00:40:00.001Z").collect, false,
  "an expired game with no opening cannot repeatedly trigger opening-incomplete provider recovery");
assert.equal(need([failed], "2026-11-02T00:40:00.001Z").collect, false,
  "the expired legacy empty-T60 representation also cannot trigger a late opening seed");
assert.equal(JSON.stringify(failedAttempt), originalAttemptJson,
  "a later planner run preserves the exact failed-attempt evidence and its explicit publication hold");

const lockedBets = (["moneyline", "spread", "total"] as const).map((market) => ({
  market, stage: "t60_locked", lockedAt: "2026-11-02T00:25:00.000Z",
  decisionRelease: "older-immutable-decision-release",
})) as NflForwardEvidencePayload["decisions"]["evaluatedBets"];
const locked = stored("t60", "2026-11-02T00:25:00.000Z", lockedBets);
assert.equal(hasNflStoredLockedDecision(locked), true);
assert.deepEqual(plans([opening, failed, locked], "2026-11-02T00:30:00.000Z"), [],
  "a successful older-release lock prevents every subsequent writer generation");
assert.equal(need([opening, failed, locked], "2026-11-02T00:30:00.000Z").collect, false,
  "a new required release cannot supersede the immutable public lock");
assert.deepEqual(plans([locked], "2026-11-02T00:30:00.000Z"), [],
  "a stored lock without an opening row cannot cause a new post-lock opening");
assert.equal(need([locked], "2026-11-02T00:30:00.000Z").collect, false,
  "a protected lock without an opening cannot trigger redundant paid collection");
const partial = stored("t60", "2026-11-02T00:25:00.000Z", lockedBets.slice(0, 1));
assert.equal(partial.payload.decisions.trackingEnabled, false);
assert.equal(hasNflStoredLockedDecision(partial), true);
assert.deepEqual(plans([opening, partial], "2026-11-02T00:30:00.000Z"), [],
  "partial stored locked fields remain immutable even if tracking is disabled");
const incompleteLock = stored("t60", "2026-11-02T00:25:00.000Z", [
  { ...lockedBets[0]!, lockedAt: null },
]);
assert.equal(hasNflStoredLockedDecision(incompleteLock), true,
  "a malformed partial lock requires owner review, not automated regeneration");

assert.equal(plans([opening, failed], "2026-11-02T00:40:00.000Z").length, 1,
  "the existing inclusive 20-minute boundary is preserved");
for (const after of ["2026-11-02T00:40:00.001Z", "2026-11-02T00:51:37.596Z", game.scheduledStart]) {
  assert.deepEqual(plans([opening, failed], after), [],
    "expired or started games cannot acquire retrospective T-60 predictions");
  assert.equal(need([opening, failed], after).collect, false,
    "failed attempts must not cause paid collection after the original legal deadline");
}
assert.deepEqual(plans([], "2026-11-02T00:51:37.596Z"), [],
  "a missing opening cannot bypass the expired T-60 window by creating a late unlocked card");

console.log("NFL T-60 failed-attempt retry: legal window, immutable locks and no retrospective picks passed");
