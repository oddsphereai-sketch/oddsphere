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
  decodeNflPlayerPropsSnapshotPayload,
  encodeNflPlayerPropsSnapshotPayload,
  measureNflPlayerPropsSnapshotPayload,
  NFL_PLAYER_PROPS_SNAPSHOT_ENVELOPE_RELEASE,
  NFL_PLAYER_PROPS_SNAPSHOT_MAX_JSON_BYTES,
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

  storedPayload = { ...encoded, checksum: "bad" };
  await assert.rejects(
    readNflPlayerPropsSnapshot({ client, season: 2026, week: 1 }),
    /corrupt or unsupported/,
    "a corrupt current row is unavailable and cannot be mistaken for an empty prior snapshot",
  );
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    const memberFallback = await readMemberDataWithDeadline({
      label: "nfl-player-props-snapshot-test",
      fallback: null,
      read: () => readNflPlayerPropsSnapshot({ client, season: 2026, week: 1 }),
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
  assert.match(memberPage, /readNflPlayerPropsSnapshot/);
  assert.match(writer, /readNflPlayerPropsSnapshot/);
  assert.match(readiness, /readNflPlayerPropsSnapshotRecord/);
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
  read: () => unknown;
  write?: (payload: unknown) => void;
  onRead?: () => void;
  onWrite?: () => void;
  readError?: string;
}): SupabaseClient {
  return {
    from(table: string) {
      assert.equal(table, "lab_response_snapshots");
      return {
        async upsert(row: Record<string, unknown>, options: { onConflict: string }) {
          args.onWrite?.();
          assert.equal(options.onConflict, "snapshot_key");
          assert.equal(row.payload_version, NFL_PLAYER_PROPS_PRODUCTION_CANDIDATE_RELEASE);
          args.write?.(row.payload);
          return { error: null };
        },
        select(columns: string) {
          assert.equal(columns, "payload,generated_at");
          return {
            eq(column: string, value: string) {
              assert.equal(column, "snapshot_key");
              assert.equal(value, "nfl::player-props::2026::1");
              return {
                async maybeSingle() {
                  args.onRead?.();
                  return args.readError
                    ? { data: null, error: { message: args.readError } }
                    : { data: { payload: args.read(), generated_at: "2026-09-02T12:00:00.000+00:00" }, error: null };
                },
              };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}
