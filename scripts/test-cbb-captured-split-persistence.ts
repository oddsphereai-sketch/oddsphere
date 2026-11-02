import assert from "node:assert/strict";
import type { CbbForecast,CbbGame,CbbQuote } from "../lib/cbb/types";
import { buildCbbProvisionalBoard } from "../lib/cbb/provisionalBoard";
import { advanceCbbProvisionalSnapshot } from "../lib/cbb/provisionalLifecycle";
import { adaptCbbProvisionalGame,cbbDailyEdgeResponse } from "../lib/services/cbb/adaptCbbProvisionalToDailyEdge";
import { writeCbbMemberGame,type CbbStoredMemberGame } from "../lib/services/cbb/cbbMemberGameStore";
import { mergeCbbCapturedNamedSplitEvidence,mergeCbbReaderEvidence,cbbQualifiedPublicSplitSection,type CbbCapturedNamedSplitFeed,type CbbCapturedPublicSplitRow } from "../lib/services/cbb/cbbReaderMarketEvidence";
import { applySharpApiCurrentSplitOverlay } from "../lib/providers/real_api/sharpApiCurrentSplits";

async function main(){
  const at="2026-11-02T15:00:00.000Z",observed="2026-11-02T14:55:00.000Z",start="2026-11-02T18:00:00.000Z";
  const team=(id:number,college:string,abbr:string)=>({id,name:college,full_name:college,college,abbreviation:abbr,conference_id:1});
  const game:CbbGame={id:777,date:start,season:2026,status:"pre",period:0,home_score:0,away_score:0,
    home_team:team(1,"Villanova","VILL"),visitor_team:team(2,"Notre Dame","ND")};
  const forecast:CbbForecast={release:"test",gameId:777,asOf:at,homeId:1,awayId:2,homeScore:78,awayScore:68,margin:10,total:146,
    possessions:69,homeWinProbability:.8,inputStatus:"complete",issues:[],uncertainty:{marginSd:11,totalSd:16,marginTotalCorrelation:0,
      marginCorrection:0,totalCorrection:0,fitThroughSeason:2025,games:3000}};
  const base:CbbQuote={gameId:777,sportsbook:"fanduel",market:"moneyline",line:null,firstPrice:-300,secondPrice:250,
    providerObservedAt:observed,fetchedAt:at,phase:"current"};
  const board=buildCbbProvisionalBoard(forecast,[base,{...base,market:"spread",line:-7.5,firstPrice:-110,secondPrice:-110},
    {...base,market:"total",line:146.5,firstPrice:-110,secondPrice:-110}]);
  const snapshot=advanceCbbProvisionalSnapshot({existing:null,candidate:board,startsAt:start,now:at});
  const dto=adaptCbbProvisionalGame({game,snapshot,homeLogo:null,awayLogo:null,now:at});
  const response=cbbDailyEdgeResponse("2026-11-02",[dto],at),sourceBytes=JSON.stringify(response);
  const pair={bets_pct:{away:.4,home:.6},handle_pct:{away:.2,home:.8}};
  const row={event_id:"ncaab:Notre Dame@Villanova-20261102",league:"ncaab",home_team:"Villanova",away_team:"Notre Dame",sportsbook:"circa",fetched_at:observed,
    moneyline:pair,spread:pair,total:{bets_pct:{over:.6,under:.4},handle_pct:{over:.8,under:.2}}};
  const feed:CbbCapturedNamedSplitFeed={source:"owls_current_splits",release:"owls_current_splits_2026_10_27_r1_complete_named_book",sport:"cbb",fetchedAt:at,rows:[row]};
  const merge=(value:CbbCapturedNamedSplitFeed,input=response)=>mergeCbbCapturedNamedSplitEvidence(input,value,applySharpApiCurrentSplitOverlay,Date.parse(at));
  const publicRows:CbbCapturedPublicSplitRow[]=["moneyline","spread","total"].flatMap(market=>(market==="total"?["over","under"]:["home","away"]).map((side,index)=>({
    canonical_event_id:"777",market_type:market,selection_key:`777:${market}:${side}`,bets_pct:index?.4:.6,money_pct:index?.3:.7,
    provider:"playbook",source_book:"consensus",source_type:"multi_book_consensus",source_observed_at:null,fetched_at:observed})));
  const publicBoard=mergeCbbReaderEvidence(response,null,publicRows,Date.parse(at));
  const enriched=merge(feed,publicBoard),sections=Object.fromEntries(Object.entries(enriched.games[0].markets).map(([key,m])=>[key,m.sportsbookSplits!]));
  const publicSections=Object.fromEntries(Object.entries(enriched.games[0].markets).map(([key,m])=>[key,m.publicSplits]));
  assert.deepEqual(publicSections.moneyline.map(row=>[row.betsPct,row.moneyPct]),[[60,70],[40,30]]);
  assert.ok(publicSections.moneyline.every(row=>row.observedAt===observed&&row.freshnessCheckedAt===observed));
  assert.equal(cbbQualifiedPublicSplitSection(publicSections.moneyline,"moneyline",Date.parse(at)),true);
  assert.equal(cbbQualifiedPublicSplitSection(publicSections.moneyline,"moneyline",Date.parse("2026-11-02T15:26:00Z")),false);
  const futureRows=publicRows.map(row=>({...row,source_observed_at:"2026-11-02T15:01:00Z"}));
  assert.equal(mergeCbbReaderEvidence(response,null,futureRows,Date.parse(at)).games[0].markets.moneyline.publicSplits.length,0,"source clock cannot be later than its receipt");
  const reversed=merge({...feed,rows:[{...row,home_team:"Notre Dame",away_team:"Villanova"}]}).games[0].markets.moneyline.sportsbookSplits!;
  assert.equal(reversed.rows.find(r=>r.side==="home")?.moneyPct,20,"neutral-site reversal preserves source-side orientation");
  assert.equal(JSON.stringify(response),sourceBytes,"qualification never mutates the original board");
  for(const key of ["moneyline","total","first_inning"] as const){
    const market=enriched.games[0].markets[key];
    assert.equal(market.sportsbookSplits?.rows.length,2);
    assert.equal(market.sportsbookSplits?.sourceObservedAt,observed,"original source time is never made fresh");
    assert.equal(market.pick,dto.markets[key].pick);assert.equal(market.modelProb,dto.markets[key].modelProb);
    assert.deepEqual(market.verdict,dto.markets[key].verdict);assert.equal(market.priceAmerican,dto.markets[key].priceAmerican);
  }
  for(const bad of [{...row,league:"nba"},{...row,fetched_at:"2026-11-02T15:01:00Z"},{...row,fetched_at:"2026-11-02T11:59:59Z"},
    {...row,event_id:"ncaab:Notre Dame@Villanova-20261103"},{...row,away_team:"Duke"},
    {...row,moneyline:{bets_pct:{away:null,home:null},handle_pct:{away:.2,home:.8}},spread:null,total:null}]){
    assert.equal(merge({...feed,rows:[bad]}).games[0].markets.moneyline.sportsbookSplits,null);
  }
  const duplicate={...dto,id:"cbb-778",external_id:778};
  assert.equal(merge(feed,{...response,games:[dto,duplicate]}).games[0].markets.moneyline.sportsbookSplits,null,"full-board identity ambiguity is not narrowed away");
  let stored:CbbStoredMemberGame|null=null,writes=0;
  const db={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:stored?{payload:stored}:null,error:null})})}),
    upsert:async(row:{payload:CbbStoredMemberGame})=>{stored=structuredClone(row.payload);writes++;return {error:null};}})} as unknown as Parameters<typeof writeCbbMemberGame>[1];
  const saved=await writeCbbMemberGame({game,candidate:board,homeLogo:null,awayLogo:null,now:at,capturedNamedSections:sections,capturedPublicSections:publicSections},db);
  assert.deepEqual(saved.record.memberGame.markets.moneyline.sportsbookSplits,sections.moneyline);
  assert.deepEqual(saved.record.memberGame.markets.moneyline.publicSplits,publicSections.moneyline);
  const carried=await writeCbbMemberGame({game,candidate:board,homeLogo:null,awayLogo:null,now:"2026-11-02T15:05:00Z"},db);
  assert.deepEqual(carried.record.memberGame.markets.moneyline.publicSplits,publicSections.moneyline,"a still-fresh prior observation survives temporary capture omission");
  assert.deepEqual(carried.record.memberGame.markets.moneyline.sportsbookSplits,sections.moneyline);
  const frozen=await writeCbbMemberGame({game,candidate:null,homeLogo:null,awayLogo:null,now:"2026-11-02T17:00:00Z",capturedNamedSections:{}},db);
  assert.deepEqual(frozen.record.memberGame.markets.moneyline.sportsbookSplits,sections.moneyline,"future lock freezes the last published qualified source");
  assert.deepEqual(frozen.record.memberGame.markets.moneyline.publicSplits,publicSections.moneyline,"future lock retains the original published public consensus");
  const bytes=JSON.stringify(stored);
  await writeCbbMemberGame({game,candidate:board,homeLogo:null,awayLogo:null,now:"2026-11-02T17:10:00Z",capturedNamedSections:sections},db);
  assert.equal(writes,3);assert.equal(JSON.stringify(stored),bytes,"existing locked payload has exact precedence");
  console.log("PASS captured CBB splits: shared reader/writer rules, original clocks, identity/age/axis guards, unchanged decisions and immutable future locks");
}
main().catch(e=>{console.error(e);process.exitCode=1;});
