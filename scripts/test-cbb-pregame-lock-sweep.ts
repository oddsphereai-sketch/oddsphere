import assert from "node:assert/strict";
import { buildCbbProvisionalBoard } from "../lib/cbb/provisionalBoard";
import { CBB_SCORE_RESEARCH_RELEASE } from "../lib/cbb/scoreResearch";
import type { CbbForecast, CbbGame, CbbQuote } from "../lib/cbb/types";
import { writeCbbMemberGame, cbbMemberGameForReader, type CbbStoredMemberGame } from "../lib/services/cbb/cbbMemberGameStore";
import { sweepCbbPregameLocks, isCbbFixtureWithdrawnByPublishedCensus } from "../lib/services/cbb/cbbPregameLockSweep";

const start="2026-11-13T19:00:00Z",before="2026-11-13T17:00:00Z",due="2026-11-13T18:05:00Z";
const team=(id:number)=>({id,abbreviation:`T${id}`,full_name:`School ${id}`,name:`School ${id}`,college:null,conference_id:1});
const games=[1,2].map(id=>({id,date:start,season:2026,status:"pre",period:0,home_score:0,away_score:0,
  home_team:team(id*2),visitor_team:team(id*2+1)} satisfies CbbGame));
const fixtures=games.map(g=>({id:g.id,external_id:g.id,game_date:start,slate_date:"2026-11-13",home_team:{external_id:g.home_team.id,display_name:g.home_team.full_name,abbreviation:g.home_team.abbreviation},
  away_team:{external_id:g.visitor_team.id,display_name:g.visitor_team.full_name,abbreviation:g.visitor_team.abbreviation}}));
const stored=new Map<string,CbbStoredMemberGame>(),tracked:Array<Record<string,unknown>>=[];let writes=0;
let dbFailure=false,overflow=false;
let censusIds:unknown=[1,2],censusFailure=false;
const census={snapshot_key:"cbb::2026-11-13::current-only::live-copy",generated_at:"2026-11-13T17:30:00Z",gameIds:[1,2]};
const db={from:(table:string)=>{
  if(table==="lab_response_snapshots")return {select:(fields:string)=>{
    if(fields.includes("gameIds:")){const q={eq:()=>q,in:(_key:string,keys:string[])=>{assert.equal(keys.length,2);assert(keys.every(k=>/^cbb::2026-11-(12|13)::current-only::live-copy$/.test(k)));return q;},lte:()=>q,order:()=>q,limit:()=>q,maybeSingle:async()=>({data:censusFailure?null:{...census,gameIds:censusIds},error:censusFailure?{message:"census unavailable"}:null})};return q;}
    return ({in:async(_:string,keys:string[])=>({data:keys.filter(k=>stored.has(k)).map(k=>({snapshot_key:k,payload:stored.get(k)})),error:null}),
    eq:(_:string,key:string)=>({maybeSingle:async()=>({data:stored.has(key)?{payload:stored.get(key)}:null,error:null})})});},upsert:async(r:{snapshot_key:string;payload:CbbStoredMemberGame})=>{writes++;stored.set(r.snapshot_key,structuredClone(r.payload));return{error:null};}};
  const filters=new Map<string,unknown>();
  if(table==="games")return {select:()=>{
    const q={eq:(k:string,v:unknown)=>{filters.set(k,v);return q;},gt:()=>q,lte:()=>q,order:()=>q,
      limit:async()=>({data:overflow?Array(301).fill(fixtures[0]):fixtures,error:dbFailure?{message:"db unavailable"}:null}),
      maybeSingle:async()=>({data:fixtures.find(g=>g.external_id===filters.get("external_id")),error:null})};return q;}};
  assert.equal(table,"prediction_records");return {select:()=>{const q={eq:(k:string,v:unknown)=>{filters.set(k,v);return q;},then:(resolve:(r:unknown)=>unknown)=>resolve({data:tracked.filter(r=>r.game_id===filters.get("game_id")),error:null})};return q;},
    insert:async(row:Record<string,unknown>)=>{tracked.push({...structuredClone(row),id:tracked.length+1});return{error:null};}};
}} as unknown as Parameters<typeof sweepCbbPregameLocks>[0]["db"];

async function main(){
  for(const game of games){
    const f:CbbForecast={release:CBB_SCORE_RESEARCH_RELEASE,gameId:game.id,asOf:before,homeId:game.home_team.id,awayId:game.visitor_team.id,
      homeScore:78,awayScore:68,margin:10,total:146,possessions:69,homeWinProbability:.8,inputStatus:"complete",issues:[],
      uncertainty:{marginSd:11,totalSd:16,marginTotalCorrelation:0,marginCorrection:0,totalCorrection:0,fitThroughSeason:2025,games:3000}};
    const q:CbbQuote={gameId:game.id,sportsbook:"fanduel",market:"moneyline",line:null,firstPrice:-300,secondPrice:250,
      providerObservedAt:before,fetchedAt:before,phase:"current"};
    const board=buildCbbProvisionalBoard(f,[q,{...q,market:"spread",line:-7.5,firstPrice:-105,secondPrice:-115},{...q,market:"total",line:146.5,firstPrice:-110,secondPrice:-110}]);
    await writeCbbMemberGame({game,candidate:board,homeLogo:null,awayLogo:null,now:before},db);
  }
  const check=(extra:Partial<Parameters<typeof isCbbFixtureWithdrawnByPublishedCensus>[0]>={})=>isCbbFixtureWithdrawnByPublishedCensus({census,id:3,startsAt:start,capturedAt:before,now:due,...extra});
  assert.equal(check(),true);assert.equal(check({id:2}),false);assert.equal(check({id:NaN}),false);
  for(const bad of [null,{...census,snapshot_key:"cbb::2026-02-31::current-only::live-copy"},{...census,gameIds:null},{...census,gameIds:[1,"2"]},{...census,gameIds:[1,1]},{...census,generated_at:"bad"},{...census,generated_at:"2026-11-14T00:00:00Z"},{...census,generated_at:"2026-11-13T16:00:00Z"}])assert.equal(check({census:bad}),false,"Missing, malformed, future or older census cannot suppress a prelock record");
  assert.equal(check({startsAt:"2026-11-20T19:00:00Z"}),false,"A seven-day census cannot withdraw a fixture outside its window");
  assert.equal(check({census:{...census,snapshot_key:"cbb::2026-11-12::current-only::live-copy"}}),true,"The previous ET day's seven-day publication covers midnight rollover");
  const originals=structuredClone(stored);
  censusIds=[2];
  const removed=await sweepCbbPregameLocks({db,now:due});
  assert.equal(removed.locked,1);assert.equal(removed.trackingInserted,3);assert(removed.problems.includes("1:withdrawn_by_newer_published_fixture_census"));
  assert.equal(stored.get("cbb::member-game::1")!.snapshot.lockedAt,null);

  // Reset only the synthetic harness to prove ordinary supported first locks.
  stored.clear();for(const [key,value]of originals)stored.set(key,value);
  tracked.length=0;censusIds=[1,2];
  const original=structuredClone(stored.get("cbb::member-game::2")!);
  fixtures[0].home_team.display_name="Changed institution";
  const report=await sweepCbbPregameLocks({db,now:due});
  assert.equal(report.locked,1);assert.equal(report.trackingInserted,3);assert.equal(report.problems.length,1);
  assert.equal(stored.get("cbb::member-game::1")!.snapshot.lockedAt,null,"One changed matchup stays untouched");
  const frozen=stored.get("cbb::member-game::2")!;
  assert.deepEqual(frozen.snapshot.board,original.snapshot.board,"No forecast or numerical evaluation occurs at lock");
  assert.equal(frozen.snapshot.capturedAt,original.snapshot.capturedAt);
  for(const key of ["moneyline","total","first_inning"] as const)for(const field of ["pick","line","priceAmerican","modelProb","verdict","oddsTrail","sportsbookSplits"] as const)
    assert.deepEqual(frozen.memberGame.markets[key][field],original.memberGame.markets[key][field],`${key}/${field} frozen exactly`);
  assert(tracked.every(r=>r.locked_at===due));
  const bytes=JSON.stringify(frozen),priorWrites=writes;
  const repeated=await sweepCbbPregameLocks({db,now:"2026-11-13T18:20:00Z"});
  assert.equal(repeated.locked,0);assert.equal(repeated.trackingInserted,0);assert.equal(tracked.length,3);assert.equal(writes,priorWrites);
  assert.equal(JSON.stringify(stored.get("cbb::member-game::2")),bytes,"Repeated sweeps cannot rewrite a lock");
  const late=await sweepCbbPregameLocks({db,now:due,clock:()=>start});
  assert.equal(late.locked,0);assert.equal(late.trackingInserted,0);assert.equal(late.problems.length,2,"Crossing kickoff never manufactures a post-start lock");
  fixtures[0].home_team.display_name=games[0].home_team.full_name;
  stored.get("cbb::member-game::1")!.snapshot.capturedAt="2026-11-13T18:01:00Z";
  const afterCutoff=await sweepCbbPregameLocks({db,now:due});assert.equal(afterCutoff.locked,0);assert(afterCutoff.problems.some(p=>p.includes("pre_cutoff")));
  // With no newer trustworthy census, the existing publication still owns
  // first-lock eligibility; a census outage cannot block supported picks.
  stored.get("cbb::member-game::1")!.snapshot.capturedAt=before;
  censusFailure=true;const withoutCensus=await sweepCbbPregameLocks({db,now:due});censusFailure=false;
  assert.equal(withoutCensus.locked,1);assert(withoutCensus.problems.includes("fixture_census_unavailable_retained_prelock_policy"));
  const lockedBytes=JSON.stringify([...stored]);censusIds=[];
  const withdrawnAfterLock=await sweepCbbPregameLocks({db,now:due});
  assert.equal(withdrawnAfterLock.locked,0);assert.equal(JSON.stringify([...stored]),lockedBytes,"A newer census never suppresses, replaces or rewrites an existing lock");
  assert.deepEqual(cbbMemberGameForReader(stored.get("cbb::member-game::2")!,games[1]).markets,frozen.memberGame.markets,"Reader keeps exact frozen markets after withdrawal from the current census");
  dbFailure=true;await assert.rejects(sweepCbbPregameLocks({db,now:due}),/db unavailable/);dbFailure=false;
  overflow=true;await assert.rejects(sweepCbbPregameLocks({db,now:due}),/cap reached/);
  console.log("PASS CBB lock-first sweep: exact frozen decisions, tracking parity, per-game isolation, immutable repeat, strict cutoff/kickoff clocks, indexed two-key published census, withdrawn IDs, unknown-source fallback, DB failure and bounded cap; zero real IO");
}
main().catch(e=>{console.error(e);process.exitCode=1});
