import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NBA_PLAYER_STAT_EVIDENCE_RELEASE, packNbaPlayerStatEvidence, decodeNbaPlayerStatEvidence,
  nbaPlayerStatEvidenceKey, nbaPlayerStatEvidenceAtCutoff, retainNbaPlayerStatEvidence, selectNbaPlayerStatEvidenceAtCutoff, type NbaPlayerStatEvidence } from "../lib/services/nba/nbaPlayerStatEvidence";
import { NBA_PLAYER_PROPS_CURRENT_STATE_RELEASE, writeNbaPlayerPropsCurrentState, collectNbaPlayerPropsCurrentState,
  type NbaPlayerPropsCurrentState } from "../lib/services/nba/nbaPlayerPropsCurrentState";
import { decodeNbaPlayerPropsPrivatePayload } from "../lib/services/nba/nbaPlayerPropsPrivateStore";
import { normalizeNbaHistoricalGame, normalizeNbaHistoricalPlayerBox, normalizeNbaHistoricalPlayerAdvanced } from "../lib/services/nba/nbaPointInTimeFeatures";
const at = "2026-11-20T11:30:00.000Z";
const rawGame = { id: 100, season: 2026, datetime: "2026-11-20T01:00:00Z", status: "Final", status_state: "final",
  home_team: { id: 1, abbreviation: "ATL" }, visitor_team: { id: 2, abbreviation: "BOS" }, home_team_score: 110, visitor_team_score: 100 };
const rawBox = (id: number, team: number) => ({ id, game: { id: 100 }, team: { id: team }, player: { id: id + 10, first_name: "Fixture", last_name: String(id) },
  min: "240", fgm: 40, fga: 90, fg3m: 10, fg3a: 30, ftm: team === 1 ? 20 : 10, fta: 20, oreb: 10, dreb: 30,
  ast: 20, stl: 5, blk: 5, turnover: 10, pf: 20, pts: team === 1 ? 110 : 100, plus_minus: team === 1 ? 10 : -10 });
const rawAdv = (id: number, team: number) => ({ id, game_id: 100, team_id: team, player_id: id + 10, period: 0, possessions: 100, estimated_net_rating: team === 1 ? 10 : -10, pie: .1 });
const state: NbaPlayerPropsCurrentState = { release: NBA_PLAYER_PROPS_CURRENT_STATE_RELEASE, publicEnabled: false, season: 2026,
  createdAt: at, updatedAt: at, games: [normalizeNbaHistoricalGame(rawGame)], boxes: [normalizeNbaHistoricalPlayerBox(rawBox(1, 1)), normalizeNbaHistoricalPlayerBox(rawBox(2, 2))],
  advanced: [normalizeNbaHistoricalPlayerAdvanced(rawAdv(1, 1)), normalizeNbaHistoricalPlayerAdvanced(rawAdv(2, 2))], players: [] };
const retainedAt = "2026-11-20T12:00:00.000Z";
const packed = packNbaPlayerStatEvidence({ state, gameId: 100, retainedAt });
const originalState = JSON.stringify(state);
const decoded = decodeNbaPlayerStatEvidence(packed);
assert.deepEqual(decoded.body.boxes, state.boxes);
assert.deepEqual(decoded.body.advanced, state.advanced);
assert.equal(decoded.body.sourceKind, "normalized_collector_state_not_raw_http");
assert.equal(nbaPlayerStatEvidenceAtCutoff(packed, "2026-11-20T11:59:59Z", 200), null, "new retention cannot backdate the old cache");
assert.deepEqual(nbaPlayerStatEvidenceAtCutoff(packed, retainedAt, 200), decoded.body);
const incomplete = packNbaPlayerStatEvidence({ state: { ...state, advanced: state.advanced.slice(1) }, gameId: 100, retainedAt });
assert.equal(decodeNbaPlayerStatEvidence(incomplete).body.coverage.completeForRotationResearch, false);
assert.equal(nbaPlayerStatEvidenceAtCutoff(incomplete, retainedAt, 200), null, "missing impact rows remain unknown, never healthy/zero");
const ambiguous = packNbaPlayerStatEvidence({ state: { ...state, boxes: state.boxes.map(b => ({ ...b, playerId: 11 })),
  advanced: state.advanced.map(b => ({ ...b, playerId: 11 })) }, gameId: 100, retainedAt });
assert.equal(nbaPlayerStatEvidenceAtCutoff(ambiguous, retainedAt, 200), null, "a player cannot belong to both teams in one game");
assert.equal(nbaPlayerStatEvidenceAtCutoff(packed, retainedAt, 100), null, "target-game results are never forecast inputs");
assert.throws(() => decodeNbaPlayerStatEvidence({ ...packed, bodySha256: "a".repeat(64) }));
assert.throws(() => decodeNbaPlayerStatEvidence({ ...packed, rawBytes: 2_000_001 }));
assert.throws(() => decodeNbaPlayerStatEvidence({ ...packed, data: packed.data + "=" }));
assert.throws(() => packNbaPlayerStatEvidence({ state: { ...state, updatedAt: "2026-11-21T00:00:00Z" }, gameId: 100, retainedAt }));
assert.throws(() => packNbaPlayerStatEvidence({ state: { ...state, boxes: [...state.boxes, state.boxes[0]!] }, gameId: 100, retainedAt }));
assert.throws(() => packNbaPlayerStatEvidence({ state: { ...state, boxes: [{ ...state.boxes[0]!, teamId: 30 }] }, gameId: 100, retainedAt }));

class Store {
  rows = new Map<string, Record<string, unknown>>(); calls: Array<{ table: string; op: string }> = [];
  insertMode: "ok" | "lost_ack" | "failure" | "collision" = "ok"; readFails = false; wrongLease = false; expired = false; stateFails = false;
  client = { from: (table: string) => {
    let op = "read", keys: string[] = [], payload: unknown;
    const run = () => {
      this.calls.push({ table, op });
      if (table === "cron_job_leases") return { data: this.wrongLease ? null : { run_id: "lease-1", acquired_at: at,
        lease_expires_at: this.expired ? at : "2099-01-01T00:00:00Z" }, error: null };
      if (op === "read") return this.readFails ? { data: null, error: { message: "read down" } } : { data: keys.flatMap(k => this.rows.has(k) ? [structuredClone(this.rows.get(k)!)] : []), error: null };
      if (op === "upsert") {
        if (this.stateFails) return { error: { message: "state unavailable" } };
        const row = payload as Record<string, unknown>; this.rows.set(row.snapshot_key as string, structuredClone(row)); return { error: null };
      }
      const rows = payload as Record<string, unknown>[];
      if (this.insertMode === "failure") return { error: { message: "insert unavailable" } };
      if (rows.some(r => this.rows.has(r.snapshot_key as string))) return { error: { code: "23505" } };
      for (const r of rows) this.rows.set(r.snapshot_key as string, structuredClone(r));
      if (this.insertMode === "collision") {
        const first = this.rows.get(rows[0]!.snapshot_key as string)!;
        (first.payload as NbaPlayerStatEvidence).bodySha256 = "f".repeat(64);
      }
      return { error: this.insertMode === "ok" ? null : { message: "unknown ACK" } };
    };
    const q = { select: () => q, in: (_field: string, values: string[]) => { keys = values; return q; }, eq: () => q, gt: () => q,
      abortSignal: () => q, maybeSingle: async () => run(), insert: (value: unknown) => { op = "insert"; payload = value; return q; },
      upsert: (value: unknown) => { op = "upsert"; payload = value; return q; },
      then: (yes: (v: unknown) => unknown, no?: (e: unknown) => unknown) => Promise.resolve().then(run).then(yes, no) };
    return q;
  } } as unknown as SupabaseClient;
}
async function main() {
  const db = new Store();
  const save = (s = state, clock = retainedAt) => retainNbaPlayerStatEvidence({ client: db.client, writerRunId: "lease-1", state: s, gameIds: [100], now: () => clock });
  const first = await save(); assert.equal(first.status, "retained"); assert.equal(first.inserted, 1);
  const key = nbaPlayerStatEvidenceKey(100, packed.bodySha256), original = JSON.stringify(db.rows.get(key));
  const later = { ...state, updatedAt: "2026-11-21T11:30:00Z" };
  const repeat = await save(later, "2026-11-21T12:00:00Z");
  assert.equal(repeat.existing, 1); assert.equal(repeat.inserted, 0); assert.equal(JSON.stringify(db.rows.get(key)), original, "repeat preserves first bytes and clock");
  const corrected = { ...later, updatedAt: "2026-11-22T11:30:00Z", boxes: state.boxes.map((b, i) => i ? b : { ...b, ast: b.ast + 1 }) };
  assert.equal((await save(corrected, "2026-11-22T12:00:00Z")).inserted, 1);
  assert.equal(db.rows.size, 5); assert.equal(JSON.stringify(db.rows.get(key)), original, "source corrections append and leave original exact");
  const beforeRevert = [...db.rows.values()].map(row => structuredClone(row));
  const sameCollection = await save(corrected, "2026-11-22T12:30:00Z");
  assert.equal(sameCollection.observationsExisting, 1); assert.equal(sameCollection.observationsInserted, 0);
  assert.deepEqual([...db.rows.values()], beforeRevert, "the same collection retry preserves its original reference clock");
  const reversion = await save({ ...state, updatedAt: "2026-11-23T11:30:00Z" }, "2026-11-23T12:00:00Z");
  assert.equal(reversion.inserted, 0); assert.equal(reversion.observationsInserted, 1);
  const observations = [...db.rows].filter(([key]) => key.startsWith("nba::stat-seen::")).map(([, row]) => row.payload);
  const bodies = new Map([...db.rows].filter(([key]) => key.startsWith("nba::player-stat-evidence::")).map(([key, row]) => [key, row.payload]));
  const select = (cutoff: string, observed = observations) => selectNbaPlayerStatEvidenceAtCutoff({ gameId: 100, targetGameId: 200, cutoff, observations: observed, bodies });
  assert.equal(select("2026-11-22T12:01:00Z")!.boxes[0]!.ast, state.boxes[0]!.ast + 1);
  assert.equal(select("2026-11-23T12:01:00Z")!.boxes[0]!.ast, state.boxes[0]!.ast, "reversion selects the old body through the NEW observation");
  const futureChanged = observations.map(o => { const v = o as { firstRetainedAt: string }; return Date.parse(v.firstRetainedAt) > Date.parse("2026-11-22T12:01:00Z") ? { ...v, bodySha256: "mutated-future" } : o; });
  assert.deepEqual(select("2026-11-22T12:01:00Z", futureChanged), select("2026-11-22T12:01:00Z"), "future observations cannot change an older cutoff");
  assert.equal(select("2026-11-19T12:00:00Z"), null);
  assert.equal(selectNbaPlayerStatEvidenceAtCutoff({ gameId: 100, targetGameId: 100, cutoff: "2026-11-24T00:00:00Z", observations, bodies }), null);
  for (const mode of ["lost_ack", "failure", "collision"] as const) {
    const fault = new Store(); fault.insertMode = mode;
    const result = await retainNbaPlayerStatEvidence({ client: fault.client, writerRunId: "lease-1", state, gameIds: [100], now: () => retainedAt });
    assert.equal(result.status, mode === "lost_ack" ? "retained" : "unavailable");
    if (mode === "lost_ack") { assert.equal(result.inserted, 0); assert.equal(result.reconciled, 2); }
  }
  for (const mode of ["wrongLease", "expired", "readFails"] as const) {
    const fault = new Store(); fault[mode] = true;
    assert.equal((await retainNbaPlayerStatEvidence({ client: fault.client, writerRunId: "lease-1", state, gameIds: [100], now: () => retainedAt })).status, "unavailable");
    assert.equal(fault.calls.filter(c => c.op === "insert").length, 0);
  }
  const noLease = new Store();
  assert.equal((await retainNbaPlayerStatEvidence({ client: noLease.client, state, gameIds: [100] })).status, "unavailable");
  assert.equal(noLease.calls.length, 0);
  const reserved = await retainNbaPlayerStatEvidence({ client: noLease.client, writerRunId: "lease-1", state, gameIds: [100], deadlineMs: Date.now() + 1 });
  assert.equal(reserved.reason, "forecast_source_window_reserved"); assert.equal(noLease.calls.length, 0, "evidence cannot spend the forecast's reserved source window");
  assert.equal((await retainNbaPlayerStatEvidence({ client: noLease.client, writerRunId: "lease-1", state, gameIds: Array(129).fill(100) })).status, "unavailable");
  assert.equal(noLease.calls.length, 0);
  const keep = new Store(); keep.insertMode = "failure";
  const saved = await writeNbaPlayerPropsCurrentState({ client: keep.client, state, writerRunId: "lease-1", collectedGameIds: [100] });
  assert.equal(saved.statEvidence?.status, "unavailable");
  const storedState = decodeNbaPlayerPropsPrivatePayload(keep.rows.get("nba::player-props-private-current-state::2026")!.payload, "current_state");
  assert.deepEqual(storedState, state, "archive failure cannot change or suppress the canonical numerical state");
  const stateFailure = new Store(); stateFailure.stateFails = true;
  await assert.rejects(writeNbaPlayerPropsCurrentState({ client: stateFailure.client, state, writerRunId: "lease-1", collectedGameIds: [100] }), /state unavailable/);
  assert.equal(stateFailure.calls.filter(c => c.op === "insert").length, 0, "a failed canonical write is not relabeled as a completed collection");
  const many: NbaPlayerPropsCurrentState = { ...state, games: [], boxes: [], advanced: [] };
  const games = Array.from({ length: 65 }, (_, i) => ({ ...state.games[0]!, gameId: 100 + i }));
  const manyState = { ...many, games, boxes: games.flatMap((g, i) => state.boxes.map(b => ({ ...b, gameId: g.gameId, rowId: b.rowId + i * 100 }))),
    advanced: games.flatMap((g, i) => state.advanced.map(b => ({ ...b, gameId: g.gameId, rowId: b.rowId + i * 100 }))) };
  const bulk = new Store();
  const bulkReceipt = await retainNbaPlayerStatEvidence({ client: bulk.client, writerRunId: "lease-1", state: manyState, gameIds: games.map(g => g.gameId), now: () => retainedAt });
  assert.equal(bulkReceipt.inserted, 65); assert.equal(bulkReceipt.status, "retained");
  assert.equal(bulk.calls.filter(c => c.table === "lab_response_snapshots" && c.op === "read").length, 3, "body and reference inventory keys stay bounded below URL limits");
  const crossing = new Store(); let clocks = 0;
  assert.equal((await retainNbaPlayerStatEvidence({ client: crossing.client, writerRunId: "lease-1", state, gameIds: [100],
    now: () => clocks++ === 0 ? retainedAt : "2100-01-01T00:00:00Z" })).reason, "nba_writer_lease_unavailable");
  assert.equal(crossing.calls.filter(c => c.op === "insert").length, 0, "actual lease is rechecked after preparation, not at the old source clock");
  const requests: string[] = [];
  const collected = await collectNbaPlayerPropsCurrentState({ previous: null, season: 2026, dates: ["2026-11-19"], apiKey: "fixture", fetchImpl: async input => {
    const url = new URL(String(input)); requests.push(url.pathname);
    const data = url.pathname.endsWith("games") ? url.searchParams.get("season_type") === "ist" ? [] : [rawGame]
      : url.pathname.endsWith("advanced") ? [rawAdv(1, 1), rawAdv(2, 2)] : [rawBox(1, 1), rawBox(2, 2)];
    return new Response(JSON.stringify({ data, meta: { next_cursor: null } }), { headers: { "content-type": "application/json" } });
  } });
  assert.deepEqual(collected.collectedGameIds, [100]); assert.equal(collected.providerRequests, 4); assert.equal(requests.length, 4);
  assert.deepEqual(collected.state.games, state.games); assert.deepEqual(collected.state.boxes, state.boxes); assert.deepEqual(collected.state.advanced, state.advanced);
  assert.equal(JSON.stringify(state), originalState);
  assert.equal(packed.release, NBA_PLAYER_STAT_EVIDENCE_RELEASE);
  console.log("PASS NBA player-stat observations: exact numerical state, new/correction/repeat clocks, cutoff/target refusal, corruption/bounds/lease failures, lost ACK, append-only originals and no extra provider requests.");
}
void main();
