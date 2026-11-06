import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import assert from "node:assert/strict";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import lockedFixture from "./fixtures/cbb-west-florida-locked-20261106.json";
import recovery from "../lib/cbb/artifacts/locked-market-recovery-10882715-r1.json";
import {appendCbbLockedMarketRecovery,cbbRecoveryPayloadSha256} from "../lib/services/cbb/cbbLockedMarketRecovery";
import {writeCbbMemberGame,type CbbStoredMemberGame} from "../lib/services/cbb/cbbMemberGameStore";
import {overlayCbbLockedMemberGames} from "../lib/services/cbb/cbbMemberReader";
import {cbbDailyEdgeResponse} from "../lib/services/cbb/adaptCbbProvisionalToDailyEdge";
import {CbbRecoveredMarketContext} from "../app/lab/components/daily-edge/CbbRecoveredMarketContext";
import {QuickRead as MemberQuickRead} from "../app/dev/experience-preview/ActualDailyEdgePreview";
import type {CbbGame} from "../lib/cbb/types";

async function main(){
const record=structuredClone(lockedFixture) as unknown as CbbStoredMemberGame;
const exact=JSON.stringify(record);
const team=(id:number,full_name:string,college:string|null,abbreviation:string)=>({id,full_name,college,abbreviation,name:full_name,conference_id:null});
const game:CbbGame={id:10882715,date:recovery.startsAt,season:2026,status:"pre",period:0,home_score:0,away_score:0,
  home_team:team(156,"Florida International Panthers","Florida International","FIU"),visitor_team:team(732,"Argonauts",null,"WEST ")};
const at="2026-11-06T20:00:00Z";
type Point={timestampUtc:string;price:number;point?:string;inPlay?:boolean};
type Receipt={status:number;requestedAt:string;availableAt:string;body:{success:boolean;data:{eventId:string;book:string;market:string;side:string;history:Point[]}}};
const histories=new Map<string,Point[]>();
for(const source of recovery.sourceReceipts){
  const raw=readFileSync(`scripts/fixtures/cbb-fiu-recovery-20261106/${source.market}-${source.side}.json`,"utf8");
  assert.equal(createHash("sha256").update(raw).digest("hex"),source.sha256);
  const r=JSON.parse(raw) as Receipt;const d=r.body.data;
  assert.equal(r.status,200);assert(r.body.success);assert.equal(d.eventId,recovery.providerEventId);
  assert.equal(d.book,recovery.book);assert.equal(d.market,source.market);assert.equal(d.side,source.side);
  assert(Date.parse(r.availableAt)>Date.parse(recovery.lockedAt),"No historical retrieval is backdated as lock-known evidence");
  histories.set(`${source.market}:${source.side}`,d.history.filter(p=>Number.isFinite(Date.parse(p.timestampUtc))&&Date.parse(p.timestampUtc)<=Date.parse(recovery.asOf)&&p.inPlay!==true));
}
for(const row of recovery.markets){
 const kind=row.market==="moneyline"?"h2h":row.market==="spread"?"spreads":"totals";
 const first=histories.get(`${kind}:${kind==="totals"?"over":"home"}`)!;
 const second=histories.get(`${kind}:${kind==="totals"?"under":"away"}`)!;
 const joint=first.filter(a=>second.some(b=>a.timestampUtc===b.timestampUtc)).sort((a,b)=>Date.parse(a.timestampUtc)-Date.parse(b.timestampUtc));
 const a=joint.at(-1)!,b=second.find(b=>b.timestampUtc===a.timestampUtc)!;
 assert.equal(row.observedAt,a.timestampUtc);assert.equal(row.firstPrice,a.price);assert.equal(row.secondPrice,b.price);
 if(row.line!==null){assert.equal(row.line,Number(a.point));assert.equal(row.line,row.market==="spread"?-Number(b.point):Number(b.point));}
}

assert.equal(cbbRecoveryPayloadSha256(record),recovery.originalPayloadSha256);
const view=appendCbbLockedMarketRecovery(record,structuredClone(record.memberGame));
assert.equal(view.awayTeamDisplayName,"West Florida Argonauts");
assert.equal(view.cbbRecoveredMarketData?.markets.length,3);
assert.deepEqual(view.markets,record.memberGame.markets,"Archived context never overwrites locked prices, picks, probabilities or grades");
assert.deepEqual(view.projected,record.memberGame.projected);
assert.deepEqual(view.predictions,record.memberGame.predictions);
assert.equal(JSON.stringify(record),exact);
const changed=structuredClone(record);changed.memberGame.projected.home+=1;
assert.equal(appendCbbLockedMarketRecovery(changed,changed.memberGame),changed.memberGame,"Changed historical payload cannot acquire the correction");
for(const market of ["moneyline","first_inning","total"] as const){
  const html=renderToStaticMarkup(<CbbRecoveredMarketContext game={view} market={market}/>);
  assert.match(html,/Recovered pre-lock odds/);assert.match(html,/retrieved after lock/);
  const actual=renderToStaticMarkup(<MemberQuickRead game={view} market={view.markets[market]} marketKey={market} sport="cbb"/>);
  assert.match(actual,/Recovered pre-lock odds/,"The active member layout, not just the isolated panel, must render the recovery");
  assert.match(actual,/retrieved after lock/);assert.match(actual,/West Florida Argonauts/);
  assert.match(html,market==="moneyline"?/-1989/:market==="first_inning"?/-16.5/:/162.5/);
}
assert.equal(renderToStaticMarkup(<CbbRecoveredMarketContext game={record.memberGame} market="total"/>),"");
let writes=0;
const writerDb={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{payload:record},error:null})})}),upsert:async()=>{writes++;return{error:null};}})} as unknown as Parameters<typeof writeCbbMemberGame>[1];
const result=await writeCbbMemberGame({game,candidate:null,homeLogo:null,awayLogo:null,now:"2026-11-06T22:20:00Z"},writerDb);
assert.equal(result.written,false);assert.equal(writes,0);assert.equal(JSON.stringify(record),exact);
const index={snapshot_key:"cbb::member-game::10882715",storeRelease:record.release,gameId:"10882715",startsAt:record.snapshot.startsAt,lockedAt:record.snapshot.lockedAt,
  memberId:record.memberGame.id,memberExternalId:"10882715",memberStart:record.snapshot.startsAt,memberLock:record.snapshot.lockedAt};
const readerDb={from:(table:string)=>table==="lab_response_snapshots"?{select:(fields:string)=>({in:async()=>({data:fields.includes("storeRelease:")?[index]:[{snapshot_key:index.snapshot_key,payload:record}],error:null})})}:
  {select:()=>({eq:()=>({in:async()=>({data:[{external_id:game.id,status:"STATUS_SCHEDULED",home_score:null,away_score:null,game_date:game.date,
    home_team:{external_id:156,display_name:game.home_team.full_name},away_team:{external_id:732,display_name:"Argonauts"}}],error:null})})})}} as unknown as Parameters<typeof overlayCbbLockedMemberGames>[1];
const board=cbbDailyEdgeResponse("2026-11-06",[record.memberGame],at);
const corrected=await overlayCbbLockedMemberGames(board,readerDb);
assert.equal(corrected.games[0].awayTeamDisplayName,"West Florida Argonauts");
assert.deepEqual((await overlayCbbLockedMemberGames(corrected,readerDb)).games,corrected.games,"Already corrected cached view keeps exact stored precedence");
assert.equal(JSON.stringify(record),exact);assert.equal(writes,0);
console.log("PASS FIU–West Florida all-three-market historical recovery, immutable locked writer/reader precedence, hash rejection and explicit historical UI context; zero real IO");

}
void main().catch(error=>{console.error(error);process.exitCode=1;});
