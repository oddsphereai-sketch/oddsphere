/** Copy-only public-record locking. No model, provider, clock rewriting or timer. */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import type { DailyEdgeGameDto } from '@/app/lab/lib/labTypes';
import type { PredictionRecordRow } from '@/lib/types/domain/Tracking';
import { hashNflForwardEvidencePayload, NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE, hasNflStoredLockedDecision, type NflForwardEvidencePayload, type NflForwardStoredEvidence } from './nflForwardEvidence';
import { serializeNflPublishedSourceTracking } from './nflOfficialTrackingRecord';
import { renderNflPublishedSourceGame } from './nflWeekOneHeldMemberFixture';
import type { NflForwardMemberSnapshot } from './nflForwardMemberSnapshotStore';
export const NFL_PUBLISHED_DEADLINE_LOCK_RELEASE = 'nfl_published_deadline_lock_2026_11_16_r1' as const;
export type NflPublishedLockReceipt = {
    release: typeof NFL_PUBLISHED_DEADLINE_LOCK_RELEASE;
    mode: 'deadline' | 'owner_recovery';
    providerGameId: string;
    sourceEvidenceId: string;
    sourcePayloadSha256: string;
    sourceCapturedAt: string;
    sourcePublishedAt: string;
    cutoffAt: string;
    frozenAt: string;
    memberGameSha256: string;
    operationalException: boolean;
    ownerApproval?: string;
    failedEvidenceId?: string;
    failedPayloadSha256?: string;
};
export type NflPublishedLockProposal = {
    source: NflForwardStoredEvidence & {
        payload: NflForwardEvidencePayload;
    };
    receipt: NflPublishedLockReceipt;
    memberGame: DailyEdgeGameDto;
    failed?: NflForwardStoredEvidence;
};
const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)])) : v;
export const nflPublishedGameSha256 = (v: unknown) => createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const need = (v: unknown, m: string) => { if (!v)
    throw Error('NFL published lock: ' + m); };
const fields = ['pick', 'line', 'priceAmerican', 'modelProb'] as const;
function matches(a: DailyEdgeGameDto, b: DailyEdgeGameDto) { return String(a.external_id) === String(b.external_id) && Date.parse(a.gameStartAt ?? '') === Date.parse(b.gameStartAt ?? '') && (['moneyline', 'first_inning', 'total'] as const).every(k => fields.every(f => a.markets[k][f] === b.markets[k][f]) && a.markets[k].verdict?.label === b.markets[k].verdict?.label); }
export function validateNflPublishedLock(p: NflPublishedLockProposal, checkRendering = false) {
    const { s, receipt: r, memberGame: g } = { s: p.source, receipt: p.receipt, memberGame: p.memberGame }, source = s.payload, start = Date.parse(source.game.scheduledStart), cutoff = start - 60 * 60000, at = Date.parse(r.frozenAt), capture = Date.parse(s.capturedAt);
    need(r.release === NFL_PUBLISHED_DEADLINE_LOCK_RELEASE && s.stage === 'unlocked' && source.stage === 'unlocked' && !source.captureAttempt && source.schemaRelease === NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE && source.decisions.publicationEnabled && !source.decisions.trackingEnabled, 'source is not an approved unlocked publication');
    need(r.sourceEvidenceId === s.id && r.providerGameId === s.providerGameId && source.game.providerGameId === s.providerGameId && String(g.external_id) === s.providerGameId && r.sourcePayloadSha256 === s.payloadSha256 && hashNflForwardEvidencePayload(source) === s.payloadSha256, 'source identity/checksum differs');
    need([start, cutoff, at, capture, Date.parse(r.sourcePublishedAt)].every(Number.isFinite) && capture < cutoff && capture >= cutoff - 90 * 60000 && r.sourceCapturedAt === s.capturedAt && Date.parse(source.capturedAt) === capture && Date.parse(r.cutoffAt) === cutoff && Date.parse(g.gameStartAt ?? '') === start, 'source/deadline clock differs');
    if (r.mode === 'deadline')
        need(at >= cutoff && at < start && Date.parse(r.sourcePublishedAt) <= cutoff, 'outside future publication lock window');
    else {
        need(r.mode === 'owner_recovery' && at > start && !!r.ownerApproval?.trim() && !!r.failedEvidenceId && !!r.failedPayloadSha256, 'historical recovery lacks explicit owner receipt');
        const f = p.failed;
        need(f && f.id === r.failedEvidenceId && f.providerGameId === s.providerGameId && f.payloadSha256 === r.failedPayloadSha256 && hashNflForwardEvidencePayload(f.payload) === f.payloadSha256, 'failed final capture proof differs');
        need(f && f.payload.captureAttempt?.requestedStage === 't60' && f.payload.captureAttempt.status === 'failed' && Date.parse(f.payload.captureAttempt.cutoffAt) === cutoff && Date.parse(f.capturedAt) >= cutoff && Date.parse(f.capturedAt) < start, 'not the original failed final capture');
    }
    need(g.lockedAt === r.frozenAt && g.lockState === 'locked' && nflPublishedGameSha256(g) === r.memberGameSha256, 'public frozen card differs');
    if (checkRendering) {
        const rendered = renderNflPublishedSourceGame(s);
        need(rendered && matches(g, rendered), 'member prices/picks/probabilities/grades differ from the original source');
    }
    const expectedException = source.decisions.evaluatedBets.length === 0 && source.coverage.healthHolds.length > 0;
    need(r.operationalException === expectedException, 'operational exception classification differs');
    return p;
}
export function planNflPublishedDeadlineLocks(args: {
    rows: NflForwardStoredEvidence[];
    previous: NflForwardMemberSnapshot | null;
    now: string;
    failedFinalGameIds: ReadonlySet<string>;
}): NflPublishedLockProposal[] {
    if (!args.previous)
        return [];
    const now = Date.parse(args.now), published = Date.parse(args.previous.publishedAt);
    need(Number.isFinite(now) && Number.isFinite(published), 'invalid planning clock');
    const proposals: NflPublishedLockProposal[] = [];
    for (const game of args.previous.fixture.snapshot.games) {
        if (game.lockedAt || game.lockState === 'locked')
            continue;
        const id = String(game.external_id);
        if (!args.failedFinalGameIds.has(id))
            continue;
        const start = Date.parse(game.gameStartAt ?? ''), cutoff = start - 60 * 60000;
        if (!(now >= cutoff && now < start) || published > cutoff)
            continue;
        const own = args.rows.filter(r => r.providerGameId === id);
        if (own.some(hasNflStoredLockedDecision))
            continue;
        const source = own.filter((r): r is NflForwardStoredEvidence & {
            payload: NflForwardEvidencePayload;
        } => r.payload.schemaRelease === NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE && r.stage === 'unlocked' && !r.payload.captureAttempt && r.payload.decisions.publicationEnabled && Date.parse(r.capturedAt) <= published && Date.parse(r.capturedAt) < cutoff).sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt))[0];
        if (!source)
            continue;
        const frozen = structuredClone(game);
        frozen.lockedAt = args.now;
        frozen.lockState = 'locked';
        const receipt: NflPublishedLockReceipt = { release: NFL_PUBLISHED_DEADLINE_LOCK_RELEASE, mode: 'deadline', providerGameId: id, sourceEvidenceId: source.id, sourcePayloadSha256: source.payloadSha256, sourceCapturedAt: source.capturedAt, sourcePublishedAt: args.previous.publishedAt, cutoffAt: new Date(cutoff).toISOString(), frozenAt: args.now, memberGameSha256: nflPublishedGameSha256(frozen), operationalException: source.payload.decisions.evaluatedBets.length === 0 && source.payload.coverage.healthHolds.length > 0 };
        proposals.push(validateNflPublishedLock({ source, receipt, memberGame: frozen }, true));
    }
    return proposals;
}
export function buildNflPublishedDeadlineTrackingRecords(p: NflPublishedLockProposal, gameId: number): PredictionRecordRow[] { validateNflPublishedLock(p, true); return serializeNflPublishedSourceTracking({ source: p.source, gameId }).map(r => ({ ...r, locked_at: p.receipt.frozenAt, published_at: p.source.capturedAt, source_quality: p.receipt.operationalException ? 'nfl_public_operational_forecast_r1' : r.source_quality, prediction_source: p.receipt.mode === 'deadline' ? 'nfl_published_deadline_lock' : 'nfl_owner_published_forecast_recovery', snapshot_json: { ...r.snapshot_json, nfl_published_deadline_lock: p.receipt, ...(r.market === 'moneyline' ? { nfl_member_game_at_lock: p.memberGame } : {}), ...(p.receipt.operationalException ? { nfl_published_forecast_operational_exception: true } : {}) } })); }
/** Small immutable public-lock projection; a failed read cannot erase a lock. */
export async function readNflPublishedDeadlineLocks(args: {
    client: SupabaseClient;
    rows: NflForwardStoredEvidence[];
}): Promise<NflPublishedLockProposal[]> {
    const ids = [...new Set(args.rows.map(r => Number(r.providerGameId)))];
    if (!ids.length)
        return [];
    const { data, error } = await args.client.from('prediction_records').select('external_id,locked_at,sourceHash:snapshot_json->>evidence_payload_sha256,receipt:snapshot_json->nfl_published_deadline_lock,game:snapshot_json->nfl_member_game_at_lock').eq('sport', 'nfl').eq('market', 'moneyline').eq('snapshot_json->nfl_published_deadline_lock->>release', NFL_PUBLISHED_DEADLINE_LOCK_RELEASE).in('external_id', ids).limit(33);
    if (error)
        throw Error('NFL published lock read failed: ' + error.message);
    need(Array.isArray(data) && data.length <= 32, 'invalid published lock inventory');
    const result: NflPublishedLockProposal[] = [];
    for (const row of data ?? []) {
        const receipt = row.receipt as NflPublishedLockReceipt, game = row.game as DailyEdgeGameDto, source = args.rows.find(r => r.id === receipt?.sourceEvidenceId);
        need(source && source.payload.schemaRelease === NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE && source.payloadSha256 === row.sourceHash && row.locked_at && Date.parse(row.locked_at) === Date.parse(receipt.frozenAt), 'stored lock source unavailable or differs');
        result.push(validateNflPublishedLock({ source: source as NflPublishedLockProposal['source'], receipt, memberGame: game, failed: receipt.mode === 'owner_recovery' ? args.rows.find(r => r.id === receipt.failedEvidenceId) : undefined }));
    }
    need(new Set(result.map(p => p.receipt.providerGameId)).size === result.length, 'duplicate published game lock');
    return result;
}
export function withNflPublishedDeadlineLocks(previous: NflForwardMemberSnapshot | null, locks: NflPublishedLockProposal[]): NflForwardMemberSnapshot | null {
    if (!previous || !locks.length)
        return previous;
    const copy = structuredClone(previous), byId = new Map(locks.map(p => [p.receipt.providerGameId, p]));
    copy.fixture.snapshot.games = copy.fixture.snapshot.games.map(g => { const p = byId.get(String(g.external_id)); if (!p || g.lockedAt || g.lockState === 'locked')
        return g; need(Date.parse(g.gameStartAt ?? '') === Date.parse(p.memberGame.gameStartAt ?? ''), 'public lock fixture changed'); return structuredClone(p.memberGame); });
    return copy;
}
/** Historical copies require a concrete owner receipt; never called by cron. */
export function planNflOwnerPublishedRecovery(args: {
    rows: NflForwardStoredEvidence[];
    previous: NflForwardMemberSnapshot;
    sourceId: string;
    failedId: string;
    ownerApproval: string;
    now: string;
}): NflPublishedLockProposal {
    const source = args.rows.find(r => r.id === args.sourceId), failed = args.rows.find(r => r.id === args.failedId);
    need(source && source.payload.schemaRelease === NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE && failed, 'reviewed source/failed capture absent');
    const s = source as NflPublishedLockProposal['source'];
    need(!args.rows.filter(r => r.providerGameId === s.providerGameId).some(hasNflStoredLockedDecision), 'existing T60 record wins');
    const game = args.previous.fixture.snapshot.games.find(g => String(g.external_id) === s.providerGameId);
    need(game && !game.lockedAt && game.lockState !== 'locked', 'existing public lock wins');
    const memberGame = structuredClone(game!);
    memberGame.lockedAt = args.now;
    memberGame.lockState = 'locked';
    const receipt: NflPublishedLockReceipt = { release: NFL_PUBLISHED_DEADLINE_LOCK_RELEASE, mode: 'owner_recovery', providerGameId: s.providerGameId, sourceEvidenceId: s.id, sourcePayloadSha256: s.payloadSha256, sourceCapturedAt: s.capturedAt, sourcePublishedAt: args.previous.publishedAt, cutoffAt: new Date(Date.parse(s.gameStartAt) - 60 * 60000).toISOString(), frozenAt: args.now, memberGameSha256: nflPublishedGameSha256(memberGame), operationalException: s.payload.decisions.evaluatedBets.length === 0 && s.payload.coverage.healthHolds.length > 0, ownerApproval: args.ownerApproval, failedEvidenceId: failed!.id, failedPayloadSha256: failed!.payloadSha256 };
    return validateNflPublishedLock({ source: s, failed, receipt, memberGame }, true);
}
