import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildNflPlayerPropsMarketObserverRows,
  captureNflPlayerPropsMarketObserver,
  captureNflPlayerPropsMarketObserverSafely,
  decodeNflPlayerPropsMarketObserverHistory,
  encodeNflPlayerPropsMarketObserverHistory,
  mergeNflPlayerPropsMarketObserverRows,
  NFL_PLAYER_PROPS_MARKET_OBSERVER_CAPTURE_RELEASE,
  NFL_PLAYER_PROPS_MARKET_OBSERVER_MAX_GZIP_BYTES,
  NFL_PLAYER_PROPS_MARKET_OBSERVER_MAX_JSON_BYTES,
  NFL_PLAYER_PROPS_MARKET_OBSERVER_MAX_ROWS,
  nflPlayerPropsMarketObserverKey,
  type NflPlayerPropsMarketObserverHistory,
} from "../lib/services/football/nflPlayerPropsMarketObserverStore";
import type { NflPlayerPropsMarketEvidenceCapture } from "../lib/services/football/nflPlayerPropsMarketEvidenceCapture";
import type { NflPlayerPropsProductionSnapshot } from "../lib/services/football/nflPlayerPropsProductionContract";

const start = "2026-10-12T00:00:00.000Z";
const lock = "2026-10-11T23:00:00.000Z";

function evidence(args: {
  observedAt: string;
  fetchedAt?: string;
  openingObservedAt?: string | null;
  openingLine?: number | null;
  openingOver?: number | null;
  openingUnder?: number | null;
}): NflPlayerPropsMarketEvidenceCapture {
  return {
    r: "nfl_player_props_market_evidence_capture_2026_09_02_r1",
    s: "nflpme1",
    mb: 8,
    hb: 512 * 1024,
    rt: "category_hash_round_robin_v1",
    sp: "n",
    n: 1,
    k: 1,
    o: 0,
    c: [["rc", 1, 1, 0]],
    i: [[
      "evidence-id",
      "rc",
      [[
        "draftkings",
        "b",
        "r",
        args.observedAt,
        args.fetchedAt ?? new Date(Date.parse(args.observedAt) + 1_000).toISOString(),
        1_000,
        args.openingObservedAt === undefined ? "2026-10-08T18:00:00.000Z" : args.openingObservedAt,
        args.openingLine === undefined ? 3.5 : args.openingLine,
        -105,
        -115,
        null,
        args.openingOver === undefined ? -110 : args.openingOver,
        args.openingUnder === undefined ? -110 : args.openingUnder,
        null,
        3,
      ]],
      [1, 1, 0, 1, 0, 0, 0, "c", "c", "m"],
      [0.2, null, 4.7, 4.8, 0.51, 0.5, 0.51, 0.01, 0.02, "n", 0.49, 0.5, 0.49, -0.01, -0.02, "n", null, null, null, null, null, null],
    ]],
  };
}

function snapshot(args: {
  evaluatedAt: string;
  retainedEvidence?: NflPlayerPropsMarketEvidenceCapture;
}): NflPlayerPropsProductionSnapshot {
  const decision = {
    gameId: "game-id",
    providerPlayerId: "player-id",
    playerName: "Exact Player",
    scheduledStart: start,
    lockAt: lock,
    market: "receptions",
    line: 4.5,
    forecastContext: { position: "WR" },
    modelRelease: "model-release",
    calibrationRelease: "calibration-release",
    decisionRelease: "decision-release",
    marketEvidenceId: "evidence-id",
  };
  return {
    release: "nfl_player_props_member_2026_10_09_r40_independent_receiving_yards",
    season: 2026,
    week: 6,
    generatedAt: args.evaluatedAt,
    writerLeaseGroup: "prediction_pipeline:nfl",
    publicationEligible: true,
    trackingEligible: true,
    riskLabel: "forward_monitoring_2025_exact_price_confirmation",
    board: {
      release: "nfl_player_props_board_2026_10_09_r32_independent_receiving_yards",
      generatedAt: args.evaluatedAt,
      evaluatedAt: args.evaluatedAt,
      provisional: false,
      publicationEnabled: true,
      trackingEnabled: true,
      decisions: [decision],
      counts: { "Best Angle": 0, Lean: 0, Watchlist: 0, "No Play": 1, Held: 0, actionable: 0 },
      marketEvidence: args.retainedEvidence,
      diagnostics: {
        inputOffers: 1,
        completeExactOffers: 1,
        incompleteExactOffers: 0,
        lockedOffers: 0,
        unavailableNoIndependentBenchmark: 0,
        unavailableStaleQuotes: 0,
        unavailableFeatureContext: 0,
        completedEvaluations: 1,
        operationalExceptions: 0,
        recoveryEligibleOperationalExceptions: 0,
        roleOrIdentityHeld: 0,
      },
    },
    memberDecisions: [decision],
    lifecycle: { recomputedUnlocked: 1, retainedStillFreshUnlocked: 0, frozenAtLock: 0, retainedPreviouslyLocked: 0 },
  } as unknown as NflPlayerPropsProductionSnapshot;
}

const t24At = "2026-10-11T00:30:00.000Z";
const t24Evidence = evidence({ observedAt: "2026-10-11T00:25:00.000Z" });
const t24Snapshot = snapshot({ evaluatedAt: t24At, retainedEvidence: t24Evidence });
const beforeBuild = JSON.stringify(t24Snapshot);
const t24 = buildNflPlayerPropsMarketObserverRows({
  snapshot: t24Snapshot,
  currentMarketEvidence: t24Evidence,
  evaluatedAt: t24At,
  maximumLockQuoteAgeHours: 6,
  writerRelease: "writer-release",
});
assert.equal(JSON.stringify(t24Snapshot), beforeBuild, "capture construction cannot mutate the production snapshot");
assert.deepEqual(t24.rows.map((row) => row.landmark), ["provider_opening", "t24"]);
assert.equal(t24.health.provider_opening.eligibleIdentities, 1);
assert.equal(t24.health.provider_opening.identitiesWithRows, 1);
assert.equal(t24.health.t24.rowsBuilt, 1);
const opening = t24.rows.find((row) => row.landmark === "provider_opening")!;
assert.equal(opening.observedLine, 3.5, "provider opening retains its own line rather than the current line");
assert.equal(opening.observedAt, "2026-10-08T18:00:00.000Z");
assert.equal(opening.fetchedAt, null, "an unavailable opening fetch time is not reconstructed");
assert.deepEqual(opening.targetSides, ["over", "under"]);
assert.equal(opening.overPrice, -110);
assert.equal(opening.underPrice, -110);
assert.equal(opening.sourceClass, "retail");
assert.equal(opening.provider, "balldontlie");

const noProviderOpening = evidence({
  observedAt: "2026-10-11T00:25:00.000Z",
  openingObservedAt: null,
  openingLine: null,
  openingOver: null,
  openingUnder: null,
});
const noOpening = buildNflPlayerPropsMarketObserverRows({
  snapshot: snapshot({ evaluatedAt: t24At, retainedEvidence: noProviderOpening }),
  currentMarketEvidence: noProviderOpening,
  evaluatedAt: t24At,
  maximumLockQuoteAgeHours: 6,
  writerRelease: "writer-release",
});
assert.equal(noOpening.rows.some((row) => row.landmark === "provider_opening"), false,
  "a first-observed current quote is never relabeled as a provider opening");
assert.equal(noOpening.health.provider_opening.eligibleIdentities, 1);
assert.equal(noOpening.health.provider_opening.identitiesWithRows, 0,
  "missing true openings remain explicit in completeness telemetry");
assert.equal(noOpening.rows.some((row) => row.landmark === "t24"), true);

const missingEvidenceSnapshot = snapshot({ evaluatedAt: t24At });
missingEvidenceSnapshot.memberDecisions = missingEvidenceSnapshot.memberDecisions.map((decision) => {
  const copy = { ...decision };
  Reflect.deleteProperty(copy, "marketEvidenceId");
  return copy;
});
const missingEvidence = buildNflPlayerPropsMarketObserverRows({
  snapshot: missingEvidenceSnapshot,
  currentMarketEvidence: null,
  evaluatedAt: t24At,
  maximumLockQuoteAgeHours: 6,
  writerRelease: "writer-release",
});
assert.equal(missingEvidence.health.t24.eligibleIdentities, 1,
  "complete-board identities remain in the denominator when bounded evidence retention omits a tuple");
assert.equal(missingEvidence.health.t24.identitiesWithRows, 0);

const t6At = "2026-10-11T18:30:00.000Z";
const t6Evidence = evidence({ observedAt: "2026-10-11T18:25:00.000Z" });
const t6 = buildNflPlayerPropsMarketObserverRows({
  snapshot: snapshot({ evaluatedAt: t6At, retainedEvidence: t6Evidence }),
  currentMarketEvidence: t6Evidence,
  evaluatedAt: t6At,
  maximumLockQuoteAgeHours: 6,
  writerRelease: "writer-release",
});
assert.equal(t6.rows.some((row) => row.landmark === "t6"), true);
assert.equal(t6.rows.some((row) => row.landmark === "t24"), false);

const lockAt = "2026-10-11T23:10:00.000Z";
const lockEvidence = evidence({ observedAt: "2026-10-11T22:58:00.000Z", fetchedAt: "2026-10-11T22:58:01.000Z" });
const atLock = buildNflPlayerPropsMarketObserverRows({
  snapshot: snapshot({ evaluatedAt: lockAt, retainedEvidence: lockEvidence }),
  currentMarketEvidence: null,
  evaluatedAt: lockAt,
  maximumLockQuoteAgeHours: 6,
  writerRelease: "writer-release",
});
assert.deepEqual(atLock.rows.map((row) => row.landmark), ["t60_lock"],
  "the coherent retained tuple can fill T-60 when the provider removes the offer at lock");
assert.equal(atLock.rows[0]?.observedAt, "2026-10-11T22:58:00.000Z");
assert.equal(atLock.rows[0]?.minutesToStartAtCapture, 50);

const staleLockEvidence = evidence({ observedAt: "2026-10-11T16:00:00.000Z", fetchedAt: "2026-10-11T16:00:01.000Z" });
const staleLock = buildNflPlayerPropsMarketObserverRows({
  snapshot: snapshot({ evaluatedAt: lockAt, retainedEvidence: staleLockEvidence }),
  currentMarketEvidence: null,
  evaluatedAt: lockAt,
  maximumLockQuoteAgeHours: 6,
  writerRelease: "writer-release",
});
assert.equal(staleLock.rows.length, 0, "a stale retained quote cannot become the T-60 observation");
assert.equal(staleLock.health.t60_lock.eligibleIdentities, 1);
assert.equal(staleLock.health.t60_lock.identitiesWithRows, 0);

const invalidOrderingEvidence = evidence({
  observedAt: "2026-10-11T00:25:00.000Z",
  fetchedAt: "2026-10-11T00:24:59.000Z",
});
const invalidOrdering = buildNflPlayerPropsMarketObserverRows({
  snapshot: snapshot({ evaluatedAt: t24At, retainedEvidence: invalidOrderingEvidence }),
  currentMarketEvidence: invalidOrderingEvidence,
  evaluatedAt: t24At,
  maximumLockQuoteAgeHours: 6,
  writerRelease: "writer-release",
});
assert.equal(invalidOrdering.rows.some((row) => row.landmark === "t24"), false,
  "source-time reversal cannot be captured as a landmark");

const afterKickoffAt = "2026-10-12T00:01:00.000Z";
const afterKickoff = buildNflPlayerPropsMarketObserverRows({
  snapshot: snapshot({ evaluatedAt: afterKickoffAt, retainedEvidence: lockEvidence }),
  currentMarketEvidence: lockEvidence,
  evaluatedAt: afterKickoffAt,
  maximumLockQuoteAgeHours: 6,
  writerRelease: "writer-release",
});
assert.equal(afterKickoff.rows.length, 0, "no observation is added after kickoff");

const mergedOnce = mergeNflPlayerPropsMarketObserverRows({ previous: [], current: t24.rows });
const mergedTwice = mergeNflPlayerPropsMarketObserverRows({ previous: mergedOnce.rows, current: t24.rows });
assert.equal(mergedOnce.added, 2);
assert.equal(mergedTwice.added, 0);
assert.equal(mergedTwice.preserved, 2);
const changedDuplicate = { ...t24.rows[0]!, overPrice: 500 };
const immutableMerge = mergeNflPlayerPropsMarketObserverRows({ previous: t24.rows, current: [changedDuplicate] });
assert.equal(immutableMerge.conflicts, 1);
assert.equal(immutableMerge.rows[0]?.overPrice, t24.rows[0]?.overPrice,
  "a later conflicting value cannot rewrite the first landmark record");

const history: NflPlayerPropsMarketObserverHistory = {
  kind: "nfl_player_props_market_observer_history_v1",
  schema: "nfl_props_market_observer_history_v1",
  captureRelease: NFL_PLAYER_PROPS_MARKET_OBSERVER_CAPTURE_RELEASE,
  season: 2026,
  week: 6,
  createdAt: t24At,
  updatedAt: t24At,
  boundaryPolicy: "t60_is_lock_no_post_t60_prelock_interval",
  rowLimit: NFL_PLAYER_PROPS_MARKET_OBSERVER_MAX_ROWS,
  rows: t24.rows,
};
const envelope = encodeNflPlayerPropsMarketObserverHistory(history);
assert.ok(envelope.uncompressedBytes < NFL_PLAYER_PROPS_MARKET_OBSERVER_MAX_JSON_BYTES);
assert.ok(envelope.compressedBytes < NFL_PLAYER_PROPS_MARKET_OBSERVER_MAX_GZIP_BYTES);
assert.deepEqual(decodeNflPlayerPropsMarketObserverHistory(envelope), history);
assert.equal(decodeNflPlayerPropsMarketObserverHistory({ ...envelope, checksum: "corrupt" }), null);
assert.throws(() => encodeNflPlayerPropsMarketObserverHistory({
  ...history,
  rows: Array.from({ length: NFL_PLAYER_PROPS_MARKET_OBSERVER_MAX_ROWS + 1 }, () => t24.rows[0]!),
}), /row limit/);

async function runPersistenceAndIsolationTests(): Promise<void> {
  let storedPayload: unknown = null;
  let writes = 0;
  const fakeClient = {
  from(table: string) {
    assert.equal(table, "lab_response_snapshots");
    const query = {
      select() { return query; },
      eq(_column: string, key: string) {
        assert.equal(key, nflPlayerPropsMarketObserverKey(2026, 6));
        return query;
      },
      async maybeSingle() {
        return { data: storedPayload === null ? null : { payload: storedPayload }, error: null };
      },
      async upsert(row: Record<string, unknown>, options: { onConflict: string }) {
        assert.equal(row.snapshot_key, nflPlayerPropsMarketObserverKey(2026, 6));
        assert.equal(row.kind, "daily_edge");
        assert.equal(row.source, "writer-release");
        assert.equal(options.onConflict, "snapshot_key");
        storedPayload = row.payload;
        writes += 1;
        return { error: null };
      },
    };
    return query;
  },
  } as unknown as SupabaseClient;

  const firstWrite = await captureNflPlayerPropsMarketObserver({
  client: fakeClient,
  snapshot: t24Snapshot,
  currentMarketEvidence: t24Evidence,
  evaluatedAt: t24At,
  maximumLockQuoteAgeHours: 6,
  writerRelease: "writer-release",
});
  assert.equal(firstWrite.written, true);
  assert.equal(firstWrite.rowsAdded, 2);
  assert.equal(writes, 1);
  const replayWrite = await captureNflPlayerPropsMarketObserver({
  client: fakeClient,
  snapshot: t24Snapshot,
  currentMarketEvidence: t24Evidence,
  evaluatedAt: t24At,
  maximumLockQuoteAgeHours: 6,
  writerRelease: "writer-release",
});
  assert.equal(replayWrite.written, false, "same-cycle replay is idempotent and avoids a database write");
  assert.equal(replayWrite.rowsAdded, 0);
  assert.equal(writes, 1);
  assert.equal(JSON.stringify(t24Snapshot), beforeBuild, "the persisted capture path cannot mutate production state");

  const isolatedFailure = await captureNflPlayerPropsMarketObserverSafely(async () => {
    throw new Error("capture database unavailable");
  });
  assert.equal(isolatedFailure.error, "capture database unavailable");
  assert.equal(isolatedFailure.written, false);
}

const writerSource = readFileSync("lib/services/football/nflPlayerPropsProductionWriter.ts", "utf8");
assert.ok(writerSource.indexOf("await writeNflPlayerPropsSnapshot") < writerSource.indexOf("? await captureNflPlayerPropsMarketObserverSafely"),
  "capture must occur only after the member-authoritative snapshot write");
assert.ok(writerSource.indexOf("settleNflPlayerPropsRecords({") < writerSource.lastIndexOf("captureNflPlayerPropsMarketObserverSafely"),
  "capture must run after lock tracking, closing prices, and settlement rather than delaying them");
assert.doesNotMatch(
  readFileSync("lib/services/football/nflPlayerPropsMarketObserverStore.ts", "utf8"),
  /fetch\(|collectNflPlayerPropsObservations|ballDontLieApiKey|sharpApiKey/,
  "the observer store cannot make provider requests",
);

runPersistenceAndIsolationTests()
  .then(() => console.log("NFL player props prospective market observer store tests passed."))
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
