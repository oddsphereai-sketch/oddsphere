export const DAILY_EDGE_PROFESSIONAL_OPPOSITION_AUDIT_RELEASE =
  "daily_edge_professional_opposition_audit_2026_11_04_r2_causal_split_receipt_timing" as const;

export const NBA_AUTHORITATIVE_REFRESH_COMPLETION_GRACE_MS = 10 * 60_000;

export type ProfessionalOppositionDisposition =
  | "not_strong"
  | "explained_authoritative_posture"
  | "late_evidence_pending_authoritative_refresh"
  | "immutable_legacy_locked"
  | "live_unexplained";

export type ProfessionalOppositionAssessment = {
  release: typeof DAILY_EDGE_PROFESSIONAL_OPPOSITION_AUDIT_RELEASE;
  disposition: ProfessionalOppositionDisposition;
  explanationSource: "market_signal" | "resolved_market_read" | "stored_posture_copy" | "locked_record" | null;
  liveProductGap: boolean;
  rawSplitDirectionForecastAuthority: false;
  predictionGeneratedAt: string | null;
  professionalEvidenceAt: string | null;
  authoritativeRefreshDueAt: string | null;
  authoritativeRefreshWindowEndsAt: string | null;
};

const EXPLAINED_RESOLVED_STATUSES = new Set([
  "mixed",
  "resistance",
  "consensus_resistance",
  "confirmation",
  "confirmed",
  "support",
  "conflict",
  "disagreement",
  "unresolved",
  "held_resistance",
  "counterpressure_hold",
]);

const AUTHORITATIVE_POSTURE_SENTENCES = [
  /^stored named-book evidence conflicts across .+; no directional confirmation is claimed\.(?:\s|$)/i,
  /^stored named-book posture resists this pick \(.+\)\.(?:\s|$)/i,
  /^stored named-book posture is mixed or recently tempered, so the reader does not claim clean confirmation\.(?:\s|$)/i,
  /^the stored reader saw .+ hold against opposing pressure; that supports retaining the pick without inventing a directional move\.(?:\s|$)/i,
  /^stored named-book posture supports this pick \(.+\)\.(?:\s|$)/i,
  /^the stored named-book posture does not match this displayed selection, so it is not claimed as support or resistance\.(?:\s|$)/i,
  /^the stored qualified market direction (?:confirms|resists) this pick\.(?:\s|$)/i,
  /^the stored reader receipt contains no qualified market episode for this market\.(?:\s|$)/i,
  /^the stored (?:market episode|independent reader) records (?:conflicting named-book paths|an unresolved market episode); no directional confirmation is claimed\.(?:\s|$)/i,
  /^the stored (?:market episode|independent reader) has no qualified direction for this market\.(?:\s|$)/i,
  /^the stored (?:market episode|independent reader) held on the selected side against opposing pressure; the pick is retained without claiming a directional move\.(?:\s|$)/i,
  /^the stored (?:market episode|independent reader) points against the displayed pick \((?:confirmation|resistance|discovery)\)\.(?:\s|$)/i,
  /^the stored (?:market episode|independent reader) (?:confirms|supports) the displayed pick\.(?:\s|$)/i,
] as const;

function normalizedCopy(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function timestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Exact next scheduled NBA writer start from the deployed UTC cron contract. */
export function nextNbaAuthoritativeRefreshAt(after: unknown): string | null {
  const afterMs = timestamp(after);
  if (afterMs === null) return null;
  const cursor = new Date(afterMs);
  cursor.setUTCSeconds(0, 0);
  for (let offset = 0; offset <= 24 * 60; offset += 1) {
    const candidate = new Date(cursor.getTime() + offset * 60_000);
    if (candidate.getTime() <= afterMs) continue;
    const hour = candidate.getUTCHours();
    const minute = candidate.getUTCMinutes();
    const scheduled = hour <= 5 || hour >= 13
      ? minute === 12 || minute === 42
      : hour === 11
        ? minute === 30
        : minute === 12;
    if (scheduled) return candidate.toISOString();
  }
  return null;
}

export function hasAuthoritativeStoredPostureExplanation(value: unknown): boolean {
  const copy = normalizedCopy(value);
  return copy.length > 0 && AUTHORITATIVE_POSTURE_SENTENCES.some((pattern) => pattern.test(copy));
}

export function assessStrongProfessionalOpposition(args: {
  oppositionPp: number;
  sport: unknown;
  marketSignal: unknown;
  resolvedMarketReadStatus: unknown;
  whyLine: unknown;
  lockState: unknown;
  lockedAt: unknown;
  scheduledLockAt: unknown;
  predictionGeneratedAt: unknown;
  professionalEvidenceAt: unknown;
  auditCheckedAt: unknown;
}): ProfessionalOppositionAssessment {
  const predictionGeneratedMs = timestamp(args.predictionGeneratedAt);
  const professionalEvidenceMs = timestamp(args.professionalEvidenceAt);
  const auditCheckedMs = timestamp(args.auditCheckedAt);
  const refreshDueAt = normalizedCopy(args.sport).toLowerCase() === "nba"
    ? nextNbaAuthoritativeRefreshAt(args.professionalEvidenceAt)
    : null;
  const refreshDueMs = timestamp(refreshDueAt);
  const refreshWindowEndsAt = refreshDueMs === null
    ? null
    : new Date(refreshDueMs + NBA_AUTHORITATIVE_REFRESH_COMPLETION_GRACE_MS).toISOString();
  const base = {
    release: DAILY_EDGE_PROFESSIONAL_OPPOSITION_AUDIT_RELEASE,
    rawSplitDirectionForecastAuthority: false as const,
    predictionGeneratedAt: predictionGeneratedMs === null ? null : new Date(predictionGeneratedMs).toISOString(),
    professionalEvidenceAt: professionalEvidenceMs === null ? null : new Date(professionalEvidenceMs).toISOString(),
    authoritativeRefreshDueAt: refreshDueAt,
    authoritativeRefreshWindowEndsAt: refreshWindowEndsAt,
  };
  if (!Number.isFinite(args.oppositionPp) || args.oppositionPp < 25) {
    return { ...base, disposition: "not_strong", explanationSource: null, liveProductGap: false };
  }
  const signal = normalizedCopy(args.marketSignal).toLowerCase();
  if (signal === "market_resistance" || signal === "resistance") {
    return { ...base, disposition: "explained_authoritative_posture", explanationSource: "market_signal", liveProductGap: false };
  }
  const resolved = normalizedCopy(args.resolvedMarketReadStatus).toLowerCase();
  if (EXPLAINED_RESOLVED_STATUSES.has(resolved)) {
    return { ...base, disposition: "explained_authoritative_posture", explanationSource: "resolved_market_read", liveProductGap: false };
  }
  if (hasAuthoritativeStoredPostureExplanation(args.whyLine)) {
    return { ...base, disposition: "explained_authoritative_posture", explanationSource: "stored_posture_copy", liveProductGap: false };
  }
  const immutableLocked = normalizedCopy(args.lockState).toLowerCase() === "locked"
    || (typeof args.lockedAt === "string" && Number.isFinite(Date.parse(args.lockedAt)));
  if (immutableLocked) {
    return { ...base, disposition: "immutable_legacy_locked", explanationSource: "locked_record", liveProductGap: false };
  }
  const scheduledLockMs = timestamp(args.scheduledLockAt);
  const atOrAfterLockBoundary = scheduledLockMs !== null && auditCheckedMs !== null && auditCheckedMs >= scheduledLockMs;
  const postDecisionEvidence = predictionGeneratedMs !== null && professionalEvidenceMs !== null
    && professionalEvidenceMs > predictionGeneratedMs;
  const insideBoundedNbaRefreshWindow = postDecisionEvidence
    && refreshDueMs !== null
    && auditCheckedMs !== null
    && auditCheckedMs < refreshDueMs + NBA_AUTHORITATIVE_REFRESH_COMPLETION_GRACE_MS;
  if (!atOrAfterLockBoundary && insideBoundedNbaRefreshWindow) {
    return { ...base, disposition: "late_evidence_pending_authoritative_refresh", explanationSource: null, liveProductGap: false };
  }
  return { ...base, disposition: "live_unexplained", explanationSource: null, liveProductGap: true };
}
