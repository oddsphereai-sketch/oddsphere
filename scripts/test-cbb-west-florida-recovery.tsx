import {isCbbDivisionOneTeam} from "../lib/cbb/divisionOneMembership";
import assert from "node:assert/strict";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import lockedFixture from "./fixtures/cbb-west-florida-locked-20261106.json";
import recovery from "../lib/cbb/artifacts/locked-market-recovery-10882715-r1.json";
import {cbbProviderFixtureIdentity,cbbProviderSchoolIdentity,cbbProviderStoredSchoolMatches} from "../lib/cbb/providerInstitutionIdentity";
import {normalizeCbbOwlsCurrent} from "../lib/cbb/owlsMarketEvidence";
import {normalizeCbbTheOddsApiCurrent} from "../lib/services/cbb/cbbTheOddsApiCurrent";
import {cbbSplitOrientation} from "../lib/cbb/exactSplitIdentity";
import {appendCbbLockedMarketRecovery,cbbRecoveryPayloadSha256} from "../lib/services/cbb/cbbLockedMarketRecovery";
import {writeCbbMemberGame,type CbbStoredMemberGame} from "../lib/services/cbb/cbbMemberGameStore";
import {overlayCbbLockedMemberGames} from "../lib/services/cbb/cbbMemberReader";
import {cbbDailyEdgeResponse} from "../lib/services/cbb/adaptCbbProvisionalToDailyEdge";
import {CbbRecoveredMarketContext} from "../app/lab/components/daily-edge/CbbRecoveredMarketContext";
import type {CbbGame} from "../lib/cbb/types";

async function main(){
const record=structuredClone(lockedFixture) as unknown as CbbStoredMemberGame;
const exact=JSON.stringify(record);
const team=(id:number,full_name:string,college:string|null,abbreviation:string)=>({id,full_name,college,abbreviation,name:full_name,conference_id:null});
const game:CbbGame={id:10882715,date:recovery.startsAt,season:2026,status:"pre",period:0,home_score:0,away_score:0,
  home_team:team(156,"Florida International Panthers","Florida International","FIU"),visitor_team:team(732,"Argonauts",null,"WEST ")};
const identity=cbbProviderFixtureIdentity(game);
assert.equal(identity.awayTeamDisplayName,"West Florida Argonauts");
assert(isCbbDivisionOneTeam({id:732,full_name:"West Florida Argonauts"},2026));
assert.throws(()=>isCbbDivisionOneTeam({id:732,full_name:"Other Argonauts"},2026),/identity changed/);
assert.equal(cbbSplitOrientation("West Florida","FIU",identity),"direct");
assert.equal(cbbSplitOrientation("FIU","West Florida Argonauts",identity),"reversed");
for(const wrong of ["Florida Atlantic","Florida Gulf Coast","North Florida","Argonauts"])
  assert.equal(cbbSplitOrientation(wrong,"FIU",identity),null,"No mascot-only or neighboring-school guess");
assert.equal(cbbProviderSchoolIdentity({...game.visitor_team,id:733}).displayName,"Argonauts");
assert.equal(cbbProviderSchoolIdentity({...game.visitor_team,college:"Other College"}).college,"Other College");
assert(cbbProviderStoredSchoolMatches("West Florida Argonauts",game.visitor_team));
assert(cbbProviderStoredSchoolMatches("Argonauts",{...game.visitor_team,full_name:"West Florida Argonauts"}));
assert(!cbbProviderStoredSchoolMatches("Argonauts",{...game.visitor_team,full_name:"West Florida Argonauts",college:"Other College"}));
assert(!cbbProviderStoredSchoolMatches("Argonauts",{...game.visitor_team,id:733,full_name:"West Florida Argonauts"}));
assert(!cbbProviderStoredSchoolMatches("West Florida Argonauts",{...game.visitor_team,id:733}));
const update="2026-11-06T19:40:13.039Z",at="2026-11-06T20:00:00Z";
const event={eventId:recovery.providerEventId,id:"fiu-west-florida",sport:"ncaab",sport_key:"basketball_ncaab",home_team:"FIU",away_team:"West Florida",commence_time:game.date,
  bookmakers:[{key:"pinnacle",last_update:update,markets:[
    {key:"h2h",outcomes:[{name:"FIU",price:-1989},{name:"West Florida",price:1058}]},
    {key:"spreads",outcomes:[{name:"FIU",price:-111,point:-16.5},{name:"West Florida",price:-105,point:16.5}]},
    {key:"totals",outcomes:[{name:"Over",price:-104,point:162.5},{name:"Under",price:-116,point:162.5}]}]}]};
assert.equal(normalizeCbbOwlsCurrent(game,{success:true,data:[event]},at,at).quotes.length,3);
assert.equal(normalizeCbbTheOddsApiCurrent([game],[event],at,at).quotes.length,3);
assert.equal(normalizeCbbOwlsCurrent({...game,visitor_team:{...game.visitor_team,id:733}},{success:true,data:[event]},at,at).quotes.length,0);
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
console.log("PASS West Florida exact-ID/FIU joins, all-three-market source recovery, immutable locked writer/reader precedence, hash rejection and explicit historical UI context; zero real IO");

}
void main().catch(error=>{console.error(error);process.exitCode=1;});
