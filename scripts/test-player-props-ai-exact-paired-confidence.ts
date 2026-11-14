/** Future exact paired policy versus frozen original semantics. All I/O blocked. */
import assert from 'node:assert/strict';
import {gradeAiEventFromMass,gradeAiEventFromExactPairedMass,priceAiLaw,type ExactEventGradeArgs} from '../lib/playerPropsAi/pricing';
import {validateLaw,lawForecast,type AcceptedPlayerLaw} from '../lib/playerPropsAi/law';
import {PROPS_AI_RELEASE,PROPS_AI_LAW_RELEASE,PRIOR_PROPS_AI_LAW_RELEASE,LEGACY_PROPS_AI_LAW_RELEASE,propsAiLawGradeRelease,propsAiLawSelectionRelease} from '../lib/playerPropsAi/releases';
import {PROPS_AI_EXACT_CONFIDENCE_PRICE_RELEASE} from '../lib/playerPropsAi/exactConfidencePrice';
import {digest,validatePacket} from '../lib/playerPropsAi/evidence';
import {normalizeBallDontLieNbaPlayerProps} from '../lib/services/nba/nbaPlayerPropsProviders';
import {mergeNbaPlayerPropsMarketHistory} from '../lib/services/nba/nbaPlayerPropsPrivateStore';
import {nbaAuthorityFixture} from './test-player-props-ai-nba-lock-authority';
import {nbaPlayedStateFixture} from './lib/player-props-ai-nba-played-fixture';
import {normalizeBalldontlieNflPlayerProps} from '../lib/services/football/nflPlayerPropsProviders';
import {buildTeamDepthSnapshot} from '../lib/services/football/balldontlieNflRoster';
import {buildNflPlayerPropsRuntimeFeatureRows,buildNflPlayerPropsRuntimeBoard} from '../lib/services/football/nflPlayerPropsRuntime';
import {buildNflPlayerPropsExactBoard} from '../lib/services/football/nflPlayerPropsMarketBoard';
import {reconcileNflPlayerPropsProductionSnapshot,buildNflPlayerPropsMemberSnapshot} from '../lib/services/football/nflPlayerPropsProductionContract';
import {parseBallDontLiePlayerProps} from '../lib/mlb/props/providerClients';
import type {MlbPropsBoardSnapshot} from '../lib/mlb/props/boardSnapshotStore';
import type {PlayerPropPreviewRow} from '../app/mlb/props/components/PlayerPropsDashboard';
import {liveNbaPacket,liveNflPacket,liveMlbPacket} from '../lib/playerPropsAi/liveSources';
import {encodeCanonicalScenarioLaw} from '../lib/playerPropsAi/generativeCoordinates';
import {parseJointReview} from '../lib/playerPropsAi/request';
import {PROPS_AI_WIRE_RELEASE} from '../lib/playerPropsAi/scenarioCoordinates';
import {verifiedReaderFixture} from './lib/player-props-ai-reader-fixture';
import {evidenceAliases} from '../lib/playerPropsAi/input';
import {independentPriorEvents} from '../lib/playerPropsAi/priorEvents';
import {criticalContextHashes} from '../lib/playerPropsAi/criticalContext';
import type {AcceptedGameReview} from '../lib/playerPropsAi/reviewer';
import type {GamePacket,Sport} from '../lib/playerPropsAi/evidenceContract';
import {siteAiDecisions} from '../lib/playerPropsAi/publication';
import {applyNbaSiteAi,applyNflSiteAi,applyMlbSiteAi} from '../lib/playerPropsAi/siteBindings';
import {advanceNbaPlayerPropsCandidateLifecycle} from '../lib/services/nba/nbaPlayerPropsLifecycle';

globalThis.fetch=async()=>{throw Error('Exact paired controls forbid network/provider/count/model/SQL');};
const B=BigInt,z=()=>Array<number>(16).fill(0),v=(n:number)=>Array<number>(16).fill(n);
// Independent fraction implementation: no production paired helper or decimal
// diagnostic participates in its policy comparisons.
type Fraction={n:bigint;d:bigint};
const add=(a:Fraction,b:Fraction)=>({n:a.n*b.d+b.n*a.d,d:a.d*b.d});
const sub=(a:Fraction,b:Fraction)=>({n:a.n*b.d-b.n*a.d,d:a.d*b.d});
const compare=(a:Fraction,b:Fraction)=>{const n=a.n*b.d-b.n*a.d;return n===B(0)?0:n>B(0)?1:-1;};
const implied=(p:number):Fraction=>p>0?{n:B(100),d:B(100)+B(p)}:{n:B(-p),d:B(100)-B(p)};
function oracle(x:ExactEventGradeArgs){
 const p={n:B(x.win),d:B(x.total)},nonpush=B(x.win+x.loss);
 const ev=x.american>0?B(x.win)*B(x.american)-B(x.loss)*B(100):B(x.win)*B(100)-B(x.loss)*B(-x.american);
 let paired=false;
 if(x.opposingAmerican!==null&&nonpush>B(0)){
  const a=implied(x.american),hold=add(a,implied(x.opposingAmerican)),allowance=compare(hold,{n:B(1),d:B(1)})>0?sub(hold,{n:B(1),d:B(1)}):{n:B(0),d:B(1)};
  const boundary=sub(a,allowance),required={n:boundary.n*nonpush,d:boundary.d*B(x.total)};
  paired=compare(hold,{n:B(49),d:B(50)})>=0&&compare(hold,{n:B(13),d:B(10)})<=0&&compare(p,{n:B(11),d:B(20)})>=0&&compare(p,required)>=0;
 }
 return x.exception?'No Play':x.confidence===2&&ev>B(0)?'Best Angle':x.confidence>=1&&ev>B(0)||x.confidence===2&&paired?'Lean':'Watchlist';
}
let cases=0,promotions=0,demotions=0,oldActionable=0,newActionable=0;
const actionable=(grade:string)=>grade==='Lean'||grade==='Best Angle';
for(let opposite=123;opposite<=1000;opposite++)for(const push of [0,1,100])for(const delta of [-1,0,1]){
 const win=opposite+delta,x={win,loss:100,push,total:win+100+push,american:-opposite-20,opposingAmerican:opposite,confidence:2,exception:null};
 const old=gradeAiEventFromMass(x),next=gradeAiEventFromExactPairedMass(x);
 assert.equal(next.grade,oracle(x));assert.equal(next.ev,old.ev);
 oldActionable+=Number(actionable(old.grade));newActionable+=Number(actionable(next.grade));
 promotions+=Number(!actionable(old.grade)&&actionable(next.grade));demotions+=Number(actionable(old.grade)&&!actionable(next.grade));cases++;
}
assert.deepEqual({cases,promotions,demotions,oldActionable,newActionable},{cases:7902,promotions:592,demotions:0,oldActionable:4432,newActionable:5024});
const boundary={win:128,loss:100,push:0,total:228,american:-148,opposingAmerican:128,confidence:2,exception:null};
assert.equal(gradeAiEventFromMass(boundary).grade,'Watchlist','Original R4 boundary behavior is frozen');
assert.equal(gradeAiEventFromExactPairedMass(boundary).grade,'Lean');
assert.equal(gradeAiEventFromExactPairedMass(boundary).confidenceLean!.release,PROPS_AI_EXACT_CONFIDENCE_PRICE_RELEASE);
for(const scale of [1,2,20])for(const price of [-148,-147,-149,Number.MAX_SAFE_INTEGER,-Number.MAX_SAFE_INTEGER])for(const opposite of [128,Number.MAX_SAFE_INTEGER,-Number.MAX_SAFE_INTEGER]){
 const x={...boundary,win:128*scale,loss:100*scale,total:228*scale,american:price,opposingAmerican:opposite};assert.equal(gradeAiEventFromExactPairedMass(x).grade,oracle(x));
}
for(const [american,opposingAmerican,win,loss]of [[-899,1150,9,1],[-900,1150,9,1],[-901,1150,9,1],[-399,100,6,4],[-400,100,6,4],[-401,100,6,4],[-130,100,11,9],[-130,100,10999,9001]] as const){
 const x={...boundary,american,opposingAmerican,win,loss,total:win+loss};assert.equal(gradeAiEventFromExactPairedMass(x).grade,oracle(x));
}
for(const confidence of [0,1,2])for(const exception of [null,'unsupported exact source'])for(const push of [0,20,1000]){
 const x={...boundary,confidence,exception,push,total:228+push};assert.equal(gradeAiEventFromExactPairedMass(x).grade,oracle(x));
}
for(const x of [{...boundary,win:0,loss:0,push:10,total:10},{...boundary,opposingAmerican:null},{...boundary,win:1,loss:15,total:16,american:1700,opposingAmerican:null},{...boundary,win:5,loss:2,total:7,american:-250,opposingAmerican:200}])assert.equal(gradeAiEventFromExactPairedMass(x).grade,oracle(x));
assert.equal(gradeAiEventFromExactPairedMass({...boundary,win:1,loss:15,total:16,american:1700,opposingAmerican:null}).grade,'Best Angle','Positive rare-event value remains promotable without inventing a pair');
assert.equal(gradeAiEventFromExactPairedMass({...boundary,american:150}).grade,'Best Angle');
assert.equal(gradeAiEventFromExactPairedMass({...boundary,american:150,confidence:1}).grade,'Lean');
assert.equal(gradeAiEventFromExactPairedMass({...boundary,american:150,confidence:0}).grade,'Watchlist');
assert.throws(()=>gradeAiEventFromExactPairedMass({...boundary,total:227}),/mass/);
assert.throws(()=>gradeAiEventFromExactPairedMass({...boundary,american:Number.MAX_SAFE_INTEGER+1}),/price/);

// Full source normalization and current-wire admission fixtures for every sport.
const at='2026-11-10T22:23:00Z',start='2026-11-10T23:30:00Z',lock='2026-11-10T22:30:00Z';
function sourceFixture(sport:Sport,side:'over'|'under'){
 const over=side==='over'?-148:128,under=side==='under'?-148:128;
 if(sport==='nba'){
  const f=nbaAuthorityFixture(),id='nba-bdl-player:1',game={id:'g',start,home:'NYK',away:'BOS'};
  const normalized=normalizeBallDontLieNbaPlayerProps({values:[{id:1,game_id:7,player_id:1,player:{first_name:'Current',last_name:'Name',team_id:1},prop_type:'points',vendor:'book',line_value:15.5,updated_at:at,market:{type:'over_under',over_odds:over,under_odds:under}}],fetchedAt:at,events:{'7':{canonicalGameId:'g',homeTeam:'NYK',awayTeam:'BOS',scheduledStart:start}},canonicalPlayers:{'1':id}});
  assert.equal(normalized.rejectedRows,0);assert.equal(normalized.rows.length,2);
  const current=normalized.rows.map(q=>({...q,receivedAt:at})),market=mergeNbaPlayerPropsMarketHistory({previous:null,current,slateDate:'2026-11-10',capturedAt:at}).history;
  const baseline=f.snapshot([{...f.row(),playerId:id,playerName:'Current Name'}]),state=nbaPlayedStateFixture('2026-11-10T22:20:00Z',[1],[14,18,20],[4,6,8]);
  return{packet:liveNbaPacket({game,window:{gameId:'g',stage:'final',cutoff:at,lock},snapshot:baseline,market,prior:state,current:state,currentObservations:current}),nba:baseline,nfl:null,mlb:null};
 }
 if(sport==='nfl'){
  const game={id:'synthetic',start,away:'KC',home:'BUF'},normalized=normalizeBalldontlieNflPlayerProps({values:[{id:10,game_id:game.id,player_id:7,vendor:'book',prop_type:'receptions',line_value:4.5,updated_at:at,market:{type:'over_under',over_odds:over,under_odds:under}}],fetchedAt:at});
  assert.equal(normalized.rows.length,2);
  const observations=normalized.rows.map(q=>({...q,canonicalGameId:game.id,providerPlayerId:'7',playerName:'Marquise Brown',playerTeam:'KC',receivedAt:at,homeTeam:'BUF',awayTeam:'KC',scheduledStart:start}));
  const awayDepth=buildTeamDepthSnapshot({team:'KC',capturedAt:at,sourceSnapshotId:'synthetic',rows:[{player:{id:7,first_name:'Marquise',last_name:'Brown',position:'WR'}}]});
  const context={providerSnapshotGeneratedAt:at,capturedAt:at,week:10,games:[{canonicalGameId:game.id,scheduledStart:start,awayTeam:'KC',homeTeam:'BUF',awayDepth,homeDepth:{team:'BUF',capturedAt:at,roster:[]},injuries:{eventId:game.id,awayTeam:'KC',homeTeam:'BUF',source:'BALLDONTLIE',sourceLabel:'synthetic',sourceUrl:null,reportUpdatedAt:at,playerClearances:[],teams:[{abbreviation:'KC',teamName:'KC',players:[]},{abbreviation:'BUF',teamName:'BUF',players:[]}]},mainMarket:{currentBooks:[]},weather:null}]};
  const source={generatedAt:at,observations,games:[{providerGameId:game.id,scheduledStart:start,awayTeam:'KC',homeTeam:'BUF'}]};
  const features=buildNflPlayerPropsRuntimeFeatureRows({snapshot:source,context} as never),offers=buildNflPlayerPropsExactBoard({snapshots:[source],evaluatedAt:at} as never),board=buildNflPlayerPropsRuntimeBoard({offers,features,evaluatedAt:at});
  assert(board.decisions.length>0,'Actual native builder supplies role/context qualification');
  const snapshot=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:10,evaluatedAt:at,nextBoard:board});
  const history={release:'synthetic played logs',updatedAt:at,games:[0,1,2].map(i=>({gameId:`played-${i}`,scheduledStart:`2026-11-0${i+1}T18:00:00Z`,homeTeam:'KC',awayTeam:'NYJ'})),stats:[0,1,2].map(i=>({gameId:`played-${i}`,scheduledStart:`2026-11-0${i+1}T18:00:00Z`,playerId:'7',playerName:'Marquise Brown',team:'KC',receptions:[4,6,8][i]})),teamStats:[],playMetrics:[]};
  return{packet:liveNflPacket({game,window:{gameId:game.id,stage:'final',cutoff:at,lock},snapshot,observations:source,history,context} as never),nba:null,nfl:board,mlb:null};
 }
 const current=parseBallDontLiePlayerProps({data:[{id:123,prop_type:'hits',game_id:1,player_id:2,vendor:'draftkings',line_value:.5,market:{type:'over_under',over_odds:over,under_odds:under}}]},at).map(q=>({...q,providerResponseAt:at}));assert.equal(current.length,2);
 const native={id:'synthetic',providerIds:{gameId:'balldontlie-game-1',bdlGameId:'1',bdlPlayerId:2,mlbStatsPlayerId:'mlbstats-player-2'},player:'Synthetic Batter',team:'NYY',opponent:'BOS',gameStartTime:start,market:'batter_hits',offerContract:'two_way',line:.5,side,book:'draftkings',odds:-148,lastUpdated:at,projection:1,finalProbability:.6,playGrade:'WATCHLIST',missingFeatures:[],oddsSanity:[],units:0,
  recentForm:{statLabel:'Hits',sampleLabel:'games',source:'Synthetic canonical played hits',asOfTimestamp:at,coverage:'recent_only',logs:[0,1,2].map((value,i)=>({gameId:String(i),date:`2026-11-0${i+1}`,opponent:'BOS',homeAway:'home',value,plateAppearances:4}))}} as unknown as PlayerPropPreviewRow;
 const snapshot={slateDate:'2026-11-10',snapshotId:'synthetic',asOfTimestamp:at,data:{props:[native]},modelContext:{modelReleaseId:'mlb_props_2026_10_21_r44'}} as unknown as MlbPropsBoardSnapshot;
 return{packet:liveMlbPacket({game:{id:'balldontlie-game-1',start,away:'NYY',home:'BOS'},window:{gameId:'balldontlie-game-1',stage:'final',cutoff:at,lock},snapshot,currentOdds:current,openingOdds:[]}),nba:null,nfl:null,mlb:[native]};
}
function accepted(packet:GamePacket,side:'over'|'under'){
 const aliases=evidenceAliases(packet),players=Object.fromEntries(packet.players.map(p=>{
  const outcomes:Record<string,number[]>=packet.sport==='nba'?{points:[14,18,...v(18).slice(2)],rebounds:v(6),assists:v(3),threes:v(1)}:packet.sport==='nfl'?{receptions:[4,6,...v(6).slice(2)]}:{batter_singles:[0,1,...z().slice(2)],batter_doubles:z(),batter_triples:z(),batter_home_runs:z(),batter_walks:z(),batter_strikeouts:z(),batter_rbis:z(),batter_runs_scored:z(),batter_stolen_bases:z()};
  const weights=side==='over'?[100,128,...z().slice(2)]:[128,100,...z().slice(2)];
  return[p.id,verifiedReaderFixture(packet,p.id,{priorRead:Object.fromEntries(independentPriorEvents(p).map(e=>[[...aliases].find(([,id])=>id===e.sourceId)![0],e.preferredOutcome])),evidenceIds:[[...aliases].find(([,id])=>id===p.evidence[0].id)![0]],gaps:[],confidence:p.markets.map(()=>2),exceptions:p.markets.map(()=>null),law:encodeCanonicalScenarioLaw(packet.sport,p,{weights,outcomes})})];
 }));
 const parsed=parseJointReview(packet,{wireRelease:PROPS_AI_WIRE_RELEASE,players}),hash=digest(packet);
 return{...parsed,release:PROPS_AI_RELEASE,gameId:packet.gameId,sourceGameId:packet.gameId,start,lock,cutoff:at,stage:'final',issuedAt:at,inputHash:hash,inputEvidence:{digest:hash},model:'synthetic-never-sent',partProvenance:[],marketScopes:Object.fromEntries(packet.players.map(p=>[p.id,p.markets])),criticalContextHashes:criticalContextHashes(packet)} as unknown as AcceptedGameReview;
}
let memberCases=0;
for(const sport of ['nba','nfl','mlb'] as const)for(const side of ['over','under'] as const){
 const f=sourceFixture(sport,side);validatePacket(f.packet);const current=accepted(f.packet,side);
 for(const era of ['current','prior','legacy'] as const){
  const review=structuredClone(current);
  if(era!=='current'){
   review.release=era==='prior'?'player_props_ai_2026_11_11_r36_urgent_slot_cohorts':'player_props_ai_2026_11_11_r35_terminal_wave_guard';
   for(const p of review.players){const law=p.law!;const body=era==='prior'?{release:PRIOR_PROPS_AI_LAW_RELEASE,weights:[...law.weights],integerWeights:[...law.integerWeights!],outcomes:structuredClone(law.outcomes)}:{release:LEGACY_PROPS_AI_LAW_RELEASE,weights:[...law.weights],outcomes:structuredClone(law.outcomes)};p.law={...body,hash:digest(body)} as AcceptedPlayerLaw;}
  }
  const original=JSON.stringify({packet:f.packet,review,nba:f.nba,nfl:f.nfl,mlb:f.mlb}),choices=siteAiDecisions(f.packet,review,at),c=choices[0];assert.equal(choices.length,1);assert.equal(c.side,side);
  assert.equal(c.grade,era==='current'?'Lean':'Watchlist');assert.equal(c.evidence.gradeRelease,propsAiLawGradeRelease(review.players[0].law!.release));assert.equal(c.evidence.selectionRelease,propsAiLawSelectionRelease(review.players[0].law!.release));
  const later=structuredClone(f.packet),laterAt='2026-11-10T22:24:00Z';for(const q of [...later.quotes,...(later.executionQuotes??[])]){q.receivedAt=q.observedAt=laterAt;if(q.side===side)q.american=-149;}
  if(f.nba){
   for(const baseline of [f.nba,{...f.nba,decisions:[]}]){const applied=applyNbaSiteAi(baseline,f.packet,choices,at);assert.equal(applied.decisions[0].grade,c.grade);assert.equal(applied.decisions[0].aiReview!.gradeRelease,c.evidence.gradeRelease);assert(!('exactEventMass' in applied.decisions[0]));
    const repriced=applyNbaSiteAi(baseline,later,siteAiDecisions(later,review,laterAt),laterAt).decisions[0];assert.equal(repriced.grade,c.grade);assert(repriced.expectedValue!<applied.decisions[0].expectedValue!);
    const frozen=advanceNbaPlayerPropsCandidateLifecycle({now:lock,previous:applied,candidate:applied}).snapshot,locked={...frozen,decisions:[...frozen.decisions,...frozen.decisions]},bytes=JSON.stringify(locked);const malformed=structuredClone(choices);delete malformed[0].exactEventMass;assert.strictEqual(applyNbaSiteAi(locked,later,malformed,laterAt),locked);assert.equal(JSON.stringify(locked),bytes);}
  }else if(f.nfl){
   const applied=applyNflSiteAi(f.nfl,f.packet,choices,at),row=applied.decisions.find(r=>r.side===side)!;assert.equal(row.grade,c.grade);assert(!row.aiReview!.nativeQualification);
   const repriced=applyNflSiteAi(f.nfl,later,choices,laterAt).decisions.find(r=>r.side===side)!;assert.equal(repriced.grade,c.grade);assert(repriced.expectedValue<row.expectedValue);
   const before=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:10,evaluatedAt:at,nextBoard:applied}),locked=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:10,evaluatedAt:lock,nextBoard:applied,previous:before}),bytes=JSON.stringify(locked);
   const draft={...locked.board,decisions:[...locked.board.decisions,...locked.board.decisions],publicationEnabled:false as const,trackingEnabled:false as const},draftBytes=JSON.stringify(draft),malformed=structuredClone(choices);delete malformed[0].exactEventMass;assert.strictEqual(applyNflSiteAi(draft,later,malformed,laterAt),draft);assert.equal(JSON.stringify(draft),draftBytes);assert.deepEqual(buildNflPlayerPropsMemberSnapshot(locked,lock).memberDecisions,locked.memberDecisions);assert.equal(JSON.stringify(locked),bytes);
   if(era==='current'){const bad=structuredClone(choices);bad[0].evidence.gradeRelease='wrong';assert.throws(()=>applyNflSiteAi(f.nfl!,later,bad,laterAt),/release mismatch/);}
  }else{
   const applied=applyMlbSiteAi(f.mlb!,f.packet,choices,at),row=applied[0];assert.equal(row.playGrade,era==='current'?'LEAN':'WATCHLIST');assert.equal(row.units,era==='current'?1:0);
   const repriced=applyMlbSiteAi(f.mlb!,later,choices,laterAt)[0];assert.equal(repriced.playGrade,row.playGrade);assert(repriced.expectedValue!<row.expectedValue!);
   const frozen=applied.map(r=>({...r,lockStatus:{status:'locked' as const,lockedAt:lock}})),locked=[...frozen,...frozen],bytes=JSON.stringify(locked),malformed=structuredClone(choices);delete malformed[0].exactEventMass;assert.strictEqual(applyMlbSiteAi(locked,later,malformed,laterAt),locked);assert.equal(JSON.stringify(locked),bytes);
   if(era==='current'){const bad=structuredClone(choices);bad[0].evidence.selectionRelease='wrong';assert.throws(()=>applyMlbSiteAi(f.mlb!,later,bad,laterAt),/release mismatch/);}
  }
  assert.equal(JSON.stringify({packet:f.packet,review,nba:f.nba,nfl:f.nfl,mlb:f.mlb}),original);memberCases++;
 }
}
// Signed units and inclusive rare-event semantics do not change with grading.
const signed=validateLaw('nfl',{markets:['rushing_yards']},{weights:[128,100,...z().slice(2)],outcomes:{rushing_yards:[-2,4,...z().slice(2)]}}),signedBefore=JSON.stringify(signed);
for(const indices of [Array.from({length:16},(_,i)=>i),Array.from({length:16},(_,i)=>15-i)]){
 const law=validateLaw('nfl',{markets:['rushing_yards']},{weights:indices.map(i=>signed.integerWeights![i]),outcomes:{rushing_yards:indices.map(i=>signed.outcomes.rushing_yards[i])}});assert.deepEqual(lawForecast(law,'rushing_yards',0),lawForecast(signed,'rushing_yards',0));
 const q={id:'under',book:'same',provider:'synthetic',line:0,side:'under' as const,american:-148,availableAt:at,confirmedAt:at,current:true,actionRule:'qualifying_participation' as const};
 assert.equal(priceAiLaw({law,market:'rushing_yards',quotes:[q,{...q,id:'over',side:'over',american:128}],now:at,maxAgeMs:60000,confidence:2,exception:null})!.grade,'Lean');
}
assert.equal(signed.release,PROPS_AI_LAW_RELEASE);assert.equal(JSON.stringify(signed),signedBefore);
const pair=[{id:'under',book:'same',provider:'synthetic',line:0,side:'under' as const,american:-148,availableAt:at,confirmedAt:at,current:true,actionRule:'qualifying_participation' as const},{id:'over',book:'same',provider:'synthetic',line:0,side:'over' as const,american:128,availableAt:'2026-11-10T22:17:00Z',confirmedAt:'2026-11-10T22:17:00Z',current:true,actionRule:'qualifying_participation' as const}];
assert.equal(priceAiLaw({law:signed,market:'rushing_yards',quotes:pair,now:at,maxAgeMs:900000,confidence:2,exception:null})!.grade,'Watchlist','A separately stale pair cannot support a confidence Lean');
console.log(JSON.stringify({futureExactPairedPolicy:true,cases,promotions,demotions,oldActionable,newActionable,actualNormalizedFullWireThreeEraMemberCases:memberCases,originalR1R2Unchanged:true,storedWriterReaderLocksExact:true,currentNflMlbExecutionRepriced:true,networkCalls:0}));
