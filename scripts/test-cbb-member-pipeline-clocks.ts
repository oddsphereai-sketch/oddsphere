import assert from "node:assert/strict";
import type { CbbGame } from "../lib/cbb/types";
import type { CbbBallDontLieClient } from "../lib/cbb/ballDontLie";
import type { OwlsInsightClient } from "../lib/providers/owls/owlsInsightClient";
import { buildCbbRollingSchedule } from "../lib/services/cbb/cbbRollingSchedule";
import {makeCbbPipelineTestRuntime} from "./fixtures/cbb-contextual-pipeline-runtime";
import {readCbbContextualOutcomeEvidence} from "../lib/services/cbb/cbbContextualOutcomeRuntime";
import { refreshCbbMemberBoard } from "../lib/services/cbb/cbbMemberPipeline";

const asOf="2026-10-29T22:00:00Z",start="2026-11-01T14:30:00Z";
const home={id:92,conference_id:1,name:"Wildcats",full_name:"Villanova Wildcats",college:"Villanova",abbreviation:"VILL"};
const away={id:11,conference_id:1,name:"Fighting Irish",full_name:"Notre Dame Fighting Irish",college:"Notre Dame",abbreviation:"ND"};
const game:CbbGame={id:10882407,date:start,season:2026,status:"pre",status_state:"scheduled",period:0,
  home_score:0,away_score:0,home_team:home,visitor_team:away};
const quote=(key:string,first:number,second:number,line?:number)=>({key,outcomes:key==="totals"?
  [{name:"Over",price:first,point:line},{name:"Under",price:second,point:line}]:
  [{name:"Villanova",price:first,point:line},{name:"Notre Dame",price:second,point:line===undefined?undefined:-line}]});
const odds={success:true,data:[{id:"exact-1",sport:"ncaab",commence_time:start,home_team:"Villanova",away_team:"Notre Dame",
  bookmakers:[{key:"fanduel",last_update:"2026-10-29T21:55:00Z",markets:[quote("h2h",-280,240),quote("spreads",-110,-110,-6.5),quote("totals",-110,-110,145.5)]}]}]};
const splits={sport:"ncaab",data:[],meta:{status:"partial"}};
const provider={calls:2,gamesForDates:async(dates:string[])=>dates.includes("2026-11-01")?[game]:[]} as unknown as CbbBallDontLieClient;
const schedule=buildCbbRollingSchedule({anchorDate:"2026-10-29",games:[{external_id:game.id,slate_date:"2026-11-01",
  game_date:"2026-11-01T14:30:00+00:00",status:"STATUS_SCHEDULED",away_team_id:11,home_team_id:92,venue:"Venue"}],
  teams:[{id:92,abbreviation:"VILL",display_name:home.full_name,logo_url:"https://a.espncdn.com/i/teamlogos/ncaa/500/222.png"},
    {id:11,abbreviation:"ND",display_name:away.full_name,logo_url:"https://a.espncdn.com/i/teamlogos/ncaa/500/87.png"}]});
const event={id:"espn-1",date:start,competitions:[{neutralSite:true,timeValid:true,
  competitors:[{homeAway:"home",team:{displayName:home.full_name,location:home.college}},
    {homeAway:"away",team:{displayName:away.full_name,location:away.college}}]}]};
const fetcher=(async()=>new Response(JSON.stringify({events:[event]}),{status:200,headers:{"Content-Type":"application/json"}})) as typeof fetch;
const stored=new Map<string,unknown>();
const tracked:Array<Record<string,unknown>>=[];
const db={from:(table:string)=>{
  if(table==="games")return {select:()=>{const q={eq:()=>q,maybeSingle:async()=>({data:{id:1,external_id:game.id,game_date:"2026-11-01T14:30:00+00:00",slate_date:"2026-11-01"},error:null})};return q;}};
  if(table==="prediction_records")return {select:()=>{const q={eq:()=>q,then:(resolve:(value:unknown)=>unknown)=>resolve({data:tracked,error:null})};return q;},insert:async(row:Record<string,unknown>)=>{tracked.push(structuredClone(row));return {error:null};}};
  assert.equal(table,"lab_response_snapshots");return {
  select:()=>({in:async(_:string,keys:string[])=>({data:keys.filter(key=>stored.has(key)).map(key=>({snapshot_key:key,payload:stored.get(key)})),error:null}),
    eq:(_:string,key:string)=>({maybeSingle:async()=>({data:stored.has(key)?{payload:stored.get(key)}:null,error:null})})}),
  upsert:async(row:{snapshot_key:string;payload:unknown})=>{stored.set(row.snapshot_key,structuredClone(row.payload));return {error:null};},
};}} as unknown as Parameters<typeof refreshCbbMemberBoard>[0]["db"];
const saveSnapshot=(async()=>{
  return {ok:true,snapshotKey:"test",expiresAt:asOf,staleUntil:asOf};}) as NonNullable<Parameters<typeof refreshCbbMemberBoard>[0]["saveSnapshot"]>;

const runtime=makeCbbPipelineTestRuntime();const loadContextualRuntime=async()=>runtime.runtime;
async function main(){
  let priceCalls=0,splitCalls=0;
  const prices=(timestamp:string,first:number,second:number,complete:boolean)=>{
    const body=structuredClone(odds);
    body.data[0].bookmakers[0].last_update=timestamp;
    if(!complete)body.data[0].bookmakers[0].markets=body.data[0].bookmakers[0].markets.filter(m=>m.key!=="totals");
    body.data[0].bookmakers.push({key:"circa",last_update:timestamp,markets:[quote("h2h",-150,130),quote("spreads",first,second,-6.5)]});
    return body;
  };
  const earlier={odds:async()=>{priceCalls++;return {body:prices("2026-10-29T21:50:00Z",-150,130,true)};},
    splits:async()=>{splitCalls++;return {body:splits};}} as unknown as OwlsInsightClient;
  await refreshCbbMemberBoard({loadContextualRuntime,anchorDate:"2026-10-29",season:2026,now:"2026-10-29T21:56:00Z",bdlKey:"test",owlsKey:"test",
    trainingGames:[],provider,owls:earlier,db,fetcher,loadSchedule:async()=>schedule,saveSnapshot});
  const clocks=["2026-10-29T21:58:30Z","2026-10-29T21:59:01Z","2026-10-29T21:59:02Z","2026-10-29T22:00:00Z","2026-10-29T22:00:30Z"];
  let clockCalls=0;
  const nowClock=()=>{const value=clocks[clockCalls++];assert.ok(value,"unexpected clock read");return value;};
  const realSplits={sport:"ncaab",data:[{event_id:"exact-1",home_team:"Villanova",away_team:"Notre Dame",splits:[{
    book:"circa",as_of:"2026-10-29T21:54:00Z",spread:{home_line:-6.5,away_line:6.5,
      home_bets_pct:60,away_bets_pct:40,home_handle_pct:10,away_handle_pct:90}}]}],meta:{status:"ok"}};
  const source={odds:async()=>{priceCalls++;await Promise.resolve();await Promise.resolve();return {body:prices("2026-10-29T21:58:00Z",-115,-105,false)};},
    splits:async()=>{splitCalls++;return {body:realSplits};}} as unknown as OwlsInsightClient;
  const result=await refreshCbbMemberBoard({loadContextualRuntime,anchorDate:"2026-10-29",season:2026,nowClock,bdlKey:"test",owlsKey:"test",
    trainingGames:[],provider,owls:source,db,fetcher,fallbackOdds:[],loadSchedule:async()=>schedule,saveSnapshot});
  const record=stored.get(`cbb::member-game::${game.id}`) as import("../lib/services/cbb/cbbMemberGameStore").CbbStoredMemberGame;
  const evidence=readCbbContextualOutcomeEvidence(record.snapshot.board)!;
  assert.equal(evidence.input.currentQuotes.find(q=>q.sportsbook==="circa"&&q.market==="spread")?.fetchedAt,"2026-10-29T21:59:02Z");
  assert.ok(evidence.input.splitContext?.some(r=>r.sourceBook==="circa"&&r.availableBy==="2026-10-29T21:59:01Z"),"Split keeps its own completion before odds and fallback");
  assert.equal(evidence.decision.asOf,"2026-10-29T22:00:30Z","Decision cutoff can advance after fallback without restamping a source");
  assert.ok(evidence.decision.marketDecisions.filter(m=>m.target).every(m=>m.target?.requestedAt==="2026-10-29T21:58:30Z"));
  assert.equal(evidence.decision.marketDecisions.find(m=>m.market==="total")?.grade,"Held","Missing current total cannot inherit an earlier executable target");
  assert.equal(clockCalls,5);assert.equal(priceCalls,2);assert.equal(splitCalls,2);assert.equal(result.owlsCalls,2);
  console.log("PASS CBB pipeline response clocks: original odds/splits receipts survive a later board-wide fallback with one call per existing endpoint.");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
