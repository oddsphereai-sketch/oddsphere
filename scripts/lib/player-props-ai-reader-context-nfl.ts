/* eslint-disable @typescript-eslint/no-explicit-any -- Synthetic typed-provider/native boundaries; no I/O. */
import {__BALLDONTLIE_NFL_AVAILABILITY_TEST__} from '../../lib/services/football/balldontlieNflAvailability';
import assert from 'node:assert/strict';
import {buildTeamDepthSnapshot} from '../../lib/services/football/balldontlieNflRoster';
import {buildNflPlayerPropsRuntimeFeatureRows,buildNflPlayerPropsRuntimeBoard} from '../../lib/services/football/nflPlayerPropsRuntime';
import {buildNflPlayerPropsExactBoard} from '../../lib/services/football/nflPlayerPropsMarketBoard';
import {reconcileNflPlayerPropsProductionSnapshot} from '../../lib/services/football/nflPlayerPropsProductionContract';
import {liveNflPacket} from '../../lib/playerPropsAi/liveSources';
import {siteAiDecisions} from '../../lib/playerPropsAi/publication';
import {applyNflSiteAi} from '../../lib/playerPropsAi/siteBindings';
import {testNflHandoffCapture,testNflSourceAuthority,mergeNflHandoffs} from '../../lib/playerPropsAi/nflLockAuthority';
import {digest} from '../../lib/playerPropsAi/evidence';
import {criticalContextHashes} from '../../lib/playerPropsAi/criticalContext';
import {parseJointReview} from '../../lib/playerPropsAi/request';
import {independentPriorEvents} from '../../lib/playerPropsAi/priorEvents';
import {evidenceAliases} from '../../lib/playerPropsAi/input';
import {PROPS_AI_WIRE_RELEASE} from '../../lib/playerPropsAi/scenarioCoordinates';
import {verifiedReaderFixture} from './player-props-ai-reader-fixture';
import type {AcceptedGameReview} from '../../lib/playerPropsAi/reviewer';
import type {GamePacket} from '../../lib/playerPropsAi/evidenceContract';
import {readerCanonicalContextHash} from '../../lib/playerPropsAi/readerContext';
import {playerParticipationEligibility} from '../../lib/playerPropsAi/participationEligibility';
export function nflCrossSourceReaderClockProof(){

globalThis.fetch=async()=>{throw Error('NFL native qualification controls forbid all HTTP');};
let clockSwitch=false;
const at='2026-11-11T00:14:00Z',past='2026-11-11T00:13:00Z',later='2026-11-11T00:13:30Z',start='2026-11-11T01:15:00Z',lock='2026-11-11T00:15:00Z';
const game={id:'123456789',start,away:'KC',home:'BUF'},history={release:'synthetic canonical past stat logs',updatedAt:at,games:[0,1].map(i=>({gameId:`played-${i}`,scheduledStart:`2026-11-0${1+i}T18:00:00Z`,homeTeam:'KC',awayTeam:'NYJ'})),stats:[0,1].map(i=>({gameId:`played-${i}`,scheduledStart:`2026-11-0${1+i}T18:00:00Z`,playerId:'666',playerName:'Marquise Brown',team:'KC',receptions:i?8:4,receiving_yards:i?80:40})),teamStats:[],playMetrics:[]};
function fixture({native=false,two=false,status=null,clear=false,sourceNative=false,sameState=false,rosterAt=clockSwitch?later:past,clinicalAt=clockSwitch?past:later,mutate}:{native?:boolean;two?:boolean;status?:string|null;clear?:boolean;sourceNative?:boolean;sameState?:boolean;rosterAt?:string;clinicalAt?:string;mutate?:(context:any)=>void}={}){
 const awayDepth=buildTeamDepthSnapshot({team:'KC',capturedAt:rosterAt,sourceSnapshotId:'synthetic',rows:[{player:{id:666,first_name:'Marquise',last_name:'Brown',position:'WR'},injury_status:status},{player:{id:777,first_name:'Other',last_name:'Player',position:'WR'},injury_status:'Out'}]});
 const context:any={providerSnapshotGeneratedAt:at,capturedAt:at,games:[{canonicalGameId:game.id,scheduledStart:start,awayTeam:'KC',homeTeam:'BUF',awayDepth,homeDepth:{provider:'balldontlie',team:'BUF',capturedAt:past,roster:[]},injuries:{eventId:game.id,awayTeam:'KC',homeTeam:'BUF',source:'BALLDONTLIE',sourceLabel:'synthetic',sourceUrl:null,reportUpdatedAt:clear?later:past,playerClearances:[{teamAbbreviation:'KC',name:'Other Player',reportedAt:clockSwitch?past:later}],teams:[{abbreviation:'KC',teamName:'KC',players:[]},{abbreviation:'BUF',teamName:'BUF',players:[]}]},mainMarket:{currentBooks:[]},weather:null}]};
 context.games[0].injuries=__BALLDONTLIE_NFL_AVAILABILITY_TEST__.normalizeNflDesignationGames([{game_id:game.id,player:{first_name:'Marquise',last_name:'Brown',position:'WR'},team:{abbreviation:'KC'},...(sameState&&status==='Out'?{game_status:'Out'}:{active:true}),updated_at:sameState?past:later},{game_id:game.id,player:{first_name:'Other',last_name:'Player',position:'WR'},team:{abbreviation:'KC'},...(sameState?{game_status:'Out'}:{active:true}),updated_at:clinicalAt}],[{id:game.id,awayTeam:'KC',homeTeam:'BUF'}])[0];
 mutate?.(context);
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

const a=fixture({native:true}),r=accepted(a.packet),before=siteAiDecisions(a.packet,r,at);clockSwitch=true;const b=fixture({native:true}),after=siteAiDecisions(b.packet,r,at);
assert.equal(before.length,1);assert.equal(after.length,0,'Cross-source teammate medical authority changed although own eligibility did not');assert.notEqual(readerCanonicalContextHash(a.packet,a.packet.players[0].id),readerCanonicalContextHash(b.packet,b.packet.players[0].id));assert.equal(playerParticipationEligibility(a.packet,a.packet.players[0]).status,playerParticipationEligibility(b.packet,b.packet.players[0]).status);
const applied=applyNflSiteAi(b.board,b.packet,after,at,b.board.decisions),capture=testNflHandoffCapture(()=>at),authority=testNflSourceAuthority(()=>at)(b.packet,r,true),proof=capture(applied.decisions,b.packet,r,'ai',b.board.decisions);
const locked=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:10,evaluatedAt:'2026-11-11T00:15:01Z',nextBoard:applied,previous:null,lockHandoff:mergeNflHandoffs([authority,proof,capture(b.board.decisions,b.packet,r,'native')])});
assert.equal(proof.candidateProofs.length,0);assert(locked.memberDecisions.every(row=>!row.aiReview),'A changed teammate authority cannot become a stale AI first lock');
// Actual equivalent Out rows: roster numeric ID, name-only clinical report,
// and (for an own Out) the attached native canonical-ID availability record.
const clocks=['availableAt','reportedAt','reported_at','reportUpdatedAt','capturedAt','asOfTimestamp','evaluatedAt','snapshotAvailableAt','featureAsOf'];
function strip(value:any,key=''):any{if(Array.isArray(value)){const rows=value.map(row=>strip(row));return key==='players'?rows.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):rows;}return value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>!clocks.includes(key)).map(([key,v])=>[key,strip(v,key)])):value;}
const material=(packet:GamePacket)=>packet.players.map(p=>p.evidence.filter(e=>e.kind!=='market').map(e=>({kind:e.kind,source:e.source,value:strip(e.value)})));
const tuple=(row:any)=>({game:row.gameId,player:row.providerPlayerId,market:row.market,line:row.line,side:row.side,book:row.sportsbook,provider:row.provider,price:row.americanPrice,projection:row.projection,probability:row.finalProbability,ev:row.expectedValue,grade:row.grade,assessment:row.aiReview?.assessment,coverage:row.aiReview?.coverage,lawHash:row.aiReview?.lawHash,inputHash:row.aiReview?.inputHash,exception:row.aiReview?.exception});
for(const ownOut of [false,true]){
 const initial=fixture({native:true,sameState:true,status:ownOut?'Out':null,rosterAt:past,clinicalAt:past}),acceptedReview=accepted(initial.packet),initialBytes=digest(initial.packet),reviewBytes=digest(acceptedReview),initialChoices=siteAiDecisions(initial.packet,acceptedReview,at);
 assert.equal(initialChoices.length,1);
 const priorBoard=applyNflSiteAi(initial.board,initial.packet,initialChoices,at,initial.board.decisions),previous=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:10,evaluatedAt:at,nextBoard:priorBoard,previous:null});
 assert.equal(previous.memberDecisions.length,2);assert(previous.memberDecisions.every(row=>row.aiReview));if(ownOut)assert(previous.memberDecisions.every(row=>row.grade==='No Play'));
 const lockResult=(next:ReturnType<typeof fixture>,review=acceptedReview)=>{
  const choices=siteAiDecisions(next.packet,review,at),board=applyNflSiteAi(next.board,next.packet,choices,at,next.board.decisions),frames=mergeNflHandoffs([testNflSourceAuthority(()=>at)(next.packet,review,true),testNflHandoffCapture(()=>at)(board.decisions,next.packet,review,'ai',next.board.decisions),testNflHandoffCapture(()=>at)(next.board.decisions,next.packet,review,'native')]);
  return{choices,locked:reconcileNflPlayerPropsProductionSnapshot({season:2026,week:10,evaluatedAt:'2026-11-11T00:15:01Z',nextBoard:board,previous,lockHandoff:frames})};
 };
 for(const [rosterAt,clinicalAt]of [[past,past],[later,past],[past,later],[later,later]]){
  const next=fixture({native:true,sameState:true,status:ownOut?'Out':null,rosterAt,clinicalAt}),bytes=digest(next.packet);assert.deepEqual(material(initial.packet),material(next.packet),'All substantive actual source/native/role facts remain exact');
  const result=lockResult(next);assert.equal(readerCanonicalContextHash(initial.packet,initial.packet.players[0].id),readerCanonicalContextHash(next.packet,next.packet.players[0].id));assert.equal(result.choices.length,1);
  assert.deepEqual(result.locked.memberDecisions.map(tuple),previous.memberDecisions.map(tuple),'Same-state source clocks retain conditional AI laws/text/numbers/quotes/grades at actual first lock');assert(result.locked.memberDecisions.every(row=>row.state==='locked'));assert.equal(digest(next.packet),bytes);
 }
 // Role, ID, provider, name, non-null detail and position remain raw source facts.
 const mutations:((context:any)=>void)[]=[
  c=>{c.games[0].awayDepth.roster[1].injuryStatus='Questionable';},c=>{c.games[0].injuries.teams[0].players.find((p:any)=>p.name==='Other Player').detail='Back';},
  c=>{c.games[0].awayDepth.roster[1].position='TE';},c=>{c.games[0].awayDepth.roster[1].depth='2';c.games[0].awayDepth.roster[1].depthRank=2;},
  c=>{c.games[0].awayDepth.roster[1].explicitStarter=true;},c=>{c.games[0].awayDepth.roster[1].playerId='778';},c=>{c.games[0].awayDepth.provider='unverified';},
  c=>{c.games[0].injuries.source='ESPN';},c=>{c.games[0].injuries.teams[0].players.find((p:any)=>p.name==='Other Player').name='Different Player';},
  c=>{c.games[0].injuries.teams[0].players.find((p:any)=>p.name==='Other Player').expectedReturnAt='2026-11-20';},
  c=>{c.games[0].awayDepth.roster[1].extraMedicalFact='unknown';},c=>{c.games[0].injuries.teams[0].players.find((p:any)=>p.name==='Other Player').position={unknown:true};},
 ];
 for(const mutate of mutations){const next=fixture({native:true,sameState:true,status:ownOut?'Out':null,rosterAt:later,clinicalAt:past,mutate}),result=lockResult(next);assert.notEqual(readerCanonicalContextHash(initial.packet,initial.packet.players[0].id),readerCanonicalContextHash(next.packet,next.packet.players[0].id));assert.equal(result.choices.length,0);assert(result.locked.memberDecisions.every(row=>!row.aiReview),'Substantive/unknown source changes cannot make a stale AI first lock');}
 // Ambiguous same-name distinct BDL IDs cannot share a guessed clinical identity.
 const ambiguous=(rosterAt:string)=>fixture({native:true,sameState:true,status:ownOut?'Out':null,rosterAt,clinicalAt:past,mutate:c=>{c.games[0].awayDepth.roster.push({...c.games[0].awayDepth.roster[1],playerId:'778'});}});
 const ambiguousInitial=ambiguous(past),ambiguousReview=accepted(ambiguousInitial.packet),ambiguousNext=ambiguous(later);assert.notEqual(readerCanonicalContextHash(ambiguousInitial.packet,ambiguousInitial.packet.players[0].id),readerCanonicalContextHash(ambiguousNext.packet,ambiguousNext.packet.players[0].id));assert.equal(siteAiDecisions(ambiguousNext.packet,ambiguousReview,at).length,0);
 // The same clinical/roster status/detail alternatives remain in both packets;
 // changing their effective winner or creating a tie must invalidate the read.
 for(const field of ['status','detail']){
  const alternatives=(rosterAt:string,clinicalAt:string)=>fixture({native:true,sameState:true,status:ownOut?'Out':null,rosterAt,clinicalAt,mutate:c=>{const row=c.games[0].injuries.teams[0].players.find((p:any)=>p.name==='Other Player');if(field==='status')row.status='Questionable';else row.detail='Back';}});
  const first=alternatives(past,later),read=accepted(first.packet);
  for(const next of [alternatives(later,past),alternatives(past,past)]){assert.deepEqual(material(first.packet),material(next.packet));assert.notEqual(readerCanonicalContextHash(first.packet,first.packet.players[0].id),readerCanonicalContextHash(next.packet,next.packet.players[0].id));assert.equal(siteAiDecisions(next.packet,read,at).length,0);}
 }
 assert.equal(digest(initial.packet),initialBytes);assert.equal(digest(acceptedReview),reviewBytes);
 const stored=lockResult(fixture({native:true,sameState:true,status:ownOut?'Out':null,rosterAt:later,clinicalAt:past})).locked,storedBytes=digest(stored);
 const preserved=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:10,evaluatedAt:'2026-11-11T00:15:02Z',nextBoard:initial.board,previous:stored,lockHandoff:mergeNflHandoffs([])});assert.deepEqual(preserved.memberDecisions,stored.memberDecisions);assert.equal(digest(stored),storedBytes);
}

}
