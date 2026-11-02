import assert from "node:assert/strict";
import type { CbbForecast,CbbGame,CbbQuote } from "../lib/cbb/types";
import { buildCbbProvisionalBoard } from "../lib/cbb/provisionalBoard";
import { advanceCbbProvisionalSnapshot } from "../lib/cbb/provisionalLifecycle";
import { adaptCbbProvisionalGame,cbbDailyEdgeResponse } from "../lib/services/cbb/adaptCbbProvisionalToDailyEdge";
import { writeCbbMemberGame,type CbbStoredMemberGame } from "../lib/services/cbb/cbbMemberGameStore";
import { mergeCbbCapturedNamedSplitEvidence,mergeCbbDraftKingsSplitEvidence,mergeCbbReaderEvidence,cbbQualifiedPublicSplitSection,type CbbCapturedNamedSplitFeed,type CbbCapturedPublicSplitRow } from "../lib/services/cbb/cbbReaderMarketEvidence";
import { applyDraftKingsNetworkSplitFallback,type DraftKingsNetworkSplitFeed } from "../lib/providers/draftkings/draftKingsNetworkSplits";
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
  for(const bad of [{...row,league:"nba"},{...row,fetched_at:"2026-11-02T15:01:00Z"},
    {...row,event_id:"ncaab:Notre Dame@Villanova-20261103"},{...row,away_team:"Duke"},
    {...row,moneyline:{bets_pct:{away:null,home:null},handle_pct:{away:.2,home:.8}},spread:null,total:null}]){
    assert.equal(merge({...feed,rows:[bad]}).games[0].markets.moneyline.sportsbookSplits,null);
  }
  const oldAt="2026-11-02T10:00:00.000Z",oldFeed={...feed,rows:[{...row,fetched_at:oldAt}]};
  const retained=merge(oldFeed).games[0];
  assert.equal(retained.markets.moneyline.sportsbookSplits?.sourceObservedAt,oldAt,"last actual exact-game source remains visible without a new capture");
  assert.equal(retained.markets.moneyline.sportsbookSplits?.lastUpdated,oldAt,"the reader shows the original time, never now");
  assert.equal(retained.markets.moneyline.modelProb,dto.markets.moneyline.modelProb);
  assert.deepEqual(retained.markets.moneyline.verdict,dto.markets.moneyline.verdict);
  const newerRetail={...row,sportsbook:"draftkings",fetched_at:observed};
  assert.equal(merge({...feed,rows:[...oldFeed.rows,newerRetail]}).games[0].markets.moneyline.sportsbookSplits?.sourceBook,"draftkings","fresh retail supersedes old Circa during an outage");
  assert.equal(merge(oldFeed,{...response,games:[enriched.games[0]]}).games[0].markets.moneyline.sportsbookSplits?.sourceObservedAt,observed,"retained source cannot replace an existing fresh pair");
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
  const dk:DraftKingsNetworkSplitFeed={source:"draftkings_network",sport:"NCAA Basketball",fetchedAt:observed,games:[{
    providerEventId:"dk-777",awayName:"Villanova",homeName:"Notre Dame",monthDay:"11/2",markets:{
      moneyline:{market:"moneyline",sides:[{label:"Villanova",moneyPct:80,betsPct:60},{label:"Notre Dame",moneyPct:20,betsPct:40}]},
      spread:{market:"spread",sides:[{label:"Villanova -7.5",moneyPct:75,betsPct:55},{label:"Notre Dame +7.5",moneyPct:25,betsPct:45}]},
      total:{market:"total",sides:[{label:"Over 146.5",moneyPct:70,betsPct:60},{label:"Under 146.5",moneyPct:30,betsPct:40}]},
    }}]};
  const mergeDk=(value:DraftKingsNetworkSplitFeed,input=response,identity=input.games)=>mergeCbbDraftKingsSplitEvidence(input,value,applyDraftKingsNetworkSplitFallback,Date.parse(at),identity);
  const dkBoard=mergeDk(dk),dkSections=Object.fromEntries(Object.entries(dkBoard.games[0].markets).map(([key,m])=>[key,m.sportsbookSplits!]));
  assert.deepEqual(dkSections.moneyline.rows.map(row=>[row.side,row.moneyPct,row.betsPct]),[["home",80,60],["away",20,40]],"reversed source order keeps each institution's original shares");
  for(const key of ["moneyline","total","first_inning"] as const){
    const {sportsbookSplits,sharpBookAvailability,...actual}=dkBoard.games[0].markets[key];
    const {sportsbookSplits:priorSplit,sharpBookAvailability:priorAvailability,...expected}=dto.markets[key];
    assert.deepEqual(actual,expected,"DKN display cannot change forecast, quote, grade, stake or decision evidence");
    assert.equal(sportsbookSplits?.sourceBook,"draftkings_network");assert.equal(sportsbookSplits?.sourceObservedAt,observed);
  }
  assert.equal(JSON.stringify(response),sourceBytes,"source board remains unchanged");
  for(const invalid of [
    {...dk,sport:"NBA" as const},
    {...dk,fetchedAt:"2026-11-02T15:01:00Z"},
    {...dk,games:dk.games.map(g=>({...g,monthDay:"11/3"}))},
    {...dk,games:dk.games.map(g=>({...g,awayName:"Kentucky"}))},
  ])assert.equal(mergeDk(invalid as DraftKingsNetworkSplitFeed).games[0].markets.moneyline.sportsbookSplits,null);
  assert.equal(mergeDk(dk,response,[dto,duplicate]).games[0].markets.moneyline.sportsbookSplits,null,"selected-game reads retain the full duplicate-fixture guard");
  const futureMarket={...dk,games:dk.games.map(g=>({...g,markets:{moneyline:{...g.markets.moneyline!,observedAt:at}}}))};
  assert.equal(mergeDk(futureMarket).games[0].markets.moneyline.sportsbookSplits,null,"a market cannot postdate its page receipt");
  assert.equal(mergeDk(dk,enriched).games[0].markets.moneyline.sportsbookSplits?.sourceBook,"circa","fresh native Circa keeps priority");
  assert.equal(mergeDk(dk,{...response,games:[retained]}).games[0].markets.moneyline.sportsbookSplits?.sourceBook,"draftkings_network","fresh DKN replaces retained stale source without renewing it");
  const lockedBoard={...response,games:[frozen.record.memberGame]};
  assert.strictEqual(mergeDk(dk,lockedBoard).games[0],lockedBoard.games[0],"locked reader preserves exact payload object");
  stored=null;writes=0;
  const dkSaved=await writeCbbMemberGame({game,candidate:board,homeLogo:null,awayLogo:null,now:at,capturedNamedSections:dkSections},db);
  assert.deepEqual(dkSaved.record.memberGame.markets.moneyline.sportsbookSplits,dkSections.moneyline,"sole writer persists the source-qualified DKN display");
  const dkFrozen=await writeCbbMemberGame({game,candidate:null,homeLogo:null,awayLogo:null,now:"2026-11-02T17:00:00Z",capturedNamedSections:sections},db);
  assert.deepEqual(dkFrozen.record.memberGame.markets.moneyline.sportsbookSplits,dkSections.moneyline,"future lock freezes the same DKN values and source time");
  const dkLockedBytes=JSON.stringify(stored);
  await writeCbbMemberGame({game,candidate:board,homeLogo:null,awayLogo:null,now:"2026-11-02T17:10:00Z",capturedNamedSections:sections},db);
  assert.equal(writes,2);assert.equal(JSON.stringify(stored),dkLockedBytes,"later native or DKN observations cannot rewrite a lock");
  console.log("PASS captured CBB splits: shared reader/writer rules, original clocks, identity/age/axis guards, unchanged decisions and immutable future locks");
}
main().catch(e=>{console.error(e);process.exitCode=1;});
