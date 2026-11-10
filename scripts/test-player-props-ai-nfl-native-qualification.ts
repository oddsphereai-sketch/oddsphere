/* eslint-disable @typescript-eslint/no-explicit-any -- Synthetic captured provider shapes exercise the real native builder/parser/writer boundaries without I/O. */
import assert from 'node:assert/strict';
import {buildTeamDepthSnapshot} from '../lib/services/football/balldontlieNflRoster';
import {buildNflPlayerPropsRuntimeFeatureRows,buildNflPlayerPropsRuntimeBoard,type NflPlayerPropsRuntimeDecision as Row} from '../lib/services/football/nflPlayerPropsRuntime';
import {buildNflPlayerPropsExactBoard} from '../lib/services/football/nflPlayerPropsMarketBoard';
import {reconcileNflPlayerPropsProductionSnapshot} from '../lib/services/football/nflPlayerPropsProductionContract';
import {liveNflPacket} from '../lib/playerPropsAi/liveSources';
import {siteAiDecisions} from '../lib/playerPropsAi/publication';
import {applyNflSiteAi,restoreNflNativeGame} from '../lib/playerPropsAi/siteBindings';
import {testNflHandoffCapture,testNflSourceAuthority,mergeNflHandoffs} from '../lib/playerPropsAi/nflLockAuthority';
import {nflNativePublicationContext} from '../lib/playerPropsAi/nflNativeQualification';
import {digest} from '../lib/playerPropsAi/evidence';
import {criticalContextHashes} from '../lib/playerPropsAi/criticalContext';
import {parseJointReview} from '../lib/playerPropsAi/request';
import {independentPriorEvents} from '../lib/playerPropsAi/priorEvents';
import {evidenceAliases} from '../lib/playerPropsAi/input';
import {PROPS_AI_WIRE_RELEASE} from '../lib/playerPropsAi/scenarioCoordinates';
import {verifiedReaderFixture} from './lib/player-props-ai-reader-fixture';
import type {AcceptedGameReview} from '../lib/playerPropsAi/reviewer';
import type {GamePacket} from '../lib/playerPropsAi/evidenceContract';

globalThis.fetch=async()=>{throw Error('NFL native qualification controls forbid all HTTP');};
Object.assign(process.env,{NODE_ENV:'test'});
const at='2026-11-11T00:14:00Z',past='2026-11-11T00:13:00Z',later='2026-11-11T00:13:30Z',start='2026-11-11T01:15:00Z',lock='2026-11-11T00:15:00Z';
const game={id:'synthetic',start,away:'KC',home:'BUF'},history={updatedAt:at,games:[],stats:[],teamStats:[],playMetrics:[]};
function fixture({native=false,two=false,status=null,clear=false,sourceNative=false}:{native?:boolean;two?:boolean;status?:string|null;clear?:boolean;sourceNative?:boolean}={}){
 const awayDepth=buildTeamDepthSnapshot({team:'KC',capturedAt:past,sourceSnapshotId:'synthetic',rows:[{player:{id:666,first_name:'Marquise',last_name:'Brown',position:'WR'},injury_status:status}]});
 const context:any={providerSnapshotGeneratedAt:at,capturedAt:at,games:[{canonicalGameId:game.id,scheduledStart:start,awayTeam:'KC',homeTeam:'BUF',awayDepth,homeDepth:{provider:'balldontlie',team:'BUF',capturedAt:past,roster:[]},injuries:{eventId:game.id,awayTeam:'KC',homeTeam:'BUF',source:'BALLDONTLIE',sourceLabel:'synthetic',sourceUrl:null,reportUpdatedAt:clear?later:past,playerClearances:clear?[{teamAbbreviation:'KC',name:'Marquise Brown',reportedAt:later}]:[],teams:[{abbreviation:'KC',teamName:'KC',players:[]},{abbreviation:'BUF',teamName:'BUF',players:[]}]},mainMarket:{currentBooks:[]},weather:null}]};
 const observations:any[]=(two?['receptions','receiving_yards']:['receptions']).flatMap(market=>['over','under'].map(side=>({provider:'balldontlie',providerObservationId:market+side,providerEventId:game.id,canonicalGameId:game.id,providerPlayerId:'666',playerName:'Marquise Brown',playerTeam:'KC',sportsbook:'synthetic-book',market,providerMarket:market,offerType:'over_under',side,line:market==='receptions'?6.5:49.5,americanPrice:-110,observedAt:at,fetchedAt:at,receivedAt:at,isOpening:false,isLive:false,homeTeam:'BUF',awayTeam:'KC',scheduledStart:start})));
 const snapshot:any={generatedAt:at,observations,games:[{providerGameId:game.id,scheduledStart:start,awayTeam:'KC',homeTeam:'BUF'}]};
 const features=buildNflPlayerPropsRuntimeFeatureRows({snapshot,context}),offers=buildNflPlayerPropsExactBoard({snapshots:[snapshot],evaluatedAt:at});
 const board=buildNflPlayerPropsRuntimeBoard({offers,features:native?features:[],evaluatedAt:at});
 const sourceBoard=sourceNative?buildNflPlayerPropsRuntimeBoard({offers,features,evaluatedAt:at}):board;
 const baseline=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:10,evaluatedAt:at,nextBoard:sourceBoard,previous:null});
 const packet=liveNflPacket({game,window:{gameId:game.id,stage:'early',cutoff:at,lock},snapshot:baseline,observations:snapshot,history,context} as never);
 return{packet,board,offers};
}
function accepted(packet:GamePacket,decline=false):AcceptedGameReview{
 const player=packet.players[0],aliases=evidenceAliases(packet),v=(n:number)=>Array<number>(16).fill(n);
 const raw=verifiedReaderFixture(packet,player.id,{priorRead:Object.fromEntries(independentPriorEvents(player).map(e=>[[...aliases].find(([,id])=>id===e.sourceId)![0],e.preferredOutcome])),evidenceIds:[[...aliases][0][0]],law:decline?null:{weights:v(1),outcomes:{receptions:[4,...v(8).slice(1)],...(player.markets.includes('receiving_yards')?{receiving_yards:[40,...v(80).slice(1)]}:{})}},confidence:player.markets.map(()=>decline?0:2),gaps:decline?['forecast_declined']:[],exceptions:player.markets.map(()=>decline?'forecast_declined':null)});
 const parsed=parseJointReview(packet,{wireRelease:PROPS_AI_WIRE_RELEASE,players:{[player.id]:raw}}),hash=digest(packet);
 return{...parsed,gameId:packet.gameId,sourceGameId:packet.sourceGameId??packet.gameId,start,lock,cutoff:at,stage:'early',issuedAt:at,inputHash:hash,inputEvidence:{digest:hash} as AcceptedGameReview['inputEvidence'],criticalContextHashes:criticalContextHashes(packet),marketScopes:{[player.id]:player.markets},model:'synthetic-never-dispatched',partProvenance:[]};
}
const capture=testNflHandoffCapture(()=>at),observe=testNflSourceAuthority(()=>at);
function run(options:Parameters<typeof fixture>[0]){
 const {packet,board,offers}=fixture(options),review=accepted(packet),choices=siteAiDecisions(packet,review,at),before=digest({packet,board,review});
 const applied=applyNflSiteAi(board,packet,choices,at,board.decisions),proof=capture(applied.decisions,packet,review,'ai',board.decisions),authority=observe(packet,review,true);
 const handoff=mergeNflHandoffs([authority,proof,capture(applied.decisions,packet,review,'ai',board.decisions)]);
 const locked=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:10,evaluatedAt:lock,nextBoard:applied,previous:null,lockHandoff:handoff});
 const count=options?.two?4:2;assert.equal(offers.length,count/2);assert.equal(applied.decisions.length,count);assert.equal(proof.candidateProofs.length,count);assert.equal(locked.memberDecisions.length,count);
 assert.equal(digest({packet,board,review}),before,'Original conditional law, exceptions, source and baseline are immutable');
 assert.deepEqual(review.players[0].exceptions,packet.players[0].markets.map(()=>null));
 if(!options?.native){assert.equal(board.decisions.length,0);assert(applied.decisions.every(r=>r.grade==='No Play'&&r.aiReview?.nativeQualification));assert(locked.memberDecisions.every(r=>r.aiReview?.lawHash===review.players[0].law?.hash));}
 const repeated=applyNflSiteAi(applied,packet,choices,at,board.decisions),restored=applyNflSiteAi(restoreNflNativeGame(applied,board,packet,at),packet,choices,at,board.decisions);
 const withoutNativeHolds=(rows:Row[])=>rows.map(({healthHolds,...row})=>{void healthHolds;return row;});
 assert.deepEqual(repeated.decisions,applied.decisions);assert.deepEqual(withoutNativeHolds(restored.decisions),withoutNativeHolds(applied.decisions));assert.equal(capture(repeated.decisions,packet,review,'ai',board.decisions).candidateProofs.length,count);
 const retained=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:10,evaluatedAt:lock,nextBoard:board,previous:locked,lockHandoff:handoff});
 assert.deepEqual(retained.memberDecisions,locked.memberDecisions);assert.deepEqual(retained.board.decisions,locked.board.decisions);
 return{packet,board,review,choices,applied,locked};
}
for(const two of [false,true])for(const options of [{},{status:'out'},{status:'out',clear:true},{status:'Questionable'}])run({two,...options});
const quoteOnly=run({two:true}),native=run({native:true,two:true}),out=run({native:true,two:true,status:'out'});
assert(native.applied.decisions.some(r=>r.grade==='Best Angle'));for(const row of native.applied.decisions){const choice=native.choices.find(c=>c.market===row.market)!;assert.equal(row.grade,row.side===choice.side?choice.grade:'Watchlist','Available native context retains exact action qualification without hidden demotion');}assert(native.applied.decisions.every(r=>!r.aiReview?.nativeQualification));assert(out.applied.decisions.every(r=>r.grade==='No Play'&&!r.aiReview?.nativeQualification&&r.aiReview?.sourceEligibility?.blocked));
const both=run({two:true,status:'out'});assert(both.applied.decisions.every(r=>r.aiReview?.nativeQualification&&r.aiReview.sourceEligibility?.blocked&&r.aiReview.exception==='Source participation unavailable: explicit_out'));
const optionalNative=native.board.decisions.map(row=>({...row,aiReview:undefined}));const optionalApplied=applyNflSiteAi(native.board,native.packet,native.choices,at,optionalNative);assert.equal(capture(optionalApplied.decisions,native.packet,native.review,'ai',optionalNative).candidateProofs.length,4,'Legitimate undefined optional row fields share persisted JSON hash semantics');
const priorOnly=run({two:true,sourceNative:true});assert(priorOnly.packet.players[0].evidence.some(e=>e.kind==='independent_model'),'An existing source head cannot fabricate an actual native template');
assert.equal(capture(quoteOnly.applied.decisions,quoteOnly.packet,quoteOnly.review,'ai').candidateProofs.length,0,'Explicit original baseline required; marker alone is insufficient');
const bad:(readonly[string,(r:Row)=>void])[]=[
 ['removed marker',r=>{delete r.aiReview!.nativeQualification;}],['forged grade',r=>{r.grade='Best Angle';}],['forged exception',r=>{r.aiReview!.exception='Unbound hold';}],
 ...(['release','reason','detail','gameId','playerId','scheduledStart','lockAt','sourcePacketHash','nativeBaselineHash'] as const).map(key=>[key,(r:Row)=>{(r.aiReview!.nativeQualification as any)[key]='forged';}] as const),
 ['forged medical source',r=>{r.aiReview!.sourceEligibility!.blocked=true;}],['forged quote',r=>{r.aiReview!.executionEvidence!.selectedQuote.american=900;}],['forged law',r=>{r.aiReview!.lawHash='foreign';}],
];
for(const [label,change]of bad){const rows=structuredClone(quoteOnly.applied.decisions);rows.forEach(change);assert.equal(capture(rows,quoteOnly.packet,quoteOnly.review,'ai',quoteOnly.board.decisions).candidateProofs.length,0,label);}
for(const withMarker of [false,true]){const rows=structuredClone(native.applied.decisions);for(const row of rows){row.grade='No Play';if(withMarker)row.aiReview!.nativeQualification=structuredClone(quoteOnly.applied.decisions[0].aiReview!.nativeQualification);}assert.equal(capture(rows,native.packet,native.review,'ai',native.board.decisions).candidateProofs.length,0,'A native-qualified actor cannot forge a generic NoPlay or copied qualification');}
const recovered=applyNflSiteAi(quoteOnly.applied,quoteOnly.packet,quoteOnly.choices,at,native.board.decisions);assert(recovered.decisions.some(r=>r.grade==='Best Angle'));assert(recovered.decisions.every(r=>!r.aiReview?.nativeQualification));assert.equal(capture(recovered.decisions,quoteOnly.packet,quoteOnly.review,'ai',native.board.decisions).candidateProofs.length,4);
for(const change of [(r:Row)=>{r.observedAt='2026-11-11T00:16:00Z';},(r:Row)=>{r.forecastContext.featureAsOf='2026-11-11T00:16:00Z';},(r:Row)=>{r.gameId='foreign';},(r:Row)=>{r.team='LAR';},(r:Row)=>{r.providerPlayerId='777';},(r:Row)=>{r.modelRelease=quoteOnly.review.release;}]){const rows=structuredClone(native.board.decisions);rows.forEach(change);assert(nflNativePublicationContext(quoteOnly.packet,quoteOnly.packet.players[0].id,rows).qualification,'Foreign/future/AI rows cannot supply current native context');}
const declined=accepted(quoteOnly.packet,true),declinedChoices=siteAiDecisions(quoteOnly.packet,declined,at);assert.deepEqual(declinedChoices,[]);assert.deepEqual(applyNflSiteAi(quoteOnly.board,quoteOnly.packet,declinedChoices,at,quoteOnly.board.decisions).decisions,[],'Operational qualification never resurrects a declined law');
console.log('NFL native qualification passed: actual empty-feature native builder/live source/parser, two/four first-lock NoPlays, independent native/medical states, original-baseline binding, repeated overlays, forged/missing/copied metadata refusal, qualified native recovery, clock/identity guards and exact legacy locks. No I/O.');
