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
assert.equal(audit.metrics.maximumSourceAgeMinutes, 390, "far-window evidence follows the six-hour cadence");
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
assert.equal(pastAndFarFutureAudit.metrics.maximumSourceAgeMinutes, 390,
  "completed games cannot force far-window upcoming evidence onto the near-kickoff cadence");
assert.equal(pastAndFarFutureAudit.healthy, true);
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
  assert.equal(mlTotalContinuityRead?.snapshotRelease, NFL_FORWARD_MEMBER_SNAPSHOT_RELEASE);
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
  assert.equal(injuryContinuityRead?.snapshotRelease, NFL_FORWARD_MEMBER_SNAPSHOT_RELEASE);
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
  assert.equal(onePointContinuityRead?.snapshotRelease, NFL_FORWARD_MEMBER_SNAPSHOT_RELEASE);
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
  assert.equal(continuityRead?.snapshotRelease, NFL_FORWARD_MEMBER_SNAPSHOT_RELEASE);
  assert.equal(continuityRead?.fixtureRelease, previousFixtureRelease);
  assert.equal(continuityRead?.fixture.heldMemberFixtureRelease, previousFixtureRelease);

  storedKey = nflForwardMemberSnapshotKey({ season: 2026, week: 1 });
  storedPayload = { ...snapshot, decisionRelease: "wrong-release" };
  assert.equal(await readNflForwardMemberSnapshot({ client, season: 2026, week: 1 }), null);

  console.log("NFL compact member snapshot release key, validation, indexed write/read, and fixture parity passed.");
}

void main();
