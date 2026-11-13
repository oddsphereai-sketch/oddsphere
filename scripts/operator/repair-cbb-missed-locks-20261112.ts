/** Owner-approved, bounded append-only recovery. Default is SELECT-only. */
import { randomUUID } from "node:crypto";
import approved from "../fixtures/cbb-missed-lock-recovery-20261112.json";
import { supabase } from "../../lib/db/supabase";
import { acquireCronJobLease, releaseCronJobLease } from "../../lib/cron/leases";
import { acquireCronJobLeaseWithRetry } from "../../lib/cron/leaseRetry";
import { readCbbMemberGames } from "../../lib/services/cbb/cbbMemberGameStore";
import { cbbTrackingEvidenceSha256 } from "../../lib/services/cbb/cbbTrackingWriter";
import { buildCbbMissedLockRecovery, CBB_MISSED_LOCK_RECOVERY_RELEASE } from "../../lib/services/cbb/cbbMissedLockRecovery";
import { gradePrediction } from "../../lib/services/predictionGrader";
import { refreshTrackingFoundationResponseSnapshot } from "../../lib/services/labResponseSnapshotWriter";
import type { PredictionRecordRow } from "../../lib/types/domain/Tracking";

async function main() {
  const apply = process.argv.includes("--apply"), runId = randomUUID(), jobName = "prediction_pipeline:cbb";
  if (approved.release !== CBB_MISSED_LOCK_RECOVERY_RELEASE || approved.sources.length !== 19) throw Error("Wrong approved recovery manifest");
  let leased = false;
  try {
    if (apply) {
      const { lease } = await acquireCronJobLeaseWithRetry({ jobName, runId, leaseSeconds: 600, maxWaitMs: 15_000 }, { acquire: acquireCronJobLease });
      if (lease.mode !== "acquired") throw Error(`CBB recovery lease not acquired: ${lease.mode}`);
      leased = true;
    }
    const ids = approved.sources.map(s => s.gameId);
    const original = await readCbbMemberGames(ids, supabase);
    const before = await supabase.from("prediction_records").select("*").eq("sport", "cbb").eq("slate_date", approved.slateDate).order("id");
    if (before.error) throw Error(before.error.message);
    const existing = before.data as PredictionRecordRow[];
    const recovered = existing.filter(r => ids.includes(r.external_id));
    if (recovered.some(r => r.snapshot_json?.tracking_recovery_release !== approved.release)) throw Error("Recovery would conflict with existing historical record");
    const recoveredAt = recovered[0]?.locked_at ?? new Date().toISOString();
    const proposals: PredictionRecordRow[] = [];
    for (const source of approved.sources) {
      const record = original.get(source.gameId);
      if (!record || record.snapshot.capturedAt !== source.capturedAt || record.snapshot.startsAt !== source.startsAt)
        throw Error(`Approved original source missing or changed: ${source.gameId}`);
      proposals.push(...await buildCbbMissedLockRecovery({ original: record, approvedSha256: source.sha256, recoveredAt, db: supabase }));
    }
    const all = [...recovered, ...proposals];
    if (all.length !== approved.expectedMarkets || new Set(all.map(r => `${r.external_id}:${r.market}`)).size !== all.length
      || all.filter(r => r.play_grade === "lean").length !== approved.expectedLeans)
      throw Error("Recovered contracts differ from approved 55-record/10-Lean manifest");
    const fixtures = await supabase.from("games").select("id,external_id,status,home_score,away_score").eq("sport", "cbb").in("external_id", ids);
    if (fixtures.error || fixtures.data.length !== ids.length || fixtures.data.some(g => g.status !== "STATUS_FINAL")) throw Error("Incomplete canonical final results");
    const byId = new Map(fixtures.data.map(g => [g.external_id, g]));
    const counts: Record<string, Record<string, number>> = {};
    for (const row of all) {
      const g = byId.get(row.external_id)!;
      const grade = gradePrediction({ record: { ...row, id: row.id ?? -1 }, game: { status: g.status, home_score: g.home_score, away_score: g.away_score, first_inning_runs: null }, source: "manual_operator" });
      counts[row.market] ??= {}; counts[row.market][grade.result] = (counts[row.market][grade.result] ?? 0) + 1;
    }
    if (JSON.stringify(counts) !== JSON.stringify({ moneyline: { win: 12, loss: 7 }, spread: { win: 8, loss: 10 }, total: { loss: 9, win: 9 } })) {
      // Property insertion order is not part of the result contract.
      for (const [market, wins, losses] of [["moneyline",12,7],["spread",8,10],["total",9,9]] as const)
        if (counts[market]?.win !== wins || counts[market]?.loss !== losses || Object.keys(counts[market]).length !== 2) throw Error("Recovery result comparison changed");
    }
    console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", games: ids.length, markets: all.length, existing: recovered.length, toInsert: proposals.length, leans: approved.expectedLeans, counts, originalSourcesPreserved: true, onTimeT60Lock: false, recoveredAt }, null, 2));
    if (!apply) return;
    if (proposals.length) {
      const inserted = await supabase.from("prediction_records").insert(proposals);
      if (inserted.error) throw Error(`Recovery insert failed: ${inserted.error.message}`);
    }
    const read = await supabase.from("prediction_records").select("*").eq("sport", "cbb").in("external_id", ids).order("id");
    if (read.error || read.data.length !== approved.expectedMarkets) throw Error("Recovery readback incomplete");
    const rows = read.data as PredictionRecordRow[];
    for (const row of rows) if (row.snapshot_json?.tracking_recovery_release !== approved.release || row.snapshot_json?.on_time_t60_lock !== false) throw Error("Recovery provenance missing");
    const grades = rows.map(record => { const g=byId.get(record.external_id)!;return gradePrediction({ record, game: { status:g.status,home_score:g.home_score,away_score:g.away_score,first_inning_runs:null }, source:"manual_operator", notes:"Owner-approved missed-lock recovery from exact stored pregame forecast; original member payload unchanged." }); });
    const graded = await supabase.from("prediction_grades").upsert(grades, { onConflict:"prediction_record_id",ignoreDuplicates:true });
    if (graded.error) throw Error(`Recovery grading failed: ${graded.error.message}`);
    const after = await readCbbMemberGames(ids,supabase);
    for (const source of approved.sources) if (!after.get(source.gameId) || cbbTrackingEvidenceSha256(after.get(source.gameId)!) !== source.sha256) throw Error("Original member payload changed");
    const protectedIds=existing.filter(r=>!ids.includes(r.external_id)).map(r=>r.id!);
    const protectedRows=await supabase.from("prediction_records").select("*").in("id",protectedIds).order("id");
    if(protectedRows.error||JSON.stringify(protectedRows.data)!==JSON.stringify(existing.filter(r=>protectedIds.includes(r.id!))))throw Error("Original tracked records changed");
    const snapshot=await refreshTrackingFoundationResponseSnapshot({source:approved.release});
    if(!snapshot.ok)throw Error(snapshot.error??"Tracking snapshot publication failed");
    console.log(JSON.stringify({complete:true,inserted:proposals.length,graded:grades.length,originalTrackedRecordsUnchanged:protectedIds.length,originalMemberPayloadsUnchanged:ids.length,trackingSnapshot:snapshot.snapshotKey}));
  } finally { if(leased)await releaseCronJobLease({jobName,runId}); }
}
main().catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=1;});
