/* eslint-disable @typescript-eslint/no-explicit-any -- Synthetic provider/context shapes exercise the actual native pipeline without any I/O. */
/** The exact Round 6 native roster-Out failure and its positive recovery. No
 * invented native decision, forecast/probability, row hash or capture proof. */
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {buildTeamDepthSnapshot} from '../lib/services/football/balldontlieNflRoster';
import {buildNflPlayerPropsRuntimeFeatureRows,buildNflPlayerPropsRuntimeBoard,type NflPlayerPropsRuntimeDecision as Row} from '../lib/services/football/nflPlayerPropsRuntime';
import {buildNflPlayerPropsExactBoard} from '../lib/services/football/nflPlayerPropsMarketBoard';
import {reconcileNflPlayerPropsProductionSnapshot} from '../lib/services/football/nflPlayerPropsProductionContract';
import {liveNflPacket} from '../lib/playerPropsAi/liveSources';
import {playerParticipationEligibility} from '../lib/playerPropsAi/participationEligibility';
import {restoreNflNativeGame} from '../lib/playerPropsAi/siteBindings';
import {testNflHandoffCapture,testNflSourceAuthority,mergeNflHandoffs} from '../lib/playerPropsAi/nflLockAuthority';
import {digest} from '../lib/playerPropsAi/evidence';
import {criticalContextHashes} from '../lib/playerPropsAi/criticalContext';
import {readerAvailabilityContextHash,reviewedReaderContextCurrent} from '../lib/playerPropsAi/readerClaimFreshness';
import {parseJointReview} from '../lib/playerPropsAi/request';
import {independentPriorEvents} from '../lib/playerPropsAi/priorEvents';
import {evidenceAliases} from '../lib/playerPropsAi/input';
import {PROPS_AI_WIRE_RELEASE} from '../lib/playerPropsAi/scenarioCoordinates';
import {verifiedReaderFixture} from './lib/player-props-ai-reader-fixture';
import type {AcceptedGameReview} from '../lib/playerPropsAi/reviewer';
import type {GamePacket} from '../lib/playerPropsAi/evidenceContract';

globalThis.fetch=async()=>{throw Error('Native participation fallback proof forbids all HTTP');};
const at='2026-11-11T00:14:00Z',past='2026-11-11T00:13:00Z',later='2026-11-11T00:13:30Z',start='2026-11-11T01:15:00Z',lock='2026-11-11T00:15:00Z';
const game={id:'synthetic',start,away:'KC',home:'BUF'},history={updatedAt:at,games:[],stats:[],teamStats:[],playMetrics:[]};
function fixture(status:string|null='out',clear=false){
 const awayDepth=buildTeamDepthSnapshot({team:'KC',capturedAt:past,sourceSnapshotId:'synthetic',rows:[{player:{id:666,first_name:'Marquise',last_name:'Brown',position:'WR'},injury_status:status}]});
 const context:any={providerSnapshotGeneratedAt:at,capturedAt:at,games:[{canonicalGameId:game.id,scheduledStart:start,awayTeam:'KC',homeTeam:'BUF',awayDepth,homeDepth:{provider:'balldontlie',team:'BUF',capturedAt:past,roster:[]},injuries:{eventId:game.id,awayTeam:'KC',homeTeam:'BUF',source:'BALLDONTLIE',sourceLabel:'synthetic',sourceUrl:null,reportUpdatedAt:clear?later:past,playerClearances:clear?[{teamAbbreviation:'KC',name:'Marquise Brown',reportedAt:later}]:[],teams:[{abbreviation:'KC',teamName:'KC',players:[]},{abbreviation:'BUF',teamName:'BUF',players:[]}]},mainMarket:{currentBooks:[]},weather:null}]};
 const observations:any[]=['synthetic-book','second'].flatMap(sportsbook=>['over','under'].map(side=>({provider:'balldontlie',providerObservationId:sportsbook+side,providerEventId:game.id,canonicalGameId:game.id,providerPlayerId:'666',playerName:'Marquise Brown',playerTeam:'KC',sportsbook,market:'receptions',providerMarket:'receptions',offerType:'over_under',side,line:6.5,americanPrice:-110,observedAt:at,fetchedAt:at,receivedAt:at,isOpening:false,isLive:false,homeTeam:'BUF',awayTeam:'KC',scheduledStart:start})));
 const snapshot:any={generatedAt:at,observations,games:[{providerGameId:game.id,scheduledStart:start,awayTeam:'KC',homeTeam:'BUF'}]};
 const features=buildNflPlayerPropsRuntimeFeatureRows({snapshot,context}),offers=buildNflPlayerPropsExactBoard({snapshots:[snapshot],evaluatedAt:at});
 const board=buildNflPlayerPropsRuntimeBoard({offers,features,evaluatedAt:at});
 const baseline=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:10,evaluatedAt:at,nextBoard:board,previous:null});
 const packet=liveNflPacket({game,window:{gameId:game.id,stage:'early',cutoff:at,lock},snapshot:baseline,observations:snapshot,history,context} as never);
 assert.equal(board.decisions.length,2);assert.equal(board.counts.Lean,1,'Actual retained native model supplies the positive qualification control');
 return{packet,board,baseline,features};
}
function declined(packet:GamePacket):AcceptedGameReview{
 const player=packet.players[0],aliases=evidenceAliases(packet),raw=verifiedReaderFixture(packet,player.id,{priorRead:Object.fromEntries(independentPriorEvents(player).map(e=>[[...aliases].find(([,id])=>id===e.sourceId)![0],e.preferredOutcome])),evidenceIds:[[...aliases][0][0]],law:null,confidence:player.markets.map(()=>0),gaps:['forecast_declined'],exceptions:player.markets.map(()=>'forecast_declined')});
 const parsed=parseJointReview(packet,{wireRelease:PROPS_AI_WIRE_RELEASE,players:{[player.id]:raw}}),json=JSON.stringify(packet),hash=digest(packet);
 return{...parsed,gameId:packet.gameId,sourceGameId:packet.sourceGameId??packet.gameId,start,lock,cutoff:at,stage:'early',issuedAt:at,inputHash:hash,inputEvidence:{digest:hash,encoding:'gzip-base64',bytes:Buffer.byteLength(json),data:gzipSync(Buffer.from(json)).toString('base64')},criticalContextHashes:criticalContextHashes(packet),marketScopes:{[player.id]:player.markets},model:'synthetic-never-dispatched',partProvenance:[]};
}
const numeric=(rows:readonly Row[])=>rows.map(row=>{const{grade,healthHolds,...original}=row;void grade;void healthHolds;return original;});
async function main(){
 const env=process.env.NODE_ENV;Object.assign(process.env,{NODE_ENV:'test'});
 try{
 const blocked=fixture(),cleared=fixture('out',true),unknown=fixture(null),oldBytes=digest(JSON.parse(JSON.stringify(blocked))),id=blocked.packet.players[0].id;
 assert.equal(blocked.features[0].scoreEligible,true);assert.deepEqual(blocked.features[0].healthHolds,[],'The native model deliberately remains unchanged; the source qualification closes its independent roster gap');
 assert(playerParticipationEligibility(blocked.packet,blocked.packet.players[0]).blocked);
 assert.equal(playerParticipationEligibility(cleared.packet,cleared.packet.players[0]).status,'eligible');
 const blockedDecline=declined(blocked.packet),changedReview=declined(unknown.packet);
 for(const scenario of [{name:'no review/pending/failed slot',review:null,lookup:true},{name:'failed review lookup',review:null,lookup:false},{name:'declined current review',review:blockedDecline,lookup:true},{name:'context changed prior review',review:changedReview,lookup:true}]){
  const restored=restoreNflNativeGame(blocked.board,blocked.board,blocked.packet,at);assert.equal(restored.counts.actionable,0);assert.equal(restored.counts['No Play'],2);assert.deepEqual(numeric(restored.decisions),numeric(blocked.board.decisions));
  const authority=testNflSourceAuthority(()=>at)(blocked.packet,scenario.review,scenario.lookup);
  // Capture the ORIGINAL unqualified native board to exercise the real writer's
  // onSourceReady order, before restoration/overlay can run.
  const capture=testNflHandoffCapture(()=>at)(blocked.board.decisions,blocked.packet,scenario.review,'native');assert.equal(capture.nativeProofs.length,2);assert(capture.nativeRows.every(r=>r.grade==='No Play'));
  const bundle=mergeNflHandoffs([authority,capture]);
  const prelock=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:10,evaluatedAt:at,nextBoard:blocked.board,previous:blocked.baseline,lockHandoff:bundle});assert.equal(prelock.board.counts.actionable,0,scenario.name);
  const result=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:10,evaluatedAt:lock,nextBoard:blocked.board,previous:blocked.baseline,lockHandoff:bundle});
  assert.equal(result.memberDecisions.length,2,scenario.name);assert(result.memberDecisions.every(r=>r.grade==='No Play'&&r.state==='locked'),scenario.name);assert.deepEqual(numeric(result.memberDecisions.map(r=>({...r,state:'unlocked'}))),numeric(blocked.baseline.memberDecisions));
 }
 // Exact explicit clearance recovers the original native recommendation; no
 // confidence/mean/price tuning or replacement model is involved.
 const restoredClear=restoreNflNativeGame(blocked.board,cleared.board,cleared.packet,at);assert.equal(restoredClear.counts.actionable,1);assert.equal(restoredClear.counts.Lean,1);assert.deepEqual(restoredClear.decisions,cleared.board.decisions);
 const clearFrames=mergeNflHandoffs([testNflSourceAuthority(()=>at)(cleared.packet,null,true),testNflHandoffCapture(()=>at)(cleared.board.decisions,cleared.packet,null,'native')]);
 const positive=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:10,evaluatedAt:lock,nextBoard:cleared.board,previous:cleared.baseline,lockHandoff:clearFrames});assert(positive.memberDecisions.some(r=>r.grade==='Lean'&&r.state==='locked'));
 const lockBytes=digest(JSON.parse(JSON.stringify(positive))),blockedFrames=mergeNflHandoffs([testNflSourceAuthority(()=>at)(blocked.packet,null,false),testNflHandoffCapture(()=>at)(blocked.board.decisions,blocked.packet,null,'native')]);
 const retained=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:10,evaluatedAt:lock,nextBoard:blocked.board,previous:positive,lockHandoff:blockedFrames});assert.deepEqual(retained.memberDecisions,positive.memberDecisions);assert.deepEqual(retained.board.decisions,positive.board.decisions);assert.equal(digest(JSON.parse(JSON.stringify(positive))),lockBytes);
 // Silence, other actors, wrong identity/fixture and invalid future clocks do
 // not invent a new block. All variants retain the actual native Lean.
 const controls=[unknown.packet,...['teammate','wrong_id','wrong_team','wrong_fixture','future_clock'].map(mode=>{
  const packet=structuredClone(blocked.packet);for(const e of packet.players[0].evidence){const value=e.value as any;
   if(/exact-game depth/.test(e.source)){
    if(mode==='teammate')value.away.roster[0].name='Different Player';
    if(mode==='wrong_id')value.away.roster[0].playerId='777';
    if(mode==='wrong_team')value.away.team='LAR';
    if(mode==='future_clock')value.away.capturedAt=lock;
   }
   if(mode==='wrong_fixture'&&e.kind!=='market')value.canonicalGameId='different-game';
  }return packet;
 })];
 for(const packet of controls){assert.equal(playerParticipationEligibility(packet,packet.players[0]).blocked,false);assert.equal(restoreNflNativeGame(blocked.board,blocked.board,packet,at).counts.actionable,1);}
 // Scheduled packets use the exact funded ID plus explicit native source ID.
 // This alias cannot change source eligibility or R31 semantic freshness.
 const funded={...structuredClone(blocked.packet),gameId:'espn:nfl:123',sourceGameId:blocked.packet.gameId};
 assert.equal(playerParticipationEligibility(funded,funded.players[0]).blocked,true);assert.equal(readerAvailabilityContextHash(funded,id),readerAvailabilityContextHash(blocked.packet,id));
 const fundedReview=declined(funded);assert(reviewedReaderContextCurrent(blocked.packet,fundedReview,id));
 const fundedReport={...structuredClone(unknown.packet),gameId:'espn:nfl:123',sourceGameId:unknown.packet.gameId};
 const report=fundedReport.players[0].evidence.find(e=>e.kind==='availability')!;const reportValue=report.value as any;
 reportValue.canonicalGameId=unknown.packet.gameId;reportValue.scheduledStart=start;
 reportValue.context.away.players=[{name:'Marquise Brown',status:'Out',reportedAt:past}];
 assert(playerParticipationEligibility(fundedReport,fundedReport.players[0]).blocked,'An exact native fixture report remains authoritative inside its explicitly linked funded packet');
 const nativeReport={...fundedReport,gameId:unknown.packet.gameId};assert.equal(readerAvailabilityContextHash(nativeReport,id),readerAvailabilityContextHash(fundedReport,id));
 for(const wrong of [{canonicalGameId:'foreign'},{scheduledStart:new Date(Date.parse(start)+1000).toISOString()}]){const mismatched=structuredClone(fundedReport);Object.assign(mismatched.players[0].evidence.find(e=>e.kind==='availability')!.value as object,wrong);assert.equal(playerParticipationEligibility(mismatched,mismatched.players[0]).blocked,false);}
 const foreign=structuredClone(funded);for(const e of foreign.players[0].evidence)if(e.kind!=='market')(e.value as any).canonicalGameId='foreign';assert.equal(playerParticipationEligibility(foreign,foreign.players[0]).blocked,false);
 assert.equal(digest(JSON.parse(JSON.stringify(blocked))),oldBytes,'Current qualification cannot mutate any original native source, baseline or model result');
 console.log('Native NFL fallback participation passed: actual roster/native features/exact offers/model/live source/restore/trusted capture/production publication/first lock; missing/failed/declined/changed review guards, explicit clearance, identity/clock/fixture refusal, funded/native semantic identity and exact stored locks. Board impact:2rows retained;1Lean→0actionables on Out;0→1Lean on clearance. No HTTP/DB/paid calls.');
 }finally{if(env===undefined)Reflect.deleteProperty(process.env,'NODE_ENV');else Object.assign(process.env,{NODE_ENV:env});}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
