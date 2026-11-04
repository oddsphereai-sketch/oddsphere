import assert from "node:assert/strict";
import { CbbBallDontLieClient } from "../lib/cbb/ballDontLie";
import { assertCbbFixtureRefreshSafe, cbbLockedTerminalScore, cbbCanonicalGamePayload,
  cbbCanonicalStatus, cbbCanonicalTeamPayload } from "../lib/cbb/canonicalFixture";
import { cbbFixtureSeedDates, selectCbbSlateGames } from "../lib/services/cbb/seedCbbGamesService";
import type { CbbGame, CbbTeam } from "../lib/cbb/types";
import { readCbbSettlementFixtureCatchupDates } from "../lib/services/cbb/cbbSettlementFixtureCatchup";
import type { SupabaseClient } from "@supabase/supabase-js";

const home: CbbTeam = { id: 92, conference_id: 7, name: "Wildcats",
  full_name: "Villanova Wildcats", college: "Villanova", abbreviation: "VILL" };
const away: CbbTeam = { id: 11, conference_id: 1, name: "Fighting Irish",
  full_name: "Notre Dame Fighting Irish", college: "Notre Dame", abbreviation: "ND" };
const game: CbbGame = { id: 10882407, date: "2026-11-01T14:30:00.000Z", season: 2026,
  status: "pre", status_state: "scheduled", period: 0, home_team: home,
  visitor_team: away, home_score: 0, away_score: 0 };
const late: CbbGame = { ...game, id: 10882408, date: "2026-11-02T04:59:00.000Z" };
const nextDay: CbbGame = { ...game, id: 10882409, date: "2026-11-02T05:01:00.000Z" };

assert.deepEqual(selectCbbSlateGames([nextDay, late, game], "2026-11-01", 2026).map(row => row.id),
  [game.id, late.id]);
assert.deepEqual(cbbFixtureSeedDates("2026-10-29"),
  ["2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"]);
assert.throws(() => cbbFixtureSeedDates("2026-11-1"), /Invalid/);
assert.throws(() => selectCbbSlateGames([game, game], "2026-11-01", 2026), /Duplicate/);
assert.throws(() => selectCbbSlateGames([{ ...game, status_state: "unknown" }], "2026-11-01", 2026), /unknown/);
assert.throws(() => selectCbbSlateGames([{ ...game, season: 2025 }], "2026-11-01", 2026), /foreign season/);
assert.equal(cbbCanonicalStatus({ status: "pre" }), "STATUS_SCHEDULED");
assert.equal(cbbCanonicalStatus({ status: "post", status_state: "final" }), "STATUS_FINAL");
assert.throws(() => cbbCanonicalStatus({ status: "pre", status_state: "canceled-but-rescheduled" }), /Unsupported/);
assert.equal(cbbCanonicalTeamPayload(home).slug, "cbb-92");
assert.equal(cbbCanonicalGamePayload(late, 200, 300).slate_date, "2026-11-01");
assert.equal(cbbCanonicalGamePayload(game, 200, 300).home_score, null);
assert.throws(() => cbbCanonicalGamePayload({ ...game, status_state: "final", home_score: -1 }, 200, 300), /valid score/);
assert.equal(cbbCanonicalGamePayload({ ...game, status_state: "in_progress", home_score: 18 }, 200, 300).home_score, 18);
const payload = cbbCanonicalGamePayload(game, 200, 300);
const previous = { id: 1, status: "STATUS_SCHEDULED", game_date: game.date,
  home_team_id: 200, away_team_id: 300 };
const lockedPrevious = { ...previous, external_id:game.id,season:2026,home_score:null,away_score:null };
const final = cbbCanonicalGamePayload({...game,date:"2026-11-01T15:00:00Z",status:"post",status_state:"final",period:2,home_score:84,away_score:76},200,300);
const beforeFinal=JSON.stringify(lockedPrevious);
assert.deepEqual(cbbLockedTerminalScore(lockedPrevious,final),{status:"STATUS_FINAL",home_score:84,away_score:76,period:2});
assert.deepEqual(cbbLockedTerminalScore(lockedPrevious,{...final,home_team_id:300,away_team_id:200}),{status:"STATUS_FINAL",home_score:76,away_score:84,period:2},"scores follow original exact team IDs when provider home/away labels reverse");
assert.equal(JSON.stringify(lockedPrevious),beforeFinal,"terminal score mapping cannot mutate the locked fixture identity");
for(const candidate of [
  {...final,external_id:999}, {...final,season:2025}, {...final,away_team_id:999},
  {...final,game_date:"invalid"}, {...final,game_date:"2026-11-03T15:00:00Z"},
  {...final,status:"STATUS_IN_PROGRESS" as const}, {...final,home_score:-1},
  {...final,home_score:76},
])assert.equal(cbbLockedTerminalScore(lockedPrevious,candidate),null,"wrong event/season/teams/time, nonfinal, malformed or tied results stay held");
assert.equal(cbbLockedTerminalScore({...lockedPrevious,status:"STATUS_CANCELED"},final),null,"a canceled wager is never silently restored");
assert.equal(cbbLockedTerminalScore({...lockedPrevious,status:"STATUS_FINAL",home_score:80,away_score:75},final),null,"an existing final result cannot be revised by the continuity path");
assert.doesNotThrow(() => assertCbbFixtureRefreshSafe(previous, payload, true));
assert.throws(() => assertCbbFixtureRefreshSafe(previous, { ...payload, game_date: nextDay.date }, true), /locked identity/);
assert.throws(() => assertCbbFixtureRefreshSafe({ ...previous, status: "STATUS_FINAL" }, payload, false), /regress from final/);

async function testDateBoundedProvider(): Promise<void> {
  const urls: URL[] = [];
  const client = new CbbBallDontLieClient("test-key", { delayMs: 0, fetch: async input => {
    urls.push(new URL(String(input)));
    return new Response(JSON.stringify({ data: [game], meta: { next_cursor: null } }), { status: 200 });
  } });
  assert.deepEqual(await client.gamesForDates(["2026-10-31", "2026-11-01", "2026-11-02"], 2026), [game]);
  assert.deepEqual(urls[0].searchParams.getAll("dates[]"), ["2026-10-31", "2026-11-01", "2026-11-02"]);
  assert.deepEqual(urls[0].searchParams.getAll("seasons[]"), ["2026"]);
  assert.throws(() => client.gamesForDates(["2026-11-01", "2026-11-01"], 2026), /distinct/);
  const filters:unknown[]=[];
  const pendingDays=["2026-10-29","2026-10-29","2026-10-30","2026-10-31","2026-11-01"];
  const db={from:(table:string)=>{assert.equal(table,"prediction_records");return{select:()=>{const q={
    eq:(...args:unknown[])=>{filters.push(args);return q;},not:(...args:unknown[])=>{filters.push(args);return q;},
    gte:(...args:unknown[])=>{filters.push(args);return q;},lt:(...args:unknown[])=>{filters.push(args);return q;},order:()=>q,
    limit:async(size:number)=>{assert.equal(size,1000);return{error:null,data:pendingDays.map(day=>({slate_date:day,games:{status:"STATUS_SCHEDULED"}}))};},
  };return q;}};}}as unknown as SupabaseClient;
  assert.deepEqual(await readCbbSettlementFixtureCatchupDates(db,"2026-11-04"),["2026-10-29","2026-10-30","2026-10-31"],"catch-up reuses at most three oldest distinct pending slate dates");
  assert.ok(filters.some(row=>JSON.stringify(row)===JSON.stringify(["locked_at","is",null])));
  assert.ok(filters.some(row=>JSON.stringify(row)===JSON.stringify(["prediction_grades.result","pending"])));
  assert.ok(filters.some(row=>JSON.stringify(row)===JSON.stringify(["slate_date","2026-10-29"])));
  assert.ok(filters.some(row=>JSON.stringify(row)===JSON.stringify(["slate_date","2026-11-03"])));
  console.log("CBB canonical fixture tests passed");
}
testDateBoundedProvider().catch(error => { console.error(error); process.exitCode = 1; });
