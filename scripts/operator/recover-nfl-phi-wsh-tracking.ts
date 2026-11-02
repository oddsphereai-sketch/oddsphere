/** Owner-directed, append-only recovery of the November 1 missed NFL lock. */
import { randomUUID } from "node:crypto";
import { supabase } from "../../lib/db/supabase";
import { acquireCronJobLease, cronJobName, releaseCronJobLease } from "../../lib/cron/leases";
import { readNflForwardEvidence } from "../../lib/services/football/nflForwardEvidenceStore";
import { writeOfficialTrackingFromPayloads } from "../../lib/services/football/nflForwardEvidenceWriter";
import {
  buildNflPublishedPregameRecoveryRecords,
  selectNflPublishedPregameRecoverySource,
  NFL_PUBLISHED_PREGAME_RECOVERY_RELEASE,
  type NflPublishedPregameRecovery,
} from "../../lib/services/football/nflOfficialTrackingRecord";
import { gradePredictionsForSlate } from "../../lib/services/predictionGradingService";
import { fetchBalldontlieNflRegularResults } from "../../lib/services/football/balldontlieNflPreviewSlate";
import { ingestNflFinalScores } from "../../lib/services/football/nflScoreIngestService";

const apply = process.argv.includes("--apply");
if (process.argv.slice(2).some(arg => arg !== "--apply")) throw new Error("Only --apply is supported.");
const gameId = "1392335";
const runId = randomUUID();
const jobName = cronJobName("prediction_pipeline", "nfl");
const recovery: NflPublishedPregameRecovery = {
  sourceEvidenceId: "cbf096d7-ecc8-4832-b5f7-92d76f56cf51",
  sourcePayloadSha256: "12cc72a851d4e0fb17e8cd15f06839e2fb068992ae4c5d2bfff2179926295213",
  failedEvidenceId: "1d7a6194-4f9e-49d5-84a8-8e8220c700c9",
  failedPayloadSha256: "6d7b1539b4171348b330f51fdedfbd4887caacad37fad1ec669d598e6da293fa",
  ownerApproval: "Daniel Mengel, 2026-11-02: recover the existing Eagles–Commanders prediction; do not leave the game out of tracking.",
  recoveredAt: new Date().toISOString(),
};

async function main(): Promise<void> {
  if (apply) {
    const lease = await acquireCronJobLease({ jobName, runId, leaseSeconds: 180 });
    if (lease.mode !== "acquired") throw new Error(`NFL recovery lease not acquired: ${lease.mode}`);
  }
  try {
    const rows = (await readNflForwardEvidence({ client: supabase, season: 2026, week: 8 }))
      .filter(row => row.providerGameId === gameId);
    const before = JSON.stringify(rows);
    const source = selectNflPublishedPregameRecoverySource({ rows, recovery });
    const { data: games, error } = await supabase.from("games")
      .select("id,status,home_score,away_score,game_date").eq("sport", "nfl").eq("external_id", Number(gameId));
    if (error || (games?.length ?? 0) > 1) throw new Error("Ambiguous recovery game identity.");
    const final = (await fetchBalldontlieNflRegularResults({ season: 2026, week: 8 })).games
      .find(game => game.providerGameId === gameId);
    if (!final || final.status.toLowerCase() !== "final" || final.awayScore !== 10 || final.homeScore !== 27 ||
        final.away.id !== source.payload.game.away.id || final.home.id !== source.payload.game.home.id ||
        Date.parse(final.scheduledStart) !== Date.parse(source.gameStartAt)) {
      throw new Error("Exact provider final score/identity does not match the reviewed PHI-WSH incident.");
    }
    const records = buildNflPublishedPregameRecoveryRecords({ source, gameId: games?.[0]?.id ?? -1, recovery });
    const { data: existing, error: existingError } = await supabase.from("prediction_records")
      .select("id,market,prediction_source,snapshot_json").eq("sport", "nfl").eq("external_id", Number(gameId));
    if (existingError) throw existingError;
    const write = await writeOfficialTrackingFromPayloads({ client: supabase, payloads: [source.payload], apply,
      publishedPregameRecovery: { rows, receipt: recovery } });
    const scores = apply ? await ingestNflFinalScores({ supabase, slateDate: "2026-11-01", apply: true }) : null;
    if (scores?.errors.length) throw new Error(JSON.stringify(scores.errors));
    const { data: gradeTargets, error: targetError } = await supabase.from("prediction_records")
      .select("id").eq("sport", "nfl").eq("external_id", Number(gameId));
    if (targetError || (apply && gradeTargets?.length !== 3)) throw new Error("Recovery grading requires its exact three record IDs.");
    const grading = apply ? await gradePredictionsForSlate({ sport: "nfl", slateDate: "2026-11-01",
      apply: true, supabase, source: "auto_score_ingest", recordIds: gradeTargets!.map(row => row.id) }) : null;
    if (grading?.errors.length) throw new Error(JSON.stringify(grading.errors));
    const after = (await readNflForwardEvidence({ client: supabase, season: 2026, week: 8 }))
      .filter(row => row.providerGameId === gameId);
    if (JSON.stringify(after) !== before) throw new Error("Original game evidence changed during recovery.");
    const { data: verified, error: verifiedError } = await supabase.from("prediction_records")
      .select("id,market,pick,line_value,odds_american,play_grade,model_version,locked_at,snapshot_json,prediction_grades(result)")
      .eq("sport", "nfl").eq("external_id", Number(gameId));
    if (verifiedError) throw verifiedError;
    if (apply && (verified?.length !== 3 || verified.some(row => !row.prediction_grades))) {
      throw new Error("NFL recovery did not produce exactly three settled records.");
    }
    console.log(JSON.stringify({ release: NFL_PUBLISHED_PREGAME_RECOVERY_RELEASE, apply, source: {
      id: source.id, capturedAt: source.capturedAt, sha256: source.payloadSha256,
    }, originalEvidenceUnchanged: true, originalFinalSlotUnchanged: true, existing: existing?.length ?? 0,
    finalScore: { away: final.awayScore, home: final.homeScore }, scores,
    records: records.map(row => ({ market: row.market, pick: row.pick, line: row.line_value,
      odds: row.odds_american, grade: row.play_grade, probability: row.model_probability,
      originalRelease: row.model_version, frozenAt: row.locked_at })), write,
    settled: verified?.map(row => ({ id: row.id, market: row.market, result: row.prediction_grades })),
    grading: grading ? { inserted: grading.upsertedCount, errors: grading.errors } : null,
  }, null, 2));
  } finally {
    if (apply) await releaseCronJobLease({ jobName, runId });
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
