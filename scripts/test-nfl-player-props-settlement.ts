import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  NFL_PLAYER_PROPS_SETTLEMENT_MAX_GAMES_PER_CYCLE,
  NFL_PLAYER_PROPS_SETTLEMENT_MAX_RECORDS_PER_CYCLE,
  settleNflPlayerPropsRecords,
} from "../lib/services/football/nflPlayerPropsSettlement";

const pending = [
  { id: 1, provider_game_id: "game", provider_player_id: "7", market: "receptions", line: 4.5, side: "under", locked_at: "2026-09-01T11:00:00.000Z" },
  { id: 2, provider_game_id: "game", provider_player_id: "7", market: "passing_yards", line: 250, side: "over", locked_at: "2026-09-01T11:00:00.000Z" },
  { id: 3, provider_game_id: "game", provider_player_id: "7", market: "anytime_td", line: 0.5, side: "yes", locked_at: "2026-09-01T11:00:00.000Z" },
] as const;
const updates: Array<{ values: Record<string, unknown>; id: number | null }> = [];
let settlementCutoff: string | null = null;
function clientFor(
  rows: ReadonlyArray<(typeof pending)[number] | { id: number; provider_game_id: string; provider_player_id: string | null; market: string; line: number; side: "under"; locked_at: string }>,
  recordedUpdates: Array<{ values: Record<string, unknown>; id: number | null }>,
  onCutoff?: (value: string) => void,
): SupabaseClient {
  return {
    from(table: string) {
      assert.equal(table, "nfl_player_prop_records");
      return {
        select() {
          let cutoff = "";
          let requireIdentity = false;
          let approvedIds: Set<number> | null = null;
          const query = {
            eq() { return query; },
            not(field: string, operator: string, value: unknown) { assert.deepEqual([field, operator, value], ["provider_player_id", "is", null]); requireIdentity = true; return query; },
            in(field: string, values: number[]) { assert.equal(field, "id"); approvedIds = new Set(values); return query; },
            lte(field: string, value: string) { assert.equal(field, "locked_at"); cutoff = value; onCutoff?.(value); return query; },
            order(field: string, options: { ascending: boolean }) { assert.equal(field, "locked_at"); assert.equal(options.ascending, true); return query; },
            async limit(value: number) {
              assert.equal(value, NFL_PLAYER_PROPS_SETTLEMENT_MAX_RECORDS_PER_CYCLE);
              return { data: rows.filter((row) => row.locked_at <= cutoff && (!requireIdentity || row.provider_player_id !== null)
                && (!approvedIds || approvedIds.has(row.id))).slice(0, value), error: null };
            },
          };
          return query;
        },
        update(values: Record<string, unknown>) {
          const record = { values, id: null as number | null }; recordedUpdates.push(record);
          return { eq(field: string, value: unknown) { if (field === "id") record.id = Number(value); return { async eq() { return { error: null }; } }; } };
        },
      };
    },
  } as unknown as SupabaseClient;
}
const client = clientFor(pending, updates, (value) => { settlementCutoff = value; });
const fetchImpl = async (request?: RequestInfo | URL) => new Response(JSON.stringify({
  data: [{
    player: { id: 7 }, game: { id: request ? new URL(String(request)).searchParams.get("game_ids[]") : "game", status_state: "final" }, receptions: 4, passing_yards: 250,
    rushing_touchdowns: 0, receiving_touchdowns: 1, kick_return_touchdowns: 0, punt_return_touchdowns: 0, fumbles_touchdowns: 0,
  }],
  meta: {},
}), { status: 200, headers: { "content-type": "application/json" } });

async function main(): Promise<void> {
  const result = await settleNflPlayerPropsRecords({ client, apiKey: "test", now: "2026-09-01T17:00:00.000Z", fetchImpl });
  assert.deepEqual(result, {
    pending: 3, eligible: 3, eligibleGames: 1, processedGames: 1, deferredGames: 0,
    recordReadLimitReached: false, settled: 3, apiCalls: 1,
  });
  assert.equal(settlementCutoff, "2026-09-01T12:00:00.000Z");
  assert.deepEqual(updates.map((row) => [row.id, row.values.result, row.values.actual_value]), [
    [1, "win", 4], [2, "push", 250], [3, "win", 1],
  ]);
  let prematureCalls = 0;
  const premature = await settleNflPlayerPropsRecords({
    client,
    apiKey: "test",
    now: "2026-09-01T15:00:00.000Z",
    fetchImpl: async () => { prematureCalls += 1; return fetchImpl(); },
  });
  assert.deepEqual(premature, {
    pending: 0, eligible: 0, eligibleGames: 0, processedGames: 0, deferredGames: 0,
    recordReadLimitReached: false, settled: 0, apiCalls: 0,
  });
  assert.equal(prematureCalls, 0, "pregame/active locked props do not trigger settlement provider calls");

  const backlog = Array.from({ length: NFL_PLAYER_PROPS_SETTLEMENT_MAX_GAMES_PER_CYCLE + 2 }, (_, index) => ({
    id: 100 + index,
    provider_game_id: `game-${String(index).padStart(2, "0")}`,
    provider_player_id: "7",
    market: "receptions",
    line: 4.5,
    side: "under" as const,
    locked_at: new Date(Date.parse("2026-09-01T01:00:00.000Z") + index * 60_000).toISOString(),
  }));
  const backlogUpdates: Array<{ values: Record<string, unknown>; id: number | null }> = [];
  const requestedGames: string[] = [];
  const bounded = await settleNflPlayerPropsRecords({
    client: clientFor(backlog, backlogUpdates),
    apiKey: "test",
    now: "2026-09-02T17:00:00.000Z",
    fetchImpl: async (request) => {
      const gameId = new URL(String(request)).searchParams.get("game_ids[]")!;
      requestedGames.push(gameId);
      return fetchImpl(request);
    },
  });
  assert.equal(bounded.eligibleGames, backlog.length);
  assert.equal(bounded.processedGames, NFL_PLAYER_PROPS_SETTLEMENT_MAX_GAMES_PER_CYCLE);
  assert.equal(bounded.deferredGames, 2);
  assert.equal(bounded.apiCalls, NFL_PLAYER_PROPS_SETTLEMENT_MAX_GAMES_PER_CYCLE);
  assert.deepEqual(requestedGames, backlog.slice(0, NFL_PLAYER_PROPS_SETTLEMENT_MAX_GAMES_PER_CYCLE).map((row) => row.provider_game_id));
  const blockedRows = Array.from({ length: 1_100 }, (_, index) => ({
    ...backlog[0]!, id: 10_000 + index, provider_game_id: `unresolved-${index}`, provider_player_id: null,
  }));
  const recoverableUpdates: Array<{ values: Record<string, unknown>; id: number | null }> = [];
  const recoverable = await settleNflPlayerPropsRecords({
    client: clientFor([...blockedRows, ...pending], recoverableUpdates), apiKey: "test",
    now: "2026-09-02T17:00:00.000Z", fetchImpl,
  });
  assert.equal(recoverable.apiCalls, 1, "unresolved games cannot consume the bounded provider budget");
  assert.equal(recoverable.settled, 3, "more than one page of null identities cannot starve valid records");
  assert.ok(recoverableUpdates.every(update => update.id !== null && update.id < 10_000), "legacy unresolved identities remain untouched");
  const historical = { ...backlog[0]!, id: 671, provider_game_id: "game", provider_player_id: null,
    player_name: "Amon-Ra St. Brown", team: "DET" };
  const historicalBefore = JSON.stringify(historical);
  const historicalUpdates: Array<{ values: Record<string, unknown>; id: number | null }> = [];
  const proposals: unknown[] = [];
  const official = { player: { id: 7, first_name: "Amon Ra", last_name: "St Brown" },
    team: { abbreviation: "DET" }, game: { id: "game", status_state: "final" }, receptions: 4 };
  const recovery = (stats: unknown[], apply = false) => settleNflPlayerPropsRecords({
    client: clientFor([historical], historicalUpdates), apiKey: "test", now: "2026-09-02T17:00:00Z",
    recoverMissingIdentityRecordIds: [671], apply, onProposal: proposal => proposals.push(proposal),
    fetchImpl: async () => new Response(JSON.stringify({ data: stats, meta: {} }), { status: 200 }),
  });
  const preview = await recovery([official]);
  assert.equal(preview.settled, 0);
  assert.equal(historicalUpdates.length, 0, "the review audit cannot write any result");
  assert.deepEqual(proposals, [{ id: 671, gameId: "game", resolvedPlayerId: "7", actual: 4, result: "win" }]);
  for (const stats of [
    [official, { ...official, player: { ...official.player, id: 8 } }],
    [{ ...official, team: { abbreviation: "GB" } }],
    [{ ...official, game: { id: "other", status_state: "final" } }],
    [{ ...official, game: { id: "game", status_state: "in_progress" } }],
  ]) { proposals.length = 0; await recovery(stats); assert.equal(proposals.length, 0, "ambiguous/wrong-team/wrong-game/nonfinal recovery is rejected"); }
  await recovery([official], true);
  assert.deepEqual(Object.keys(historicalUpdates[0]!.values).sort(), ["actual_value", "result", "settled_at", "updated_at"],
    "approved recovery can only fill outcomes; original identity, snapshot, line, price and model fields remain immutable");
  assert.equal(JSON.stringify(historical), historicalBefore);

  // A conventional suffix is accepted only within a unique exact game/team.
  const suffixHistorical = { ...historical, player_name: "Aaron Jones" };
  const suffixStats = { ...official, player: { id: 7, first_name: "Aaron", last_name: "Jones Sr." } };
  const suffixProposals: unknown[] = [];
  const suffixRun = (stats: unknown[]) => settleNflPlayerPropsRecords({
    client: clientFor([suffixHistorical], []), apiKey: "test", now: "2026-09-02T17:00:00Z", recoverMissingIdentityRecordIds: [671], apply: false,
    onProposal: proposal => suffixProposals.push(proposal), fetchImpl: async () => new Response(JSON.stringify({ data: stats }), { status: 200 }),
  });
  await suffixRun([suffixStats]);
  assert.equal(suffixProposals.length, 1);
  suffixProposals.length = 0;
  await suffixRun([suffixStats, { ...suffixStats, player: { id: 8, first_name: "Aaron", last_name: "Jones Jr." } }]);
  assert.equal(suffixProposals.length, 0, "suffix collisions fail closed");

  const zeroRow = { ...historical, provider_player_id: "7", player_name: "Eric Saubert", market: "receiving_yards" };
  const zeroStat = { ...official, player: { id: 9 }, receptions: 2 };
  const snap = { ...official, player: { id: 7, first_name: "Eric", last_name: "Saubert" }, offense_snaps: 15, defense_snaps: 0, special_teams_snaps: 16 };
  const zeroUpdates: typeof updates = [];
  const zeroRun = (snapRows: unknown[], options?: { missingId?: boolean; stats?: unknown[]; nextCursor?: number; status?: number }) => settleNflPlayerPropsRecords({
    client: clientFor([{ ...zeroRow, provider_player_id: options?.missingId ? null : "7" }], zeroUpdates), apiKey: "test", now: "2026-09-02T17:00:00Z",
    recoverMissingIdentityRecordIds: options?.missingId ? [671] : undefined,
    fetchImpl: async request => new Response(JSON.stringify(new URL(String(request)).pathname.endsWith("snap_counts")
      ? { data: snapRows, meta: { next_cursor: options?.nextCursor } } : { data: options?.stats ?? [zeroStat] }), { status: options?.status ?? 200 }),
  });
  const zero = await zeroRun([snap]);
  assert.equal(zero.settled, 1); assert.equal(zero.apiCalls, 2);
  assert.deepEqual([zeroUpdates[0]!.values.actual_value, zeroUpdates[0]!.values.result], [0, "win"]);
  assert.deepEqual(Object.keys(zeroUpdates[0]!.values).sort(), ["actual_value", "result", "settled_at", "updated_at"]);
  zeroUpdates.length = 0;
  assert.equal((await zeroRun([snap], { missingId: true })).settled, 1, "owner-only missing identity recovery can use exact-game participation evidence");
  for (const invalid of [[], [{ ...snap, offense_snaps: 0, special_teams_snaps: 0 }], [{ ...snap, offense_snaps: null }],
    [{ ...snap, game: { id: "other", status_state: "final" } }], [{ ...snap, team: { abbreviation: "GB" } }],
    [{ ...snap, game: { id: "game", status_state: "in_progress" } }]]) {
    zeroUpdates.length = 0;
    assert.equal((await zeroRun(invalid)).settled, 0, "absent, invalid, wrong-game/team, or nonfinal participation cannot invent zero");
    assert.equal(zeroUpdates.length, 0);
  }
  assert.equal((await zeroRun([{ ...snap, offense_snaps: 0, special_teams_snaps: 7 }])).settled, 1, "positive special teams participation is participation, not DNP");
  zeroUpdates.length = 0;
  await assert.rejects(zeroRun([snap], { nextCursor: 1 }), /Duplicate|page bound/);
  assert.equal(zeroUpdates.length, 0, "an incomplete participation response cannot write outcomes");
  assert.equal((await zeroRun([snap], { stats: [] })).settled, 0, "an empty stats feed cannot be interpreted as a final zero-stat game");
  assert.equal((await zeroRun([snap], { stats: [{ ...zeroStat, game: { id: "wrong", status_state: "final" } }] })).settled, 0, "a foreign final game cannot authorize settlement");
  console.log("NFL player-props exact-market settlement and push semantics passed.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
