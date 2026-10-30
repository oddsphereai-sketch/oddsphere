import assert from "node:assert/strict";
import type { CbbGame } from "../lib/cbb/types";
import type { CbbBallDontLieClient } from "../lib/cbb/ballDontLie";
import type { OwlsInsightClient } from "../lib/providers/owls/owlsInsightClient";
import type { DailyEdgeResponse } from "../app/lab/lib/labTypes";
import { buildCbbRollingSchedule } from "../lib/services/cbb/cbbRollingSchedule";
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
const owls={odds:async()=>({body:odds,status:200,rateLimit:{remainingMinute:null,remainingMonth:null}}),
  splits:async()=>({body:splits,status:200,rateLimit:{remainingMinute:null,remainingMonth:null}})} as unknown as OwlsInsightClient;
const schedule=buildCbbRollingSchedule({anchorDate:"2026-10-29",games:[{external_id:game.id,slate_date:"2026-11-01",
  game_date:"2026-11-01T14:30:00+00:00",status:"STATUS_SCHEDULED",away_team_id:11,home_team_id:92,venue:"Venue"}],
  teams:[{id:92,abbreviation:"VILL",display_name:home.full_name,logo_url:"https://a.espncdn.com/i/teamlogos/ncaa/500/222.png"},
    {id:11,abbreviation:"ND",display_name:away.full_name,logo_url:"https://a.espncdn.com/i/teamlogos/ncaa/500/87.png"}]});
const event={id:"espn-1",date:start,competitions:[{neutralSite:true,timeValid:true,
  competitors:[{homeAway:"home",team:{displayName:home.full_name,location:home.college}},
    {homeAway:"away",team:{displayName:away.full_name,location:away.college}}]}]};
const fetcher=(async()=>new Response(JSON.stringify({events:[event]}),{status:200,headers:{"Content-Type":"application/json"}})) as typeof fetch;
const stored=new Map<string,unknown>();
const db={from:(table:string)=>{assert.equal(table,"lab_response_snapshots");return {
  select:()=>({in:async(_:string,keys:string[])=>({data:keys.filter(key=>stored.has(key)).map(key=>({snapshot_key:key,payload:stored.get(key)})),error:null}),
    eq:(_:string,key:string)=>({maybeSingle:async()=>({data:stored.has(key)?{payload:stored.get(key)}:null,error:null})})}),
  upsert:async(row:{snapshot_key:string;payload:unknown})=>{stored.set(row.snapshot_key,structuredClone(row.payload));return {error:null};},
};}} as unknown as Parameters<typeof refreshCbbMemberBoard>[0]["db"];
let published:DailyEdgeResponse|null=null;
const saveSnapshot=(async(input:{payload:DailyEdgeResponse})=>{published=structuredClone(input.payload);
  return {ok:true,snapshotKey:"test",expiresAt:asOf,staleUntil:asOf};}) as NonNullable<Parameters<typeof refreshCbbMemberBoard>[0]["saveSnapshot"]>;

async function main(){
  const wrongStart={...schedule,games:schedule.games.map(row=>({...row,gameStartAt:"2026-11-01T14:31:00+00:00"}))};
  await assert.rejects(refreshCbbMemberBoard({anchorDate:"2026-10-29",season:2026,now:asOf,bdlKey:"test",owlsKey:"test",
    trainingGames:[],provider,owls,db,fetcher,loadSchedule:async()=>wrongStart,saveSnapshot}),/lost exact games/);
  assert.equal(stored.size,0,"a real start-time drift must not write a member game");
  const result=await refreshCbbMemberBoard({anchorDate:"2026-10-29",season:2026,now:asOf,bdlKey:"test",owlsKey:"test",
    trainingGames:[],provider,owls,db,fetcher,loadSchedule:async()=>schedule,saveSnapshot});
  assert.equal(result.sourceGames,1);assert.equal(result.published,1);assert.equal(result.written,1);
  assert.equal(result.trackingInserted,0);
  assert.ok(published);
  const member=(published as DailyEdgeResponse).games[0];
  assert.equal(member.cbbHomeCollege,"Villanova");assert.equal(member.homeTeamLogo,schedule.games[0].homeTeamLogo);
  assert.equal(member.markets.first_inning.line,-6.5);
  assert.equal(member.markets.moneyline.currentPriceSportsbook,"fanduel");
  assert.equal(member.projected.home+member.projected.away,member.markets.total.modelTotal);
  assert.equal(member.markets.moneyline.sportsbookSplits,null);
  assert.ok(result.problems.some(problem=>problem.includes("verified_splits_unavailable")));
  console.log("CBB member pipeline: exact fixture, seven-day card, source price, coherent score, published snapshot and honest split absence passed.");
}
void main();
