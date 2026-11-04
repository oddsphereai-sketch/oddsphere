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
const fetchImpl = async () => new Response(JSON.stringify({
  data: [{
    player: { id: 7 }, game: { status_state: "final" }, receptions: 4, passing_yards: 250,
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
      return fetchImpl();
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
  console.log("NFL player-props exact-market settlement and push semantics passed.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
