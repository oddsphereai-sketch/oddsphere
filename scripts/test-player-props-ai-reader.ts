import assert from "node:assert/strict";
import {PRODUCT_RELEASE,type GamePacket,type Evidence,type Json} from "../lib/playerPropsAi/evidenceContract";
import {digest} from "../lib/playerPropsAi/evidence";
import {compileMarketReport} from "../lib/playerPropsAi/marketReport";
import {readerEvidence,READER_AREAS,validateCoverage,validatePlayerCoverage,hasUnsupportedCertainty,type ReaderCoverage} from "../lib/playerPropsAi/readerCoverage";
import {readerLogWindows} from "../lib/playerPropsAi/readerLogs";
import {attachGameReaderContext,type ReaderGameContext} from "../lib/playerPropsAi/gameContext";
import {readableInput,evidenceAliases} from "../lib/playerPropsAi/input";
import {PROPS_AI_WIRE_RELEASE} from "../lib/playerPropsAi/scenarioCoordinates";
import {jointReviewRequest,parseJointReview,parseReaderReview,readerReviewRequest} from "../lib/playerPropsAi/request";
import {prepareReviewParts} from "../lib/playerPropsAi/partitions";
import {nbaReaderBenchmark} from "../lib/playerPropsAi/nbaBenchmarks";
import type {NbaPlayerPropsCurrentState} from "../lib/services/nba/nbaPlayerPropsCurrentState";
import {attachNflReaderMarkets} from "../lib/playerPropsAi/nflMarkets";
import type {NflPlayerPropsMarketObserverHistory} from "../lib/services/football/nflPlayerPropsMarketObserverStore";
const at="2026-11-06T18:00:00Z";
const evidence=(id:string,kind:Evidence["kind"],value:Json):Evidence=>({id,kind,value,source:"synthetic source",availableAt:at});
const log=(id:string,date:string,minutes:number,points:number)=>evidence(id,"recent_games",{game:{startTime:date,homeTeam:"A",awayTeam:"B"},box:{minutes,points,fga:points/2,fg3a:2}});
const packet:GamePacket={release:PRODUCT_RELEASE,sport:"nba",gameId:"reader",start:"2026-11-06T23:00:00Z",lock:"2026-11-06T22:00:00Z",cutoff:"2026-11-06T21:00:00Z",stage:"final",sourceLimitations:[],quotes:[],
  players:[{id:"p",name:"Synthetic Player",team:"A",opponent:"B",markets:["points"],missing:[],evidence:[
    log("latest","2026-11-05T23:00:00Z",30,24),log("older","2026-11-03T23:00:00Z",20,12),log("dnp","2026-11-01T23:00:00Z",0,0),
    evidence("model","independent_model",{market:"points",line:18.5,independentProjection:18,independentSelectedSideProbability:.5,selectedSide:"over",
      role:[{key:"minutes",label:"Minutes",value:25}],production:[{label:"Recent points",value:18}],matchup:[{key:"opp_defense",label:"Opponent defensive rating",value:105},{key:"pace",label:"Pace",value:100}]}),
    evidence("h2h","matchup_history",{status:"no_history",gamesPlayed:0,plateAppearances:0,hits:0}),
    evidence("injury","availability",{context:{away:{team:"A",known:true,players:[{name:"Teammate",status:"Out"}]},home:{team:"B",known:true,players:[]}}}),
  ]}]};
for(const opening of [true,false])for(const side of ["over","under"] as const)packet.quotes.push({id:`${opening}-${side}`,playerId:"p",market:"points",provider:"synthetic",book:"one",line:opening?20.5:18.5,
  side,american:side==="over"?-105:-115,opening,receivedAtProvenance:"provider_response",observedAt:opening?"2026-11-05T18:00:00Z":"2026-11-06T20:58:00Z",receivedAt:"2026-11-06T20:59:00Z",live:false});
const before=digest(packet),compiled=compileMarketReport(packet),catalog=readerEvidence(compiled),r=catalog.p;
assert.deepEqual(Object.keys(r),[...READER_AREAS]);
assert.equal(r.head_to_head.status,"missing"); // Zero appearances are absence of history, not a bad batting average.
assert.equal(r.availability.status,"partial"); // Teammate out does not mean own player out or healthy.
assert.ok(r.availability.facts.some(f=>JSON.stringify(f.value).includes("not_listed_or_unverified")));
assert.equal((r.recent_form.facts[0].value as {distinctGames:number}).distinctGames,3);
assert.equal((r.recent_form.facts[0].value as {summarizedGames:number}).summarizedGames,2);
assert.equal(r.matchup.status,"available");assert.equal(r.game_environment.status,"available");
assert.equal(compiled.quotes.filter(q=>q.opening).length,2); // Opening is a DIFFERENT line and must survive.
const report=compiled.players[0].evidence.find(e=>e.kind==="market")!.value as {books:{openingPairs:{line:number}[]}[]};
assert.equal(report.books[0].openingPairs[0].line,20.5);
const input=readableInput(compiled,{compactClocks:true,readerCoverage:true});
assert.equal(input.format,"player_props_readable_tables_r11_explicit_prior_events");
assert.match(input.schema.bookRow,/allSuppliedOpeningPairs/);
assert.ok(input.players[0].readerAreas);
assert.match(JSON.stringify(input.players[0].readerAreas?.market),/readFromEvidence/);
const withoutNavigation=readableInput(compiled,{compactClocks:true});
assert.deepEqual(input.quoteTraces,withoutNavigation.quoteTraces);
assert.equal(input.rawQuoteCount,withoutNavigation.rawQuoteCount);
assert.deepEqual(input.players[0].evidence,withoutNavigation.players[0].evidence); // Navigation never removes the underlying quotes.
const publishedA=structuredClone(compiled),publishedB=structuredClone(compiled);
for(const [source,projection,probability] of [[publishedA,1,.99],[publishedB,100,.01]] as const){
  const head=source.players[0].evidence.find(e=>e.kind==="independent_model")!.value as Record<string,Json>;
  head.storedPublishedProjection=projection;head.storedPublishedProbability=probability;
}
const {rawPacketDigest:digestA,...priorA}=readableInput(publishedA,{compactClocks:true,readerCoverage:true});
const {rawPacketDigest:digestB,...priorB}=readableInput(publishedB,{compactClocks:true,readerCoverage:true});
assert.notEqual(digestA,digestB);assert.deepEqual(priorA,priorB); // Old market-adjusted predictions cannot reinforce the independent prior.
assert.ok(!JSON.stringify(priorA).includes("storedPublished"));
assert.equal(jointReviewRequest(compiled,"gpt-6-luna",10000).store,false);
assert.deepEqual(JSON.parse(readerReviewRequest(compiled,"gpt-6-luna",10000).input),JSON.parse(jointReviewRequest(compiled,"gpt-6-luna",10000).input));
const coverage=Object.fromEntries(READER_AREAS.map(area=>[area,{status:r[area].status,factIds:r[area].facts.slice(0,1).map(f=>f.id),effect:r[area].status==="missing"?"unavailable":"uncertain",observation:"Supplied facts require contextual caution."}])) as ReaderCoverage;
const accepted=validateCoverage(r,coverage);
const wire={priorRead:Object.fromEntries(compiled.players[0].evidence.filter(e=>e.kind==="independent_model").map(e=>[[...evidenceAliases(compiled)].find(([,id])=>id===e.id)![0],"tie"])),assessment:"Synthetic conditional forecast.",coverage,evidenceIds:["e0"],gaps:[],law:{weights:Array(16).fill(1),outcomes:{points:Array.from({length:16},(_,i)=>i===1?24:10),rebounds:Array(16).fill(4),assists:Array(16).fill(3),threes:Array(16).fill(2)}},confidence:[1],exceptions:[null]};
const matrixForecast=parseJointReview(compiled,{wireRelease:PROPS_AI_WIRE_RELEASE,players:{p:wire}});
assert.throws(()=>parseJointReview(compiled,{players:{p:wire}}),/wire release mismatch/);
assert.throws(()=>parseJointReview(compiled,{wireRelease:"props_scenario_rows_legacy",players:{p:wire}}),/wire release mismatch/);
assert.equal(matrixForecast.players[0].law!.outcomes.points[0],10);assert.equal(matrixForecast.players[0].law!.outcomes.threes[0],2);
assert.throws(()=>parseJointReview(compiled,{wireRelease:PROPS_AI_WIRE_RELEASE,players:{p:{...wire,law:[[1,10,4,3,2]]}}}),/Named scenario law/);
assert.throws(()=>parseJointReview(compiled,{wireRelease:PROPS_AI_WIRE_RELEASE,players:{p:{...wire,law:Array.from({length:16},()=>[1,-1,4,3,2])}}}),/Named scenario law/);
assert.equal(accepted.recent_form.facts[0].hash,r.recent_form.facts[0].hash);
assert.equal(parseReaderReview(compiled,{players:{p:{coverage}}}).players.length,1);
assert.throws(()=>parseReaderReview(compiled,{players:{}}),/omitted/);
const missing=structuredClone(coverage);delete (missing as Partial<ReaderCoverage>).matchup;
assert.throws(()=>validateCoverage(r,missing),/omitted/);
const invented=structuredClone(coverage);invented.market.factIds=[r.recent_form.facts[0].id];
assert.throws(()=>validateCoverage(r,invented),/fabricated/);
const badHistory=structuredClone(coverage);badHistory.head_to_head.effect="downward";
assert.throws(()=>validateCoverage(r,badHistory),/Missing history/);
const badStatus=structuredClone(coverage);badStatus.availability.status="available";
assert.throws(()=>validateCoverage(r,badStatus),/misrepresented/);
const inventedNumber=structuredClone(coverage);inventedNumber.recent_form.observation="Averages 99 points.";
assert.throws(()=>validateCoverage(r,inventedNumber),/figures/);
const truncated=structuredClone(coverage);truncated.market.observation="The exact-game report is";
assert.throws(()=>validateCoverage(r,truncated),/complete sentence/);
assert.equal(hasUnsupportedCertainty("He is unlisted, not confirmed healthy or starting."),false);
assert.equal(hasUnsupportedCertainty("There is no verified smart money in the supplied source."),false);
assert.equal(hasUnsupportedCertainty("He is confirmed healthy."),true);
assert.equal(hasUnsupportedCertainty("He is not listed but confirmed healthy."),true);
assert.equal(hasUnsupportedCertainty("Smart money guarantees this result."),true);
const oldEvidence=structuredClone(r);oldEvidence.recent_form.limitations.push("old_game_history: Recorded performance is dated.");
assert.throws(()=>validateCoverage(oldEvidence,coverage),/dated-history/);
const cautious=structuredClone(coverage);cautious.recent_form.observation="The history is dated and cannot establish current workload.";
assert.doesNotThrow(()=>validateCoverage(oldEvidence,cautious));
const split=structuredClone(coverage);split.matchup.observation="The arsenal is effective against left-handed hitters.";
assert.throws(()=>validatePlayerCoverage({markets:["pitcher_strikeouts"]},r,split),/opponent-handedness/);
split.matchup.observation="There are no splits against left-handed hitters.";
assert.doesNotThrow(()=>validatePlayerCoverage({markets:["pitcher_strikeouts"]},r,split));
// The reader must see changed evidence rather than a stale cached fact value/hash.
const counterfactual=structuredClone(compiled);(counterfactual.players[0].evidence[0].value as {box:{points:number}}).box.points=40;
assert.notEqual(readerEvidence(counterfactual).p.recent_form.facts[0].hash,r.recent_form.facts[0].hash);
assert.equal(digest(packet),before); // Original records, including a prior locked-source payload, are read only.

// Cross-provider aliases reconcile exactly once; conflicting stats remain explicit.
const nflRows=[evidence("bdl","recent_games",{game:{scheduledStart:"2026-11-01T18:00:00Z",homeTeam:"WAS",awayTeam:"MIN"},box:{rushing_attempts:10,rushing_yards:50}}),
  evidence("verse","recent_games",{game:{start:"2026-11-01T18:00:00+00:00",home:"WSH",away:"MIN"},box:{carries:10,rushing_yards:50}})];
assert.equal(readerLogWindows("nfl",nflRows).distinctGames,1);
assert.equal(readerLogWindows("nfl",nflRows).windows.last3.statistics.rushing_attempts.mean,10);
(nflRows[1].value as {box:{rushing_yards:number}}).box.rushing_yards=80;
const conflict=readerLogWindows("nfl",nflRows);
assert.equal(conflict.conflicts.length,1);assert.equal(conflict.windows.last3.statistics.rushing_yards,undefined);

const context:ReaderGameContext={id:"ctx",gameId:"reader",start:packet.start,awayTeam:"A",homeTeam:"B",availableAt:at,source:"existing collector",
  injuries:{reportUpdatedAt:at,teams:[{abbreviation:"A",players:[{name:"Synthetic Player",status:"Out"}]}]},
  depth:{away:{expectedStartingQuarterback:{name:"Projected QB",starterStatus:"projected"}},home:{}},weather:{status:"controlled_indoor",roofType:"fixed"}};
assert.equal(attachGameReaderContext(packet,[{...context,homeTeam:"C"}]).players[0].evidence.length,packet.players[0].evidence.length);
const future={...context,injuries:{reportUpdatedAt:"2026-11-07T00:00:00Z",teams:[]}};
assert.ok(!attachGameReaderContext(packet,[future]).players[0].evidence.some(e=>e.id.includes("game-context:injuries")));
assert.ok(attachGameReaderContext(packet,[context]).players[0].evidence.some(e=>e.kind==="availability"&&e.id.includes("game-context:injuries")));

// MLB posted batting order is opportunity, not a health clearance; unavailable independent inputs stay missing.
const mlb:GamePacket={...packet,sport:"mlb",quotes:[],players:[{...packet.players[0],markets:["batter_hits"],evidence:[
  evidence("lineup","availability",{status:"posted",battingOrder:8,position:"CF"}),
  evidence("empty-head","independent_model",{market:"batter_hits",independentProjection:null,storedPublishedProjection:1.5}),
  evidence("park","matchup",{park:{runFactor:104},weather:{temperatureF:60}}),
  evidence("pitchmix","matchup",{coverageStatus:"available",hitterBats:"L",pitcherThrows:"L",weighted:{xwoba:.3},pitches:[{code:"FF",pitcherUsagePercent:70}]}),
]}]};
const m=readerEvidence(mlb).p;assert.equal(m.availability.status,"partial");assert.equal(m.opportunity_role.status,"available");
assert.equal(m.independent_model.status,"missing");assert.equal(m.game_environment.status,"available");assert.equal(m.matchup.status,"available");
const state={season:2026,updatedAt:at,games:[{gameId:1,season:2026,startTime:"2026-11-01T18:00:00Z",homeTeamId:1,awayTeamId:2,homeTeam:"A",awayTeam:"B",homeScore:100,awayScore:100}],advanced:[],
  boxes:Array.from({length:10},(_,i)=>({rowId:i+1,gameId:1,teamId:i<5?1:2,playerId:i+1,minutes:48,fgm:8,fga:15,fg3m:2,fg3a:4,ftm:2,fta:3,oreb:2,dreb:5,ast:3,stl:1,blk:1,turnover:2,pf:2,points:20,plusMinus:0}))} as unknown as NbaPlayerPropsCurrentState;
const benchmarkSource=digest(state),benchmark=nbaReaderBenchmark(packet,[state]);assert.ok(benchmark);
assert.equal((benchmark.value as {reference:{league_current_season_team_games:number}}).reference.league_current_season_team_games,2);
assert.equal(nbaReaderBenchmark(packet,[{...state,updatedAt:"2026-11-07T00:00:00Z"}]),null);
assert.equal(digest(state),benchmarkSource);
const withReference={...packet,players:packet.players.map(p=>({...p,evidence:[...p.evidence,{...benchmark,id:`${p.id}:${benchmark.id}`}]}))};
assert.ok(readerEvidence(withReference).p.game_environment.facts.some(f=>f.label.includes("Observed league pace")));
const precise=structuredClone(compiled);(precise.players[0].evidence[0].value as {box:{points:number}}).box.points=12.345678901;
const preciseTables=readableInput(precise,{compactClocks:true,readerCoverage:true});
assert.ok(JSON.stringify(preciseTables).includes("12.3457"));
assert.deepEqual(preciseTables.quoteTraces,readableInput(precise,{compactClocks:true}).quoteTraces);
assert.equal((precise.players[0].evidence[0].value as {box:{points:number}}).box.points,12.345678901);
const nflPacket:GamePacket={...packet,sport:"nfl",quotes:[],players:[{...packet.players[0],markets:["rushing_yards"]}]};
const observer={rows:[{gameId:packet.gameId,scheduledStart:packet.start,capturedAt:at,playerName:"Synthetic Player",landmark:"t24",market:"rushing_yards",provider:"balldontlie",sportsbook:"synthetic",observedLine:50.5,overPrice:-110,underPrice:-110,yesPrice:null,observedAt:at}]} as unknown as NflPlayerPropsMarketObserverHistory;
const marketSource={availableAt:at,observer,references:[]},marketSourceHash=digest(marketSource);
const bothSides=attachNflReaderMarkets(nflPacket,marketSource);
assert.deepEqual(bothSides.quotes.map(q=>q.side).sort(),["over","under"]);
assert.ok(bothSides.quotes.every(q=>q.receivedAtProvenance==="snapshot_availability"));
assert.equal(attachNflReaderMarkets(nflPacket,{...marketSource,availableAt:"2026-11-07T00:00:00Z"}).quotes.length,0);
assert.equal(attachNflReaderMarkets({...nflPacket,players:[...nflPacket.players,{...nflPacket.players[0],id:"ambiguous"}]},marketSource).quotes.length,0);
assert.equal(digest(marketSource),marketSourceHash);
console.log("Player-prop reader checks passed: eight mandatory areas, exact citations, conditional participation, provider reconciliation, cross-line openings, contextual joins, time/identity guards, counterfactual facts and immutable inputs. No network calls.");
async function checkCompletePartitions(){
  const full:GamePacket={...packet,quotes:[],players:Array.from({length:32},(_,i)=>({...packet.players[0],id:`p${i}`,evidence:packet.players[0].evidence.map(e=>({...e,id:`p${i}:${e.id}`}))}))};
  const before=digest(full),parts=await prepareReviewParts(full,{key:"synthetic",count:async p=>p.players.length*15000});
  assert.equal(parts.length,4);assert.deepEqual(parts.flatMap(p=>p.packet.players.map(p=>p.id)).sort(),full.players.map(p=>p.id).sort());
  for(const part of parts)for(const p of part.packet.players)assert.deepEqual(p,full.players.find(source=>source.id===p.id));
  assert.equal(digest(full),before);
  // A request that cannot fit fails explicitly; it never silently drops players or fields.
  await assert.rejects(()=>prepareReviewParts({...full,players:full.players.slice(0,2)},{key:"synthetic",count:async()=>150000}),/capacity/);
  console.log("Complete reader partition checks passed: all players, markets and evidence preserved within bounded requests; oversized input fails explicitly.");
}
void checkCompletePartitions();
