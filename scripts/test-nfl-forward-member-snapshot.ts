import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  auditNflForwardMemberSnapshot,
  buildNflForwardMemberSnapshot,
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
