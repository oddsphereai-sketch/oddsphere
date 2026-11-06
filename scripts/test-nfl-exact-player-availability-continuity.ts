import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { mergeNflAvailabilityWithPrior, __BALLDONTLIE_NFL_AVAILABILITY_TEST__ } from "../lib/services/football/balldontlieNflAvailability";
import { resolveNflAvailabilityAdjustedQuarterbackDepth } from "../lib/services/football/nflR6MoneylineShadow";
import type { NflForwardEvidencePayload, NflForwardTeamDepthSnapshot } from "../lib/services/football/nflForwardEvidence";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readNflForwardMemberSnapshot } from "../lib/services/football/nflForwardMemberSnapshotStore";

type Fixture = { provider_game_id: string; payload: NflForwardEvidencePayload };
const load = (name: string): Fixture[] => JSON.parse(gunzipSync(readFileSync(`scripts/fixtures/${name}.json.gz`)).toString());
const original = load("nfl-qb-regime-jax-bal-20261105")[1]!.payload;
assert.ok(original.injuries && original.providerStartersAndDepth);
const originalBytes = JSON.stringify(original);
const update = structuredClone(original.injuries);
update.teams = update.teams.map(team => ({ ...team,
  players: team.players.filter(player => player.name !== "Tyler Huntley") }));
assert.ok(update.teams.find(team => team.abbreviation === "BAL")!.players.length > 0);
const retained = mergeNflAvailabilityWithPrior(update, original.injuries)!;
assert.equal(resolveNflAvailabilityAdjustedQuarterbackDepth(original.providerStartersAndDepth.home, update)
  .expectedStartingQuarterback?.name, "Tyler Huntley", "control: omission alone reproduces the false return");
assert.equal(resolveNflAvailabilityAdjustedQuarterbackDepth(original.providerStartersAndDepth.home, retained)
  .expectedStartingQuarterback?.name, "Joe Fagnano", "a non-empty partial report must preserve the unavailable starter");
assert.equal(retained.teams.find(team => team.abbreviation === "BAL")!.players
  .find(player => player.name === "Tyler Huntley")!.reportedAt, "2026-11-05T23:30:37.604Z",
"retention must not refresh the original player source clock");
const returned = mergeNflAvailabilityWithPrior({ ...update, playerClearances: [{ teamAbbreviation: "BAL",
  name: "Tyler Huntley", reportedAt: "2026-11-05T23:31:37.604Z" }] }, retained)!;
assert.equal(resolveNflAvailabilityAdjustedQuarterbackDepth(original.providerStartersAndDepth.home, returned)
  .expectedStartingQuarterback?.name, "Tyler Huntley", "a positive newer clearance permits a genuine return");
const staleOutDepth = structuredClone(original.providerStartersAndDepth.home);
staleOutDepth.expectedStartingQuarterback!.injuryStatus = "Out";
assert.equal(resolveNflAvailabilityAdjustedQuarterbackDepth(staleOutDepth, returned)
  .expectedStartingQuarterback?.name, "Tyler Huntley", "newer exact-player clearance must supersede the stale provider depth Out tag");
assert.equal(resolveNflAvailabilityAdjustedQuarterbackDepth({ ...staleOutDepth, capturedAt: "2026-11-06T00:00:00Z" }, returned)
  .expectedStartingQuarterback?.name, "Joe Fagnano", "an older clearance cannot erase a genuinely newer depth Out tag");

const conflict = structuredClone(update);
const conflictTeam = conflict.teams.find(team => team.abbreviation === "BAL")!;
const unavailable = original.injuries.teams.find(team => team.abbreviation === "BAL")!.players.find(player => player.name === "Tyler Huntley")!;
const missingDesignation = structuredClone(update);
missingDesignation.teams.find(team => team.abbreviation === "BAL")!.players.push({ ...unavailable,
  status: "Status unavailable", detail: "Elbow", reportedAt: "2026-11-05T23:33:00Z" });
const knownStatusRetained = mergeNflAvailabilityWithPrior(missingDesignation, original.injuries)!;
assert.deepEqual(knownStatusRetained.teams.find(team => team.abbreviation === "BAL")!.players
  .find(player => player.name === "Tyler Huntley"), unavailable,
  "a new timestamp with missing designation cannot erase or redatetime the prior explicit Out report");
assert.equal(resolveNflAvailabilityAdjustedQuarterbackDepth(original.providerStartersAndDepth.home, knownStatusRetained)
  .expectedStartingQuarterback?.name, "Joe Fagnano");
const available = { ...unavailable, status: "Available" };
for (const rows of [[available, unavailable], [unavailable, available]]) {
  conflictTeam.players = rows;
  assert.deepEqual(mergeNflAvailabilityWithPrior(conflict, original.injuries), original.injuries,
    "conflicting same-clock statuses preserve the exact-game prior regardless of page order");
  assert.equal(mergeNflAvailabilityWithPrior(conflict, null), null,
    "without a prior, an ambiguous report is unavailable, not an arbitrary starter choice");
}
const nativeRow = (status: string, at: string) => ({ game_id: 1392337,
  team: { abbreviation: "BAL", full_name: "Baltimore Ravens" },
  player: { first_name: "Tyler", last_name: "Huntley", position: "QB" },
  game_status: status, updated_at: at });
const normalize = __BALLDONTLIE_NFL_AVAILABILITY_TEST__.normalizeNflDesignationGames;
const matchup = { id: "1392337", awayTeam: "JAX", homeTeam: "BAL" };
for (const rows of [[nativeRow("Out", unavailable.reportedAt!), nativeRow("Available", unavailable.reportedAt!)],
  [nativeRow("Available", unavailable.reportedAt!), nativeRow("Out", unavailable.reportedAt!)]]) {
  assert.equal(normalize(rows, [matchup]).length, 0, "newest native-clock conflicts allow the existing source fallback");
  assert.equal(normalize([...rows, nativeRow("Available", "2026-11-05T23:32:00Z")], [matchup])
    [0]!.teams[1]!.players[0]!.status, "Available", "older conflicts cannot poison a newer unique source designation");
}
assert.doesNotThrow(() => normalize([{ ...nativeRow("", unavailable.reportedAt!), practice_reports: [null] }], [matchup]),
  "one malformed practice row cannot crash the slate-level collector");
const nativeUnknown = { ...nativeRow("", "2026-11-05T23:33:00Z"), injury: "Toe" };
for (const rows of [[nativeRow("Out", unavailable.reportedAt!), nativeUnknown],
  [nativeUnknown, nativeRow("Out", unavailable.reportedAt!)]]) {
  const packet = normalize(rows, [matchup])[0]!;
  assert.equal(packet.teams[1]!.players[0]!.status, "Out",
    "a missing designation cannot erase an older known status present in the same source response");
  assert.equal(packet.teams[1]!.players[0]!.reportedAt, unavailable.reportedAt);
}
for (const players of [[{ ...unavailable, status: "Status unavailable", reportedAt: "2026-11-05T23:33:00Z" }, unavailable],
  [unavailable, { ...unavailable, status: "Status unavailable", reportedAt: "2026-11-05T23:33:00Z" }]]) {
  conflictTeam.players = players;
  const firstCapture = mergeNflAvailabilityWithPrior(conflict, null)!;
  assert.equal(firstCapture.teams.find(team => team.abbreviation === "BAL")!.players[0]!.status, "Out",
    "legacy normalized duplicate rows obey the same known-status rule without a prior snapshot");
}
assert.equal(JSON.stringify(original), originalBytes, "fault probes cannot mutate the original evidence or locked payload");

const latest = load("nfl-availability-current-20261106");
const earlier = load("nfl-qb-regime-current-20261106");
let retainedPlayers = 0;
let markets = 0;
let actionables = 0;
for (const row of latest) {
  const p = row.payload;
  const prior = earlier.find(old => old.provider_game_id === row.provider_game_id)?.payload.injuries ?? null;
  assert.ok(p.providerStartersAndDepth);
  const merged = mergeNflAvailabilityWithPrior(p.injuries, prior);
  assert.deepEqual(merged, p.injuries, `${row.provider_game_id}: frozen current availability input must remain exact`);
  for (const side of ["away", "home"] as const) {
    const depth: NflForwardTeamDepthSnapshot = p.providerStartersAndDepth[side];
    assert.deepEqual(resolveNflAvailabilityAdjustedQuarterbackDepth(depth, merged),
      resolveNflAvailabilityAdjustedQuarterbackDepth(depth, p.injuries), `${row.provider_game_id} ${side}: current starter inputs must remain exact`);
  }
  retainedPlayers += (merged?.teams.flatMap(team => team.players).length ?? 0)
    - (p.injuries?.teams.flatMap(team => team.players).length ?? 0);
  markets += p.decisions.evaluatedBets.length;
  actionables += p.decisions.evaluatedBets.filter(bet => bet.grade === "Lean" || bet.grade === "Best Angle").length;
}
assert.equal(latest.length, 14);
assert.equal(markets, 42);
assert.equal(actionables, 18);
async function verifyPredecessorReader(): Promise<void> {
  const old = JSON.parse(gunzipSync(readFileSync("scripts/fixtures/nfl-availability-predecessor-member-20261106.json.gz")).toString());
  const bytes = JSON.stringify(old);
  let key: string | null = null;
  const client = { from(table: string) {
    assert.equal(table, "lab_response_snapshots");
    return { select() { return { eq(column: string, value: string) {
      assert.equal(column, "snapshot_key");
      key = value;
      return { async maybeSingle() { return { error: null,
        data: key?.includes("nfl_forward_member_snapshot_2026_11_06_r71_quarterback_regime_continuity")
          ? { payload: old } : null }; } };
    } }; } };
  } } as unknown as SupabaseClient;
  const read = await readNflForwardMemberSnapshot({ client, season: 2026, week: 9, now: old.publishedAt });
  assert.deepEqual(read, old, "new R72 reader must give the original R71 payload exact precedence");
  assert.equal(JSON.stringify(old), bytes);
  console.log(JSON.stringify({ test: "exact-player availability continuity", games: latest.length,
    markets, actionables, retainedPlayers, changedStarterInputs: 0, productionWrites: 0,
    predecessorReaderExact: true,
    scope: "source/quarterback-input parity; this is not a market interpretation or accuracy certification" }));
}
void verifyPredecessorReader().catch(error => { console.error(error); process.exitCode = 1; });
