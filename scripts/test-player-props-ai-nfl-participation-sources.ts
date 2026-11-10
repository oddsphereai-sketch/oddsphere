/** Actual NFL producer→adapter→parser→publication controls, synthetic/offline. */
import assert from 'node:assert/strict';
import {liveNflPacket} from '../lib/playerPropsAi/liveSources';
import {playerParticipationEligibility} from '../lib/playerPropsAi/participationEligibility';
import {readerEvidence,READER_AREAS} from '../lib/playerPropsAi/readerCoverage';
import {evidenceAliases} from '../lib/playerPropsAi/input';
import {encodeCanonicalScenarioLaw,GENERATIVE_WIRE_RELEASE} from '../lib/playerPropsAi/generativeCoordinates';
import {parseJointReview} from '../lib/playerPropsAi/request';
import {criticalContextHashes} from '../lib/playerPropsAi/criticalContext';
import {siteAiDecisions,siteReviewQualification} from '../lib/playerPropsAi/publication';
import {applyNflSiteAi} from '../lib/playerPropsAi/siteBindings';
import {PROPS_AI_RELEASE} from '../lib/playerPropsAi/releases';
import {digest} from '../lib/playerPropsAi/evidence';
import {buildTeamDepthSnapshot} from '../lib/services/football/balldontlieNflRoster';
import type {AcceptedGameReview} from '../lib/playerPropsAi/reviewer';
import type {GamePacket} from '../lib/playerPropsAi/evidenceContract';
import type {NflPlayerPropsRuntimeBoard} from '../lib/services/football/nflPlayerPropsRuntime';
globalThis.fetch=async()=>{throw Error('NFL participation source controls forbid network');};
const at='2026-11-10T16:00:00Z',past='2026-11-10T15:00:00Z',later='2026-11-10T15:30:00Z',future='2026-11-10T16:01:00Z',start='2026-11-11T01:15:00Z',lock='2026-11-11T00:15:00Z';
const game={id:'synthetic',start,away:'KC',home:'BUF'},v=(n:number)=>Array<number>(16).fill(n);
type Options={quoteName?:string;rosterName?:string;rosterStatus?:string|null;rosterAt?:string;reportStatus?:string;clearanceAt?:string;clearanceName?:string;clearanceTeam?:string;rosterId?:number;rosterTeam?:string};
function source(options:Options={}):GamePacket{
 const {quoteName='Hollywood Brown',rosterName='Marquise Brown',rosterStatus=null,rosterAt=past,reportStatus,clearanceAt,clearanceName='Marquise Brown',clearanceTeam='KC',rosterId=666,rosterTeam='KC'}=options;
 const awayDepth=buildTeamDepthSnapshot({team:rosterTeam,capturedAt:rosterAt,sourceSnapshotId:'synthetic',rows:[{player:{id:rosterId,first_name:rosterName.split(' ')[0],last_name:rosterName.split(' ').slice(1).join(' '),position:'WR'},injury_status:rosterStatus}]});
 // The quote independently establishes the offered actor; a deliberately wrong
 // roster cannot corrupt the identity test fixture before qualification runs.
 const identityDepth={...awayDepth,team:'KC',roster:awayDepth.roster.map(row=>({...row,playerId:'666',name:'Marquise Brown'}))};
 const context={capturedAt:at,games:[{canonicalGameId:game.id,scheduledStart:start,awayTeam:'KC',homeTeam:'BUF',awayDepth:identityDepth,homeDepth:{provider:'balldontlie',team:'BUF',capturedAt:past,roster:[]},injuries:{eventId:game.id,awayTeam:'KC',homeTeam:'BUF',source:'BALLDONTLIE',sourceLabel:'synthetic',sourceUrl:null,reportUpdatedAt:clearanceAt??past,playerClearances:clearanceAt?[{teamAbbreviation:clearanceTeam,name:clearanceName,reportedAt:clearanceAt}]:[],teams:[{abbreviation:'KC',teamName:'KC',players:reportStatus?[{name:rosterName,status:reportStatus,detail:null,position:'WR',reportedAt:past}]:[]},{abbreviation:'BUF',teamName:'BUF',players:[]}]},weather:null}]};
 const observations=['over','under'].map(side=>({provider:'balldontlie',providerObservationId:'synthetic-'+side,providerEventId:game.id,canonicalGameId:game.id,providerPlayerId:'666',playerName:quoteName,playerTeam:'KC',sportsbook:'synthetic-book',market:'receptions',providerMarket:'receptions',offerType:'over_under',side,line:6.5,americanPrice:-110,observedAt:at,fetchedAt:at,receivedAt:at,isOpening:false,isLive:false,homeTeam:'BUF',awayTeam:'KC',scheduledStart:start}));
 const packet=liveNflPacket({game,window:{gameId:game.id,stage:'early',cutoff:at,lock},snapshot:{week:10,generatedAt:at,board:{decisions:[]},memberDecisions:[]},observations:{generatedAt:at,observations},history:{updatedAt:at,games:[],stats:[],teamStats:[],playMetrics:[]},context} as never);
 // Invalid-source controls retain the actual producer structure while allowing
 // the verified current quote actor to remain independently reviewable.
 for(const e of packet.players[0].evidence)if(/exact-game depth/.test(e.source))e.value={away:awayDepth,home:context.games[0].homeDepth} as never;
 return packet;
}
function accepted(packet:GamePacket,side:'over'|'under'){
 const p=packet.players[0],facts=readerEvidence(packet)[p.id],aliases=evidenceAliases(packet),before=digest(packet);
 const actor={assessment:'The supplied evidence supports a conditional participation forecast.',priorRead:{},coverage:Object.fromEntries(READER_AREAS.map(a=>[a,{status:facts[a].status,factIds:facts[a].facts.slice(0,1).map(f=>f.id),effect:'uncertain',observation:'The supplied source requires appropriate participation caution.'}])),evidenceIds:[[...aliases][0][0]],gaps:[],confidence:[2],exceptions:[null],law:encodeCanonicalScenarioLaw('nfl',p,{weights:v(1),outcomes:{receptions:side==='over'?[4,...v(8).slice(1)]:[8,...v(4).slice(1)]}} as never)};
 const parsed=parseJointReview(packet,{wireRelease:GENERATIVE_WIRE_RELEASE,players:{[p.id]:actor}});
 const review={...parsed,release:PROPS_AI_RELEASE,gameId:game.id,sourceGameId:game.id,start,lock,cutoff:at,stage:'early',issuedAt:at,inputHash:before,criticalContextHashes:criticalContextHashes(packet),marketScopes:{[p.id]:p.markets},partProvenance:[],model:'synthetic',inputEvidence:{digest:before}} as unknown as AcceptedGameReview;
 const choices=siteAiDecisions(packet,review,at);assert.equal(digest(packet),before);assert.equal(choices.length,1);assert.equal(choices[0].side,side);
 return{review,choices,status:playerParticipationEligibility(packet,p)};
}
for(const side of ['over','under'] as const){
 for(const options of [{reportStatus:'Out'},{quoteName:'Marquise Brown',rosterStatus:'out'},{rosterStatus:'injured reserve'},{rosterStatus:'suspended'}]){
  const packet=source(options),before=digest(packet),{review,choices,status}=accepted(packet,side),c=choices[0];
  assert.equal(status.blocked,true);assert.equal(c.grade,'No Play');assert.deepEqual(c.evidence.sourceEligibility,status);assert.equal(siteReviewQualification(packet,review,at).participationBlockedScopes,1);
  const fact=status.facts.find(f=>f.status==='blocked')!;assert.equal(fact.sourcePlayerName,'Marquise Brown');assert.equal(fact.sourcePlayerId,options.reportStatus?undefined:'666');assert.equal(fact.actorProviderId,options.reportStatus?'666':undefined);assert.equal(fact.sourceTeam,'KC');
  assert.equal(fact.ownIdentityBasis,options.reportStatus?'exact_team_and_id_bound_alias':'exact_team_and_provider_id');assert.equal(fact.timeBasis,options.reportStatus?'provider_reported':'source_capture_clock');assert.equal(fact.effectiveAt,new Date(past).toISOString());
  const seed=applyNflSiteAi({decisions:[],counts:{},diagnostics:{}} as unknown as NflPlayerPropsRuntimeBoard,packet,choices,at),native={...seed,decisions:seed.decisions.map(row=>({...row,aiReview:undefined}))},board=applyNflSiteAi(native,packet,choices,at);assert(board.decisions.length);assert(board.decisions.every(row=>row.grade==='No Play'&&row.aiReview?.sourceEligibility?.blocked));
  const locked={...board,decisions:board.decisions.map(row=>({...row,state:'locked' as const,aiReview:{...row.aiReview!}}))};for(const row of locked.decisions)delete row.aiReview.sourceEligibility;const bytes=JSON.stringify(locked);assert.strictEqual(applyNflSiteAi(locked,packet,choices,at),locked);assert.equal(JSON.stringify(locked),bytes);assert.equal(digest(packet),before);
 }
 const originalBlocked=accepted(source({rosterStatus:'out'}),side);
 const recoveryPacket=source({rosterStatus:'out',clearanceAt:later}),recovered=accepted(recoveryPacket,side);assert.equal(recovered.review.players[0].law!.hash,originalBlocked.review.players[0].law!.hash);assert.equal(recovered.choices[0].projection,originalBlocked.choices[0].projection);assert.equal(recovered.choices[0].probability,originalBlocked.choices[0].probability);const recoveredSeed=applyNflSiteAi({decisions:[],counts:{},diagnostics:{}} as unknown as NflPlayerPropsRuntimeBoard,recoveryPacket,recovered.choices,at),nativeTemplate={...recoveredSeed,decisions:recoveredSeed.decisions.map(row=>({...row,aiReview:undefined}))},recoveredBoard=applyNflSiteAi(nativeTemplate,recoveryPacket,recovered.choices,at);assert(recoveredBoard.decisions.some(row=>row.side===side&&row.grade==='Best Angle'&&row.aiReview?.sourceEligibility?.status==='eligible'));
assert.equal(recovered.status.status,'eligible');assert.equal(recovered.choices[0].grade,'Best Angle');assert(!recovered.status.facts.some(f=>f.rawStatus==='not_listed'));assert.equal(recovered.status.facts.find(f=>f.status==='eligible')!.sourcePlayerName,'Marquise Brown');
 const exactRecovered=accepted(source({quoteName:'Marquise Brown',rosterStatus:'out',clearanceAt:later}),side);assert.equal(exactRecovered.status.status,'eligible');assert.equal(exactRecovered.choices[0].grade,'Best Angle');
 const laterOut=accepted(source({rosterStatus:'out',rosterAt:at,clearanceAt:later}),side);assert.equal(laterOut.status.blocked,true);assert.equal(laterOut.choices[0].grade,'No Play');
 const newerUncertainty=accepted(source({rosterStatus:'Questionable',rosterAt:at,clearanceAt:later}),side);assert.equal(newerUncertainty.status.status,'unknown');assert.equal(newerUncertainty.status.blocked,false);
 const reportOut=accepted(source({reportStatus:'Out',clearanceAt:later}),side);assert.equal(reportOut.status.status,'eligible');assert.equal(reportOut.choices[0].grade,'Best Angle');
 for(const options of [{rosterStatus:'active'},{rosterStatus:'Questionable'},{rosterStatus:'out',rosterAt:'invalid'},{rosterStatus:'out',rosterAt:future},{rosterStatus:'out',rosterId:777},{rosterStatus:'out',rosterTeam:'LAR'}]){
  const {status,choices}=accepted(source(options),side);assert.equal(status.blocked,false);assert.equal(status.status,'unknown');assert.equal(choices[0].grade,'Best Angle');
 }
 for(const options of [{rosterStatus:'out',clearanceAt:later,clearanceName:'Different Player'},{rosterStatus:'out',clearanceAt:later,clearanceTeam:'BUF'},{rosterStatus:'out',clearanceAt:future}]){
  const packet=source(options);
  // Future context attachments are rejected as a whole by the existing adapter;
  // retain its earlier admissible roster to prove future clearance cannot clear it.
  if(options.clearanceAt===future)packet.players[0].evidence.push(...source({rosterStatus:'out'}).players[0].evidence.filter(e=>/exact-game depth/.test(e.source)));
  const result=accepted(packet,side);assert.equal(result.status.blocked,true);assert.equal(result.choices[0].grade,'No Play');
 }
}
const uncertainAfterOut=source({rosterStatus:'Questionable',rosterAt:at});uncertainAfterOut.players[0].evidence.push({id:'older-native-out',kind:'independent_model',source:'synthetic native',availableAt:past,value:{context:{availability:{listed:true,status:'Out',reportedAt:past}}}});assert.equal(playerParticipationEligibility(uncertainAfterOut,uncertainAfterOut.players[0]).blocked,true,'Later uncertain roster injury cannot clear an explicit older Out');
for(const [id,alias,canonical] of [['666','Hollywood Brown','Marquise Brown'],['12','Kenny Gainwell','Kenneth Gainwell'],['33934397','KC Concepcion','Kevin Concepcion'],['734','Chig Okonkwo','Chigoziem Okonkwo']]){const packet=source({reportStatus:'Out'}),p=packet.players[0];p.id=`nfl-bdl-player:${id}`;p.name=alias;for(const e of p.evidence)if(e.kind==='availability'){const value=e.value as {context:{away:{players:{name:string}[]}}};value.context.away.players[0].name=canonical;}assert.equal(playerParticipationEligibility(packet,p).blocked,true,`Verified alias ${alias} retains own Out`);}
const noGuess=source({reportStatus:'Out'});noGuess.players[0].id='nfl-bdl-player:777';assert.equal(playerParticipationEligibility(noGuess,noGuess.players[0]).blocked,false,'Alias equivalence requires its independently verified exact provider ID');
const exactClear=accepted(source({quoteName:'Marquise Brown',clearanceAt:past}), 'over');assert.equal(exactClear.status.status,'eligible');assert.equal(exactClear.status.effectiveAt,new Date(past).toISOString());assert.equal(exactClear.status.facts.length,1,'The same report cannot synthesize newer uncertainty from its omission');
console.log('NFL participation source controls passed: actual roster producer, live source/parser/pricing/member path, ID-bound aliases, exact own roster statuses and clocks, same-report clearance authority, paired Over/Under recovery, wrong identity/team/clock refusals, active-roster uncertainty and legacy locked immutability. No network.');
