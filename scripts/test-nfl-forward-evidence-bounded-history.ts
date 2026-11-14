import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  determineNflForwardCollectionNeed,
  hashNflForwardEvidencePayload,
  planNflForwardEvidenceCaptures,
  type NflForwardEvidencePayload,
  type NflForwardStoredEvidence,
} from "../lib/services/football/nflForwardEvidence";
import {
  NFL_FORWARD_EVIDENCE_MAX_PAYLOAD_JSON_BYTES,
  readNflForwardEvidence,
} from "../lib/services/football/nflForwardEvidenceStore";
import { buildNflWeekOneHeldMemberFixture } from "../lib/services/football/nflWeekOneHeldMemberFixture";
import { buildNflPlayerPropsInferenceContextFromForwardEvidence } from "../lib/services/football/nflPlayerPropsInferenceContext";
import type { NflPlayerPropsObservationSnapshot } from "../lib/services/football/nflPlayerPropsContract";
import { hasImmutableNflLockedRecord, latestVerifiedInjuriesForGame } from "../lib/services/football/nflForwardEvidenceWriter";
import { nflStoredMarketEpisodeHistory } from "../lib/services/football/nflStoredMarketEpisodeHistory";

globalThis.fetch = (() => { throw new Error("Network is forbidden in the NFL history test."); }) as typeof fetch;

type Row = {
  id: string; provider_game_id: string; stage: string; captured_at: string;
  game_start_at: string; payload_sha256: string; payload: NflForwardEvidencePayload;
};

function row(payload: NflForwardEvidencePayload, id: string): Row {
  return { id, provider_game_id: payload.game.providerGameId, stage: payload.stage,
    captured_at: payload.capturedAt, game_start_at: payload.game.scheduledStart,
    payload_sha256: hashNflForwardEvidencePayload(payload), payload };
}

function client(count: number, at: (index: number) => Row, failAt = -1, week = 10) {
  let requests = 0;
  const db = { from(table: string) {
    assert.equal(table, "nfl_forward_evidence_snapshots");
    const filters: Array<[string, unknown]> = [], order: string[] = [];
    const q = {
      select(fields: string) { assert.equal(fields, "id,provider_game_id,stage,captured_at,game_start_at,payload_sha256,payload"); return q; },
      eq(key: string, value: unknown) { filters.push([key, value]); return q; },
      order(key: string, options: { ascending: boolean }) { assert(options.ascending); order.push(key); return q; },
      async range(from: number, to: number) {
        requests++;
        assert.deepEqual(filters, [["evidence_release", NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE], ["season", 2026], ["week", week]]);
        assert.deepEqual(order, ["captured_at", "id"]);
        assert(to - from < 50);
        return from === failAt ? { data: null, error: { message: "late read refusal" } }
          : { data: Array.from({ length: Math.max(0, Math.min(count, to + 1) - from) }, (_, i) => at(from + i)), error: null };
      },
    };
    return q;
  } } as unknown as SupabaseClient;
  return { db, requests: () => requests };
}

function normalize(value: Row): NflForwardStoredEvidence {
  return { id: value.id, providerGameId: value.provider_game_id, stage: value.payload.stage,
    capturedAt: value.payload.capturedAt, gameStartAt: new Date(value.game_start_at).toISOString(),
    payloadSha256: value.payload_sha256, payload: value.payload };
}

function synthetic(extra: Record<string, unknown>): NflForwardEvidencePayload {
  return { schemaRelease: NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE, season: 2026, week: 10,
    stage: "unlocked", capturedAt: "2026-11-12T12:00:00.000Z",
    game: { providerGameId: "synthetic", scheduledStart: "2026-11-15T18:00:00.000Z" },
    ...extra } as unknown as NflForwardEvidencePayload;
}

async function worker(kind: string) {
  if (kind === "low-heap") {
    const source = row(synthetic({ market: { original: "source" }, decisions: { evaluatedBets: [], original: true }, opaqueLegacy: {
      blob: "0123456789abcdef".repeat(6_000), probability: .6123, price: -108, stake: 1.25,
      grade: "original", zero: 0, nullable: null, empty: [],
    } }), "source");
    const before = JSON.stringify(source.payload);
    const mock = client(6_000, i => ({ ...source, id: String(i).padStart(8, "0") }));
    const history = await readNflForwardEvidence({ client: mock.db, season: 2026, week: 10 });
    assert.equal(history.length, 6_000);
    assert.equal(mock.requests(), 121);
    const stable = history[0]!.payload;
    for (const entry of history) assert.equal(JSON.stringify(entry.payload), before);
    assert.equal(history[0]!.payload, stable, "top-level identity survives cache eviction");
    assert.notEqual(history[0]!.payload, history[1]!.payload);
    assert.notEqual(history[0]!.payload.decisions, history[1]!.payload.decisions,
      "distinct rows cannot share eagerly retained objects");
    assert.notEqual((history[0]!.payload as unknown as { opaqueLegacy: object }).opaqueLegacy,
      (history[1]!.payload as unknown as { opaqueLegacy: object }).opaqueLegacy,
      "distinct rows cannot share hydrated objects even when mock inputs alias");
    assert.equal(JSON.stringify(source.payload), before);
    assert.equal(mock.requests(), 121, "arbitrary hydration/eviction performs no further I/O");
    const other = client(1, () => source);
    const independent = await readNflForwardEvidence({ client: other.db, season: 2026, week: 10 });
    assert.notEqual(independent[0]!.payload, stable, "independent reads share no payload cache");
    console.log(JSON.stringify({ worker: kind, rows: history.length, requests: mock.requests(), heapUsed: process.memoryUsage().heapUsed }));
    return;
  }
  if (kind === "hot-bound") {
    const source = row(synthetic({ decisions: { opaqueLegacy: "h".repeat(1_800_000) } }), "hot");
    const before = JSON.stringify(source.payload);
    const mock = client(100, i => ({ ...source, id: String(i) }));
    await assert.rejects(readNflForwardEvidence({ client: mock.db, season: 2026, week: 10 }), /bounded hot JSON byte limit/);
    assert.equal(JSON.stringify(source.payload), before);
    console.log("hot JSON aggregate bound rejects without changing the source");
    return;
  }
  if (kind === "compressed-bound") {
    // Deterministic high-entropy bytes prevent compression from hiding this
    // aggregate bound. The mock owns one source object; the reader must not.
    const bytes = Buffer.alloc(1_400_000); let seed = 0x9e3779b9;
    for (let i = 0; i < bytes.length; i++) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; bytes[i] = seed & 255; }
    const source = row(synthetic({ opaqueLegacy: { blob: bytes.toString("base64") } }), "compressed");
    const mock = client(250, i => ({ ...source, id: String(i) }));
    await assert.rejects(readNflForwardEvidence({ client: mock.db, season: 2026, week: 10 }), /bounded compressed byte limit/);
    console.log("compressed aggregate byte bound rejects complete oversized input");
    return;
  }
  throw new Error(`Unknown test worker: ${kind}`);
}

async function main() {
  const load = <T>(name: string): T => JSON.parse(gunzipSync(readFileSync(resolve(`scripts/fixtures/${name}.json.gz`))).toString("utf8"));
  const fixture = load<Array<{ payload: NflForwardEvidencePayload; payload_sha256: string }>>("nfl-publication-clock-current-evidence-20261106");
  const storedLock = load<typeof fixture>("nfl-qb-regime-jax-bal-20261105")[0]!;
  fixture.push(storedLock);
  const previous = load<{ fixture: ReturnType<typeof buildNflWeekOneHeldMemberFixture> }>("nfl-publication-clock-r72-member-20261106").fixture;
  const raw = fixture.map((entry, i) => ({ ...row(structuredClone(entry.payload), `fixture-${String(i).padStart(3, "0")}`), payload_sha256: entry.payload_sha256 }));
  const week = raw[0]!.payload.week;
  // Exact original stored lock plus a synthetic later unlocked row without
  // injuries: neither a newer reader nor a newer row may replace authority.
  const locked = storedLock.payload;
  const missingInjuries = structuredClone(raw[1]!.payload);
  missingInjuries.injuries = null;
  missingInjuries.capturedAt = new Date(Date.parse(missingInjuries.capturedAt) + 1_000).toISOString();
  raw.push(row(missingInjuries, "missing-injuries"));
  raw.sort((a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at) || a.id.localeCompare(b.id));
  const before = JSON.stringify(raw);
  const mock = client(raw.length, i => raw[i]!, -1, week);
  const history = await readNflForwardEvidence({ client: mock.db, season: 2026, week });
  const eager = raw.map(normalize);
  assert.equal(JSON.stringify(history), JSON.stringify(eager), "every original field and row remains in exact order");
  assert.equal(JSON.stringify(raw), before, "reader leaves every original payload/hash untouched");
  const games = [...new Map(eager.map(entry => [entry.providerGameId, entry.payload.game])).values()];
  const now = "2026-11-06T16:00:00.000Z";
  const observation = { snapshotRelease: "offline-original", generatedAt: now, season: 2026, week, phase: "regular",
    games: games.map(game => ({ providerGameId: game.providerGameId, scheduledStart: game.scheduledStart,
      awayTeam: game.away.abbreviation, homeTeam: game.home.abbreviation })) } as unknown as NflPlayerPropsObservationSnapshot;
  const outputs = (rows: NflForwardStoredEvidence[]) => ({
    need: determineNflForwardCollectionNeed({ existing: rows, now }),
    plans: planNflForwardEvidenceCaptures({ existing: rows, games, capturedAt: now, unlockedCadenceMinutes: 60 }),
    context: buildNflPlayerPropsInferenceContextFromForwardEvidence({ snapshot: observation, evidence: rows, capturedAt: now }),
    fixture: buildNflWeekOneHeldMemberFixture(rows, { previousFixture: previous }),
    locks: games.map(game => hasImmutableNflLockedRecord(rows, game.providerGameId)),
    injuries: games.map(game => latestVerifiedInjuriesForGame(rows, game.providerGameId)),
    episodes: games.map(game => nflStoredMarketEpisodeHistory({ providerGameId: game.providerGameId, evaluatedAt: now,
      captures: rows.filter(entry => entry.providerGameId === game.providerGameId).map(entry => entry.payload.contextualEvidenceCapture) })),
  });
  assert.equal(JSON.stringify(outputs(history)), JSON.stringify(outputs(eager)),
    "actual full-game planner/lock/injury/episode/member and props-context consumers remain byte-identical");
  assert(hasImmutableNflLockedRecord(history, locked.game.providerGameId));
  assert.equal(JSON.stringify(raw), before, "native consumers do not mutate the source");

  const oversized = row(synthetic({ opaque: "x".repeat(NFL_FORWARD_EVIDENCE_MAX_PAYLOAD_JSON_BYTES) }), "oversized");
  const tooLarge = client(1, () => oversized);
  await assert.rejects(readNflForwardEvidence({ client: tooLarge.db, season: 2026, week: 10 }), /bounded payload JSON byte limit/);
  const lateSource = row(synthetic({ opaqueLegacy: { original: "unchanged" } }), "late");
  const late = client(51, i => ({ ...lateSource, id: String(i) }), 50);
  await assert.rejects(readNflForwardEvidence({ client: late.db, season: 2026, week: 10 }), /late read refusal/);
  for (const kind of ["low-heap", "hot-bound", "compressed-bound"]) {
    const run = spawnSync(process.execPath, ["--max-old-space-size=192", "--import", "tsx", resolve(process.argv[1]!), `--worker=${kind}`],
      { cwd: process.cwd(), encoding: "utf8", timeout: 90_000, maxBuffer: 1_000_000 });
    assert.equal(run.status, 0, `${kind} failed: ${run.error?.message ?? ""}\n${run.stderr}\n${run.stdout}`);
    console.log(run.stdout.trim());
  }
  console.log("NFL bounded history: lossless full chronology, native consumer/lock/source parity, stable independent row views, low-heap >5k read and byte/late-error refusal passed; mocks only, no network or database.");
}

const kind = process.argv.find(value => value.startsWith("--worker="))?.slice("--worker=".length);
void (kind ? worker(kind) : main()).catch(error => { console.error(error); process.exitCode = 1; });
