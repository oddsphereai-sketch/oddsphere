import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import type { SupabaseClient } from "@supabase/supabase-js";
import { refreshCompactMemberSnapshot } from "../lib/services/football/nflForwardEvidenceWriter";
import { buildNflForwardMemberSnapshot, readNflForwardMemberSnapshot, writeNflForwardMemberSnapshot,
  NFL_FORWARD_MEMBER_SNAPSHOT_RELEASE, type NflForwardMemberSnapshot } from "../lib/services/football/nflForwardMemberSnapshotStore";
import type { NflForwardStoredEvidence, NflForwardEvidencePayload } from "../lib/services/football/nflForwardEvidence";
import { buildNflWeekOneHeldMemberFixture } from "../lib/services/football/nflWeekOneHeldMemberFixture";

const load = <T>(name: string): T => JSON.parse(gunzipSync(readFileSync(`scripts/fixtures/${name}.json.gz`)).toString());
const predecessor = load<NflForwardMemberSnapshot>("nfl-publication-clock-r72-member-20261106");
const older = load<NflForwardMemberSnapshot>("nfl-availability-predecessor-member-20261106");
const originalBytes = JSON.stringify(predecessor);
const storedKey = (snapshot: typeof predecessor) => ["nfl", "daily-edge", snapshot.season, snapshot.week,
  snapshot.snapshotRelease, snapshot.fixtureRelease, snapshot.memberRelease, snapshot.decisionRelease].join("::");
assert(Date.parse(predecessor.publishedAt) < Date.parse(predecessor.sourceCapturedAt), "actual R72 fixture reproduces the run-start publication clock");
type FrozenRow = { id: string; payload_sha256: string; payload: NflForwardEvidencePayload };
const evidence = [...load<FrozenRow[]>("nfl-publication-clock-current-evidence-20261106"), load<FrozenRow[]>("nfl-qb-regime-jax-bal-20261105")[0]!].map((row): NflForwardStoredEvidence => ({
  id: row.id, providerGameId: row.payload.game.providerGameId, stage: row.payload.stage, capturedAt: row.payload.capturedAt,
  gameStartAt: row.payload.game.scheduledStart, payloadSha256: row.payload_sha256, payload: row.payload,
}));
const evidenceBytes = JSON.stringify(evidence);
const completedAt = new Date(Date.parse(predecessor.sourceCapturedAt) + 120_000).toISOString();
function harness() {
  type Write = { snapshot_key: string; payload: NflForwardMemberSnapshot; generated_at: string; updated_at: string };
  const requested: string[] = [], writes: Write[] = [];
  const client = { from(table: string) {
    assert.equal(table, "lab_response_snapshots", "publication regression harness permits no provider or other DB access");
    return {
      select() { return { eq(_column: string, key: string) { requested.push(key); return { async maybeSingle() {
        const saved = writes.find(row => row.snapshot_key === key);
        const payload = saved?.payload ?? (key === storedKey(predecessor) ? predecessor : key === storedKey(older) ? older : null);
        return { data: payload ? { payload } : null, error: null };
      } }; } }; },
      async upsert(value: Write) { writes.push(value); return { error: null }; },
    };
  } } as unknown as SupabaseClient;
  return { client, writes, requested };
}
async function main() {
  assert.throws(() => buildNflForwardMemberSnapshot({ fixture: predecessor.fixture, season: 2026, week: 9, publishedAt: predecessor.publishedAt }), /publication/);
  assert.throws(() => buildNflForwardMemberSnapshot({ fixture: predecessor.fixture, season: 2026, week: 9, publishedAt: "invalid" }), /publication/);
  const newSnapshot = buildNflForwardMemberSnapshot({ fixture: predecessor.fixture, season: 2026, week: 9, publishedAt: completedAt });
  assert.equal(newSnapshot.snapshotRelease, NFL_FORWARD_MEMBER_SNAPSHOT_RELEASE);
  assert.deepEqual(newSnapshot.fixture, predecessor.fixture, "new outer metadata must not touch any stored card, projection, grade or evidence");
  const legacyRead = harness();
  assert.deepEqual(await readNflForwardMemberSnapshot({ client: legacyRead.client, season: 2026, week: 9, now: completedAt }), predecessor,
    "R72 predecessor keeps its exact original payload and takes precedence over R71");
  assert.equal(legacyRead.requested.length, 2);
  assert.equal(legacyRead.requested[1], storedKey(predecessor), "fallback must address the full frozen R72 key, not just its release fragment");
  await assert.rejects(() => writeNflForwardMemberSnapshot({ client: legacyRead.client, snapshot: predecessor }), /legacy snapshots are read-only/);
  await assert.rejects(() => writeNflForwardMemberSnapshot({ client: legacyRead.client, snapshot: { ...newSnapshot, publishedAt: predecessor.publishedAt } }), /publication/);
  assert.equal(legacyRead.writes.length, 0, "invalid or historical publications never reach the DB write");
  const invalidCurrent = harness();
  invalidCurrent.writes.push({ snapshot_key: storedKey(newSnapshot), generated_at: predecessor.publishedAt,
    updated_at: predecessor.publishedAt, payload: { ...newSnapshot, publishedAt: predecessor.publishedAt } });
  assert.deepEqual(await readNflForwardMemberSnapshot({ client: invalidCurrent.client, season: 2026, week: 9, now: completedAt }), predecessor,
    "a malformed new publication cannot hide the valid exact predecessor");
  const current = harness();
  const expectedFixture = buildNflWeekOneHeldMemberFixture(evidence, { previousFixture: predecessor.fixture });
  const result = await refreshCompactMemberSnapshot({ client: current.client, existing: evidence, payloads: [],
    season: 2026, week: 9, now: predecessor.publishedAt, apply: true, publicationClock: () => completedAt });
  assert.equal(result.memberSnapshotUpdated, true, result.memberSnapshotError ?? "publication failed");
  assert.equal(current.writes.length, 1);
  const stored = current.writes[0]!;
  assert.equal(stored.generated_at, completedAt); assert.equal(stored.updated_at, completedAt);
  assert.equal(stored.payload.publishedAt, completedAt);
  assert.equal(stored.payload.sourceCapturedAt, predecessor.sourceCapturedAt);
  assert.equal(stored.payload.fixture.snapshot.games.length, 15);
  const locked = predecessor.fixture.snapshot.games.filter(g => g.lockState === "locked");
  assert(locked.length > 0);
  for (const game of expectedFixture.snapshot.games) {
    const actual = stored.payload.fixture.snapshot.games.find(g => g.id === game.id);
    assert.deepEqual(actual, game, `${game.id}: publication clock cannot change any card field, locked or unlocked`);
  }
  for (const game of locked) assert.deepEqual(stored.payload.fixture.snapshot.games.find(g => g.id === game.id), game,
    "the original legacy lock is byte-for-byte authority, not a rebuilt current card");
  assert.deepEqual(await readNflForwardMemberSnapshot({ client: current.client, season: 2026, week: 9, now: completedAt }), stored.payload);
  const bad = harness();
  const rejected = await refreshCompactMemberSnapshot({ client: bad.client, existing: evidence, payloads: [], season: 2026, week: 9,
    now: predecessor.publishedAt, apply: true, publicationClock: () => predecessor.publishedAt });
  assert.equal(rejected.memberSnapshotUpdated, false); assert.match(rejected.memberSnapshotError!, /publication/);
  assert.equal(bad.writes.length, 0, "clock failure retains the prior stored board");
  const malformed = harness();
  const malformedResult = await refreshCompactMemberSnapshot({ client: malformed.client, existing: evidence, payloads: [], season: 2026, week: 9,
    now: predecessor.publishedAt, apply: true, publicationClock: () => "invalid" });
  assert.equal(malformedResult.memberSnapshotUpdated, false); assert.equal(malformed.writes.length, 0);
  assert.equal(JSON.stringify(predecessor), originalBytes); assert.equal(JSON.stringify(evidence), evidenceBytes);
  const grades: Record<string, number> = {};
  for (const row of evidence.filter(row => row.stage === "unlocked")) for (const d of row.payload.decisions.evaluatedBets) grades[d.grade] = (grades[d.grade] ?? 0) + 1;
  assert.deepEqual(grades, { "Best Angle": 3, "No Play": 17, "Watchlist": 7, "Lean": 15 });
  console.log(JSON.stringify({ games: 14, marketDecisions: 42, actionables: 18, promoted: 0, demoted: 0, grades,
    lockedCardsUnchanged: locked.length, allCardFieldsExact: true, predecessorExact: true,
    oldPublicationAt: predecessor.publishedAt, sourceCapturedAt: predecessor.sourceCapturedAt,
    newPublicationAt: completedAt, databaseWrites: "fake harness only", productionWrites: 0, providerRequests: 0 }));
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
