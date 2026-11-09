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
  rows: ReadonlyArray<{ id: number; provider_game_id: string; provider_player_id: string | null; market: string; line: number; side: "under" | "over" | "yes"; locked_at: string; result?:string }>,
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
          let expectedResult = "pending";
          const query = {
            eq(field:string,value:string) { assert.equal(field,"result");expectedResult=value;return query; },
            not(field: string, operator: string, value: unknown) { assert.deepEqual([field, operator, value], ["provider_player_id", "is", null]); requireIdentity = true; return query; },
            in(field: string, values: number[]) { assert.equal(field, "id"); approvedIds = new Set(values); return query; },
            lte(field: string, value: string) { assert.equal(field, "locked_at"); cutoff = value; onCutoff?.(value); return query; },
            order(field: string, options: { ascending: boolean }) { assert.equal(field, "locked_at"); assert.equal(options.ascending, true); return query; },
            async limit(value: number) {
              assert.equal(value, NFL_PLAYER_PROPS_SETTLEMENT_MAX_RECORDS_PER_CYCLE);
              return { data: rows.filter((row) => (row.result??"pending")===expectedResult && row.locked_at <= cutoff && (!requireIdentity || row.provider_player_id !== null)
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

  const qbRows = [
    { ...pending[0], id: 201, market: "passing_tds", line: 1.5 },
    { ...pending[0], id: 202, market: "interceptions", line: 0.5 },
    { ...pending[0], id: 203, market: "passing_tds", line: 2 },
    { ...pending[0], id: 204, market: "interceptions", line: 1.5 },
    { ...pending[0], id: 205, market: "anytime_td", side: "yes" as const, line: 0.5 },
  ];
  const qbBefore = JSON.stringify(qbRows);
  const qbRun = async (fields: Record<string, unknown>) => {
    const changes: typeof updates = [];
    let calls = 0;
    const result = await settleNflPlayerPropsRecords({client: clientFor(qbRows, changes), apiKey: "test", now: "2026-09-02T17:00:00Z",
      fetchImpl: async request => {calls++;assert.equal(new URL(String(request)).pathname,"/nfl/v1/stats");return new Response(JSON.stringify({data:[{
        player:{id:7},game:{id:"game",status_state:"final"},passing_touchdowns:2,passing_interceptions:1,
        rushing_touchdowns:0,receiving_touchdowns:0,interceptions:9,...fields,
      }],meta:{}}),{status:200});}});
    assert.equal(calls, 1, "new markets reuse the same bounded exact-game stats request");
    for(const update of changes)assert.deepEqual(Object.keys(update.values).sort(),["actual_value","result","settled_at","updated_at"],"settlement cannot change locked prediction, grade, price, evidence or identity");
    assert.equal(JSON.stringify(qbRows),qbBefore,"locked source rows remain exact");
    return {result,changes};
  };
  assert.deepEqual((await qbRun({})).changes.map(r=>[r.id,r.values.result,r.values.actual_value]),[
    [201,"loss",2],[202,"loss",1],[203,"push",2],[204,"win",1],[205,"loss",0],
  ],"passing TDs and thrown interceptions settle independently of anytime TDs and defensive interceptions");
  assert.deepEqual((await qbRun({passing_touchdowns:0,passing_interceptions:0})).changes.slice(0,4).map(r=>r.values.actual_value),[0,0,0,0],"explicit official zeros settle normally");
  assert.equal((await qbRun({passing_touchdowns:undefined,passing_tds:3})).changes[0]?.values.actual_value,3,"provider's normalized passing TD field is accepted");
  for(const invalid of [undefined,null,"1",-1,0.5,NaN,Infinity]){
    const {changes}=await qbRun({passing_touchdowns:invalid,passing_tds:undefined,passing_interceptions:invalid});
    assert.deepEqual(changes.map(r=>r.id),[205],"missing/invalid QB values stay pending without inventing zero");
  }
  const dnpGame={id:100,status_state:"final",season:2026,week:9,postseason:false,home_team:{id:17,abbreviation:"LAC"},visitor_team:{id:10,abbreviation:"HOU"}};
  const dnpRow={...pending[0],id:301,provider_game_id:"100",player_name:"Ladd McConkey",team:"LAC"};
  const dnp={game_id:100,season:2026,week:9,season_type:"regular",player:{id:7,first_name:"Ladd",last_name:"McConkey"},team:{id:17,abbreviation:"LAC"},active:true,starter:false,did_not_play:true};
  const dnpRun=async (declarations:unknown[],options:{stat?:boolean;snap?:boolean;nonfinal?:boolean;cursor?:boolean;apply?:boolean;legacy?:boolean;settled?:boolean}={})=>{
    const changes:typeof updates=[];const paths:string[]=[];const proposals:unknown[]=[];
    const row={...dnpRow,provider_player_id:options.legacy?null:dnpRow.provider_player_id,...(options.settled?{result:"win"}:{})};
    const result=await settleNflPlayerPropsRecords({client:clientFor([row],changes),apiKey:"test",now:"2026-11-09T13:00:00Z",apply:options.apply,
      ...(options.legacy?{recoverMissingIdentityRecordIds:[row.id]}:{}),onProposal:p=>proposals.push(p),fetchImpl:async request=>{
      const url=new URL(String(request));paths.push(url.pathname);let body:unknown;
      if(url.pathname.endsWith('/stats'))body={data:[{player:{id:options.stat?7:8},team:dnp.team,game:{...dnpGame,...(options.nonfinal?{status_state:'in_progress'}:{})},receptions:0}]};
      else if(url.pathname.endsWith('/snap_counts'))body={data:options.snap?[{player:dnp.player,team:dnp.team,game:dnpGame,offense_snaps:0,defense_snaps:0,special_teams_snaps:2}]:[]};
      else {assert.equal(url.pathname,'/nfl/v1/player_designations');assert.equal(url.searchParams.get('season'),'2026');assert.equal(url.searchParams.get('week'),'9');assert.equal(url.searchParams.get('season_types[]'),'2');assert.deepEqual(url.searchParams.getAll('team_ids[]'),['17']);body={data:declarations,meta:options.cursor?{next_cursor:1}:{}};}
      return Response.json(body);
    }});
    for(const change of changes)assert.deepEqual(Object.keys(change.values).sort(),['actual_value','result','settled_at','updated_at']);
    return{changes,paths,result,proposals,row};
  };
  const voided=await dnpRun([dnp]);assert.equal(voided.result.settled,1);assert.equal(voided.changes[0].values.result,'void');assert.equal(voided.changes[0].values.actual_value,null,'DNP is not a zero-stat Under win');assert.equal(voided.paths.length,3);
  for(const declarations of [[],[{...dnp,did_not_play:null}],[{...dnp,did_not_play:false}],[{...dnp,did_not_play:'true'}],[{...dnp,starter:true}],[{...dnp,game_id:101}],[{...dnp,season:2025}],[{...dnp,week:8}],[{...dnp,season_type:'postseason'}],[{...dnp,team:{id:10,abbreviation:'HOU'}}],[{...dnp,team:{id:99,abbreviation:'LAC'}}],[dnp,{...dnp,did_not_play:false}]]){
    assert.equal((await dnpRun(declarations)).changes.length,0,'unknown, conflicting or foreign participation cannot invent void/zero');
  }
  for(const options of [{stat:true},{snap:true}]){const played=await dnpRun([dnp],options);assert.equal(played.changes[0].values.result,'win');assert.equal(played.changes[0].values.actual_value,0);assert.ok(!played.paths.some(p=>p.endsWith('/player_designations')),'actual played evidence requires no extra DNP lookup');}
  assert.equal((await dnpRun([dnp],{nonfinal:true})).changes.length,0);
  assert.equal((await dnpRun([dnp],{settled:true})).paths.length,0,'already settled records are never reprocessed');
  const dry=await dnpRun([dnp],{apply:false,legacy:true});assert.equal(dry.changes.length,0);assert.deepEqual(dry.proposals,[{id:301,gameId:'100',resolvedPlayerId:'7',actual:null,result:'void'}]);assert.equal(dry.row.provider_player_id,null,'approved recovery never edits original identity');
  await assert.rejects(dnpRun([dnp],{cursor:true}),/page bound/);
  console.log("NFL player-props exact-market settlement and push semantics passed.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
