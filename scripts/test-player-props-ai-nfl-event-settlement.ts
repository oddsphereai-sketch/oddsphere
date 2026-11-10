import {PROPS_AI_WIRE_RELEASE} from "../lib/playerPropsAi/scenarioCoordinates";
import {verifiedReaderFixture} from "./lib/player-props-ai-reader-fixture";
/** Full current NFL event path, with in-memory tracking and fake final sources. */
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NflPlayerPropsRuntimeDecision as Decision } from '../lib/services/football/nflPlayerPropsRuntime';
import type { AcceptedGameReview } from '../lib/playerPropsAi/reviewer';
import { normalizeBalldontlieNflPlayerProps } from '../lib/services/football/nflPlayerPropsProviders';
import { liveNflPacket } from '../lib/playerPropsAi/liveSources';
import { encodeCanonicalScenarioLaw } from '../lib/playerPropsAi/generativeCoordinates';
import { readerEvidence, READER_AREAS } from '../lib/playerPropsAi/readerCoverage';
import { evidenceAliases } from '../lib/playerPropsAi/input';
import { parseJointReview } from '../lib/playerPropsAi/request';
import { siteAiDecisions } from '../lib/playerPropsAi/publication';
import { applyNflSiteAi } from '../lib/playerPropsAi/siteBindings';
import { criticalContextHashes } from '../lib/playerPropsAi/criticalContext';
import { digest } from '../lib/playerPropsAi/evidence';
import { PROPS_AI_RELEASE } from '../lib/playerPropsAi/releases';
import { writeLockedNflPlayerPropsTracking, NFL_PLAYER_PROPS_TRACKING_RELEASE } from '../lib/services/football/nflPlayerPropsTrackingStore';
import { settleNflPlayerPropsRecords } from '../lib/services/football/nflPlayerPropsSettlement';
import { buildNflPropsLockedEvent, nflPropsSettlementEvent, NFL_PROPS_LOCKED_EVENT_RELEASE } from '../lib/services/football/nflPlayerPropsLockedEvent';
globalThis.fetch = async () => { throw Error('No real HTTP permitted'); };
const at = '2030-11-10T16:00:00Z', start = '2030-11-11T01:15:00Z', lock = '2030-11-11T00:15:00Z';
const v = (n: number) => Array<number>(16).fill(n);
function issued(market: 'rushing_yards' | 'passing_tds' | 'anytime_td', line: number, milestone = true, release: AcceptedGameReview['release'] = PROPS_AI_RELEASE): Decision {
  const game = { id: 'synthetic', start, away: 'KC', home: 'BUF' };
  const source = normalizeBalldontlieNflPlayerProps({ values: [{ id: 10, game_id: game.id, player_id: 7, vendor: 'synthetic-book', prop_type: market, line_value: line, updated_at: at,
    market: milestone ? { type: 'milestone', odds: 150 } : { type: 'over_under', over_odds: 150, under_odds: -170 } }], fetchedAt: at });
  assert.equal(source.rows.length, milestone ? 1 : 2);
  const observations = source.rows.map(q => ({ ...q, canonicalGameId: game.id, providerPlayerId: '7', playerName: 'Synthetic Runner', playerTeam: 'KC', receivedAt: at, homeTeam: 'BUF', awayTeam: 'KC', scheduledStart: start }));
  const packet = liveNflPacket({ game, window: { gameId: game.id, stage: 'early', cutoff: at, lock }, snapshot: { week: 10, generatedAt: at, board: { decisions: [] }, memberDecisions: [] }, observations: { generatedAt: at, observations },
    history: { updatedAt: at, games: [], stats: [], teamStats: [], playMetrics: [] }, context: { capturedAt: at, games: [{ canonicalGameId: game.id, scheduledStart: start, awayTeam: 'KC', homeTeam: 'BUF',
      awayDepth: { team: 'KC', capturedAt: at, roster: [] }, homeDepth: { team: 'BUF', capturedAt: at, roster: [] }, injuries: null, weather: null }] } } as never);
  const p = packet.players[0], facts = readerEvidence(packet)[p.id], aliases = evidenceAliases(packet);
  const samples = market === 'anytime_td' ? [0, 1, 2, ...v(0).slice(3)] : [0, line, line + 10, ...v(0).slice(3)];
  const outcomes = market === 'passing_tds' ? { passing_attempts: v(30), passing_completions: v(20), passing_tds: samples, interceptions: v(0) } : { [market === 'anytime_td' ? 'touchdowns' : market]: samples };
  const parsed = parseJointReview(packet, { wireRelease: PROPS_AI_WIRE_RELEASE, players: { [p.id]: verifiedReaderFixture(packet,p.id,{
    assessment: 'The supplied source supports a conditional production estimate.', priorRead: {},
    coverage: Object.fromEntries(READER_AREAS.map(a => [a, { status: facts[a].status, factIds: facts[a].facts.slice(0, 1).map(f => f.id), effect: 'uncertain', observation: 'The supplied source supports a conditional production estimate.' }])),
    evidenceIds: [[...aliases][0][0]], gaps: [], confidence: [2], exceptions: [null], law: encodeCanonicalScenarioLaw('nfl', p, { weights: [1, 2, 1, ...v(0).slice(3)], outcomes }) }) } });
  const review = { ...parsed, release, gameId: game.id, sourceGameId: game.id, start, lock, cutoff: at, stage: 'early', issuedAt: at, inputHash: digest(packet), criticalContextHashes: criticalContextHashes(packet), marketScopes: { [p.id]: p.markets }, partProvenance: [], model: 'synthetic', inputEvidence: { digest: digest(packet) } } as unknown as AcceptedGameReview;
  const choices = siteAiDecisions(packet, review, at); assert.equal(choices.length, 1);
  const seed = applyNflSiteAi({ decisions: [], counts: {} } as never, packet, choices, at);
  const baseline = { ...seed, decisions: seed.decisions.map(r => ({ ...r, modelRelease: 'synthetic-native-source', aiReview: undefined, market: 'receptions', line: 4.5, side: 'over' })) };
  const published = applyNflSiteAi(baseline as never, packet, choices, at).decisions.find(r => r.market === market && r.side === choices[0].side)!;
  assert.equal(published.grade, 'Best Angle'); assert.equal(published.aiReview!.release, release);
  return { ...published, state: 'locked' };
}
type Stored = Record<string, unknown> & { id: number; result: string; snapshot_json: { lockedEvent?: unknown; decision: Decision; trackingRelease: string } };
function eventRead(record: Stored) { return { ...record, locked_event: record.snapshot_json.lockedEvent }; }
function memory(existing: Stored[] = []) {
  const records = structuredClone(existing), proposals: unknown[] = [];
  const query = { eq() { return query; }, not() { return query; }, lte() { return query; }, order() { return query; }, async limit() { return { data: records.filter(r => r.result === 'pending').map(eventRead), error: null }; } };
  const client = { from(table: string) { assert.equal(table, 'nfl_player_prop_records'); return {
    select(columns: string) { assert(columns.includes('locked_event:snapshot_json->lockedEvent')); assert(!columns.includes(',snapshot_json'), 'settlement must not transfer full decision/AI coverage payloads'); return query; },
    async upsert(rows: Record<string, unknown>[], options: { onConflict: string; ignoreDuplicates: boolean }) {
      assert.deepEqual(options, { onConflict: 'tracking_key,decision_release', ignoreDuplicates: true });
      for (const row of rows) if (!records.some(r => r.tracking_key === row.tracking_key && r.decision_release === row.decision_release)) records.push({ ...structuredClone(row), id: records.length + 1, result: 'pending' } as Stored);
      return { error: null };
    },
    update(values: Record<string, unknown>) { return { eq(_field: string, id: unknown) { return { async eq() { Object.assign(records.find(r => r.id === id)!, values); return { error: null }; } }; } }; },
  }; } } as unknown as SupabaseClient;
  return { records, client, proposals };
}
async function write(row: Decision, db = memory()) {
  const before = JSON.stringify(row);
  await writeLockedNflPlayerPropsTracking({ client: db.client, snapshot: { board: { decisions: [row] } } as never });
  assert.equal(JSON.stringify(row), before, 'tracking cannot mutate the immutable decision');
  return db;
}
async function settle(record: Stored, actual: number, field: string) {
  const db = memory([record]);
  const result = await settleNflPlayerPropsRecords({ client: db.client, apiKey: 'synthetic', now: '2030-11-11T12:00:00Z', onProposal: p => db.proposals.push(p), fetchImpl: async () => Response.json({ data: [{ player: { id: 7 }, team: { abbreviation: 'KC' }, game: { id: 'synthetic', status_state: 'final' }, [field]: actual }], meta: {} }) });
  return { row: db.records[0], result, proposals: db.proposals };
}
async function main() {
  for (const [market, line, field] of [['rushing_yards', 50, 'rushing_yards'], ['passing_tds', 2, 'passing_touchdowns']] as const) {
    const row = issued(market, line), db = await write(row), record = db.records[0];
    assert.equal(record.snapshot_json.trackingRelease, NFL_PLAYER_PROPS_TRACKING_RELEASE);
    assert.equal((record.snapshot_json.lockedEvent as { release: string }).release, NFL_PROPS_LOCKED_EVENT_RELEASE);
    assert.equal(nflPropsSettlementEvent(eventRead(record) as never).status, 'exact');
    for (const [actual, expected] of [[line - 1, 'loss'], [line, 'win'], [line + 1, 'win']] as const) assert.equal((await settle(record, actual, field)).row.result, expected);
    const bytes = JSON.stringify(db.records); await write(row, db); assert.equal(JSON.stringify(db.records), bytes, 'same-key retries preserve every stored field and insert no duplicate');
  }
  const priorLaw = issued('rushing_yards', 50, true, 'player_props_ai_2026_11_10_r29_identity_and_execution_evidence');
  assert.equal(nflPropsSettlementEvent(eventRead((await write(priorLaw)).records[0]) as never).status, 'exact', 'new R13 decision with unchanged accepted R29 law opts in');
  const binary = (await write(issued('anytime_td', .5))).records[0];
  for (const [actual, result] of [[0, 'loss'], [1, 'win'], [2, 'win']] as const) assert.equal((await settle(binary, actual, 'rushing_touchdowns')).row.result, result);
  const ordinary = (await write(issued('rushing_yards', 50, false))).records[0];
  for (const [actual, result] of [[49, 'loss'], [50, 'push'], [51, 'win']] as const) assert.equal((await settle(ordinary, actual, 'rushing_yards')).row.result, result);
  const row = issued('rushing_yards', 50), current = (await write(row)).records[0];
  for (const alter of [(r: Stored) => { r.snapshot_json.lockedEvent = null; }, (r: Stored) => { (r.snapshot_json.lockedEvent as { line: number }).line = 1; }, (r: Stored) => { (r.snapshot_json.lockedEvent as { contract: string }).contract = 'unknown'; }, (r: Stored) => { r.market = 'receptions'; }, (r: Stored) => { r.provider_player_id = '8'; }, (r: Stored) => { (r.snapshot_json.lockedEvent as { sourceQuote: { provider: string } }).sourceQuote.provider = 'wrong'; }]) {
    const invalid = structuredClone(current); alter(invalid); const settled = await settle(invalid, 60, 'rushing_yards'); assert.equal(settled.row.result, 'pending'); assert.equal(settled.proposals.length, 0);
  }
  const missing = structuredClone(row); delete missing.aiReview!.executionEvidence; assert.equal(buildNflPropsLockedEvent(missing), null); assert.equal((await settle((await write(missing)).records[0], 49, 'rushing_yards')).row.result, 'pending');
  const dnp = memory([current]);
  const finalGame = { id: 'synthetic', status_state: 'final', season: 2030, week: 10, postseason: false, home_team: { id: 2, abbreviation: 'BUF' }, visitor_team: { id: 1, abbreviation: 'KC' } };
  await settleNflPlayerPropsRecords({ client: dnp.client, apiKey: 'synthetic', now: '2030-11-11T12:00:00Z', fetchImpl: async request => {
    const url = String(request);
    if (url.includes('/snap_counts')) return Response.json({ data: [], meta: {} });
    if (url.includes('/player_designations')) return Response.json({ data: [{ game_id: 'synthetic', season: 2030, week: 10, season_type: 'regular', player: { id: 7, first_name: 'Synthetic', last_name: 'Runner' }, team: { id: 1, abbreviation: 'KC' }, did_not_play: true, starter: false }], meta: {} });
    return Response.json({ data: [{ player: { id: 8 }, team: { abbreviation: 'KC' }, game: finalGame }], meta: {} });
  } });
  assert.equal(dnp.records[0].result, 'void', 'confirmed exact-game DNP keeps the normal void behavior for new event locks');
  const old = { ...row, decisionRelease: 'player_props_ai_nfl_decision_2026_11_09_r11_prelock_authority' };
  const legacy = (await write(old)).records[0]; assert(!Object.hasOwn(legacy.snapshot_json, 'lockedEvent'));
  assert.equal((await settle(legacy, 49, 'rushing_yards')).row.result, 'win', 'legacy issued semantics remain exact, even when mathematically different');
  const absent = structuredClone(current); delete absent.snapshot_json.lockedEvent; assert.equal((await settle(absent, 49, 'rushing_yards')).row.result, 'pending', 'new R13 requires its stored event; absence cannot become legacy or a reconstructed event');
  const settledLegacy = structuredClone(legacy); settledLegacy.result = 'loss'; settledLegacy.actual_value = 49; const storedBytes = JSON.stringify(settledLegacy);
  const preserved = await settle(settledLegacy, 100, 'rushing_yards'); assert.equal(JSON.stringify(preserved.row), storedBytes); assert.equal(preserved.result.pending, 0);
  console.log('NFL exact event passed: normalizer→live source→generative parser→pricing→binding→actual tracking write→settlement; 50+ yards/2+ passing TDs below/equal/above, binary TD, integer push, R29 law/new R13 event, malformed metadata holds, exact legacy absence/results, immutable same-key retries. Fake I/O only.');
}
void main();
