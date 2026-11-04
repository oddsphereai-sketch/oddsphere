import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE, type NflForwardStoredEvidence } from "../lib/services/football/nflForwardEvidence";
import { buildNflForwardMemberSnapshot, nflForwardMemberSnapshotKey, readNflForwardMemberSnapshot } from "../lib/services/football/nflForwardMemberSnapshotStore";
import { buildNflWeekOneHeldMemberFixture, NFL_WEEK_ONE_HELD_MEMBER_FIXTURE_RELEASE, type NflWeekOneHeldMemberFixture } from "../lib/services/football/nflWeekOneHeldMemberFixture";
import { NFL_V1_ACTIONABLE_GRADE_MEMBER_RELEASE, NFL_V1_ACTIONABLE_GRADE_DECISION_RELEASE } from "../lib/services/football/nflV1ActionableGradeCandidate";

const at = "2026-11-04T12:00:00.000Z";
const fixture = { heldMemberFixtureRelease: NFL_WEEK_ONE_HELD_MEMBER_FIXTURE_RELEASE, capturedAt: at, sport: "nfl",
  snapshot: { sport: "nfl", date: "2026-11-04", games: [{ id: "nfl-123", external_id: 123, lockState: "locked", lockedAt: at,
    projected: { home: 23.123456, away: 24.987654 }, markets: { moneyline: { pick: "AWAY ML", modelProb: .51234567, priceAmerican: 123,
      verdict: { label: "Best Angle" }, evidence: { retainedLegacyBytes: ["never reinterpret", 0, null] } }, total: {}, first_inning: {} } }] },
  week: { week: 9 }, provenance: { sourceChecksum: "a".repeat(64) } } as unknown as NflWeekOneHeldMemberFixture;
const current = buildNflForwardMemberSnapshot({ fixture, season: 2026, week: 9, publishedAt: at });
const predecessors = [
  { snapshot: "nfl_forward_member_snapshot_2026_11_04_r64_unchanged_ml_confirmation", fixture: "nfl_weekly_member_fixture_2026_11_04_r72_unchanged_ml_confirmation",
    member: "nfl_v1_member_release_2026_11_04_r56_unchanged_ml_confirmation", decision: "nfl_v1_daily_edge_decision_2026_11_04_r59_unchanged_ml_confirmation" },
  { snapshot: "nfl_forward_member_snapshot_2026_11_02_r63_published_rounding_pressure", fixture: "nfl_weekly_member_fixture_2026_11_02_r71_published_rounding_pressure",
    member: "nfl_v1_member_release_2026_11_02_r55_published_rounding_pressure", decision: "nfl_v1_daily_edge_decision_2026_11_02_r58_published_rounding_pressure" },
] as const;
const entries = new Map<string, unknown>();
const client = { from: () => ({ select: () => ({ eq: (_column: string, key: string) => ({ maybeSingle: async () => ({
  data: entries.has(key) ? { payload: entries.get(key), generated_at: at, expires_at: at, stale_until: at } : null, error: null,
}) }) }) }) } as unknown as SupabaseClient;

async function main() {
  for (const old of predecessors) {
    const payload = { ...structuredClone(current), snapshotRelease: old.snapshot, fixtureRelease: old.fixture, memberRelease: old.member,
      decisionRelease: old.decision, fixture: { ...structuredClone(fixture), heldMemberFixtureRelease: old.fixture } };
    const key = ["nfl", "daily-edge", 2026, 9, old.snapshot, old.fixture, old.member, old.decision].join("::");
    entries.clear(); entries.set(key, payload);
    const bytes = JSON.stringify(payload);
    assert.deepEqual(await readNflForwardMemberSnapshot({ client, season: 2026, week: 9, now: at }), payload,
      "each exact predecessor key returns the opaque stored locked DTO unchanged");
    assert.equal(JSON.stringify(payload), bytes);
    for (const field of ["memberRelease", "decisionRelease", "fixtureRelease"] as const) {
      entries.set(key, { ...payload, [field]: current[field] });
      assert.equal(await readNflForwardMemberSnapshot({ client, season: 2026, week: 9, now: at }), null,
        "mixed current/predecessor release tuples cannot masquerade as the exact predecessor");
    }
    entries.set(key, payload);
    entries.set(nflForwardMemberSnapshotKey({ season: 2026, week: 9 }), current);
    assert.deepEqual(await readNflForwardMemberSnapshot({ client, season: 2026, week: 9, now: at }), current,
      "the actual current snapshot keeps precedence when already published");
    assert.equal(JSON.stringify(payload), bytes);

    const row = (id: string, member: string, decision: string) => ({ id, providerGameId: id, stage: "unlocked", capturedAt: at,
      gameStartAt: "2026-11-08T18:00:00.000Z", payloadSha256: "b".repeat(64), payload: {
        schemaRelease: NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE, season: 2026, week: 9, slateGameCount: 2, stage: "unlocked", capturedAt: at,
        game: { providerGameId: id, scheduledStart: "2026-11-08T18:00:00.000Z" },
        decisions: { publicationEnabled: true, modelPromotionStatus: member, evaluatedBets: [{ decisionRelease: decision }] },
      } }) as unknown as NflForwardStoredEvidence;
    const rows = [row("current", NFL_V1_ACTIONABLE_GRADE_MEMBER_RELEASE, NFL_V1_ACTIONABLE_GRADE_DECISION_RELEASE), row("old", old.member, old.decision)];
    const rowBytes = JSON.stringify(rows);
    assert.throws(() => buildNflWeekOneHeldMemberFixture(rows), /coverage is 1\/2 games/,
      "an exact predecessor unlocked row must not join the current fixture");
    assert.equal(JSON.stringify(rows), rowBytes);
  }
  console.log("PASS NFL PMF release continuity: exact R64/R72/R56/R59 and retained R63/R71/R55/R58 keys, byte-exact locked DTOs, mixed tuple and unlocked fixture rejection.");
}
void main();
