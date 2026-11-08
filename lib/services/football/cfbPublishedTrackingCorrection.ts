import type { SupabaseClient } from "@supabase/supabase-js";
import type { PredictionRecordRow } from "@/lib/types/domain/Tracking";
import { matchesCfbForwardEvidencePayloadHash, type CfbForwardEvidencePayload } from "./cfbForwardEvidence";
import { serializeCfbOfficialTrackingDecision } from "./cfbOfficialTrackingRecord";

export const CFB_PUBLISHED_TRACKING_CORRECTION_RELEASE = "cfb_published_tracking_correction_2026_11_08_r1_owner_approved_t60" as const;
export const CFB_PUBLISHED_TRACKING_CORRECTION_MODEL_VERSION = "cfb_tracking_original_t60_correction_2026_11_08_r1" as const;
// Daniel approved precisely these nine original records on November 8 after
// reviewing the October 24/31 conflict and exact saved T60 calls. This is not
// a generic permission to replace other immutable historical records.
export const CFB_APPROVED_TRACKING_CORRECTIONS = [
  {"originalId":478261,"externalId":457396,"market":"total","sourceId":"2c0c6a23-8551-42a7-a8ab-0dbb51d37823","sourceSha256":"36aa6ba735aa1db131d2c0d9ee6213499313e87ab383412b88aadee1fc5add99"},
  {"originalId":520674,"externalId":457753,"market":"spread","sourceId":"338ea668-d9de-429c-9802-d2c4adb012ee","sourceSha256":"5a877837f4125f660bd1c2c90bdc740f6c8fa06a29a6ceee160ea9998b4b2dfe"},
  {"originalId":520675,"externalId":457753,"market":"total","sourceId":"338ea668-d9de-429c-9802-d2c4adb012ee","sourceSha256":"5a877837f4125f660bd1c2c90bdc740f6c8fa06a29a6ceee160ea9998b4b2dfe"},
  {"originalId":478256,"externalId":457395,"market":"moneyline","sourceId":"543be4ff-3745-495b-b59e-09bdeb552095","sourceSha256":"256a26caab014e7f9d0e784b77d6ce043150648a3e692d2b1bcdc161d6931a5f"},
  {"originalId":478257,"externalId":457395,"market":"spread","sourceId":"543be4ff-3745-495b-b59e-09bdeb552095","sourceSha256":"256a26caab014e7f9d0e784b77d6ce043150648a3e692d2b1bcdc161d6931a5f"},
  {"originalId":478265,"externalId":457398,"market":"total","sourceId":"722755a4-3f83-49eb-a5da-2b93434e7ce5","sourceSha256":"af1a2f74899888830b8c562a653178e7f70ad42ab06b760f1cebac29fbd689fe"},
  {"originalId":520676,"externalId":457754,"market":"moneyline","sourceId":"be16aba7-e9d9-48bd-bfe7-d46762ef4076","sourceSha256":"80403fa114aa761dce3ab12cf043d0632c1bc95c2c53b64f86426032f75a0ed8"},
  {"originalId":478268,"externalId":457744,"market":"spread","sourceId":"d2119abd-5308-4363-9fc8-2acaf25d94de","sourceSha256":"c49c7815342eb518db408ad61d7c537184d885fc8634f6f0cf02f7d3d6ed40ad"},
  {"originalId":478269,"externalId":457744,"market":"total","sourceId":"d2119abd-5308-4363-9fc8-2acaf25d94de","sourceSha256":"c49c7815342eb518db408ad61d7c537184d885fc8634f6f0cf02f7d3d6ed40ad"},
] as const;
type Approval = typeof CFB_APPROVED_TRACKING_CORRECTIONS[number];
export function cfbTrackingCorrectionSupersededRecordId(args: { modelVersion?: string | null; correctionRelease?: unknown; supersedesPredictionRecordId?: unknown }): number | null {
  return args.modelVersion === CFB_PUBLISHED_TRACKING_CORRECTION_MODEL_VERSION && args.correctionRelease === CFB_PUBLISHED_TRACKING_CORRECTION_RELEASE &&
    CFB_APPROVED_TRACKING_CORRECTIONS.some(a => a.originalId === args.supersedesPredictionRecordId)
    ? args.supersedesPredictionRecordId as number : null;
}

export function buildApprovedCfbTrackingCorrection(args: { source: PredictionRecordRow; payload: CfbForwardEvidencePayload; evidenceId: string; evidenceSha256: string }): PredictionRecordRow {
  const approval = CFB_APPROVED_TRACKING_CORRECTIONS.find(a => a.originalId === args.source.id);
  const { source, payload } = args;
  const decision = payload.decisions.evaluatedBets.find(b => b.market === approval?.market);
  const captured = Date.parse(payload.capturedAt), kickoff = Date.parse(payload.game.scheduledStart);
  if (!approval || source.sport !== "cfb" || source.external_id !== approval.externalId || source.market !== approval.market ||
    source.prediction_source !== "cfb_forward_evidence_published_pregame_accuracy_recovery" || source.play_grade !== "no_play" ||
    !source.locked_at || Date.parse(source.locked_at) >= captured || source.odds_american !== null ||
    args.evidenceId !== approval.sourceId || args.evidenceSha256 !== approval.sourceSha256 || !matchesCfbForwardEvidencePayloadHash(payload, approval.sourceSha256) ||
    payload.game.providerGameId !== String(approval.externalId) || payload.stage !== "t60" || payload.captureTiming !== "on_time" ||
    !Number.isFinite(captured) || !Number.isFinite(kickoff) || captured >= kickoff || payload.t60LagMinutes === null || payload.t60LagMinutes < 0 || payload.t60LagMinutes > 5 ||
    !payload.decisions.trackingEnabled || !payload.decisions.publicationEnabled || payload.coverage.healthHolds.length !== 0 ||
    !decision || !["Best Angle", "Lean"].includes(decision.grade) || decision.lockedAt !== payload.capturedAt || decision.evaluatedAt !== payload.capturedAt ||
    decision.stage !== "t60_locked" || Date.parse(decision.evaluatedQuote.observedAt) > captured || decision.gameStartsAt !== payload.game.scheduledStart) {
    throw new Error(`CFB historical correction refuses unapproved or changed source ${source.id ?? "missing"}`);
  }
  const exact = serializeCfbOfficialTrackingDecision({ payload, decision, gameId: source.game_id });
  return { ...exact, model_version: CFB_PUBLISHED_TRACKING_CORRECTION_MODEL_VERSION,
    prediction_source: "cfb_owner_approved_original_t60_correction",
    snapshot_json: { ...exact.snapshot_json,
      cfb_tracking_record_release: CFB_PUBLISHED_TRACKING_CORRECTION_RELEASE,
      original_decision_release: decision.decisionRelease,
      original_prediction_record_id: source.id!,
      original_prediction_record_model_version: source.model_version,
      tracking_correction_release: CFB_PUBLISHED_TRACKING_CORRECTION_RELEASE,
      supersedes_prediction_record_id: source.id!,
      tracking_correction: { release: CFB_PUBLISHED_TRACKING_CORRECTION_RELEASE, owner_approved_on: "2026-11-08",
        supersedes_prediction_record_id: source.id!, source_snapshot_id: approval.sourceId, source_payload_sha256: approval.sourceSha256,
        reason: "accuracy_only_record_frozen_before_the_actual_published_t60_lock", original_decision_unchanged: true },
    },
  };
}

/** Called only by the existing leased CFB tracking writer. Append-only and
 * idempotent; no providers, score reads, model evaluation, update or delete. */
export async function writeApprovedCfbTrackingCorrections(client: SupabaseClient): Promise<number> {
  const existing = await client.from("prediction_records").select("id,external_id,market,model_version,release:snapshot_json->>tracking_correction_release,supersedes:snapshot_json->supersedes_prediction_record_id")
    .eq("sport", "cfb").eq("model_version", CFB_PUBLISHED_TRACKING_CORRECTION_MODEL_VERSION);
  if (existing.error) throw new Error(`CFB approved correction read failed: ${existing.error.message}`);
  const complete = new Set<number>();
  for (const row of existing.data ?? []) {
    const a = CFB_APPROVED_TRACKING_CORRECTIONS.find(a => a.originalId === row.supersedes);
    if (!a || row.external_id !== a.externalId || row.market !== a.market || row.release !== CFB_PUBLISHED_TRACKING_CORRECTION_RELEASE || complete.has(a.originalId)) throw new Error("CFB approved correction identity mismatch");
    complete.add(a.originalId);
  }
  const pending: readonly Approval[] = CFB_APPROVED_TRACKING_CORRECTIONS.filter(a => !complete.has(a.originalId));
  if (pending.length === 0) return 0;
  const originals = await client.from("prediction_records").select("*").in("id", pending.map(a => a.originalId));
  if (originals.error) throw new Error(`CFB approved original read failed: ${originals.error.message}`);
  if ((originals.data?.length ?? 0) !== pending.length) throw new Error("CFB approved original set incomplete");
  const ids = [...new Set(pending.map(a => a.sourceId))];
  const evidence = await client.from("cfb_forward_evidence_snapshots").select("id,payload_sha256,payload").in("id", ids);
  if (evidence.error) throw new Error(`CFB approved source read failed: ${evidence.error.message}`);
  if ((evidence.data?.length ?? 0) !== ids.length) throw new Error("CFB approved source set incomplete");
  const rows = pending.map(a => { const source = originals.data!.find(r => r.id === a.originalId)!;
    const snapshot = evidence.data!.find(e => e.id === a.sourceId)!;
    return buildApprovedCfbTrackingCorrection({ source: source as PredictionRecordRow, payload: snapshot.payload as CfbForwardEvidencePayload, evidenceId: snapshot.id, evidenceSha256: snapshot.payload_sha256 }); });
  const inserted = await client.from("prediction_records").insert(rows).select("id");
  if (inserted.error) throw new Error(`CFB approved correction insert failed: ${inserted.error.message}`);
  if (inserted.data?.length !== rows.length) throw new Error("CFB approved correction insert incomplete");
  return rows.length;
}
