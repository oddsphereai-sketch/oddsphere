import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  auditNflForwardMemberSnapshot,
  buildNflForwardMemberSnapshot,
  nflFlatBoardWarning,
  NFL_FORWARD_MEMBER_SNAPSHOT_RELEASE,
  nflForwardMemberSnapshotKey,
  readNflForwardMemberSnapshot,
  writeNflForwardMemberSnapshot,
} from "../lib/services/football/nflForwardMemberSnapshotStore";
import {
  NFL_WEEK_ONE_HELD_MEMBER_FIXTURE_RELEASE,
  type NflWeekOneHeldMemberFixture,
} from "../lib/services/football/nflWeekOneHeldMemberFixture";

const checksum = "a".repeat(64);
const fixture = {
  heldMemberFixtureRelease: NFL_WEEK_ONE_HELD_MEMBER_FIXTURE_RELEASE,
  capturedAt: "2026-08-27T12:00:00.000Z",
  sport: "nfl",
  snapshot: {
    sport: "nfl",
    date: "2026-09-09",
    games: [{
      id: "nfl-test",
      markets: { moneyline: {}, total: {}, first_inning: {} },
    }],
  },
  week: { week: 1 },
  provenance: { sourceChecksum: checksum },
} as unknown as NflWeekOneHeldMemberFixture;

const snapshot = buildNflForwardMemberSnapshot({
  fixture,
  season: 2026,
  week: 1,
  publishedAt: "2026-08-27T12:01:00.000Z",
});
assert.equal(snapshot.snapshotRelease, NFL_FORWARD_MEMBER_SNAPSHOT_RELEASE);
assert.equal(snapshot.sourceCapturedAt, fixture.capturedAt);
assert.equal(snapshot.sourceChecksum, checksum);
assert.equal(snapshot.fixture, fixture);
assert.match(nflForwardMemberSnapshotKey({ season: 2026, week: 1 }), /2026::1/);
assert.match(nflForwardMemberSnapshotKey({ season: 2026, week: 1 }), new RegExp(NFL_FORWARD_MEMBER_SNAPSHOT_RELEASE));

const auditedFixture = {
  ...fixture,
  capturedAt: "2026-09-01T13:00:00.000Z",
  snapshot: {
    ...fixture.snapshot,
    games: [{
      id: "nfl-test",
      gameStartAt: "2026-09-10T00:20:00.000Z",
      scheduledLockAt: "2026-09-09T23:20:00.000Z",
      markets: Object.fromEntries(["moneyline", "total", "first_inning"].map((market) => [market, {
        currentPriceAmerican: -110,
        oddsTrail: [
          { label: "open", capturedAt: "2026-09-01T12:00:00.000Z" },
          { label: "current", capturedAt: "2026-09-01T13:00:00.000Z" },
        ],
        verdict: { label: market === "moneyline" ? "Lean" : "No Play" },
      }])),
    }],
  },
} as unknown as NflWeekOneHeldMemberFixture;
const auditedSnapshot = buildNflForwardMemberSnapshot({
  fixture: auditedFixture,
  season: 2026,
  week: 1,
  publishedAt: "2026-09-01T13:20:00.000Z",
});
const audit = auditNflForwardMemberSnapshot({ snapshot: auditedSnapshot, now: new Date("2026-09-01T13:30:00.000Z") });
assert.equal(audit.healthy, true);
assert.equal(audit.metrics.games, 1);
assert.equal(audit.metrics.predictions, 3);
assert.equal(audit.metrics.maximumSourceAgeMinutes, 90, "provider health follows the hourly source-evidence contract");
assert.equal(audit.metrics.grades.Lean, 1);

const lockedTerminalFixture = {
  ...auditedFixture,
  capturedAt: "2026-09-01T13:00:00.000Z",
  snapshot: {
    ...auditedFixture.snapshot,
    games: auditedFixture.snapshot.games.map((game) => ({
      ...game,
      gameStartAt: "2026-09-01T12:00:00.000Z",
      markets: Object.fromEntries(Object.entries(game.markets).map(([market, value]) => [market, {
        ...value,
        oddsTrail: [value.oddsTrail![0], { ...value.oddsTrail![1], label: "locked" }],
      }])),
    })),
  },
} as unknown as NflWeekOneHeldMemberFixture;
const lockedTerminalAudit = auditNflForwardMemberSnapshot({
  snapshot: buildNflForwardMemberSnapshot({
    fixture: lockedTerminalFixture,
    season: 2026,
    week: 1,
    publishedAt: "2026-09-01T13:20:00.000Z",
  }),
  now: new Date("2026-09-01T13:30:00.000Z"),
});
assert.equal(lockedTerminalAudit.healthy, true,
  "a completed market's first-to-locked same-book trail is a complete terminal history");

const pastAndFarFutureFixture = {
  ...auditedFixture,
  capturedAt: "2026-09-01T10:10:00.000Z",
  snapshot: {
    ...auditedFixture.snapshot,
    games: [
      { ...auditedFixture.snapshot.games[0], id: "nfl-past", gameStartAt: "2026-09-01T12:00:00.000Z" },
      { ...auditedFixture.snapshot.games[0], id: "nfl-future", gameStartAt: "2026-09-10T00:20:00.000Z" },
    ],
  },
} as unknown as NflWeekOneHeldMemberFixture;
const pastAndFarFutureAudit = auditNflForwardMemberSnapshot({
  snapshot: buildNflForwardMemberSnapshot({
    fixture: pastAndFarFutureFixture,
    season: 2026,
    week: 1,
    publishedAt: "2026-09-01T13:20:00.000Z",
  }),
  now: new Date("2026-09-01T13:30:00.000Z"),
});
assert.equal(pastAndFarFutureAudit.metrics.maximumSourceAgeMinutes, 90,
  "far-window games cannot hide a stalled hourly source refresh");
assert.equal(pastAndFarFutureAudit.healthy, false);
assert.equal(
  nflFlatBoardWarning({ grades: { Lean: 1, "No Play": 39, Watchlist: 8 }, predictions: 48 }),
  "the current weekly slate is materially flat: 1/48 actionable and 39 No Play grades",
);
assert.equal(
  nflFlatBoardWarning({ grades: { Lean: 2, "No Play": 38, Watchlist: 8 }, predictions: 48 }),
  null,
);
assert.equal(
  nflFlatBoardWarning({ grades: { "No Play": 40, Watchlist: 8 }, predictions: 48 }),
  "the current weekly slate contains no actionable play grades",
);
const brokenAudit = auditNflForwardMemberSnapshot({
  snapshot: { ...auditedSnapshot, publishedAt: "2026-09-01T11:00:00.000Z" },
  now: new Date("2026-09-01T13:30:00.000Z"),
});
assert.equal(brokenAudit.healthy, false);
assert.match(brokenAudit.critical.join(";"), /compact member snapshot age/);
const healthRoute = readFileSync(path.resolve("app/api/cron/nfl-daily-edge-health/route.ts"), "utf8");
assert.match(healthRoute, /readNflForwardMemberSnapshot/);
assert.match(healthRoute, /auditNflForwardMemberSnapshot/);
assert.match(healthRoute, /const findings = \[\.\.\.audit\.critical, \.\.\.audit\.warnings\]/);
assert.match(healthRoute, /partial: findings\.length > 0/);
assert.doesNotMatch(healthRoute, /readCurrentNflPublishedMemberSnapshot/);

let storedPayload: unknown = null;
let storedKey: string | null = null;
const client = {
  from(table: string) {
    assert.equal(table, "lab_response_snapshots");
    return {
      async upsert(row: Record<string, unknown>, options: { onConflict: string }) {
        assert.equal(options.onConflict, "snapshot_key");
        assert.equal(row.kind, "daily_edge");
        assert.equal(row.sport, "nfl");
        storedKey = String(row.snapshot_key);
        storedPayload = row.payload;
        return { error: null };
      },
      select() {
        return {
          eq(column: string, value: string) {
            assert.equal(column, "snapshot_key");
            return {
              async maybeSingle() {
                return {
                  data: value === storedKey && storedPayload
                    ? {
                        payload: storedPayload,
                        generated_at: snapshot.publishedAt,
                        expires_at: "2026-08-27T12:31:00.000Z",
                        stale_until: "2026-08-27T20:01:00.000Z",
                      }
                    : null,
                  error: null,
                };
              },
            };
          },
        };
      },
    };
  },
} as unknown as SupabaseClient;

async function main() {
  const write = await writeNflForwardMemberSnapshot({ client, snapshot });
  assert.equal(write.ok, true);
  assert.equal(write.snapshotKey, storedKey);
  const read = await readNflForwardMemberSnapshot({
    client,
    season: 2026,
    week: 1,
    now: "2026-08-27T12:02:00.000Z",
  });
  assert.deepEqual(read, snapshot);
  assert.equal(JSON.stringify(read?.fixture), JSON.stringify(fixture));

  const movementContractPredecessor = {
    ...snapshot,
    snapshotRelease: "nfl_forward_member_snapshot_2026_11_01_r58_movement_contract_separation",
    fixtureRelease: "nfl_weekly_member_fixture_2026_11_01_r66_movement_contract_separation",
    memberRelease: "nfl_v1_member_release_2026_11_01_r51_movement_contract_separation",
    decisionRelease: "nfl_v1_daily_edge_decision_2026_11_01_r54_movement_contract_separation",
    fixture: { ...fixture,
      heldMemberFixtureRelease: "nfl_weekly_member_fixture_2026_11_01_r66_movement_contract_separation",
      snapshot: { ...fixture.snapshot, games: fixture.snapshot.games.map((game) => ({
        ...game, lockedAt: "2026-08-27T11:00:00.000Z",
        markets: Object.fromEntries(Object.entries(game.markets).map(([market, value], index) => [market, {
          ...value, predictedAwayScore: 20.1234 + index, predictedHomeScore: 23.9876 + index,
          selectedSide: index === 0 ? "BUF" : index === 1 ? "Under 45.5" : "PHI",
          modelProbability: .500001 + index / 10, pushProbability: .021 + index / 100,
          grade: index === 0 ? "Best Angle" : index === 1 ? "No Play" : "Lean",
          currentPriceAmerican: index === 0 ? -145 : index === 1 ? 105 : -110,
          stakeUnits: .73 + index / 10, evidence: { legacySentinel: market, sourceAt: "2026-08-27T10:59:00.000Z" },
        }])),
      })) },
    },
  };
  storedKey = ["nfl", "daily-edge", 2026, 1,
    movementContractPredecessor.snapshotRelease, movementContractPredecessor.fixtureRelease,
    movementContractPredecessor.memberRelease, movementContractPredecessor.decisionRelease].join("::");
  storedPayload = movementContractPredecessor;
  const movementContractBefore = JSON.stringify(movementContractPredecessor);
  const movementContractRead = await readNflForwardMemberSnapshot({
    client, season: 2026, week: 1, now: "2026-08-27T12:02:00.000Z",
  });
  assert.deepEqual(movementContractRead, movementContractPredecessor,
    "r58/r66/r51/r54 must retain exact locked predecessor precedence under relative-market semantics");
  assert.equal(JSON.stringify(movementContractRead), movementContractBefore,
    "relative innovations cannot recalculate legacy locked scores, sides, probabilities, grades, prices, stakes or evidence");
  assert.equal(storedPayload, movementContractPredecessor,
    "reading the locked movement-contract predecessor cannot write or replace its stored payload");

  const relativeInnovationPredecessor = { ...snapshot,
    snapshotRelease: "nfl_forward_member_snapshot_2026_11_01_r59_relative_market_innovations",
    fixtureRelease: "nfl_weekly_member_fixture_2026_11_01_r67_relative_market_innovations",
    fixture: { ...fixture,
      heldMemberFixtureRelease: "nfl_weekly_member_fixture_2026_11_01_r67_relative_market_innovations" },
  };
  storedKey = ["nfl", "daily-edge", 2026, 1, relativeInnovationPredecessor.snapshotRelease,
    relativeInnovationPredecessor.fixtureRelease, relativeInnovationPredecessor.memberRelease,
    relativeInnovationPredecessor.decisionRelease].join("::");
  storedPayload = relativeInnovationPredecessor;
  assert.deepEqual(await readNflForwardMemberSnapshot({
    client, season: 2026, week: 1, now: "2026-08-27T12:02:00.000Z",
  }), relativeInnovationPredecessor, "r59 exact tuple remains readable before the r60 publication exists");

  const independentAxesPredecessor = {
    ...snapshot,
    snapshotRelease: "nfl_forward_member_snapshot_2026_11_01_r57_independent_market_axes",
    fixtureRelease: "nfl_weekly_member_fixture_2026_11_01_r65_independent_market_axes",
    memberRelease: "nfl_v1_member_release_2026_11_01_r50_independent_market_axes",
    decisionRelease: "nfl_v1_daily_edge_decision_2026_11_01_r53_independent_market_axes",
    fixture: { ...fixture,
      heldMemberFixtureRelease: "nfl_weekly_member_fixture_2026_11_01_r65_independent_market_axes",
      snapshot: { ...fixture.snapshot, games: fixture.snapshot.games.map((game) => ({
        ...game, lockedAt: "2026-08-27T11:00:00.000Z",
        markets: { ...game.markets,
          moneyline: { ...game.markets.moneyline, predictedAwayScore: 21.5571, predictedHomeScore: 20.8282,
            selectedSide: "PHI", modelProbability: 0.521, grade: "Best Angle", currentPriceAmerican: 220 },
        },
      })) },
    },
  };
  storedKey = ["nfl", "daily-edge", 2026, 1,
    independentAxesPredecessor.snapshotRelease, independentAxesPredecessor.fixtureRelease,
    independentAxesPredecessor.memberRelease, independentAxesPredecessor.decisionRelease].join("::");
  storedPayload = independentAxesPredecessor;
  const independentAxesBefore = JSON.stringify(independentAxesPredecessor);
  const independentAxesRead = await readNflForwardMemberSnapshot({
    client, season: 2026, week: 1, now: "2026-08-27T12:02:00.000Z",
  });
  assert.deepEqual(independentAxesRead, independentAxesPredecessor,
    "r57/r65/r50/r53 must be read under its exact stored predecessor key, including legacy locked market values");
  assert.equal(JSON.stringify(independentAxesRead), independentAxesBefore,
    "new movement semantics cannot recompute or replace any prior locked score, side, probability, grade or price");
  assert.equal(storedPayload, independentAxesPredecessor,
    "predecessor continuity must not write or replace the stored object");

  const namedPricePredecessorSnapshotRelease =
    "nfl_forward_member_snapshot_2026_10_26_r47_complete_signal_interpretation";
  const namedPricePredecessorFixtureRelease =
    "nfl_weekly_member_fixture_2026_10_26_r55_complete_signal_interpretation";
  const namedPricePredecessorPayload = {
    ...snapshot,
    snapshotRelease: namedPricePredecessorSnapshotRelease,
    memberRelease: "nfl_v1_member_release_2026_10_26_r40_complete_signal_interpretation",
    decisionRelease: "nfl_v1_daily_edge_decision_2026_10_26_r43_complete_signal_interpretation",
    fixtureRelease: namedPricePredecessorFixtureRelease,
    fixture: {
      ...fixture,
      heldMemberFixtureRelease: namedPricePredecessorFixtureRelease,
    },
  };
  storedKey = [
    "nfl", "daily-edge", 2026, 1,
    namedPricePredecessorSnapshotRelease,
    namedPricePredecessorFixtureRelease,
    namedPricePredecessorPayload.memberRelease,
    namedPricePredecessorPayload.decisionRelease,
  ].join("::");
  storedPayload = namedPricePredecessorPayload;
  const namedPriceContinuityRead = await readNflForwardMemberSnapshot({
    client,
    season: 2026,
    week: 1,
    now: "2026-08-27T12:02:00.000Z",
  });
  assert.deepEqual(namedPriceContinuityRead, namedPricePredecessorPayload,
    "the deployed r47/r55/r40/r43 predecessor must be found under its exact stored key and returned unchanged");
  assert.equal(storedPayload, namedPricePredecessorPayload,
    "predecessor reads must not replace the stored payload");

  const completeSignalPredecessorSnapshotRelease =
    "nfl_forward_member_snapshot_2026_10_26_r46_joint_side_market_arbitration";
  const completeSignalPredecessorFixtureRelease =
    "nfl_weekly_member_fixture_2026_10_26_r54_joint_side_market_arbitration";
  const completeSignalPredecessorPayload = {
    ...snapshot,
    snapshotRelease: completeSignalPredecessorSnapshotRelease,
    memberRelease: "nfl_v1_member_release_2026_10_26_r39_joint_side_market_arbitration",
    decisionRelease: "nfl_v1_daily_edge_decision_2026_10_26_r42_joint_side_market_arbitration",
    fixtureRelease: completeSignalPredecessorFixtureRelease,
    fixture: {
      ...fixture,
      heldMemberFixtureRelease: completeSignalPredecessorFixtureRelease,
    },
  };
  storedKey = [
    "nfl", "daily-edge", 2026, 1,
    completeSignalPredecessorSnapshotRelease,
    completeSignalPredecessorFixtureRelease,
    completeSignalPredecessorPayload.memberRelease,
    completeSignalPredecessorPayload.decisionRelease,
  ].join("::");
  storedPayload = completeSignalPredecessorPayload;
  const completeSignalContinuityRead = await readNflForwardMemberSnapshot({
    client,
    season: 2026,
    week: 1,
    now: "2026-08-27T12:02:00.000Z",
  });
  assert.equal(completeSignalContinuityRead?.snapshotRelease, completeSignalPredecessorSnapshotRelease);
  assert.equal(JSON.stringify(completeSignalContinuityRead?.fixture),
    JSON.stringify(completeSignalPredecessorPayload.fixture),
    "the immediate r46/r54/r39/r42 predecessor must retain exact stored reader precedence");

  const winnerCoverPredecessorSnapshotRelease =
    "nfl_forward_member_snapshot_2026_10_26_r44_nuanced_market_reader";
  const winnerCoverPredecessorFixtureRelease =
    "nfl_weekly_member_fixture_2026_10_26_r52_nuanced_market_reader";
  const winnerCoverPredecessorPayload = {
    ...snapshot,
    snapshotRelease: winnerCoverPredecessorSnapshotRelease,
    memberRelease: "nfl_v1_member_release_2026_10_26_r37_nuanced_market_reader",
    decisionRelease: "nfl_v1_daily_edge_decision_2026_10_26_r40_nuanced_market_reader",
    fixtureRelease: winnerCoverPredecessorFixtureRelease,
    fixture: {
      ...fixture,
      heldMemberFixtureRelease: winnerCoverPredecessorFixtureRelease,
    },
  };
  storedKey = [
    "nfl", "daily-edge", 2026, 1,
    winnerCoverPredecessorSnapshotRelease,
    winnerCoverPredecessorFixtureRelease,
    winnerCoverPredecessorPayload.memberRelease,
    winnerCoverPredecessorPayload.decisionRelease,
  ].join("::");
  storedPayload = winnerCoverPredecessorPayload;
  const winnerCoverContinuityRead = await readNflForwardMemberSnapshot({
    client,
    season: 2026,
    week: 1,
    now: "2026-08-27T12:02:00.000Z",
  });
  assert.equal(winnerCoverContinuityRead?.snapshotRelease, winnerCoverPredecessorSnapshotRelease);
  assert.equal(JSON.stringify(winnerCoverContinuityRead?.fixture),
    JSON.stringify(winnerCoverPredecessorPayload.fixture),
    "the immediate r44/r52/r37/r40 predecessor must retain exact stored reader precedence");

  const twoSourcePreviousSnapshotRelease = "nfl_forward_member_snapshot_2026_10_25_r41_three_state_market_reader";
  const twoSourcePreviousFixtureRelease = "nfl_weekly_member_fixture_2026_10_25_r49_three_state_market_reader";
  const twoSourcePreviousPayload = {
    ...snapshot,
    snapshotRelease: twoSourcePreviousSnapshotRelease,
    memberRelease: "nfl_v1_member_release_2026_10_25_r34_three_state_market_reader",
    decisionRelease: "nfl_v1_daily_edge_decision_2026_10_25_r37_three_state_market_reader",
    fixtureRelease: twoSourcePreviousFixtureRelease,
    fixture: {
      ...fixture,
      heldMemberFixtureRelease: twoSourcePreviousFixtureRelease,
    },
  };
  storedKey = [
    "nfl", "daily-edge", 2026, 1,
    twoSourcePreviousSnapshotRelease,
    twoSourcePreviousFixtureRelease,
    twoSourcePreviousPayload.memberRelease,
    twoSourcePreviousPayload.decisionRelease,
  ].join("::");
  storedPayload = twoSourcePreviousPayload;
  const twoSourceContinuityRead = await readNflForwardMemberSnapshot({
    client,
    season: 2026,
    week: 1,
    now: "2026-08-27T12:02:00.000Z",
  });
  assert.equal(twoSourceContinuityRead?.snapshotRelease, twoSourcePreviousSnapshotRelease);
  assert.equal(JSON.stringify(twoSourceContinuityRead?.fixture), JSON.stringify(twoSourcePreviousPayload.fixture),
    "the immediate r41/r49/r34/r37 predecessor must retain exact stored reader precedence");

  const threeStatePreviousSnapshotRelease = "nfl_forward_member_snapshot_2026_10_22_r40_verified_full_market_trail";
  const threeStatePreviousFixtureRelease = "nfl_weekly_member_fixture_2026_10_22_r48_verified_full_market_trail";
  const threeStatePreviousPayload = {
    ...snapshot,
    snapshotRelease: threeStatePreviousSnapshotRelease,
    memberRelease: "nfl_v1_member_release_2026_10_15_r33_personnel_coverage_repair",
    decisionRelease: "nfl_v1_daily_edge_decision_2026_10_15_r36_personnel_coverage_repair",
    fixtureRelease: threeStatePreviousFixtureRelease,
    fixture: {
      ...fixture,
      heldMemberFixtureRelease: threeStatePreviousFixtureRelease,
    },
  };
  storedKey = [
    "nfl",
    "daily-edge",
    2026,
    1,
    threeStatePreviousSnapshotRelease,
    threeStatePreviousFixtureRelease,
    threeStatePreviousPayload.memberRelease,
    threeStatePreviousPayload.decisionRelease,
  ].join("::");
  storedPayload = threeStatePreviousPayload;
  const threeStateContinuityRead = await readNflForwardMemberSnapshot({
    client,
    season: 2026,
    week: 1,
    now: "2026-08-27T12:02:00.000Z",
  });
  assert.equal(threeStateContinuityRead?.snapshotRelease, threeStatePreviousSnapshotRelease);
  assert.equal(JSON.stringify(threeStateContinuityRead?.fixture), JSON.stringify(threeStatePreviousPayload.fixture),
    "the r40/r48 predecessor must retain exact stored reader precedence");

  const personnelCoveragePreviousSnapshotRelease = "nfl_forward_member_snapshot_2026_10_15_r37_personnel_coverage_repair";
  const personnelCoveragePreviousFixtureRelease = "nfl_weekly_member_fixture_2026_10_15_r45_personnel_coverage_repair";
  const personnelCoveragePreviousPayload = {
    ...snapshot,
    snapshotRelease: personnelCoveragePreviousSnapshotRelease,
    memberRelease: "nfl_v1_member_release_2026_10_15_r33_personnel_coverage_repair",
    decisionRelease: "nfl_v1_daily_edge_decision_2026_10_15_r36_personnel_coverage_repair",
    fixtureRelease: personnelCoveragePreviousFixtureRelease,
    fixture: {
      ...fixture,
      heldMemberFixtureRelease: personnelCoveragePreviousFixtureRelease,
    },
  };
  storedKey = [
    "nfl",
    "daily-edge",
    2026,
    1,
    personnelCoveragePreviousSnapshotRelease,
    personnelCoveragePreviousFixtureRelease,
    personnelCoveragePreviousPayload.memberRelease,
    personnelCoveragePreviousPayload.decisionRelease,
  ].join("::");
  storedPayload = personnelCoveragePreviousPayload;
  const personnelCoverageContinuityRead = await readNflForwardMemberSnapshot({
    client,
    season: 2026,
    week: 1,
    now: "2026-08-27T12:02:00.000Z",
  });
  assert.equal(personnelCoverageContinuityRead?.snapshotRelease, personnelCoveragePreviousSnapshotRelease);
  assert.equal(personnelCoverageContinuityRead?.fixture.heldMemberFixtureRelease, personnelCoveragePreviousFixtureRelease);
  assert.equal(JSON.stringify(personnelCoverageContinuityRead?.fixture), JSON.stringify(personnelCoveragePreviousPayload.fixture),
    "the r37 locked member fixture must retain exact stored precedence");

  const foundationalPreviousSnapshotRelease = "nfl_forward_member_snapshot_2026_10_15_r36_foundational_no_weight_score";
  const foundationalPreviousFixtureRelease = "nfl_weekly_member_fixture_2026_10_15_r44_foundational_no_weight_score";
  const foundationalPreviousPayload = {
    ...snapshot,
    snapshotRelease: foundationalPreviousSnapshotRelease,
    memberRelease: "nfl_v1_member_release_2026_10_15_r32_foundational_no_weight_score",
    decisionRelease: "nfl_v1_daily_edge_decision_2026_10_15_r35_foundational_no_weight_score",
    fixtureRelease: foundationalPreviousFixtureRelease,
    fixture: {
      ...fixture,
      heldMemberFixtureRelease: foundationalPreviousFixtureRelease,
    },
  };
  storedKey = [
    "nfl",
    "daily-edge",
    2026,
    1,
    foundationalPreviousSnapshotRelease,
    foundationalPreviousFixtureRelease,
    foundationalPreviousPayload.memberRelease,
    foundationalPreviousPayload.decisionRelease,
  ].join("::");
  storedPayload = foundationalPreviousPayload;
  const foundationalContinuityRead = await readNflForwardMemberSnapshot({
    client,
    season: 2026,
    week: 1,
    now: "2026-08-27T12:02:00.000Z",
  });
  assert.equal(foundationalContinuityRead?.snapshotRelease, foundationalPreviousSnapshotRelease);
  assert.equal(foundationalContinuityRead?.fixture.heldMemberFixtureRelease, foundationalPreviousFixtureRelease);
  assert.equal(JSON.stringify(foundationalContinuityRead?.fixture), JSON.stringify(foundationalPreviousPayload.fixture));

  const personnelEligibilityPreviousSnapshotRelease = "nfl_forward_member_snapshot_2026_10_15_r35_personnel_evidence_eligibility";
  const personnelEligibilityPreviousFixtureRelease = "nfl_weekly_member_fixture_2026_10_15_r43_personnel_evidence_eligibility";
  const personnelEligibilityPreviousPayload = {
    ...snapshot,
    snapshotRelease: personnelEligibilityPreviousSnapshotRelease,
    memberRelease: "nfl_v1_member_release_2026_10_15_r31_personnel_evidence_eligibility",
    decisionRelease: "nfl_v1_daily_edge_decision_2026_10_15_r34_personnel_evidence_eligibility",
    fixtureRelease: personnelEligibilityPreviousFixtureRelease,
    fixture: {
      ...fixture,
      heldMemberFixtureRelease: personnelEligibilityPreviousFixtureRelease,
    },
  };
  storedKey = [
    "nfl",
    "daily-edge",
    2026,
    1,
    personnelEligibilityPreviousSnapshotRelease,
    personnelEligibilityPreviousFixtureRelease,
    personnelEligibilityPreviousPayload.memberRelease,
    personnelEligibilityPreviousPayload.decisionRelease,
  ].join("::");
  storedPayload = personnelEligibilityPreviousPayload;
  const personnelEligibilityContinuityRead = await readNflForwardMemberSnapshot({
    client,
    season: 2026,
    week: 1,
    now: "2026-08-27T12:02:00.000Z",
  });
  assert.equal(personnelEligibilityContinuityRead?.snapshotRelease, personnelEligibilityPreviousSnapshotRelease);
  assert.equal(personnelEligibilityContinuityRead?.fixture.heldMemberFixtureRelease, personnelEligibilityPreviousFixtureRelease);
  assert.equal(JSON.stringify(personnelEligibilityContinuityRead?.fixture), JSON.stringify(personnelEligibilityPreviousPayload.fixture));

  const personnelPreviousSnapshotRelease = "nfl_forward_member_snapshot_2026_10_09_r34_provider_feed_continuity";
  const personnelPreviousFixtureRelease = "nfl_weekly_member_fixture_2026_10_09_r42_provider_feed_continuity";
  const personnelPreviousPayload = {
    ...snapshot,
    snapshotRelease: personnelPreviousSnapshotRelease,
    memberRelease: "nfl_v1_member_release_2026_10_09_r30_provider_feed_continuity",
    decisionRelease: "nfl_v1_daily_edge_decision_2026_10_13_r33_moneyline_price_tier",
    fixtureRelease: personnelPreviousFixtureRelease,
    fixture: {
      ...fixture,
      heldMemberFixtureRelease: personnelPreviousFixtureRelease,
    },
  };
  storedKey = [
    "nfl",
    "daily-edge",
    2026,
    1,
    personnelPreviousSnapshotRelease,
    personnelPreviousFixtureRelease,
    personnelPreviousPayload.memberRelease,
    personnelPreviousPayload.decisionRelease,
  ].join("::");
  storedPayload = personnelPreviousPayload;
  const personnelContinuityRead = await readNflForwardMemberSnapshot({
    client,
    season: 2026,
    week: 1,
    now: "2026-08-27T12:02:00.000Z",
  });
  assert.equal(personnelContinuityRead?.snapshotRelease, personnelPreviousSnapshotRelease);
  assert.equal(personnelContinuityRead?.fixture.heldMemberFixtureRelease, personnelPreviousFixtureRelease);
  assert.equal(JSON.stringify(personnelContinuityRead?.fixture), JSON.stringify(personnelPreviousPayload.fixture));

  const marketStatePreviousSnapshotRelease = "nfl_forward_member_snapshot_2026_10_09_r32_market_state_identity";
  const marketStatePreviousFixtureRelease = "nfl_weekly_member_fixture_2026_10_09_r40_market_state_identity";
  const marketStatePreviousPayload = {
    ...snapshot,
    snapshotRelease: marketStatePreviousSnapshotRelease,
    memberRelease: "nfl_v1_member_release_2026_10_09_r28_market_state_identity",
    decisionRelease: "nfl_v1_daily_edge_decision_2026_10_09_r30_market_state_identity",
    fixtureRelease: marketStatePreviousFixtureRelease,
    fixture: {
      ...fixture,
      heldMemberFixtureRelease: marketStatePreviousFixtureRelease,
    },
  };
  storedKey = [
    "nfl",
    "daily-edge",
    2026,
    1,
    marketStatePreviousSnapshotRelease,
    marketStatePreviousFixtureRelease,
    marketStatePreviousPayload.memberRelease,
    marketStatePreviousPayload.decisionRelease,
  ].join("::");
  storedPayload = marketStatePreviousPayload;
  const marketStateContinuityRead = await readNflForwardMemberSnapshot({
    client,
    season: 2026,
    week: 1,
    now: "2026-08-27T12:02:00.000Z",
  });
  assert.equal(marketStateContinuityRead?.snapshotRelease, marketStatePreviousSnapshotRelease);
  assert.equal(marketStateContinuityRead?.fixtureRelease, marketStatePreviousFixtureRelease);
  assert.equal(marketStateContinuityRead?.memberRelease, marketStatePreviousPayload.memberRelease);
  assert.equal(marketStateContinuityRead?.decisionRelease, marketStatePreviousPayload.decisionRelease);
  assert.equal(JSON.stringify(marketStateContinuityRead?.fixture), JSON.stringify(marketStatePreviousPayload.fixture),
    "the previous locked member fixture must retain exact stored precedence");

  const namedSequencePreviousSnapshotRelease = "nfl_forward_member_snapshot_2026_10_08_r31_named_sequence";
  const namedSequencePreviousFixtureRelease = "nfl_weekly_member_fixture_2026_10_08_r39_named_sequence";
  const namedSequencePreviousPayload = {
    ...snapshot,
    snapshotRelease: namedSequencePreviousSnapshotRelease,
    memberRelease: "nfl_v1_member_release_2026_10_08_r27_named_sequence",
    decisionRelease: "nfl_v1_daily_edge_decision_2026_10_08_r29_named_sequence",
    fixtureRelease: namedSequencePreviousFixtureRelease,
    fixture: {
      ...fixture,
      heldMemberFixtureRelease: namedSequencePreviousFixtureRelease,
    },
  };
  storedKey = [
    "nfl",
    "daily-edge",
    2026,
    1,
    namedSequencePreviousSnapshotRelease,
    namedSequencePreviousFixtureRelease,
    namedSequencePreviousPayload.memberRelease,
    namedSequencePreviousPayload.decisionRelease,
  ].join("::");
  storedPayload = namedSequencePreviousPayload;
  const namedSequenceContinuityRead = await readNflForwardMemberSnapshot({
    client,
    season: 2026,
    week: 1,
    now: "2026-08-27T12:02:00.000Z",
  });
  assert.equal(namedSequenceContinuityRead?.snapshotRelease, namedSequencePreviousSnapshotRelease);
  assert.equal(namedSequenceContinuityRead?.fixtureRelease, namedSequencePreviousFixtureRelease);
  assert.equal(namedSequenceContinuityRead?.memberRelease, namedSequencePreviousPayload.memberRelease);
  assert.equal(namedSequenceContinuityRead?.decisionRelease, namedSequencePreviousPayload.decisionRelease);
  assert.equal(JSON.stringify(namedSequenceContinuityRead?.fixture), JSON.stringify(namedSequencePreviousPayload.fixture),
    "the r27 locked member fixture must retain exact stored precedence");

  const pressureDirectionPreviousSnapshotRelease = "nfl_forward_member_snapshot_2026_09_27_r22_pressure_direction";
  const pressureDirectionPreviousFixtureRelease = "nfl_weekly_member_fixture_2026_09_27_r30_pressure_direction";
  const pressureDirectionPreviousPayload = {
    ...snapshot,
    snapshotRelease: pressureDirectionPreviousSnapshotRelease,
    memberRelease: "nfl_v1_member_release_2026_09_27_r21_pressure_direction",
    decisionRelease: "nfl_v1_daily_edge_decision_2026_09_27_r23_pressure_direction",
    fixtureRelease: pressureDirectionPreviousFixtureRelease,
    fixture: {
      ...fixture,
      heldMemberFixtureRelease: pressureDirectionPreviousFixtureRelease,
    },
  };
  storedKey = [
    "nfl",
    "daily-edge",
    2026,
    1,
    pressureDirectionPreviousSnapshotRelease,
    pressureDirectionPreviousFixtureRelease,
    pressureDirectionPreviousPayload.memberRelease,
    pressureDirectionPreviousPayload.decisionRelease,
  ].join("::");
  storedPayload = pressureDirectionPreviousPayload;
  const pressureDirectionContinuityRead = await readNflForwardMemberSnapshot({
    client,
    season: 2026,
    week: 1,
    now: "2026-08-27T12:02:00.000Z",
  });
  assert.equal(pressureDirectionContinuityRead?.snapshotRelease, pressureDirectionPreviousSnapshotRelease);
  assert.equal(pressureDirectionContinuityRead?.fixtureRelease, pressureDirectionPreviousFixtureRelease);

  const currentSeasonPreviousSnapshotRelease = "nfl_forward_member_snapshot_2026_09_25_r21_current_season_raw_signal";
  const currentSeasonPreviousFixtureRelease = "nfl_weekly_member_fixture_2026_09_25_r29_current_season_raw_signal";
  const currentSeasonPreviousPayload = {
    ...snapshot,
    snapshotRelease: currentSeasonPreviousSnapshotRelease,
    memberRelease: "nfl_v1_member_release_2026_09_25_r20_current_season_raw_signal",
    decisionRelease: "nfl_v1_daily_edge_decision_2026_09_25_r22_current_season_raw_signal",
    fixtureRelease: currentSeasonPreviousFixtureRelease,
    fixture: {
      ...fixture,
      heldMemberFixtureRelease: currentSeasonPreviousFixtureRelease,
    },
  };
  storedKey = [
    "nfl",
    "daily-edge",
    2026,
    1,
    currentSeasonPreviousSnapshotRelease,
    currentSeasonPreviousFixtureRelease,
    currentSeasonPreviousPayload.memberRelease,
    currentSeasonPreviousPayload.decisionRelease,
  ].join("::");
  storedPayload = currentSeasonPreviousPayload;
  const currentSeasonContinuityRead = await readNflForwardMemberSnapshot({
    client,
    season: 2026,
    week: 1,
    now: "2026-08-27T12:02:00.000Z",
  });
  assert.equal(currentSeasonContinuityRead?.snapshotRelease, currentSeasonPreviousSnapshotRelease);
  assert.equal(currentSeasonContinuityRead?.fixtureRelease, currentSeasonPreviousFixtureRelease);

  const rawSignalPreviousSnapshotRelease = "nfl_forward_member_snapshot_2026_09_25_r20_marginal_likelihood_score";
  const rawSignalPreviousFixtureRelease = "nfl_weekly_member_fixture_2026_09_25_r28_marginal_likelihood_score";
  const rawSignalPreviousPayload = {
    ...snapshot,
    snapshotRelease: rawSignalPreviousSnapshotRelease,
    memberRelease: "nfl_v1_member_release_2026_09_25_r19_marginal_likelihood_score",
    decisionRelease: "nfl_v1_daily_edge_decision_2026_09_21_r21_opening_market_direction",
    fixtureRelease: rawSignalPreviousFixtureRelease,
    fixture: {
      ...fixture,
      heldMemberFixtureRelease: rawSignalPreviousFixtureRelease,
    },
  };
  storedKey = [
    "nfl",
    "daily-edge",
    2026,
    1,
    rawSignalPreviousSnapshotRelease,
    rawSignalPreviousFixtureRelease,
    rawSignalPreviousPayload.memberRelease,
    rawSignalPreviousPayload.decisionRelease,
  ].join("::");
  storedPayload = rawSignalPreviousPayload;
  const rawSignalContinuityRead = await readNflForwardMemberSnapshot({
    client,
    season: 2026,
    week: 1,
    now: "2026-08-27T12:02:00.000Z",
  });
  assert.equal(rawSignalContinuityRead?.snapshotRelease, rawSignalPreviousSnapshotRelease);
  assert.equal(rawSignalContinuityRead?.fixtureRelease, rawSignalPreviousFixtureRelease);

  const scorePreviousSnapshotRelease = "nfl_forward_member_snapshot_2026_09_22_r19_nonpush_side_alignment";
  const scorePreviousFixtureRelease = "nfl_weekly_member_fixture_2026_09_22_r27_nonpush_side_alignment";
  const scorePreviousPayload = {
    ...snapshot,
    snapshotRelease: scorePreviousSnapshotRelease,
    memberRelease: "nfl_v1_member_release_2026_09_21_r18_opening_market_direction",
    decisionRelease: "nfl_v1_daily_edge_decision_2026_09_21_r21_opening_market_direction",
    fixtureRelease: scorePreviousFixtureRelease,
    fixture: {
      ...fixture,
      heldMemberFixtureRelease: scorePreviousFixtureRelease,
    },
  };
  storedKey = [
    "nfl",
    "daily-edge",
    2026,
    1,
    scorePreviousSnapshotRelease,
    scorePreviousFixtureRelease,
    scorePreviousPayload.memberRelease,
    scorePreviousPayload.decisionRelease,
  ].join("::");
  storedPayload = scorePreviousPayload;
  const scoreContinuityRead = await readNflForwardMemberSnapshot({
    client,
    season: 2026,
    week: 1,
    now: "2026-08-27T12:02:00.000Z",
  });
  assert.equal(scoreContinuityRead?.snapshotRelease, scorePreviousSnapshotRelease);
  assert.equal(scoreContinuityRead?.fixtureRelease, scorePreviousFixtureRelease);

  const openingDirectionPreviousSnapshotRelease = "nfl_forward_member_snapshot_2026_09_21_r17_opening_market_direction";
  const openingDirectionPreviousFixtureRelease = "nfl_weekly_member_fixture_2026_09_21_r25_opening_market_direction";
  const openingDirectionPreviousPayload = {
    ...snapshot,
    snapshotRelease: openingDirectionPreviousSnapshotRelease,
    memberRelease: "nfl_v1_member_release_2026_09_21_r18_opening_market_direction",
    decisionRelease: "nfl_v1_daily_edge_decision_2026_09_21_r21_opening_market_direction",
    fixtureRelease: openingDirectionPreviousFixtureRelease,
    fixture: {
      ...fixture,
      heldMemberFixtureRelease: openingDirectionPreviousFixtureRelease,
    },
  };
  storedKey = [
    "nfl",
    "daily-edge",
    2026,
    1,
    openingDirectionPreviousSnapshotRelease,
    openingDirectionPreviousFixtureRelease,
    openingDirectionPreviousPayload.memberRelease,
    openingDirectionPreviousPayload.decisionRelease,
  ].join("::");
  storedPayload = openingDirectionPreviousPayload;
  const openingDirectionContinuityRead = await readNflForwardMemberSnapshot({
    client,
    season: 2026,
    week: 1,
    now: "2026-08-27T12:02:00.000Z",
  });
  assert.equal(openingDirectionContinuityRead?.snapshotRelease, openingDirectionPreviousSnapshotRelease);
  assert.equal(openingDirectionContinuityRead?.fixtureRelease, openingDirectionPreviousFixtureRelease);

  const lockedTransitionPreviousSnapshotRelease = "nfl_forward_member_snapshot_2026_09_20_r16_locked_transition";
  const lockedTransitionPreviousFixtureRelease = "nfl_weekly_member_fixture_2026_09_20_r24_locked_transition";
  const lockedTransitionPreviousPayload = {
    ...snapshot,
    snapshotRelease: lockedTransitionPreviousSnapshotRelease,
    memberRelease: "nfl_v1_member_release_2026_09_20_r17_ml_total_coherence",
    decisionRelease: "nfl_v1_daily_edge_decision_2026_09_20_r20_ml_total_coherence",
    fixtureRelease: lockedTransitionPreviousFixtureRelease,
    fixture: {
      ...fixture,
      heldMemberFixtureRelease: lockedTransitionPreviousFixtureRelease,
    },
  };
  storedKey = [
    "nfl",
    "daily-edge",
    2026,
    1,
    lockedTransitionPreviousSnapshotRelease,
    lockedTransitionPreviousFixtureRelease,
    lockedTransitionPreviousPayload.memberRelease,
    lockedTransitionPreviousPayload.decisionRelease,
  ].join("::");
  storedPayload = lockedTransitionPreviousPayload;
  const lockedTransitionContinuityRead = await readNflForwardMemberSnapshot({
    client,
    season: 2026,
    week: 1,
    now: "2026-08-27T12:02:00.000Z",
  });
  assert.equal(lockedTransitionContinuityRead?.snapshotRelease, lockedTransitionPreviousSnapshotRelease);
  assert.equal(lockedTransitionContinuityRead?.fixtureRelease, lockedTransitionPreviousFixtureRelease);

  const mlTotalPreviousSnapshotRelease = "nfl_forward_member_snapshot_2026_09_20_r15_ml_total_coherence";
  const mlTotalPreviousFixtureRelease = "nfl_weekly_member_fixture_2026_09_20_r23_ml_total_coherence";
  const mlTotalPreviousPayload = {
    ...snapshot,
    snapshotRelease: mlTotalPreviousSnapshotRelease,
    memberRelease: "nfl_v1_member_release_2026_09_20_r17_ml_total_coherence",
    decisionRelease: "nfl_v1_daily_edge_decision_2026_09_20_r20_ml_total_coherence",
    fixtureRelease: mlTotalPreviousFixtureRelease,
    fixture: {
      ...fixture,
      heldMemberFixtureRelease: mlTotalPreviousFixtureRelease,
    },
  };
  storedKey = [
    "nfl",
    "daily-edge",
    2026,
    1,
    mlTotalPreviousSnapshotRelease,
    mlTotalPreviousFixtureRelease,
    mlTotalPreviousPayload.memberRelease,
    mlTotalPreviousPayload.decisionRelease,
  ].join("::");
  storedPayload = mlTotalPreviousPayload;
  const mlTotalContinuityRead = await readNflForwardMemberSnapshot({
    client,
    season: 2026,
    week: 1,
    now: "2026-08-27T12:02:00.000Z",
  });
  assert.equal(mlTotalContinuityRead?.snapshotRelease, mlTotalPreviousSnapshotRelease);
  assert.equal(mlTotalContinuityRead?.fixtureRelease, mlTotalPreviousFixtureRelease);

  const injuryPreviousSnapshotRelease = "nfl_forward_member_snapshot_2026_09_16_r14_injury_pagination";
  const injuryPreviousFixtureRelease = "nfl_weekly_member_fixture_2026_09_16_r22_injury_pagination";
  const injuryPreviousPayload = {
    ...snapshot,
    snapshotRelease: injuryPreviousSnapshotRelease,
    memberRelease: "nfl_v1_member_release_2026_09_16_r16_injury_pagination",
    decisionRelease: "nfl_v1_daily_edge_decision_2026_09_16_r19_injury_pagination",
    fixtureRelease: injuryPreviousFixtureRelease,
    fixture: {
      ...fixture,
      heldMemberFixtureRelease: injuryPreviousFixtureRelease,
    },
  };
  storedKey = [
    "nfl",
    "daily-edge",
    2026,
    1,
    injuryPreviousSnapshotRelease,
    injuryPreviousFixtureRelease,
    injuryPreviousPayload.memberRelease,
    injuryPreviousPayload.decisionRelease,
  ].join("::");
  storedPayload = injuryPreviousPayload;
  const injuryContinuityRead = await readNflForwardMemberSnapshot({
    client,
    season: 2026,
    week: 1,
    now: "2026-08-27T12:02:00.000Z",
  });
  assert.equal(injuryContinuityRead?.snapshotRelease, injuryPreviousSnapshotRelease);
  assert.equal(injuryContinuityRead?.fixtureRelease, injuryPreviousFixtureRelease);

  const onePointPreviousSnapshotRelease = "nfl_forward_member_snapshot_2026_09_15_r12_one_point_pmf_boundary";
  const onePointPreviousFixtureRelease = "nfl_weekly_member_fixture_2026_09_15_r20_one_point_pmf_boundary";
  const onePointPreviousPayload = {
    ...snapshot,
    snapshotRelease: onePointPreviousSnapshotRelease,
    memberRelease: "nfl_v1_member_release_2026_09_15_r14_one_point_pmf_boundary",
    decisionRelease: "nfl_v1_daily_edge_decision_2026_09_15_r17_one_point_pmf_boundary",
    fixtureRelease: onePointPreviousFixtureRelease,
    fixture: {
      ...fixture,
      heldMemberFixtureRelease: onePointPreviousFixtureRelease,
    },
  };
  storedKey = [
    "nfl",
    "daily-edge",
    2026,
    1,
    onePointPreviousSnapshotRelease,
    onePointPreviousFixtureRelease,
    onePointPreviousPayload.memberRelease,
    onePointPreviousPayload.decisionRelease,
  ].join("::");
  storedPayload = onePointPreviousPayload;
  const onePointContinuityRead = await readNflForwardMemberSnapshot({
    client,
    season: 2026,
    week: 1,
    now: "2026-08-27T12:02:00.000Z",
  });
  assert.equal(onePointContinuityRead?.snapshotRelease, onePointPreviousSnapshotRelease);
  assert.equal(onePointContinuityRead?.fixtureRelease, onePointPreviousFixtureRelease);

  const previousSnapshotRelease = "nfl_forward_member_snapshot_2026_09_14_r10_prediction_owned_side";
  const previousFixtureRelease = "nfl_weekly_member_fixture_2026_09_14_r18_prediction_owned_side";
  const previousPayload = {
    ...snapshot,
    snapshotRelease: previousSnapshotRelease,
    memberRelease: "nfl_v1_member_release_2026_09_14_r13_prediction_owned_side",
    decisionRelease: "nfl_v1_daily_edge_decision_2026_09_14_r16_prediction_owned_side",
    fixtureRelease: previousFixtureRelease,
    fixture: {
      ...fixture,
      heldMemberFixtureRelease: previousFixtureRelease,
    },
  };
  storedKey = [
    "nfl",
    "daily-edge",
    2026,
    1,
    previousSnapshotRelease,
    previousFixtureRelease,
    previousPayload.memberRelease,
    previousPayload.decisionRelease,
  ].join("::");
  storedPayload = previousPayload;
  const continuityRead = await readNflForwardMemberSnapshot({
    client,
    season: 2026,
    week: 1,
    now: "2026-08-27T12:02:00.000Z",
  });
  assert.equal(continuityRead?.snapshotRelease, previousSnapshotRelease);
  assert.equal(continuityRead?.fixtureRelease, previousFixtureRelease);
  assert.equal(continuityRead?.fixture.heldMemberFixtureRelease, previousFixtureRelease);

  storedKey = nflForwardMemberSnapshotKey({ season: 2026, week: 1 });
  storedPayload = { ...snapshot, decisionRelease: "wrong-release" };
  assert.equal(await readNflForwardMemberSnapshot({ client, season: 2026, week: 1 }), null);

  console.log("NFL compact member snapshot release key, validation, indexed write/read, and fixture parity passed.");
}

void main();
