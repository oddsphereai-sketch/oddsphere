import type { SupabaseClient } from "@supabase/supabase-js";
import type { PredictionRecordRow } from "@/lib/types/domain/Tracking";
import { computeSlateDate } from "@/lib/dates/slateDate";
import type { CbbStoredMemberGame } from "./cbbMemberGameStore";
import { cbbTrackingEvidenceSha256, writeLockedCbbTracking } from "./cbbTrackingWriter";

export const CBB_MISSED_LOCK_RECOVERY_RELEASE = "cbb_missed_lock_recovery_2026_11_13_r1_owner_approved_original_forecast" as const;

/** Owner-approved historical serialization only. The original unlocked member
 * payload is preserved. Actual recovery time is recorded as locked_at; no
 * historical T-60 lock is invented and no prediction is recomputed. The caller
 * must verify the approved source hash and hold prediction_pipeline:cbb to
 * insert these proposals. All ordinary mapping/grade/identity checks still run. */
export async function buildCbbMissedLockRecovery(args: {
  original: CbbStoredMemberGame; approvedSha256: string; recoveredAt: string; db: SupabaseClient;
}): Promise<PredictionRecordRow[]> {
  const { original } = args, snapshot = original.snapshot;
  const start = Date.parse(snapshot.startsAt), capture = Date.parse(snapshot.capturedAt);
  const recovered = Date.parse(args.recoveredAt), cutoff = start - 60 * 60_000;
  if (snapshot.lockedAt !== null || original.memberGame.lockedAt !== null || !snapshot.board.gameForecast
    || ![start, capture, recovered, Date.parse(snapshot.board.asOf)].every(Number.isFinite)
    || capture >= cutoff || Date.parse(snapshot.board.asOf) > capture || recovered <= start
    || computeSlateDate("cbb", snapshot.startsAt) !== "2026-11-12"
    || cbbTrackingEvidenceSha256(original) !== args.approvedSha256)
    throw Error("CBB missed-lock recovery source/hash/clock differs from owner-approved pregame evidence");
  const virtual = structuredClone(original);
  // This is an in-memory serialization envelope, never a replacement member
  // snapshot. Both source null-lock fields are explicitly retained below.
  virtual.snapshot.lockedAt = args.recoveredAt;
  virtual.memberGame.lockedAt = args.recoveredAt;
  virtual.memberGame.lockState = "locked";
  const proposals: PredictionRecordRow[] = [];
  const readOnlyBuilder = { from: (table: string) => {
    if (table !== "prediction_records") return args.db.from(table);
    return { select: (fields: string) => args.db.from(table).select(fields),
      insert: async (row: PredictionRecordRow) => {
        proposals.push({ ...row, snapshot_json: { ...row.snapshot_json,
          evidence_payload_sha256: args.approvedSha256,
          recovery_envelope_sha256: cbbTrackingEvidenceSha256(virtual),
          tracking_recovery_release: CBB_MISSED_LOCK_RECOVERY_RELEASE,
          recovery_reason: "missed_lock_after_published_pregame_forecast",
          original_member_snapshot_locked_at: null,
          original_member_dto_locked_at: null,
          original_forecast_captured_at: snapshot.capturedAt,
          scheduled_t60_at: new Date(cutoff).toISOString(),
          recovered_at: args.recoveredAt,
          on_time_t60_lock: false,
          recovery_owner_approved_at: "2026-11-13",
        } });
        return { error: null };
      } };
  } } as unknown as SupabaseClient;
  await writeLockedCbbTracking(virtual, readOnlyBuilder);
  if (cbbTrackingEvidenceSha256(original) !== args.approvedSha256) throw Error("CBB recovery changed original evidence");
  return proposals;
}
