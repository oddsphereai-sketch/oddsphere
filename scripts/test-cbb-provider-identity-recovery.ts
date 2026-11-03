import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {pairCbbCanonicalMarketEvidence,type CbbCanonicalPriceRow} from "../lib/services/cbb/cbbCanonicalMarketEvidence";
import { cbbProviderInstitutionName as name } from "../lib/cbb/providerInstitutionIdentity";
import { normalizeCbbOwlsCurrent,normalizeCbbOwlsHistory } from "../lib/cbb/owlsMarketEvidence";
import { buildCbbProvisionalBoard, chooseCbbSupportedTargetBook } from "../lib/cbb/provisionalBoard";
import { applyCbbScheduleCoverage } from "../lib/services/cbb/cbbRollingSchedule";
import type { CbbGame, CbbForecast, CbbQuote } from "../lib/cbb/types";

for(const [a,b]of [["Michigan St","Michigan State"],["Boston U","Boston University"],["UMass","Massachusetts"],["Maryland-Eastern Shore","Maryland Eastern Shore"],["MD Eastern","Maryland Eastern Shore"],["N'Western St","Northwestern State"],["Texas A&M-CC","Texas A&M-Corpus Christi"],["ETSU","East Tennessee State"],["FDU","Fairleigh Dickinson"],["NC St","North Carolina State"]])assert.equal(name(a),name(b));
for(const[a,b]of[["Maryland","Maryland Eastern Shore"],["Tennessee","East Tennessee State"],["North Carolina","North Carolina State"],["Louisiana","UL Monroe"],["USC","South Carolina Upstate"],["Saint Thomas","St. Thomas-Minnesota"],["Miami","Miami (OH)"],["Wildcats","Davidson"]])assert.notEqual(name(a),name(b),"similar schools cannot alias");
const asOf="2026-11-02T12:30:00Z",start="2026-11-03T00:00:00Z";
const game={id:1,date:start,season:2026,home_team:{id:2,college:"Michigan State",full_name:"Michigan State Spartans"},visitor_team:{id:3,college:"Quinnipiac",full_name:"Quinnipiac Bobcats"}}as CbbGame;
const event={eventId:"ncaab:Quinnipiac@Michigan St-20261103",sport:"ncaab",commence_time:start,home_team:"Michigan St",away_team:"Quinnipiac",bookmakers:[{key:"draftkings",last_update:asOf,markets:[{key:"spreads",outcomes:[{name:"Michigan St",price:-110,point:-12.5},{name:"Quinnipiac",price:-110,point:12.5}]},{key:"totals",outcomes:[{name:"Over",price:-110,point:145.5},{name:"Under",price:-110,point:145.5}]}]}]};
const quotes=normalizeCbbOwlsCurrent(game,{success:true,data:[event]},asOf,asOf).quotes;
assert.equal(quotes.length,2,"both source outcomes resolve to the institution and its correct side");
const reversed={...event,away_team:event.home_team,home_team:event.away_team};
assert.deepEqual(normalizeCbbOwlsCurrent(game,{success:true,data:[reversed]},asOf,asOf).quotes,quotes,"neutral-site reversal keeps canonical outcome orientation");
assert.equal(normalizeCbbOwlsCurrent(game,{success:true,data:[{...event,sport:"ncaaw"}]},asOf,asOf).quotes.length,0);
assert.equal(normalizeCbbOwlsCurrent(game,{success:true,data:[{...event,commence_time:"2026-11-03T01:00:00Z"}]},asOf,asOf).quotes.length,0);
assert.equal(normalizeCbbOwlsCurrent({...game,home_team:{...game.home_team,college:"Michigan",full_name:"Michigan Wolverines"}},{success:true,data:[event]},asOf,asOf).quotes.length,0);
const forecast={release:"test",gameId:1,asOf,homeId:2,awayId:3,homeScore:80,awayScore:60,margin:20,total:140,homeWinProbability:.9,possessions:70,inputStatus:"complete",issues:[],uncertainty:{marginSd:11,totalSd:16,marginTotalCorrelation:0,marginCorrection:0,totalCorrection:0,fitThroughSeason:2025,games:3000}}as CbbForecast;
const partial=buildCbbProvisionalBoard(forecast,quotes);
assert.equal(partial.rows.find(r=>r.market==="moneyline")!.grade,"Held");
assert.ok(partial.rows.filter(r=>r.market!=="moneyline").every(r=>r.price!==null&&r.probability!==null),"missing ML cannot block priced markets");
assert.ok(partial.rows.some(r=>r.grade==="Lean"||r.grade==="Best Angle"),"verified partial coverage can earn an actionable promotion through the existing evaluator");
const full=[...quotes,{...quotes[0],sportsbook:"fanduel",market:"moneyline",line:null},{...quotes[0],sportsbook:"fanduel"},{...quotes[1],sportsbook:"fanduel"}]as CbbQuote[];
assert.equal(chooseCbbSupportedTargetBook(full),"fanduel","an existing complete-book choice keeps precedence over a preferred partial book");
assert.equal(chooseCbbSupportedTargetBook([...quotes,quotes[0]]),null,"duplicate markets cannot manufacture a complete quote");
const schedule={release:"test",anchorDate:"2026-11-02",throughDate:"2026-11-08",games:[1,2,3].map(id=>({externalId:id}))}as unknown as Parameters<typeof applyCbbScheduleCoverage>[0];
const visible=applyCbbScheduleCoverage(schedule,{eligibleGameIds:[1,2],modelEligibleGameIds:[1]});
assert.deepEqual(visible.games.map(g=>g.externalId),[1,2],"keep D1/D1 and D1/non-D1, exclude only non-D1/non-D1");
assert.equal(visible.games.length,2);
// Source metadata is an actual bounded stored receipt; numeric prices below
// are synthetic contract checks, never an assertion about this game's market.
const discovery=JSON.parse(readFileSync(new URL("./fixtures/owls-cbb-institution-discovery-20261103.json",import.meta.url),"utf8"));
assert.equal(discovery.events.length,5);
const sourceSchools:Record<string,{id:number;home:string;away:string;homeName:string;awayName:string}>={
 "IPFW":{id:10882593,home:"Duquesne",away:"Purdue Fort Wayne",homeName:"Duquesne Dukes",awayName:"Purdue Fort Wayne Mastodons"},
 "Purdue FW":{id:10882593,home:"Duquesne",away:"Purdue Fort Wayne",homeName:"Duquesne Dukes",awayName:"Purdue Fort Wayne Mastodons"},
 "S Dakota St":{id:10882602,home:"Kansas State",away:"South Dakota State",homeName:"Kansas State Wildcats",awayName:"South Dakota State Jackrabbits"},
 "N Arizona":{id:10882617,home:"UNLV",away:"Northern Arizona",homeName:"UNLV Rebels",awayName:"Northern Arizona Lumberjacks"},
 "Fullerton":{id:10882600,home:"San Diego State",away:"Cal State Fullerton",homeName:"San Diego State Aztecs",awayName:"Cal State Fullerton Titans"},
};
for(const source of discovery.events){
 const school=sourceSchools[source.away_team];assert.ok(school);
 const ownGame={...game,id:school.id,date:source.commence_time,
  home_team:{...game.home_team,college:school.home,full_name:school.homeName},
  visitor_team:{...game.visitor_team,college:school.away,full_name:school.awayName}};
 assert.equal(name(source.away_team),name(ownGame.visitor_team.college));
 assert.equal(name(source.home_team),name(ownGame.home_team.college));
 const captured="2026-11-03T11:59:00Z",fetched="2026-11-03T12:00:00Z",decision="2026-11-03T12:01:00Z";
 const e={...source,sport:"ncaab",bookmakers:[{key:"pinnacle",last_update:captured,markets:[
  {key:"h2h",outcomes:[{name:source.home_team,price:-150},{name:source.away_team,price:130}]},
  {key:"spreads",outcomes:[{name:source.home_team,price:-110,point:-3.5},{name:source.away_team,price:-110,point:3.5}]},
  {key:"totals",outcomes:[{name:"Over",price:-110,point:150.5},{name:"Under",price:-110,point:150.5}]}]}]};
 const current=normalizeCbbOwlsCurrent(ownGame,{success:true,data:[e]},fetched,decision).quotes;
 assert.equal(current.length,3,`${source.away_team}: all own-market pairs normalize`);
 assert.equal(current.find(q=>q.market==="spread")?.line,-3.5);
 assert.deepEqual(normalizeCbbOwlsCurrent(ownGame,{success:true,data:[{...e,home_team:e.away_team,away_team:e.home_team}]},fetched,decision).quotes,current);
 for(const bad of [{...e,sport:"nba"},{...e,commence_time:"2026-11-05T00:00:00Z"},{...e,away_team:"Wrong institution"}])
  assert.equal(normalizeCbbOwlsCurrent(ownGame,{success:true,data:[bad]},fetched,decision).quotes.length,0);
 const nativeId=source.eventId;
 const history=normalizeCbbOwlsHistory(ownGame,{homeTeam:source.home_team,awayTeam:source.away_team},[
  {book:"pinnacle",market:"spreads",side:"home",price:-110,pointValue:-3.5,recordedAt:captured,recordedAtUtc:captured},
  {book:"pinnacle",market:"spreads",side:"away",price:-110,pointValue:3.5,recordedAt:captured,recordedAtUtc:captured}],fetched,decision);
 assert.equal(history.quotes.length,1);
 const rows=["home","away"].map((side,i)=>({id:i+1,provider:"owls",provider_event_id:nativeId,
  ingestion_run_id:`cbb:2026-11-03:${fetched}`,canonical_event_id:String(ownGame.id),canonical_market_id:`${ownGame.id}:spread`,
  league:"cbb",sportsbook:"pinnacle",sharp_book:true,market_type:"spread",selection_key:`${ownGame.id}:spread:${side}`,
  line:side==="home"?-3.5:3.5,american_price:-110,decimal_price:1+100/110,no_vig_probability:.5,
  provider_timestamp:captured,fetched_at:fetched,inserted_at:"2026-11-03T12:00:01Z",raw_payload_hash:String(i+1).padStart(64,"a"),minutes_to_start:720})) as CbbCanonicalPriceRow[];
 const paired=pairCbbCanonicalMarketEvidence({game:ownGame,decisionAt:decision,priceRows:rows});
 assert.equal(paired.pricePairs.length,1,`${source.away_team}: native ID reaches the R5 reader`);
 assert.equal(paired.pricePairs[0].first.ownLine,-3.5);
 const changed=rows.map(row=>({...row,provider_event_id:nativeId.replace(/-\d{8}$/, "-20261105")}));
 assert.equal(pairCbbCanonicalMarketEvidence({game:ownGame,decisionAt:decision,priceRows:changed}).pricePairs.length,0);
}
assert.notEqual(name("N Arizona"),name("Arizona"));
assert.notEqual(name("N Arizona"),name("Arizona State"));
assert.notEqual(name("Fullerton"),name("Fullerton College"));
assert.notEqual(name("IPFW"),name("Purdue"));
assert.notEqual(name("S Dakota St"),name("South Dakota"));
assert.notEqual(name("S Dakota St"),name("San Diego State"));
console.log("CBB verified institution aliases, negative school identities, exact sides/time/league, partial-market promotion, complete-book precedence and D1 schedule coverage passed.");
