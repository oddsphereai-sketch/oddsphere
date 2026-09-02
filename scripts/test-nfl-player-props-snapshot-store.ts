import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readMemberDataWithDeadline } from "../lib/services/memberDataAvailability";
import {
  buildNflPlayerPropsMemberSnapshot,
  NFL_PLAYER_PROPS_PRODUCTION_CANDIDATE_RELEASE,
  NFL_PLAYER_PROPS_WRITER_LEASE_GROUP,
  type NflPlayerPropsProductionSnapshot,
} from "../lib/services/football/nflPlayerPropsProductionContract";
import {
  createNflPlayerPropsMemberSnapshotReader,
  decodeNflPlayerPropsSnapshotPayload,
  encodeNflPlayerPropsSnapshotPayload,
  measureNflPlayerPropsSnapshotPayload,
  NFL_PLAYER_PROPS_MEMBER_CACHE_TTL_MS,
  NFL_PLAYER_PROPS_MEMBER_READ_TIMEOUT_MS,
  NFL_PLAYER_PROPS_SNAPSHOT_ENVELOPE_RELEASE,
  NFL_PLAYER_PROPS_SNAPSHOT_MAX_JSON_BYTES,
  readNflPlayerPropsMemberSnapshot,
  readNflPlayerPropsSnapshot,
  readNflPlayerPropsSnapshotRecord,
  writeNflPlayerPropsSnapshot,
  type NflPlayerPropsSnapshotEnvelope,
} from "../lib/services/football/nflPlayerPropsSnapshotStore";
import {
  NFL_PLAYER_PROPS_BOARD_RELEASE,
  type NflPlayerPropsRuntimeDecision,
} from "../lib/services/football/nflPlayerPropsRuntime";

const evaluatedAt = "2026-09-02T12:00:00.000Z";
const actionable = decision({ state: "locked", grade: "Best Angle" });
const held = decision({
  gameId: "game-held",
  providerPlayerId: "2",
  playerName: "Held Player",
  grade: "Held",
  state: "locked",
  healthHolds: ["historical_identity_ambiguous"],
});
const snapshot = productionSnapshot([actionable, held]);
const memberBefore = buildNflPlayerPropsMemberSnapshot(snapshot);

assert.equal(NFL_PLAYER_PROPS_SNAPSHOT_ENVELOPE_RELEASE,
  "nfl_player_props_snapshot_envelope_2026_09_02_r1_gzip_deduplicated_member");

const encoded = encodeNflPlayerPropsSnapshotPayload(snapshot);
assert.equal(encoded.memberDecisionsStorage, "derived_from_board_non_held");
assert.equal(encoded.snapshotRelease, snapshot.release);
assert.deepEqual(encoded, encodeNflPlayerPropsSnapshotPayload(snapshot), "gzip envelope must be deterministic");
const storedJson = gunzipSync(Buffer.from(encoded.payload, "base64")).toString("utf8");
assert.equal(Object.hasOwn(JSON.parse(storedJson), "memberDecisions"), false,
  "normal future snapshots omit the member list duplicated by board decisions");
const decoded = decodeNflPlayerPropsSnapshotPayload(encoded);
assert.ok(decoded);
assert.deepEqual(decoded, snapshot,
  "materialization restores identical canonical values");
assert.equal(JSON.stringify(buildNflPlayerPropsMemberSnapshot(decoded)), JSON.stringify(memberBefore),
  "member DTO bytes and numeric values remain identical after storage round-trip");
assert.deepEqual(decoded.board.counts, snapshot.board.counts);
assert.deepEqual(decoded.lifecycle, snapshot.lifecycle);
assert.deepEqual(decoded.board.decisions.find((row) => row.state === "locked"), actionable,
  "locked projection, probability, pick, grade, price, and evidence remain exact");

const legacyWithDifferentMemberList = { ...snapshot, memberDecisions: [] };
assert.equal(decodeNflPlayerPropsSnapshotPayload(legacyWithDifferentMemberList), legacyWithDifferentMemberList,
  "legacy snapshots retain their stored member list and take precedence over new derivation semantics");
const embedded = encodeNflPlayerPropsSnapshotPayload(legacyWithDifferentMemberList);
assert.equal(embedded.memberDecisionsStorage, "embedded",
  "a non-derivable future member list is retained instead of silently reinterpreted");
assert.deepEqual(decodeNflPlayerPropsSnapshotPayload(embedded), legacyWithDifferentMemberList);

assert.equal(decodeNflPlayerPropsSnapshotPayload({ ...encoded, checksum: "0".repeat(64) }), null,
  "checksum corruption fails closed");
assert.equal(decodeNflPlayerPropsSnapshotPayload({ ...encoded, compressedBytes: encoded.compressedBytes + 1 }), null,
  "compressed-length corruption fails closed");
assert.equal(decodeNflPlayerPropsSnapshotPayload({ ...encoded, uncompressedBytes: encoded.uncompressedBytes + 1 }), null,
  "decoded-length corruption fails closed");
assert.equal(decodeNflPlayerPropsSnapshotPayload({ ...encoded, payload: "not-base64" }), null,
  "invalid compressed payload fails closed");
assert.equal(decodeNflPlayerPropsSnapshotPayload({ ...encoded, payload: "A".repeat(1_333_340) }), null,
  "oversized base64 is rejected before compressed-buffer allocation");

const oversizedJson = "x".repeat(NFL_PLAYER_PROPS_SNAPSHOT_MAX_JSON_BYTES + 1);
const oversizedCompressed = gzipSync(Buffer.from(oversizedJson), { level: 9 });
const decompressionBomb: NflPlayerPropsSnapshotEnvelope = {
  ...encoded,
  checksum: createHash("sha256").update(oversizedJson).digest("hex"),
  uncompressedBytes: 1,
  compressedBytes: oversizedCompressed.byteLength,
  payload: oversizedCompressed.toString("base64"),
};
assert.equal(decodeNflPlayerPropsSnapshotPayload(decompressionBomb), null,
  "gunzip output is capped independently of attacker-controlled declared size");

const largeSnapshot = productionSnapshot(Array.from({ length: 120 }, (_, index) => decision({
  gameId: `game-${index}`,
  providerPlayerId: String(index),
  playerName: `Player ${index}`,
  line: 0.5 + index,
})));
const measured = measureNflPlayerPropsSnapshotPayload(largeSnapshot);
assert.ok(measured.omittedMemberDecisionBytes > 0);
assert.ok(measured.envelopeJsonBytes < Buffer.byteLength(JSON.stringify(largeSnapshot)),
  "deduplication plus gzip reduces the serialized row for a representative board");
assert.ok(measured.jsonBytes <= NFL_PLAYER_PROPS_SNAPSHOT_MAX_JSON_BYTES);

async function main(): Promise<void> {
  let storedPayload: unknown = null;
  let reads = 0;
  let writes = 0;
  const client = clientFixture({
    read: () => storedPayload,
    write: (payload) => { storedPayload = payload; },
    onRead: () => { reads += 1; },
    onWrite: () => { writes += 1; },
  });

  await writeNflPlayerPropsSnapshot({ client, snapshot, source: "test-writer" });
  assert.equal(writes, 1, "the storage migration retains one snapshot write");
  assert.equal((storedPayload as NflPlayerPropsSnapshotEnvelope).envelopeRelease, NFL_PLAYER_PROPS_SNAPSHOT_ENVELOPE_RELEASE);
  const read = await readNflPlayerPropsSnapshot({ client, season: 2026, week: 1 });
  assert.equal(reads, 1, "the storage migration retains one snapshot read query");
  assert.deepEqual(read, snapshot);
  const record = await readNflPlayerPropsSnapshotRecord({ client, season: 2026, week: 1 });
  assert.equal(record?.generatedAt, "2026-09-02T12:00:00.000+00:00",
    "the operator-compatible store retains database timestamp formatting");

  assert.equal(NFL_PLAYER_PROPS_MEMBER_CACHE_TTL_MS, 60_000);
  assert.ok(NFL_PLAYER_PROPS_MEMBER_READ_TIMEOUT_MS < 8_000,
    "the underlying abort fires before the page-level member deadline");

  let clock = 0;
  let resolveCold!: (value: unknown) => void;
  let cachedReads = 0;
  let pendingPayload: Promise<unknown> | null = new Promise((resolve) => { resolveCold = resolve; });
  const cachedClient = clientFixture({
    read: () => pendingPayload ?? encoded,
    onRead: () => { cachedReads += 1; },
  });
  const cachedReader = createNflPlayerPropsMemberSnapshotReader({ now: () => clock });
  const cold = cachedReader.read({ client: cachedClient, season: 2026, week: 1 });
  const coalesced = cachedReader.read({ client: cachedClient, season: 2026, week: 1 });
  assert.strictEqual(cold, coalesced, "concurrent member reads share exactly one in-flight promise");
  clock = 30_000;
  resolveCold(encoded);
  const [coldValue, coalescedValue] = await Promise.all([cold, coalesced]);
  assert.equal(cachedReads, 1, "cold and coalesced reads use one query");
  assert.deepEqual(coldValue, memberBefore);
  assert.strictEqual(coldValue, coalescedValue);
  pendingPayload = null;
  clock = 89_999;
  assert.strictEqual(await cachedReader.read({ client: cachedClient, season: 2026, week: 1 }), coldValue);
  assert.equal(cachedReads, 1, "warm reads use no query before the resolution-based TTL expires");
  clock = 90_000;
  assert.deepEqual(await cachedReader.read({ client: cachedClient, season: 2026, week: 1 }), memberBefore);
  assert.equal(cachedReads, 2, "the first read at expiry performs one fresh query");
  let secondWeekReads = 0;
  const secondWeekClient = clientFixture({
    read: () => encoded,
    expectedSnapshotKey: "nfl::player-props::2026::2",
    onRead: () => { secondWeekReads += 1; },
  });
  await cachedReader.read({ client: secondWeekClient, season: 2026, week: 2 });
  await cachedReader.read({ client: secondWeekClient, season: 2026, week: 2 });
  assert.equal(secondWeekReads, 1, "season/week identities have independent cache entries");
  await cachedReader.read({ client: cachedClient, season: 2026, week: 1 });
  assert.equal(cachedReads, 2, "reading another week does not evict or replace the first week");

  let nullReads = 0;
  const nullReader = createNflPlayerPropsMemberSnapshotReader();
  const nullClient = clientFixture({ read: () => null, onRead: () => { nullReads += 1; } });
  assert.equal(await nullReader.read({ client: nullClient, season: 2026, week: 1 }), null);
  assert.equal(await nullReader.read({ client: nullClient, season: 2026, week: 1 }), null);
  assert.equal(nullReads, 2, "null results are never cached");

  let transientError: string | undefined = "temporary read failure";
  let errorReads = 0;
  const errorReader = createNflPlayerPropsMemberSnapshotReader();
  const errorClient = clientFixture({
    read: () => encoded,
    readError: () => transientError,
    onRead: () => { errorReads += 1; },
  });
  await assert.rejects(errorReader.read({ client: errorClient, season: 2026, week: 1 }), /temporary read failure/);
  transientError = undefined;
  assert.deepEqual(await errorReader.read({ client: errorClient, season: 2026, week: 1 }), memberBefore);
  assert.equal(errorReads, 2, "failed in-flight state is evicted for recovery");

  let corruptPayload: unknown = { ...encoded, checksum: "bad" };
  let corruptReads = 0;
  const corruptReader = createNflPlayerPropsMemberSnapshotReader();
  const corruptClient = clientFixture({ read: () => corruptPayload, onRead: () => { corruptReads += 1; } });
  await assert.rejects(corruptReader.read({ client: corruptClient, season: 2026, week: 1 }), /corrupt or unsupported/);
  corruptPayload = encoded;
  assert.deepEqual(await corruptReader.read({ client: corruptClient, season: 2026, week: 1 }), memberBefore);
  assert.equal(corruptReads, 2, "corrupt results are never cached and can recover");

  let abortReads = 0;
  let observedSignal: AbortSignal | undefined;
  let abortMode = true;
  const abortReader = createNflPlayerPropsMemberSnapshotReader({ readTimeoutMs: 5 });
  const abortClient = clientFixture({
    onRead: () => { abortReads += 1; },
    read: (signal) => {
      observedSignal = signal;
      if (!abortMode) return encoded;
      return new Promise((_resolve, reject) => signal?.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true }));
    },
  });
  await assert.rejects(abortReader.read({ client: abortClient, season: 2026, week: 1 }), /timed out/);
  assert.equal(observedSignal?.aborted, true, "the member timeout aborts the underlying Supabase query");
  abortMode = false;
  assert.deepEqual(await abortReader.read({ client: abortClient, season: 2026, week: 1 }), memberBefore);
  assert.equal(abortReads, 2, "timed-out state is evicted and the next request recovers");

  let invalidationReads = 0;
  const invalidationWrite = { error: undefined as string | undefined };
  const invalidationClient = clientFixture({
    read: () => encoded,
    write: () => undefined,
    readError: () => undefined,
    writeError: () => invalidationWrite.error,
    onRead: () => { invalidationReads += 1; },
  });
  await readNflPlayerPropsMemberSnapshot({ client: invalidationClient, season: 2026, week: 1 });
  await readNflPlayerPropsMemberSnapshot({ client: invalidationClient, season: 2026, week: 1 });
  assert.equal(invalidationReads, 1, "the production member reader caches a successful DTO");
  await writeNflPlayerPropsSnapshot({ client: invalidationClient, snapshot, source: "test-writer" });
  await readNflPlayerPropsMemberSnapshot({ client: invalidationClient, season: 2026, week: 1 });
  assert.equal(invalidationReads, 2, "a successful same-process write invalidates the season/week member cache");
  invalidationWrite.error = "write rejected";
  await assert.rejects(writeNflPlayerPropsSnapshot({ client: invalidationClient, snapshot, source: "test-writer" }), /write rejected/);
  await readNflPlayerPropsMemberSnapshot({ client: invalidationClient, season: 2026, week: 1 });
  assert.equal(invalidationReads, 2, "a failed write does not invalidate a successful member cache entry");

  storedPayload = { ...encoded, checksum: "bad" };
  await assert.rejects(
    readNflPlayerPropsSnapshot({ client, season: 2026, week: 1 }),
    /corrupt or unsupported/,
    "a corrupt current row is unavailable and cannot be mistaken for an empty prior snapshot",
  );
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    const fallbackReader = createNflPlayerPropsMemberSnapshotReader();
    const memberFallback = await readMemberDataWithDeadline({
      label: "nfl-player-props-snapshot-test",
      fallback: null,
      read: () => fallbackReader.read({ client, season: 2026, week: 1 }),
    });
    assert.deepEqual(memberFallback, { value: null, unavailable: true, reason: "error" },
      "corruption uses the existing member unavailable fallback without reconstructing data");
  } finally {
    console.error = originalConsoleError;
  }

  const missingTable = clientFixture({
    read: () => null,
    readError: "relation public.lab_response_snapshots does not exist",
  });
  assert.equal(await readNflPlayerPropsSnapshot({ client: missingTable, season: 2026, week: 1 }), null);

  const memberPage = readFileSync("app/player-props/page.tsx", "utf8");
  const writer = readFileSync("lib/services/football/nflPlayerPropsProductionWriter.ts", "utf8");
  const readiness = readFileSync("scripts/operator/audit-current-nfl-player-props-readiness.ts", "utf8");
  assert.match(memberPage, /readNflPlayerPropsMemberSnapshot/);
  assert.match(writer, /readNflPlayerPropsSnapshot/);
  assert.match(readiness, /readNflPlayerPropsSnapshotRecord/);
  assert.doesNotMatch(writer, /readNflPlayerPropsMemberSnapshot/,
    "the writer cannot accidentally consume the member-only cached DTO");
  assert.doesNotMatch(readiness, /readNflPlayerPropsMemberSnapshot/,
    "readiness must keep its uncached timestamp-aware record read");
  for (const readerSource of [memberPage, writer, readiness]) {
    assert.doesNotMatch(readerSource, /\.select\(["']payload/,
      "every current NFL props payload reader must use the dual-schema store");
  }
  assert.match(readiness, /\.from\("nfl_player_prop_records"\)/,
    "the readiness audit retains its independent tracking query");

  console.log(JSON.stringify({
    release: NFL_PLAYER_PROPS_SNAPSHOT_ENVELOPE_RELEASE,
    legacyBytes: Buffer.byteLength(JSON.stringify(largeSnapshot)),
    encodedBytes: measured.envelopeJsonBytes,
    decodedBytes: measured.jsonBytes,
    gzipBytes: measured.gzipBytes,
    omittedMemberDecisionBytes: measured.omittedMemberDecisionBytes,
    memberRows: memberBefore.memberDecisions.length,
    counts: memberBefore.board.counts,
    reads,
    writes,
  }, null, 2));
}

void main();

function decision(overrides: Partial<NflPlayerPropsRuntimeDecision> = {}): NflPlayerPropsRuntimeDecision {
  return {
    gameId: "game", providerPlayerId: "1", playerName: "Player", team: "NE", opponent: "NYJ",
    scheduledStart: "2026-09-03T12:00:00.000Z", market: "receptions", line: 4.5, side: "over",
    sportsbook: "book", provider: "balldontlie", americanPrice: 110, observedAt: evaluatedAt,
    bookEvidence: [{ sportsbook: "book", provider: "balldontlie", americanPrice: 110, observedAt: evaluatedAt,
      openingObservedAt: null, openingLine: null, openingAmericanPrice: null }],
    lockAt: "2026-09-03T11:00:00.000Z", state: "unlocked", roleFingerprint: "role-a", projection: 5.2,
    projectionRange: { lower: 2.1, upper: 8.4, centralCoverage: 0.8, source: "empirical_residual_distribution" },
    forecastContext: {
      featureAsOf: evaluatedAt, position: "WR",
      expectedQuarterback: { name: "Quarterback", starterStatus: "projected", capturedAt: evaluatedAt },
      availability: { listed: false, status: null, detail: null, reportedAt: null, reportUpdatedAt: evaluatedAt, source: "BALLDONTLIE" },
      teamImpliedPoints: 24.5, teamImpliedTouchdowns: 3.5,
      recentProduction: { label: "Recent receptions", value: 5.1, format: "count" },
      roleOpportunity: [{ label: "Recent targets", value: 7.4, format: "count" }],
      opponentAllowance: { label: "Opponent targets allowed", value: 31.2, format: "count" },
    },
    participationProbability: 0.9, rawModelProbability: 0.61, marketProbability: 0.5, finalProbability: 0.53,
    probabilityEdge: 0.03, expectedValue: 0.11, grade: "Best Angle", marketMovement: "neutral", healthHolds: [], provisional: false,
    modelRelease: "model", calibrationRelease: "calibration", decisionRelease: "decision",
    ...overrides,
  };
}

function productionSnapshot(rows: NflPlayerPropsRuntimeDecision[]): NflPlayerPropsProductionSnapshot {
  const memberDecisions = rows.filter((row) => row.grade !== "Held");
  const count = (grade: NflPlayerPropsRuntimeDecision["grade"]) => rows.filter((row) => row.grade === grade).length;
  return {
    release: NFL_PLAYER_PROPS_PRODUCTION_CANDIDATE_RELEASE,
    season: 2026,
    week: 1,
    generatedAt: evaluatedAt,
    writerLeaseGroup: NFL_PLAYER_PROPS_WRITER_LEASE_GROUP,
    publicationEligible: true,
    trackingEligible: true,
    riskLabel: "forward_monitoring_2025_exact_price_confirmation",
    board: {
      release: NFL_PLAYER_PROPS_BOARD_RELEASE,
      generatedAt: evaluatedAt,
      evaluatedAt,
      provisional: false,
      publicationEnabled: true,
      trackingEnabled: true,
      decisions: rows,
      counts: {
        "Best Angle": count("Best Angle"), Lean: count("Lean"), Watchlist: count("Watchlist"),
        "No Play": count("No Play"), Held: count("Held"), actionable: count("Best Angle") + count("Lean"),
      },
      diagnostics: {
        inputOffers: rows.length, completeExactOffers: rows.length, incompleteExactOffers: 0,
        lockedOffers: rows.filter((row) => row.state === "locked").length,
        unavailableNoIndependentBenchmark: 0, unavailableStaleQuotes: 0, unavailableFeatureContext: 0,
        completedEvaluations: memberDecisions.length, operationalExceptions: count("Held"),
        recoveryEligibleOperationalExceptions: 0, roleOrIdentityHeld: count("Held"),
      },
    },
    memberDecisions,
    lifecycle: { recomputedUnlocked: 0, retainedStillFreshUnlocked: 0, frozenAtLock: 0, retainedPreviouslyLocked: 0 },
  };
}

function clientFixture(args: {
  read: (signal?: AbortSignal) => unknown | Promise<unknown>;
  write?: (payload: unknown) => void;
  onRead?: () => void;
  onWrite?: () => void;
  readError?: string | (() => string | undefined);
  writeError?: string | (() => string | undefined);
  expectedSnapshotKey?: string;
}): SupabaseClient {
  return {
    from(table: string) {
      assert.equal(table, "lab_response_snapshots");
      return {
        async upsert(row: Record<string, unknown>, options: { onConflict: string }) {
          args.onWrite?.();
          assert.equal(options.onConflict, "snapshot_key");
          assert.equal(row.payload_version, NFL_PLAYER_PROPS_PRODUCTION_CANDIDATE_RELEASE);
          const writeError = typeof args.writeError === "function" ? args.writeError() : args.writeError;
          if (writeError) return { error: { message: writeError } };
          args.write?.(row.payload);
          return { error: null };
        },
        select(columns: string) {
          assert.equal(columns, "payload,generated_at");
          return {
            eq(column: string, value: string) {
              assert.equal(column, "snapshot_key");
              assert.equal(value, args.expectedSnapshotKey ?? "nfl::player-props::2026::1");
              let signal: AbortSignal | undefined;
              const query = {
                abortSignal(nextSignal: AbortSignal) {
                  signal = nextSignal;
                  return query;
                },
                async maybeSingle() {
                  args.onRead?.();
                  const readError = typeof args.readError === "function" ? args.readError() : args.readError;
                  return readError
                    ? { data: null, error: { message: readError } }
                    : { data: { payload: await args.read(signal), generated_at: "2026-09-02T12:00:00.000+00:00" }, error: null };
                },
              };
              return query;
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}
