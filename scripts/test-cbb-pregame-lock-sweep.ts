import assert from "node:assert/strict";
import { buildCbbProvisionalBoard } from "../lib/cbb/provisionalBoard";
import { CBB_SCORE_RESEARCH_RELEASE } from "../lib/cbb/scoreResearch";
import type { CbbForecast, CbbGame, CbbQuote } from "../lib/cbb/types";
import { writeCbbMemberGame, type CbbStoredMemberGame } from "../lib/services/cbb/cbbMemberGameStore";
import { sweepCbbPregameLocks } from "../lib/services/cbb/cbbPregameLockSweep";

const start="2026-11-13T19:00:00Z",before="2026-11-13T17:00:00Z",due="2026-11-13T18:05:00Z";
const team=(id:number)=>({id,abbreviation:`T${id}`,full_name:`School ${id}`,name:`School ${id}`,college:null,conference_id:1});
const games=[1,2].map(id=>({id,date:start,season:2026,status:"pre",period:0,home_score:0,away_score:0,
  home_team:team(id*2),visitor_team:team(id*2+1)} satisfies CbbGame));
const fixtures=games.map(g=>({id:g.id,external_id:g.id,game_date:start,slate_date:"2026-11-13",home_team:{external_id:g.home_team.id,display_name:g.home_team.full_name,abbreviation:g.home_team.abbreviation},
  away_team:{external_id:g.visitor_team.id,display_name:g.visitor_team.full_name,abbreviation:g.visitor_team.abbreviation}}));
const stored=new Map<string,CbbStoredMemberGame>(),tracked:Array<Record<string,unknown>>=[];let writes=0;
let dbFailure=false,overflow=false;
const db={from:(table:string)=>{
  if(table==="lab_response_snapshots")return {select:()=>({in:async(_:string,keys:string[])=>({data:keys.filter(k=>stored.has(k)).map(k=>({snapshot_key:k,payload:stored.get(k)})),error:null}),
    eq:(_:string,key:string)=>({maybeSingle:async()=>({data:stored.has(key)?{payload:stored.get(key)}:null,error:null})})}),upsert:async(r:{snapshot_key:string;payload:CbbStoredMemberGame})=>{writes++;stored.set(r.snapshot_key,structuredClone(r.payload));return{error:null};}};
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
  dbFailure=true;await assert.rejects(sweepCbbPregameLocks({db,now:due}),/db unavailable/);dbFailure=false;
  overflow=true;await assert.rejects(sweepCbbPregameLocks({db,now:due}),/cap reached/);
  console.log("PASS CBB lock-first sweep: exact frozen decisions, tracking parity, per-game isolation, immutable repeat, strict cutoff/kickoff clocks, DB failure and bounded cap; zero real IO");
}
main().catch(e=>{console.error(e);process.exitCode=1});
