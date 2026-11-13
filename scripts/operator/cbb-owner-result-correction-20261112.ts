/** Exact owner-authorized results only; SELECT-only unless --apply is supplied. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { supabase } from "../../lib/db/supabase";
import { acquireCronJobLease, releaseCronJobLease } from "../../lib/cron/leases";
import { acquireCronJobLeaseWithRetry } from "../../lib/cron/leaseRetry";
import { readCbbMemberGame } from "../../lib/services/cbb/cbbMemberGameStore";
import { cbbTrackingEvidenceSha256 } from "../../lib/services/cbb/cbbTrackingWriter";
import { gradePrediction } from "../../lib/services/predictionGrader";
import { shouldUpsertGrade } from "../../lib/services/predictionGradingService";
import { selectTrackingRecordsByScope } from "../../lib/services/trackingAggregateService";
import { refreshTrackingFoundationResponseSnapshot } from "../../lib/services/labResponseSnapshotWriter";
import type { PredictionGradeRow, PredictionRecordRow } from "../../lib/types/domain/Tracking";

const release = "cbb_owner_result_correction_2026_11_13_r1";
const ownerStatement = "I'm telling you those were wins. It's my site, and I'm authorizing the correction. Please add the spread and total wins so we have 24 games in each.";
const sourceHash = "664c21899b4636f9e326bc80b46a042f0c8ac6ea9a1a5b0fab8943a9c9462c81";
const externalId = 10883068, slateDate = "2026-11-12";
const markets = ["spread", "total"] as const;

async function main() {
  const apply = process.argv.includes("--apply"), jobName = "prediction_pipeline:cbb", runId = randomUUID();
  let leased = false;
  try {
    if (apply) {
      const { lease } = await acquireCronJobLeaseWithRetry({ jobName, runId, leaseSeconds: 600, maxWaitMs: 15_000 }, { acquire: acquireCronJobLease });
      assert.equal(lease.mode, "acquired", "CBB pipeline is busy; retry after the existing writer finishes");
      leased = true;
    }
    const original = await readCbbMemberGame(externalId, supabase);
    assert(original);
    assert.equal(cbbTrackingEvidenceSha256(original), sourceHash);
    const before = await supabase.from("prediction_records").select("*").eq("sport", "cbb").eq("slate_date", slateDate).order("id");
    if (before.error) throw Error(before.error.message);
    const rows = before.data as PredictionRecordRow[];
    const originals = rows.filter(r => r.model_version !== release);
    assert.equal(originals.length, 70);
    assert.equal(originals.filter(r => r.external_id === externalId).length, 1);
    const winner = originals.find(r => r.external_id === externalId && r.market === "moneyline");
    assert(winner);
    const fixture = await supabase.from("games").select("id,status,home_score,away_score").eq("id", winner.game_id).single();
    if (fixture.error) throw Error(fixture.error.message);
    assert.equal(fixture.data.status, "STATUS_FINAL");
    assert(Number.isFinite(fixture.data.home_score) && Number.isFinite(fixture.data.away_score));
    const existing = rows.filter(r => r.model_version === release);
    assert(existing.every(r => r.external_id === externalId && markets.includes(r.market as typeof markets[number])
      && r.snapshot_json?.owner_statement === ownerStatement && r.snapshot_json?.owner_confirmed_result === "win"
      && r.pick === null && r.side === null && r.line_value === null && r.odds_american === null
      && r.odds_decimal === null && r.model_probability === null && r.play_grade === "no_play" && r.no_bet === true));
    const at = existing[0]?.locked_at ?? new Date().toISOString();
    assert(at);
    const proposals: PredictionRecordRow[] = markets.filter(m => !existing.some(r => r.market === m)).map(market => ({
      game_prediction_id: null, game_id: winner.game_id, external_id: externalId, sport: "cbb", slate_date: slateDate,
      game_date: winner.game_date, matchup: winner.matchup, market, pick: null, side: null, line_value: null,
      odds_american: null, odds_decimal: null, model_used: "owner_authorized_historical_result", model_version: release,
      prediction_source: "owner_authorized_result", confidence: null, model_probability: null, market_probability: null,
      edge: null, expected_value: null, play_grade: "no_play", prediction_type: "owner_authorized_result",
      best_angle: false, no_bet: true, no_bet_reason: "Original wager tuple not stored; owner confirms outcome",
      market_aligned: false, data_quality_tier: null, source_quality: "owner_confirmed", provisional: false,
      held: false, hold_reason: null, launch_day: false, manual_outcome_expected: true,
      locked_at: at, published_at: at, calibration_version: null,
      snapshot_json: { tracking_correction_release: release, owner_statement: ownerStatement, owner_confirmed_result: "win",
        result_authority: "explicit_owner_confirmation", original_member_payload_sha256: sourceHash,
        original_member_snapshot_locked_at: original.snapshot.lockedAt, original_member_captured_at: original.snapshot.capturedAt,
        original_model_release: original.snapshot.board.modelRelease, original_moneyline_record_id: winner.id,
        correction_recorded_at: at, on_time_t60_lock: false, original_wager_tuple_stored: false },
    }));
    for (const record of [...existing, ...proposals]) {
      const computed = gradePrediction({ record, game: { ...fixture.data, first_inning_runs: null }, source: "auto_score_ingest" });
      assert.equal(computed.result, "pending", "No missing wager tuple may be inferred");
      assert.equal(shouldUpsertGrade({ existingResult: "win", newResult: computed.result, record }), false,
        "Normal grading must preserve the owner-confirmed final result");
      assert(selectTrackingRecordsByScope([record]).calendarRecords.includes(record));
    }
    console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", release, externalId, markets, result: "win", toInsert: proposals.length,
      originalRecordsPreserved: originals.length, lineAndPrice: null, expectedCounts: { moneyline: "17-7", spread: "11-13", total: "13-11" } }));
    if (!apply) return;
    if (proposals.length) {
      const inserted = await supabase.from("prediction_records").insert(proposals);
      if (inserted.error) throw Error(inserted.error.message);
    }
    const readback = await supabase.from("prediction_records").select("*").eq("sport", "cbb").eq("slate_date", slateDate).order("id");
    if (readback.error) throw Error(readback.error.message);
    const all = readback.data as PredictionRecordRow[], corrections = all.filter(r => r.model_version === release);
    assert.equal(corrections.length, 2);
    assert.deepEqual(all.filter(r => r.model_version !== release), originals);
    const grades: PredictionGradeRow[] = corrections.map(r => ({ prediction_record_id: r.id!, game_id: r.game_id,
      market: r.market, result: "win", win: true, loss: false, push: false, void: false, pending: false,
      actual_home_score: fixture.data.home_score, actual_away_score: fixture.data.away_score,
      actual_total: fixture.data.home_score + fixture.data.away_score, actual_first_inning_runs: null, winning_team: null,
      grade_source: "manual_operator", graded_at: at,
      grade_notes: `${release}: owner explicitly confirms this market won and authorizes the correction. Original stored payload unchanged; no pick, line, price or probability reconstructed.` }));
    const gradeWrite = await supabase.from("prediction_grades").upsert(grades, { onConflict: "prediction_record_id", ignoreDuplicates: true });
    if (gradeWrite.error) throw Error(gradeWrite.error.message);
    const gradeRead = await supabase.from("prediction_grades").select("prediction_record_id,result,grade_source").in("prediction_record_id", corrections.map(r => r.id!));
    if (gradeRead.error) throw Error(gradeRead.error.message);
    assert.equal(gradeRead.data.length, 2);
    assert(gradeRead.data.every(g => g.result === "win" && g.grade_source === "manual_operator"));
    const allGrades = await supabase.from("prediction_grades").select("prediction_record_id,result").in("prediction_record_id", all.map(r => r.id!));
    if (allGrades.error) throw Error(allGrades.error.message);
    assert.equal(allGrades.data.length, 72);
    const byId = new Map(allGrades.data.map(g => [g.prediction_record_id, g.result]));
    for (const [market, wins, losses] of [["moneyline", 17, 7], ["spread", 11, 13], ["total", 13, 11]] as const) {
      const cohort = all.filter(r => r.market === market);
      assert.equal(cohort.length, 24);
      assert.equal(cohort.filter(r => byId.get(r.id!) === "win").length, wins);
      assert.equal(cohort.filter(r => byId.get(r.id!) === "loss").length, losses);
    }
    assert.equal(cbbTrackingEvidenceSha256((await readCbbMemberGame(externalId, supabase))!), sourceHash);
    const snapshot = await refreshTrackingFoundationResponseSnapshot({ source: release });
    assert(snapshot.ok, snapshot.error);
    console.log(JSON.stringify({ complete: true, inserted: proposals.length, ownerConfirmedWins: 2, originalsUnchanged: originals.length, snapshot: snapshot.snapshotKey }));
  } finally { if (leased) await releaseCronJobLease({ jobName, runId }); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
