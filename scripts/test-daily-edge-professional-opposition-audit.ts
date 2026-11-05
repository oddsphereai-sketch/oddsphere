import assert from "node:assert/strict";
import {
  assessStrongProfessionalOpposition,
  hasAuthoritativeStoredPostureExplanation,
} from "../lib/services/dailyEdgeProfessionalOppositionAudit";

const base = {
  oppositionPp: 34,
  sport: "nba",
  marketSignal: "market_neutral",
  resolvedMarketReadStatus: null,
  whyLine: null,
  lockState: "open",
  lockedAt: null,
  scheduledLockAt: "2026-11-05T02:00:00.000Z",
  predictionGeneratedAt: "2026-11-05T00:16:22.000Z",
  professionalEvidenceAt: "2026-11-05T00:10:00.000Z",
  auditCheckedAt: "2026-11-05T00:41:00.000Z",
};

const unexplained = assessStrongProfessionalOpposition(base);
assert.equal(unexplained.disposition, "live_unexplained");
assert.equal(unexplained.liveProductGap, true);
assert.equal(unexplained.rawSplitDirectionForecastAuthority, false,
  "raw professional split direction is evidence to explain, never forecast authority by itself");

for (const whyLine of [
  "The stored independent reader held on the selected side against opposing pressure; the pick is retained without claiming a directional move. Model note follows.",
  "The stored market episode held on the selected side against opposing pressure; the pick is retained without claiming a directional move.",
  "The stored reader saw circa hold against opposing pressure; that supports retaining the pick without inventing a directional move.",
  "Stored named-book posture supports this pick (circa).",
  "Stored named-book evidence conflicts across circa, pinnacle; no directional confirmation is claimed.",
  "The stored market episode records conflicting named-book paths; no directional confirmation is claimed.",
]) {
  assert.equal(hasAuthoritativeStoredPostureExplanation(whyLine), true, whyLine);
  const assessed = assessStrongProfessionalOpposition({ ...base, whyLine });
  assert.equal(assessed.disposition, "explained_authoritative_posture", whyLine);
  assert.equal(assessed.explanationSource, "stored_posture_copy", whyLine);
  assert.equal(assessed.liveProductGap, false, whyLine);
}

for (const whyLine of [
  "The market held and the pick looks good.",
  "Sharp money supports us.",
  "Stored evidence exists.",
  "The stored reader saw pressure.",
  "There is conflict, but trust the model.",
]) {
  assert.equal(hasAuthoritativeStoredPostureExplanation(whyLine), false, whyLine);
  assert.equal(assessStrongProfessionalOpposition({ ...base, whyLine }).disposition, "live_unexplained",
    `arbitrary copy must not suppress a live audit gap: ${whyLine}`);
}

const lockedLegacy = assessStrongProfessionalOpposition({
  ...base,
  professionalEvidenceAt: "2026-11-05T00:26:34.000Z",
  lockState: "locked",
  lockedAt: "2026-11-03T23:00:00.000Z",
});
assert.equal(lockedLegacy.disposition, "immutable_legacy_locked");
assert.equal(lockedLegacy.explanationSource, "locked_record");
assert.equal(lockedLegacy.liveProductGap, false);

const pendingLateEvidence = assessStrongProfessionalOpposition({
  ...base,
  professionalEvidenceAt: "2026-11-05T00:26:34.000Z",
  auditCheckedAt: "2026-11-05T00:41:00.000Z",
});
assert.equal(pendingLateEvidence.disposition, "late_evidence_pending_authoritative_refresh");
assert.equal(pendingLateEvidence.liveProductGap, false);
assert.equal(pendingLateEvidence.authoritativeRefreshDueAt, "2026-11-05T00:42:00.000Z");
assert.equal(pendingLateEvidence.authoritativeRefreshWindowEndsAt, "2026-11-05T00:52:00.000Z");

const overdueLateEvidence = assessStrongProfessionalOpposition({
  ...base,
  professionalEvidenceAt: "2026-11-05T00:26:34.000Z",
  auditCheckedAt: "2026-11-05T00:52:00.000Z",
});
assert.equal(overdueLateEvidence.disposition, "live_unexplained");
assert.equal(overdueLateEvidence.liveProductGap, true);

const atLockLateEvidence = assessStrongProfessionalOpposition({
  ...base,
  scheduledLockAt: "2026-11-05T00:40:00.000Z",
  professionalEvidenceAt: "2026-11-05T00:26:34.000Z",
  auditCheckedAt: "2026-11-05T00:41:00.000Z",
});
assert.equal(atLockLateEvidence.disposition, "live_unexplained",
  "an unlocked card at or after its lock boundary is a live gap, not refresh-pending");

const lockedLateEvidence = assessStrongProfessionalOpposition({
  ...base,
  lockState: "locked",
  lockedAt: "2026-11-05T00:40:00.000Z",
  professionalEvidenceAt: "2026-11-05T00:26:34.000Z",
  auditCheckedAt: "2026-11-05T00:41:00.000Z",
});
assert.equal(lockedLateEvidence.disposition, "immutable_legacy_locked");
assert.equal(lockedLateEvidence.liveProductGap, false);

const lockedButExplained = assessStrongProfessionalOpposition({
  ...base,
  lockState: "locked",
  lockedAt: "2026-11-03T23:00:00.000Z",
  whyLine: "Stored named-book posture resists this pick (pinnacle).",
});
assert.equal(lockedButExplained.disposition, "explained_authoritative_posture",
  "an exact locked explanation remains visible instead of being flattened to legacy context");

assert.equal(assessStrongProfessionalOpposition({ ...base, marketSignal: "market_resistance" }).disposition,
  "explained_authoritative_posture");
assert.equal(assessStrongProfessionalOpposition({ ...base, resolvedMarketReadStatus: "held_resistance" }).disposition,
  "explained_authoritative_posture");
assert.equal(assessStrongProfessionalOpposition({ ...base, oppositionPp: 24.9 }).disposition, "not_strong");

console.log("Daily Edge professional-opposition semantic audit tests passed");
