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
const game={id:'123456789',start,away:'KC',home:'BUF'},history={updatedAt:at,games:[],stats:[],teamStats:[],playMetrics:[]};
function fixture({native=false,two=false,status=null,clear=false,sourceNative=false}:{native?:boolean;two?:boolean;status?:string|null;clear?:boolean;sourceNative?:boolean}={}){
 const awayDepth=buildTeamDepthSnapshot({team:'KC',capturedAt:clockSwitch?later:past,sourceSnapshotId:'synthetic',rows:[{player:{id:666,first_name:'Marquise',last_name:'Brown',position:'WR'},injury_status:status},{player:{id:777,first_name:'Other',last_name:'Player',position:'WR'},injury_status:'Out'}]});
 const context:any={providerSnapshotGeneratedAt:at,capturedAt:at,games:[{canonicalGameId:game.id,scheduledStart:start,awayTeam:'KC',homeTeam:'BUF',awayDepth,homeDepth:{provider:'balldontlie',team:'BUF',capturedAt:past,roster:[]},injuries:{eventId:game.id,awayTeam:'KC',homeTeam:'BUF',source:'BALLDONTLIE',sourceLabel:'synthetic',sourceUrl:null,reportUpdatedAt:clear?later:past,playerClearances:[{teamAbbreviation:'KC',name:'Other Player',reportedAt:clockSwitch?past:later}],teams:[{abbreviation:'KC',teamName:'KC',players:[]},{abbreviation:'BUF',teamName:'BUF',players:[]}]},mainMarket:{currentBooks:[]},weather:null}]};
 context.games[0].injuries=__BALLDONTLIE_NFL_AVAILABILITY_TEST__.normalizeNflDesignationGames([{game_id:game.id,player:{first_name:'Marquise',last_name:'Brown',position:'WR'},team:{abbreviation:'KC'},active:true,updated_at:later},{game_id:game.id,player:{first_name:'Other',last_name:'Player',position:'WR'},team:{abbreviation:'KC'},active:true,updated_at:clockSwitch?past:later}],[{id:game.id,awayTeam:'KC',homeTeam:'BUF'}])[0];
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
}
