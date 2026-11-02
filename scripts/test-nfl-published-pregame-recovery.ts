import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hashNflForwardEvidencePayload, NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE, type NflForwardEvidencePayload, type NflForwardStoredEvidence } from "../lib/services/football/nflForwardEvidence";
import { buildNflPublishedPregameRecoveryRecords, selectNflPublishedPregameRecoverySource, type NflPublishedPregameRecovery } from "../lib/services/football/nflOfficialTrackingRecord";
import { writeOfficialTrackingFromPayloads } from "../lib/services/football/nflForwardEvidenceWriter";
import { effectiveTrackingPlayGrade, isTrackingRecordEligible } from "../lib/services/trackingAggregateService";
import { alternateLineOutcome, hasVerifiedAlternateLineSource } from "../lib/services/tracking/alternateLinePerformance";
import { gradePrediction } from "../lib/services/predictionGrader";
import { gradePredictionsForSlate } from "../lib/services/predictionGradingService";

const start = "2026-11-02T01:20:00.000Z";
const captured = "2026-11-01T23:06:36.644Z";
const game = { status: "scheduled", providerGameId: "1392335", scheduledStart: start,
  away: { id: 1, abbreviation: "PHI", name: "Philadelphia Eagles" },
  home: { id: 2, abbreviation: "WSH", name: "Washington Commanders" } };
const decisions = (["moneyline", "spread", "total"] as const).map((market, index) => ({
  market, providerGameId: game.providerGameId, stage: "unlocked", lockedAt: null,
  evaluatedAt: captured, gameStartsAt: start, decisionRelease: "original-decision",
  modelRelease: `original-${market}`, calibrationRelease: "original-calibration",
  side: ["WSH", "PHI", "Over 40.5"][index], grade: index === 1 ? "Best Angle" : "No Play",
  modelProbability: [.5159043784756961, .6484845648434803, .5145820133512115][index], marketFairProbability: .5, expectedValue: .1,
  evaluatedQuote: { line: [null, 6, 40.5][index], price: [-260, -108, -105][index],
    sportsbook: "original-book", observedAt: captured },
}));
const sourcePayload = { schemaRelease: NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE, game, capturedAt: captured, stage: "unlocked", season: 2026, week: 8,
  decisions: { evaluatedBets: decisions, outcomeConfidence: [], publicationEnabled: true, trackingEnabled: false },
  market: { currentBooks: [], comparableCurrentBooks: [], operationalOpening: null },
  startersAndDepth: { away: { starterStatus: "projected" }, home: { starterStatus: "projected" } },
  weather: { venueName: "Northwest Stadium" },
  coverage: { healthHolds: [] },
} as unknown as NflForwardEvidencePayload;
const failedPayload = structuredClone(sourcePayload);
failedPayload.stage = "t60";
failedPayload.capturedAt = "2026-11-02T00:51:37.896Z";
failedPayload.decisions.evaluatedBets = [];
failedPayload.coverage.healthHolds = ["t60_capture_late"];
const row = (id: string, payload: NflForwardEvidencePayload): NflForwardStoredEvidence => ({
  id, providerGameId: game.providerGameId, stage: payload.stage, capturedAt: payload.capturedAt,
  gameStartAt: start, payloadSha256: hashNflForwardEvidencePayload(payload), payload,
});
const source = row("source", sourcePayload);
const failed = row("failed", failedPayload);
const rows = [source, failed];
const recovery: NflPublishedPregameRecovery = { sourceEvidenceId: source.id, sourcePayloadSha256: source.payloadSha256,
  failedEvidenceId: failed.id, failedPayloadSha256: failed.payloadSha256,
  ownerApproval: "Explicit owner recovery of this missed game", recoveredAt: "2026-11-02T16:00:00.000Z" };
const original = JSON.stringify(rows);
const selected = selectNflPublishedPregameRecoverySource({ rows, recovery });
assert.equal(selected, source);
const records = buildNflPublishedPregameRecoveryRecords({ source: selected, gameId: 42, recovery });
for (const record of records) {
  const decision = decisions.find(d => d.market === record.market)!;
  assert.deepEqual(record.snapshot_json?.decision_tuple, decision, "all original tuple fields, including null lock, survive exactly");
  assert.equal(record.locked_at, recovery.recoveredAt, "actual recovery clock, never a fabricated historical lock");
  assert.equal(record.published_at, captured);
  assert.equal(record.model_version, decision.decisionRelease);
  assert.equal(record.model_used, decision.modelRelease);
  assert.equal(record.model_probability, decision.modelProbability);
  assert.equal(record.odds_american, decision.evaluatedQuote.price);
  assert.equal(record.line_value, decision.evaluatedQuote.line);
  assert.equal(record.prediction_source, "nfl_published_pregame_recovery");
  assert.equal(record.snapshot_json?.stage, "unlocked");
  assert.equal((record.snapshot_json?.published_pregame_recovery as { onTimeT60Lock: boolean }).onTimeT60Lock, false);
  assert.equal(isTrackingRecordEligible(record), true, "the public reader includes this explicitly frozen recovered prediction");
  assert.equal(effectiveTrackingPlayGrade(record), decision.grade === "Best Angle" ? "best_angle" : "no_play");
  const grade = gradePrediction({ record: { ...record, id: 1 }, game: {
    status: "final", home_score: 27, away_score: 10, first_inning_runs: null,
  }, source: "manual_operator" });
  assert.equal(grade.result, record.market === "moneyline" ? "win" : "loss");
  if (record.market !== "moneyline") {
    assert.equal(hasVerifiedAlternateLineSource(record), true);
    const receipt = record.snapshot_json?.published_pregame_recovery;
    const projected = { ...record, snapshot_json: null,
      alternate_line_evidence_sha256: record.snapshot_json?.evidence_payload_sha256,
      alternate_line_pregame_recovery: receipt };
    assert.equal(hasVerifiedAlternateLineSource(projected), true, "bounded aggregate projection retains recovery provenance");
    assert.equal(hasVerifiedAlternateLineSource({ ...record, line_value: record.line_value! + 1 }), false);
    assert.equal(hasVerifiedAlternateLineSource({ ...record, published_at: recovery.recoveredAt }), false);
    assert.equal(hasVerifiedAlternateLineSource({ ...record, snapshot_json: null }), false);
    const wrongHashProjection = { ...projected, alternate_line_pregame_recovery: {
      ...(receipt as Record<string, unknown>), sourcePayloadSha256: "wrong-hash",
    } };
    assert.equal(hasVerifiedAlternateLineSource(wrongHashProjection), false);
    assert.equal(alternateLineOutcome(record, grade, 0), "loss");
    assert.equal(alternateLineOutcome(record, grade, 3), "loss");
    assert.equal(alternateLineOutcome(record, grade, 6), record.market === "spread" ? "loss" : "win");
  }
}
assert.equal(JSON.stringify(rows), original, "writer and reader do not mutate original or failed evidence");
const rejects = (mutate: (value: NflForwardStoredEvidence[]) => void, pattern: RegExp) => {
  const copy = structuredClone(rows); mutate(copy);
  assert.throws(() => selectNflPublishedPregameRecoverySource({ rows: copy, recovery }), pattern);
};
rejects(r => { r[0]!.payload.decisions.evaluatedBets[0]!.modelProbability = .9; }, /checksum/);
rejects(r => { r[1]!.payload.decisions.evaluatedBets = [
  { ...sourcePayload.decisions.evaluatedBets[0]!, stage: "t60_locked", lockedAt: failedPayload.capturedAt },
]; }, /existing locked/);
rejects(r => { const newer = structuredClone(sourcePayload); newer.capturedAt = "2026-11-02T00:05:00.000Z";
  newer.decisions.evaluatedBets = []; r.push(row("newer-incomplete", newer)); }, /latest pre-cutoff/);
rejects(r => { r[1]!.providerGameId = "other-game"; }, /another game/);
assert.throws(() => selectNflPublishedPregameRecoverySource({ rows, recovery: { ...recovery, ownerApproval: "" } }), /owner approval/);
assert.throws(() => selectNflPublishedPregameRecoverySource({ rows, recovery: { ...recovery, recoveredAt: captured } }), /existing locked/);

async function persistenceProof(): Promise<void> {
  const inserted: unknown[] = [];
  const insertedGames: unknown[] = [];
  let existing: unknown[] = [];
  let missingGame = false;
  const client = { from(table: string) {
    let insert = false;
    const q = { select() { return q; }, eq() { return q; }, in() { return q; },
      insert(value: unknown[]) { assert.ok(table === "prediction_records" || table === "games"); insert = true;
        if (table === "games") insertedGames.push(...value); else inserted.push(...value); return q; },
      upsert() { throw new Error("Recovery must never upsert final scores, teams or existing records"); },
      then(resolve: (r: unknown) => void) { resolve({ error: null, data: insert ? table === "games"
        ? [{ id: 42, external_id: 1392335 }] : [1, 2, 3].map(id => ({ id })) :
        table === "games" ? missingGame ? [] : [{ id: 42, external_id: 1392335, game_date: start }] :
        table === "teams" ? [{ id: 1, external_id: 1 }, { id: 2, external_id: 2 }] : existing }); },
    }; return q;
  } } as unknown as SupabaseClient;
  const args = { client, payloads: [sourcePayload], apply: true, publishedPregameRecovery: { rows, receipt: recovery } };
  assert.equal((await writeOfficialTrackingFromPayloads(args)).trackingRecordsInserted, 3);
  assert.deepEqual(inserted, records);
  existing = records.map((record, id) => ({ ...record, id,
    model_probability: Number(record.model_probability!.toFixed(6)) }));
  assert.equal((await writeOfficialTrackingFromPayloads(args)).trackingRecordsInserted, 0, "exact repeated recovery is idempotent");
  existing = [{ external_id: 1392335, market: "moneyline", locked_at: captured, snapshot_json: {} }];
  await assert.rejects(writeOfficialTrackingFromPayloads(args), /refuses existing or partial/);
  assert.equal(inserted.length, 3, "no replacement or duplicate can be written");
  existing = [];
  missingGame = true;
  assert.equal((await writeOfficialTrackingFromPayloads(args)).trackingRecordsInserted, 3);
  assert.equal(insertedGames.length, 1, "a missing game is inserted once through the sole writer, never upserted");
  assert.deepEqual(inserted.slice(3), records);
  assert.equal((await writeOfficialTrackingFromPayloads({ client, payloads: [sourcePayload], apply: false })).trackingRecordsProposed, 0,
    "the ordinary writer still rejects an unlocked payload without an explicit owner recovery");
  assert.equal(JSON.stringify(rows), original);
}
async function scopedGradingProof(): Promise<void> {
  const targets = records.map((record, index) => ({ ...record, id: 101 + index }));
  const foreign = { ...records[0]!, id: 999 };
  const foreignGrade = { prediction_record_id: 999, result: "win", grade_source: "csv_import",
    graded_at: "2026-11-02T03:00:00.000Z", grade_notes: "original provenance" };
  const grades = new Map<number, Record<string, unknown>>([[999, foreignGrade]]);
  const written: number[] = [];
  const client = { from(table: string) {
    let ids: number[] | undefined;
    let write: Record<string, unknown> | undefined;
    const q = { select() { return q; }, eq() { return q; }, not() { return q; },
      in(_column: string, values: number[]) { ids = values; return q; },
      upsert(value: Record<string, unknown>) { assert.equal(table, "prediction_grades"); write = value; return q; },
      then(resolve: (r: unknown) => void) {
        if (write) { const id = Number(write.prediction_record_id); written.push(id); grades.set(id, write); }
        resolve({ error: null, data: write ? null : table === "prediction_records"
          ? [...targets, foreign].filter(record => !ids || ids.includes(record.id))
          : table === "games" ? [{ id: 42, status: "final", home_score: 27, away_score: 10,
            first_inning_runs: null, game_date: start }] : [...grades.values()].filter(grade =>
              !ids || ids.includes(Number(grade.prediction_record_id))) });
      },
    }; return q;
  } } as unknown as SupabaseClient;
  const args = { sport: "nfl" as const, slateDate: "2026-11-01", apply: true,
    supabase: client, source: "auto_score_ingest" as const, recordIds: targets.map(record => record.id) };
  const result = await gradePredictionsForSlate(args);
  assert.equal(result.recordsLoaded, 3);
  assert.deepEqual(written, [101, 102, 103]);
  assert.deepEqual(targets.map(record => grades.get(record.id)?.result), ["win", "loss", "loss"]);
  assert.deepEqual(grades.get(999), foreignGrade, "another settled record retains every original provenance field");
  assert.equal((await gradePredictionsForSlate({ ...args, recordIds: [] })).recordsLoaded, 0);
  await assert.rejects(gradePredictionsForSlate({ ...args, recordIds: [0] }), /positive record IDs/);
  assert.equal(JSON.stringify(rows), original);
}
void persistenceProof().then(scopedGradingProof).then(() => console.log("NFL published pregame recovery: exact tuples, real clocks, reader precedence, append-only/idempotent writer, scoped grading provenance and lock protection passed."));
