/** Review-first recovery of the two missing November 15 full-game NFL records.
 * Apply requires concrete owner approval and this exact protected deployed tree.
 * No forecast rerun, inferred wager price, historical evidence update or timer. */
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { acquireCronJobLease, releaseCronJobLease } from '../../lib/cron/leases';
import { hashNflForwardEvidencePayload, type NflForwardStoredEvidence } from '../../lib/services/football/nflForwardEvidence';
import { readNflForwardEvidence } from '../../lib/services/football/nflForwardEvidenceStore';
import { readNflForwardMemberSnapshot } from '../../lib/services/football/nflForwardMemberSnapshotStore';
import { planNflOwnerPublishedRecovery, buildNflPublishedDeadlineTrackingRecords } from '../../lib/services/football/nflPublishedDeadlineTracking';
import { writeOfficialTrackingFromPayloads, refreshCompactMemberSnapshot } from '../../lib/services/football/nflForwardEvidenceWriter';
import { fetchBalldontlieNflRegularResults } from '../../lib/services/football/balldontlieNflPreviewSlate';
import { ingestNflFinalScores } from '../../lib/services/football/nflScoreIngestService';
import { gradePredictionsForSlate } from '../../lib/services/predictionGradingService';
import { gradePrediction } from '../../lib/services/predictionGrader';
const specs = [{ id: '1392358', source: '3d815630-ef69-45ef-9cd2-8f765e74d1fa', failed: '9a5fc393-6062-4fd2-8330-f1e31b62901a', failedHash:'fef1bafad0b09270516eb6ee5f2337db9f8d20f4b04b6e5aea6d3c725b28290d', sourceHash: '91c35c4e41432c4b9a378a3c51a2c1051679e752e31bc3dc3ff41393f9d2685d', away: 22, home: 24 }, { id: '1392362', source: 'a24ae1d1-3efa-43f2-9560-ab6dd19d0d2b', failed: '3122a655-4d3a-46c7-9949-8bd0b4e34c46', failedHash:'6a40216e442ae59be8149adf986ddbcf644ece5867d8c1c647fee5a1afed570e', sourceHash: '65968dfcd2103232a593e858e19adac4c9ea99d976e33c16bc1617879fbf11b2', away: 34, home: 6 }];
async function main() {
    const apply = process.argv.includes('--apply'), owner = process.argv.find(a => a.startsWith('--owner-approval='))?.slice(17), output = process.argv.find(a => a.startsWith('--output='))?.slice(9);
    if (apply && !owner?.trim())
        throw Error('Explicit owner approval is required for incomplete historical records.');
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    if (apply) {
        if (execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim())
            throw Error('Dirty recovery checkout');
        const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
        const r = await fetch('https://www.oddsphereai.com/api/admin/cbb/contextual-readiness', { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
        const p = await r.json();
        if (!r.ok || p.deployment?.commit !== sha)
            throw Error('Exact protected commit is not deployed');
    }
    const jobName = 'prediction_pipeline:nfl', runId = randomUUID();
    if (apply) {
        const l = await acquireCronJobLease({ jobName, runId, leaseSeconds: 240 });
        if (l.mode !== 'acquired')
            throw Error('NFL prediction pipeline is busy: ' + l.mode);
    }
    try {
        const rows: NflForwardStoredEvidence[] = [];
        for (const spec of specs) {
            for (const id of [spec.source, spec.failed]) {
                const q = await db.from('nfl_forward_evidence_snapshots').select('id,provider_game_id,stage,captured_at,game_start_at,payload_sha256,payload').eq('id', id).single();
                if (q.error)
                    throw q.error;
                const r = q.data;
                if (hashNflForwardEvidencePayload(r.payload) !== r.payload_sha256 || (id===spec.failed && r.payload_sha256!==spec.failedHash))
                    throw Error('Original checksum differs');
                rows.push({ id: r.id, providerGameId: r.provider_game_id, stage: r.stage, capturedAt: new Date(r.captured_at).toISOString(), gameStartAt: new Date(r.game_start_at).toISOString(), payloadSha256: r.payload_sha256, payload: r.payload });
            }
            const source = rows.find(r => r.id === spec.source)!;
            if (spec.sourceHash && source.payloadSha256 !== spec.sourceHash)
                throw Error('Reviewed source changed');
            const latest = await db.from('nfl_forward_evidence_snapshots').select('id').eq('provider_game_id', spec.id).eq('stage', 'unlocked').eq('payload->decisions->>publicationEnabled', 'true').lt('captured_at', new Date(Date.parse(source.gameStartAt) - 3600000).toISOString()).order('captured_at', { ascending: false }).limit(1);
            if (latest.error || latest.data?.[0]?.id !== spec.source)
                throw Error('Reviewed source is not latest original approved pre-cutoff publication');
        }
        const previous = await readNflForwardMemberSnapshot({ client: db, season: 2026, week: 10, now: new Date().toISOString() });
        if (!previous)
            throw Error('Saved original member cards unavailable');
        const provider = await fetchBalldontlieNflRegularResults({ season: 2026, week: 10 });
        const proposals = specs.map(spec => { const source = rows.find(r => r.id === spec.source)!, final = provider.games.find(g => g.providerGameId === spec.id); if (!final || final.status.toLowerCase() !== 'final' || final.awayScore !== spec.away || final.homeScore !== spec.home || final.away.id !== source.payload.game.away.id || final.home.id !== source.payload.game.home.id || Date.parse(final.scheduledStart) !== Date.parse(source.gameStartAt))
            throw Error('Reviewed final game identity/result differs'); return planNflOwnerPublishedRecovery({ rows, previous, sourceId: spec.source, failedId: spec.failed, ownerApproval: owner ?? 'REVIEW ONLY — owner approval pending', now: new Date().toISOString() }); });
        const review = proposals.map((p, i) => ({ game: specs[i]!.id, matchup: p.source.payload.game.away.abbreviation + ' at ' + p.source.payload.game.home.abbreviation, date: '2026-11-15', sourceId: p.source.id, sourceSha256: p.source.payloadSha256, failedId: p.failed!.id, failedSha256: p.failed!.payloadSha256, sourceAt: p.source.capturedAt, operationalException: p.receipt.operationalException, rawPricesPresent: true, originalsPreserved: true, onTimeT60Lock: false, records: buildNflPublishedDeadlineTrackingRecords(p, -1).map(r => ({ market: r.market, pick: r.pick, line: r.line_value, price: r.odds_american, grade: r.play_grade, probability: r.model_probability, originalModel: r.model_version, result: gradePrediction({ record: { ...r, id: 1 }, game: { status: 'final', away_score: specs[i]!.away, home_score: specs[i]!.home, first_inning_runs: null }, source: 'manual_operator' }).result })) }));
        const report = { apply, ownerApproval: owner ?? null, review };
        if (output)
            writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
        if (!apply) {
            console.log(JSON.stringify(report, null, 2));
            return;
        }
        const write = await writeOfficialTrackingFromPayloads({ client: db, payloads: proposals.map(p => p.source.payload), publishedDeadlineLocks: proposals, apply: true });
        const scores = await ingestNflFinalScores({ supabase: db, slateDate: '2026-11-15', apply: true });
        const thursdayScores = await ingestNflFinalScores({ supabase: db, slateDate: '2026-11-12', apply: true });
        if(thursdayScores.errors.length)throw Error(JSON.stringify(thursdayScores.errors));
        if (scores.errors.length)
            throw Error(JSON.stringify(scores.errors));
        const targets = await db.from('prediction_records').select('id').eq('sport', 'nfl').in('external_id', specs.map(s => Number(s.id))).eq('prediction_source', 'nfl_owner_published_forecast_recovery');
        if (targets.error || targets.data?.length !== 6)
            throw Error('Expected exactly six scoped new records');
        const grades = await gradePredictionsForSlate({ supabase: db, sport: 'nfl', slateDate: '2026-11-15', apply: true, source: 'auto_score_ingest', recordIds: targets.data.map(r => r.id) });
        if (grades.errors.length || grades.computed.pending)
            throw Error(JSON.stringify(grades));
        // Existing member locks retain precedence; all original source bytes survive.
        const member = await refreshCompactMemberSnapshot({ client: db, existing: await readNflForwardEvidence({ client: db, season: 2026, week: 10 }), payloads: [], season: 2026, week: 10, now: new Date().toISOString(), apply: true });
        console.log(JSON.stringify({ ...report, write, scores, thursdayScores, grades, member }, null, 2));
    }
    finally {
        if (apply)
            await releaseCronJobLease({ jobName, runId });
    }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
