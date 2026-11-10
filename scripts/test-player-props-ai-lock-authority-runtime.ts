import {PROPS_AI_WIRE_RELEASE} from "../lib/playerPropsAi/scenarioCoordinates";
import {verifiedReaderFixture} from "./lib/player-props-ai-reader-fixture";
/* eslint-disable @typescript-eslint/no-explicit-any -- Synthetic Supabase/HTTP and malformed JSON boundary fixtures are validated by the actual runtime. */
/** All data synthetic. Actual site runtime/parser/binding/reconciler; no HTTP, DB, or paid calls. */
import assert from 'node:assert/strict';
import type {NflPlayerPropsProductionSnapshot} from '../lib/services/football/nflPlayerPropsProductionContract';
import type {NflPlayerPropsRuntimeDecision,NflPlayerPropsRuntimeBoard} from '../lib/services/football/nflPlayerPropsRuntime';
globalThis.fetch=async()=>{throw Error('NETWORK BLOCKED');};
async function main(){
const root=process.cwd();
const {NFL_PLAYER_PROPS_BOARD_RELEASE,NFL_PLAYER_PROPS_CALIBRATION_RELEASE,NFL_PLAYER_PROPS_DECISION_RELEASE,NFL_PLAYER_PROPS_MODEL_RELEASE}=await import(root+'/lib/services/football/nflPlayerPropsRuntime.ts');
const {reconcileNflPlayerPropsProductionSnapshot}=await import(root+'/lib/services/football/nflPlayerPropsProductionContract.ts');
const {applyNflSiteAi}=await import(root+'/lib/playerPropsAi/siteBindings.ts');
const {siteAiDecisions}=await import(root+'/lib/playerPropsAi/publication.ts');
const {criticalContextHashes}=await import(root+'/lib/playerPropsAi/criticalContext.ts');
const {readerEvidence,READER_AREAS}=await import(root+'/lib/playerPropsAi/readerCoverage.ts');
const {evidenceAliases}=await import(root+'/lib/playerPropsAi/input.ts');
const {parseJointReview}=await import(root+'/lib/playerPropsAi/request.ts');
const {encodeCanonicalScenarioLaw}=await import(root+'/lib/playerPropsAi/generativeCoordinates.ts');
const {PRODUCT_RELEASE}=await import(root+'/lib/playerPropsAi/evidenceContract.ts');
const {digest}=await import(root+'/lib/playerPropsAi/evidence.ts');
const {independentPriorEvents}=await import(root+'/lib/playerPropsAi/priorEvents.ts');
const priorReads=(input:any)=>Object.fromEntries(independentPriorEvents(input.players[0]).map((e:any)=>[[...evidenceAliases(input)].find(([,id])=>id===e.sourceId)![0],e.preferredOutcome]));
const v=(n:number)=>Array(16).fill(n);
const decision: NflPlayerPropsRuntimeDecision = {
  gameId: "game", providerPlayerId: "1", playerName: "Player", team: "NE", opponent: "NYJ",
  scheduledStart: "2026-09-01T12:00:00.000Z", market: "receptions", line: 4.5, side: "over",
  sportsbook: "book", provider: "balldontlie", americanPrice: 110, observedAt: "2026-08-25T11:00:00.000Z",
  bookEvidence: [{ sportsbook: "book", provider: "balldontlie", americanPrice: 110, observedAt: "2026-08-25T11:00:00.000Z", openingObservedAt: null, openingLine: null, openingAmericanPrice: null }],
  lockAt: "2026-09-01T11:00:00.000Z", state: "unlocked", roleFingerprint: "role-a", projection: 5.2,
  projectionRange: { lower: 2.1, upper: 8.4, centralCoverage: 0.8, source: "empirical_residual_distribution" },
  forecastContext: {
    featureAsOf: "2026-08-25T10:00:00.000Z", position: "WR",
    expectedQuarterback: { name: "Quarterback", starterStatus: "projected", capturedAt: "2026-08-25T10:00:00.000Z" },
    availability: { listed: false, status: null, detail: null, reportedAt: null, reportUpdatedAt: "2026-08-25T09:00:00.000Z", source: "BALLDONTLIE" },
    teamImpliedPoints: 24.5, teamImpliedTouchdowns: 3.5,
    recentProduction: { label: "Recent receptions", value: 5.1, format: "count" },
    roleOpportunity: [{ label: "Recent targets", value: 7.4, format: "count" }],
    opponentAllowance: { label: "Opponent targets allowed", value: 31.2, format: "count" },
  },
  participationProbability: 0.9, rawModelProbability: 0.61, marketProbability: 0.5, finalProbability: 0.53,
  probabilityEdge: 0.03, expectedValue: 0.11, grade: "Best Angle", marketMovement: "neutral", healthHolds: [], provisional: false,
  modelRelease: NFL_PLAYER_PROPS_MODEL_RELEASE,
  calibrationRelease: NFL_PLAYER_PROPS_CALIBRATION_RELEASE,
  decisionRelease: NFL_PLAYER_PROPS_DECISION_RELEASE,
};
function board(row: NflPlayerPropsRuntimeDecision): NflPlayerPropsRuntimeBoard {
  return {
    release: NFL_PLAYER_PROPS_BOARD_RELEASE, generatedAt: "2026-08-25T12:00:00.000Z",
    evaluatedAt: "2026-08-25T12:00:00.000Z", provisional: false, publicationEnabled: false, trackingEnabled: false,
    decisions: [row], counts: { "Best Angle": 1, Lean: 0, Watchlist: 0, "No Play": 0, Held: 0, actionable: 1 },
    diagnostics: {
      inputOffers: 1, completeExactOffers: 1, incompleteExactOffers: 0, lockedOffers: 0,
      unavailableNoIndependentBenchmark: 0, unavailableStaleQuotes: 0, unavailableFeatureContext: 0,
      completedEvaluations: row.grade === "Held" ? 0 : 1,
      operationalExceptions: row.grade === "Held" ? 1 : 0,
      recoveryEligibleOperationalExceptions: row.grade === "Held" && row.state === "unlocked" ? 1 : 0,
      roleOrIdentityHeld: row.grade === "Held" ? 1 : 0,
    },
  };
}
function boardRows(rows: NflPlayerPropsRuntimeDecision[]): NflPlayerPropsRuntimeBoard {
  const count = (grade: NflPlayerPropsRuntimeDecision["grade"]) => rows.filter((row) => row.grade === grade).length;
  return {
    ...board(rows[0]!),
    decisions: rows,
    counts: {
      "Best Angle": count("Best Angle"), Lean: count("Lean"), Watchlist: count("Watchlist"),
      "No Play": count("No Play"), Held: count("Held"), actionable: count("Best Angle") + count("Lean"),
    },
    diagnostics: {
      ...board(rows[0]!).diagnostics,
      inputOffers: rows.length,
      completeExactOffers: rows.length,
      completedEvaluations: rows.filter((row) => row.grade !== "Held").length,
      operationalExceptions: count("Held"),
      recoveryEligibleOperationalExceptions: rows.filter((row) => row.grade === "Held" && row.state === "unlocked").length,
      roleOrIdentityHeld: count("Held"),
    },
  };
}

const start='2026-11-09T23:00:00Z',lock='2026-11-09T22:00:00Z',earlyIssued='2026-11-09T16:00:00Z',earlyAt='2026-11-09T21:58:00Z',finalAt='2026-11-09T21:59:58Z',publishBefore='2026-11-09T21:59:59.900Z';
void publishBefore;
const id='nfl-bdl-player:1';
const evidence=[2,4,6].map((receptions,i)=>({id:`log${i}`,kind:'recent_games',source:'synthetic',availableAt:earlyIssued,value:{game:{startTime:`2026-11-0${i+4}T18:00:00Z`,homeTeam:'BUF',awayTeam:'MIN'},box:{receptions,receiving_yards:40+i*20}}}));
function packet(at:string,final=false){const p={id,name:'Synthetic Player',team:'BUF',opponent:'MIN',markets:['receiving_yards','receptions'],evidence:[...evidence,...['receiving_yards','receptions'].map(m=>({id:`head:${m}`,kind:'independent_model',source:NFL_PLAYER_PROPS_MODEL_RELEASE,availableAt:at,value:{market:m,line:m==='receptions'?4.5:final?69.5:49.5,selectedSide:'over',independentProjection:m==='receptions'?4:55,independentSelectedSideProbability:.53,context:structuredClone(decision.forecastContext)}}))],missing:[]};const q:any[]=[];
 for(const [market,line,books]of [['receiving_yards',final?69.5:49.5,final?['one','two']:['oldbook']],['receptions',4.5,['one']]]as const)for(const book of books)for(const side of ['over','under'])q.push({id:`${market}:${line}:${book}:${side}`,playerId:id,market,line,book,provider:'balldontlie',side,american:side==='over'?150:-170,observedAt:at,receivedAt:at,receivedAtProvenance:'provider_response',opening:false,live:false});
 return{release:PRODUCT_RELEASE,sport:'nfl',gameId:'game',sourceGameId:'game',start,lock,cutoff:at,stage:final?'final':'early',players:[p],quotes:q,executionQuotes:q,sourceLimitations:[]}as any;
}
function review(input:any,final=false){const p=input.players[0],facts=readerEvidence(input)[id],alias=[...evidenceAliases(input)][0][0],law={weights:[1,1,...Array(14).fill(0)],outcomes:{receiving_yards:final?[60,80,...v(60).slice(2)]:[40,60,...v(40).slice(2)],receptions:final?[20,30,...v(20).slice(2)]:[2,6,...v(2).slice(2)]}};
 const wire={wireRelease:PROPS_AI_WIRE_RELEASE,players:{[id]:verifiedReaderFixture(input,id,{assessment:'The supplied sources support a conditional forecast.',priorRead:priorReads(input),coverage:Object.fromEntries(READER_AREAS.map((area:string)=>[area,{status:facts[area].status,factIds:facts[area].facts.slice(0,1).map((f:any)=>f.id),effect:'uncertain',observation:'The supplied context requires caution.'}])),evidenceIds:[alias],gaps:[],law:encodeCanonicalScenarioLaw('nfl',p,law),confidence:[2,2],exceptions:final?[null,'Reception range is not supported by the supplied production.']:[null,null]})}};
 const parsed=parseJointReview(input,wire);return{...parsed,gameId:'game',sourceGameId:'game',start,lock,cutoff:input.cutoff,stage:input.stage,issuedAt:input.cutoff,inputHash:digest(input),criticalContextHashes:criticalContextHashes(input),marketScopes:{[id]:p.markets},model:'gpt-6-luna',partProvenance:[],inputEvidence:{digest:digest(input)}}as any;
}
function native(input:any){return boardRows(input.quotes.map((q:any)=>({...decision,gameId:'game',providerPlayerId:'1',playerName:'Synthetic Player',team:'BUF',opponent:'MIN',scheduledStart:start,lockAt:lock,state:'unlocked',market:q.market,line:q.line,side:q.side,sportsbook:q.book,provider:q.provider,americanPrice:q.american,observedAt:q.observedAt,projection:q.market==='receiving_yards'?55:4,projectionRange:null,grade:'No Play',roleFingerprint:'current-role',bookEvidence:[],aiReview:undefined})));}

const {reviewPropsForSite}=await import('../lib/playerPropsAi/siteRuntime');
const {PROPS_AI_CONTROL_RELEASE}=await import('../lib/playerPropsAi/siteConfig');
const {testNflSourceAuthority,testNflHandoffCapture,mergeNflHandoffs}=await import('../lib/playerPropsAi/nflLockAuthority');
Object.assign(process.env,{NODE_ENV:'test',PLAYER_PROPS_AI_SITE_ENABLED:'true',PLAYER_PROPS_AI_PAID_RUNS_ENABLED:'false',PLAYER_PROPS_AI_OPENAI_API_KEY:'synthetic-never-real',OPENAI_API_KEY:'synthetic-never-real'});
const initialAt='2026-11-09T21:59:58.200Z',finalGetAt='2026-11-09T21:59:59.200Z',overlayAt='2026-11-09T21:59:59.800Z',afterLock='2026-11-09T22:00:00.100Z';
const earlyPacket=packet(earlyIssued),early=review(earlyPacket),currentPacket=packet(finalAt,true),final=review(currentPacket,true),base=native(currentPacket);
const earlyCurrent=packet(earlyAt),earlyBoard=applyNflSiteAi(native(earlyCurrent),earlyCurrent,siteAiDecisions(earlyCurrent,early,earlyAt),earlyAt);
const previous=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:9,evaluatedAt:earlyAt,nextBoard:earlyBoard});
const publicLocked=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:9,evaluatedAt:lock,nextBoard:native(earlyCurrent),previous});
function allDeclined(){const p=final.players[0],wire={wireRelease:PROPS_AI_WIRE_RELEASE,players:{[id]:verifiedReaderFixture(currentPacket,id,{assessment:'The supplied sources do not qualify a numerical forecast.',priorRead:priorReads(currentPacket),coverage:Object.fromEntries(Object.entries(p.coverage).map(([area,value]:any)=>{const{facts,...raw}=value;void facts;return[area,raw];})),evidenceIds:['e0'],gaps:['Both scopes explicitly remain unqualified.'],law:null,confidence:[0,0],exceptions:['Reviewed scope is unqualified.','Reviewed scope is unqualified.']})}};return{...final,...parseJointReview(currentPacket,wire)};}
type Scenario={name:string;initialError?:boolean;finalError?:boolean;afterInitialGet?:string;afterInitialLoad?:string;afterFinalGet?:string;failFreshLoadAfterLock?:boolean;sameEarly?:boolean;declineAll?:boolean;overlayAfterLock?:boolean;previousLocked?:boolean;currentExecutionEmpty?:boolean};
async function exercise(s:Scenario){
 let now=initialAt,reviewReads=0,loads=0,forbidden=0;const advance=(at:string)=>{if(Date.parse(at)>Date.parse(now))now=at;};const frames:any[]=[],sourceEvents:any[]=[],reviewEvents:any[]=[],loadedPackets:any[]=[],sourcePurposes:string[]=[];
 const chosen=s.declineAll?allDeclined():s.sameEarly?early:final;
 const control={data:{release:PROPS_AI_CONTROL_RELEASE,paid_enabled:false},error:null};
 const client={from(table:string){assert(['player_props_ai_control','player_props_ai_reviews'].includes(table),'Unexpected database table');const query:any={};
  for(const name of ['select','eq','gte','order','limit'])query[name]=()=>query;
  const resolve=async()=>{if(table==='player_props_ai_control')return control;reviewReads++;assert(reviewReads<=2,'No paid/pending/calendar lookup permitted');const first=reviewReads===1;if(first){if(s.afterInitialGet)advance(s.afterInitialGet);}else advance(s.afterFinalGet??finalGetAt);
   return{data:(first?s.initialError:s.finalError)?null:(first?[{result:early}]:[{result:chosen},{result:early}]),error:(first?s.initialError:s.finalError)?{message:'Synthetic review GET failure'}:null};};
  query.single=resolve;query.then=(yes:any,no:any)=>resolve().then(yes,no);return query;},rpc(){forbidden++;throw Error('No SQL/RPC allowed');}};
 const result=await reviewPropsForSite({client:client as never,sport:'nfl',games:[{id:'game',start,away:'BUF',home:'MIN'}],clock:()=>now,deadline:Date.now()+1000,fetchImpl:(async()=>{forbidden++;throw Error('No model/provider/count HTTP allowed');})as typeof fetch,
  load:async(_game,window,context)=>{sourcePurposes.push(context?.purpose??"missing");loads++;if(s.failFreshLoadAfterLock&&loads===2){advance(afterLock);throw Error('Synthetic source GET failed after lock');}if(Date.parse(window.cutoff)>=Date.parse(lock))throw Error('Synthetic current source refuses a postlock capture');
   const p={...structuredClone(currentPacket),cutoff:window.cutoff};if(s.currentExecutionEmpty&&loads===2)p.executionQuotes=[];loadedPackets.push(p);if(loads===1&&s.afterInitialLoad)advance(s.afterInitialLoad);return p;},
  onSourceReady:(p,r,observedAt,lookupAvailable)=>{sourceEvents.push({packet:p,review:r,observedAt,lookupAvailable});frames.push(testNflSourceAuthority(()=>now)(p,r,lookupAvailable));frames.push(testNflHandoffCapture(()=>now)(base.decisions,p,r,'native'));},
  onReviewObserved:(p,r,lookupAvailable)=>{reviewEvents.push({packet:p,review:r,observedAt:now,lookupAvailable});frames.push(testNflSourceAuthority(()=>now)(p,r,lookupAvailable));}
 });
 let candidate=base;
 for(const game of result.games){advance(overlayAt);candidate=applyNflSiteAi(candidate,game.packet,game.decisions,now);advance(s.overlayAfterLock?afterLock:overlayAt);const frame=testNflHandoffCapture(()=>now)(candidate.decisions,game.packet,game.authorityReview,'ai');assert.equal(frame.authorities.length,0,'Numeric readiness cannot create/backdate a source authority');frames.push(frame);}
 const bundle=mergeNflHandoffs(frames),snapshot:NflPlayerPropsProductionSnapshot=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:9,evaluatedAt:afterLock,nextBoard:candidate,previous:s.previousLocked?publicLocked:previous,lockHandoff:bundle});
 assert.equal(forbidden,0);assert.equal(reviewReads,2);assert.deepEqual(sourcePurposes,["lock_authority","member_publication"]);return{scenario:s,result,snapshot,bundle,sourceEvents,reviewEvents,loadedPackets,chosen,loads};
}
const positive=await exercise({name:'all prelock: final B and explicit native decline'});
assert.equal(positive.result.games.length,1);assert.equal(positive.result.games[0].authorityReview?.inputHash,final.inputHash);
assert(positive.snapshot.memberDecisions.some(r=>r.market==='receiving_yards'&&r.aiReview?.lawHash===final.players[0].law!.hash&&r.grade==='Best Angle'),'Actual runtime final B must promote');
assert(positive.snapshot.memberDecisions.filter(r=>r.market==='receptions').every(r=>!r.aiReview),'Explicit final decline must use verified native baseline');
const lateOverlay=await exercise({name:'source authority prelock, numeric overlay ready postlock',overlayAfterLock:true});
assert(lateOverlay.reviewEvents.some(e=>e.review?.inputHash===final.inputHash&&Date.parse(e.observedAt)<Date.parse(lock)),'B authority must be observed before overlay');
assert(lateOverlay.snapshot.memberDecisions.length>0&&lateOverlay.snapshot.memberDecisions.every(r=>!r.aiReview),'Late numeric overlay cannot erase the prelock decline authority or revive A');
const same=await exercise({name:'same known early A',sameEarly:true});
assert(same.snapshot.memberDecisions.some(r=>r.market==='receptions'&&r.aiReview?.lawHash===early.players[0].law!.hash),'Ordinary native refresh must retain known valid early A');
assert(same.snapshot.memberDecisions.filter(r=>r.aiReview).every(r=>r.aiReview!.lawHash===early.players[0].law!.hash));
const declined=await exercise({name:'all declined and zero priced choices',declineAll:true});
assert.equal(declined.result.games.length,1,'All-declined game still forwards review authority');assert.equal(declined.result.games[0].decisions.length,0);assert(declined.bundle.authorities.some(a=>a.review?.inputHash===declined.chosen.inputHash&&a.scopes.every(s=>s.status==='declined')));
assert(declined.snapshot.memberDecisions.length>0&&declined.snapshot.memberDecisions.every(r=>!r.aiReview),'Zero-price final authority must still replace stale early AI with proved native');
const initialFailure=await exercise({name:'initial review GET unavailable',initialError:true});
assert.equal(initialFailure.sourceEvents[0].lookupAvailable,false,'Initial GET failure must remain explicit');assert(initialFailure.bundle.authorities.some(a=>a.scopes.some(s=>s.status==='review_lookup_unavailable')));
assert(initialFailure.snapshot.memberDecisions.filter(r=>r.market==='receptions').every(r=>!r.aiReview));
const finalFailure=await exercise({name:'final review GET unavailable',finalError:true});
assert.equal(finalFailure.result.status,'paid_disabled');assert.equal(finalFailure.result.games.length,1);assert(finalFailure.result.findings.includes('accepted_review_read_failed_use_trusted_local'));
assert.equal(finalFailure.result.games[0].authorityReview?.inputHash,early.inputHash,'Failed refresh may use only the trusted initial early review');
assert(!finalFailure.bundle.authorities.some(a=>a.review?.inputHash===final.inputHash),'Failed final lookup cannot invent a B authority');
assert(finalFailure.snapshot.memberDecisions.filter(r=>r.aiReview).every(r=>r.aiReview!.lawHash===early.players[0].law!.hash),'A failed lookup cannot replace valid observed early A with an invented final law');
const bothFailures=await exercise({name:'both review lookups unavailable',initialError:true,finalError:true});
assert(bothFailures.reviewEvents.every(e=>e.lookupAvailable===false),'Two failed GETs must not imply a successful empty lookup');
assert(bothFailures.bundle.authorities.some(a=>a.scopes.some(s=>s.status==='review_lookup_unavailable')));
assert.equal(bothFailures.result.games[0].authorityReview,null);
assert(bothFailures.snapshot.memberDecisions.every(r=>!r.aiReview),'Prelock explicitly unknown review authority may only use verified native rows');
const initialCross=await exercise({name:'initial GET crosses lock',afterInitialGet:afterLock});
assert.equal(initialCross.sourceEvents.length,0);assert.equal(initialCross.result.games.length,0);assert.equal(initialCross.bundle.nativeProofs.length,0,'Source read after lock is not prelock availability');
assert(initialCross.snapshot.memberDecisions.filter(r=>r.aiReview).every(r=>r.aiReview!.lawHash===early.players[0].law!.hash),'Late initial lookup may not backdate final B');
const sourceCross=await exercise({name:'initial source materialization crosses lock',afterInitialLoad:afterLock});
assert(sourceCross.sourceEvents.every(e=>Date.parse(e.observedAt)>=Date.parse(lock)));assert(!sourceCross.bundle.nativeProofs.some(p=>Date.parse(p.readyAt)<Date.parse(lock)));
assert(sourceCross.snapshot.memberDecisions.filter(r=>r.aiReview).every(r=>r.aiReview!.lawHash===early.players[0].law!.hash),'Late source materialization may not replace A with B');
const finalCross=await exercise({name:'final review GET crosses lock',afterFinalGet:afterLock});
assert.equal(finalCross.result.games.length,1);assert.strictEqual(finalCross.result.games[0].packet,finalCross.sourceEvents[0].packet,'Postlock load failure must reuse the exact captured packet');
assert.equal(finalCross.result.games[0].packet.cutoff,initialAt,'Captured cutoff is never replaced with a postlock timestamp');assert.equal(finalCross.result.games[0].decisions.length,0);
assert(!finalCross.bundle.authorities.some(a=>a.review?.inputHash===final.inputHash&&Date.parse(a.observedAt)<Date.parse(lock)),'Postlock GET cannot backdate B authority');
assert(finalCross.snapshot.memberDecisions.filter(r=>r.aiReview).every(r=>r.aiReview!.lawHash===early.players[0].law!.hash),'No late B may mix with early A');
const sourceFailure=await exercise({name:'fresh source GET fails after lock',failFreshLoadAfterLock:true});
assert.equal(sourceFailure.result.games.length,1);assert.strictEqual(sourceFailure.result.games[0].packet,sourceFailure.sourceEvents[0].packet);assert.equal(sourceFailure.result.games[0].packet.cutoff,initialAt);assert(sourceFailure.result.findings.some(s=>s.startsWith('current_source_unavailable:')));
assert(!sourceFailure.bundle.authorities.some(a=>a.review?.inputHash===final.inputHash&&Date.parse(a.observedAt)<Date.parse(lock)),'No reconstruction may claim a prelock observation which never occurred');
assert(sourceFailure.snapshot.memberDecisions.filter(r=>r.aiReview).every(r=>r.aiReview!.lawHash===early.players[0].law!.hash),'A failed current source load after lock cannot backdate final B');
const currentEmpty=await exercise({name:'actual site source withdraws all current execution',sameEarly:true,currentExecutionEmpty:true});
assert.equal(currentEmpty.result.games[0].decisions.length,0);assert.equal(currentEmpty.snapshot.memberDecisions.length,0,'Actual runtime explicit empty execution cannot first-lock the earlier AI or native capture');
const protectedResult=await exercise({name:'existing public locks first',previousLocked:true});assert.deepEqual(protectedResult.snapshot.board.decisions,publicLocked.board.decisions);assert.deepEqual(protectedResult.snapshot.memberDecisions,publicLocked.memberDecisions);
{
// A complete current collector observation owns future execution availability,
// independently of whether its accepted final is newer than the prior board.
const ready:NflPlayerPropsRuntimeBoard=applyNflSiteAi(base,currentPacket,siteAiDecisions(currentPacket,final,finalAt),finalAt);
const priorReady:NflPlayerPropsProductionSnapshot=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:9,evaluatedAt:finalAt,nextBoard:ready});
const lockedReady:NflPlayerPropsProductionSnapshot=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:9,evaluatedAt:lock,nextBoard:ready,previous:priorReady});
const changedAt='2026-11-09T21:59:59Z';
const removed={...structuredClone(currentPacket),cutoff:changedAt,players:currentPacket.players.map((p:any)=>({...p,markets:['receptions']})),quotes:currentPacket.quotes.filter((q:any)=>q.market==='receptions'),executionQuotes:currentPacket.executionQuotes.filter((q:any)=>q.market==='receptions')};
function framesFor(source:any,rows:NflPlayerPropsRuntimeBoard,at=changedAt,lookup=true){return mergeNflHandoffs([
 testNflSourceAuthority(()=>at)(source,final,lookup),testNflHandoffCapture(()=>at)(rows.decisions,source,final,'native'),testNflHandoffCapture(()=>at)(rows.decisions,source,final,'ai')]);}
function reconcileCurrent(source:any,rows:NflPlayerPropsRuntimeBoard,at=afterLock,lookup=true):NflPlayerPropsProductionSnapshot{return reconcileNflPlayerPropsProductionSnapshot({season:2026,week:9,evaluatedAt:at,nextBoard:rows,previous:priorReady,lockHandoff:framesFor(source,rows,source.cutoff,lookup)});}
const nextNative=native(removed),removedBoard:NflPlayerPropsRuntimeBoard=applyNflSiteAi(nextNative,removed,siteAiDecisions(removed,final,changedAt),changedAt);
assert(!removedBoard.decisions.some(r=>r.market==='receiving_yards'));
const removedFirstLock=reconcileCurrent(removed,removedBoard);
assert(!removedFirstLock.memberDecisions.some(r=>r.market==='receiving_yards'),'An unchanged final cannot resurrect a withdrawn scope at its first lock');
assert(!reconcileCurrent(removed,removedBoard,changedAt).memberDecisions.some(r=>r.market==='receiving_yards'),'Prelock missing-scope retention cannot restore an explicitly withdrawn event');
const explicitEmpty={...structuredClone(currentPacket),cutoff:changedAt,executionQuotes:[]};
assert.equal(reconcileCurrent(explicitEmpty,ready).memberDecisions.length,0,'Explicit empty current execution removes old AI and native first-lock candidates');
const staleReadyFrames=mergeNflHandoffs([framesFor(currentPacket,ready,finalAt),framesFor(explicitEmpty,ready)]);
assert.equal(reconcileNflPlayerPropsProductionSnapshot({season:2026,week:9,evaluatedAt:afterLock,nextBoard:ready,previous:priorReady,lockHandoff:staleReadyFrames}).memberDecisions.length,0,'A real earlier numeric capture cannot defeat a later prelock withdrawal');
assert.equal(reconcileCurrent(explicitEmpty,ready,afterLock,false).memberDecisions.length,0,'Review GET failure does not erase a successful explicit current execution observation');
// An absent actor is also covered by the complete game collector observation.
const otherActor={...structuredClone(currentPacket),cutoff:changedAt,players:currentPacket.players.map((p:any)=>({...p,id:'nfl-bdl-player:2',name:'Another Player'})),quotes:[],executionQuotes:[]};
assert.equal(reconcileCurrent(otherActor,ready).memberDecisions.length,0,'Whole actor withdrawal cannot fall through the missing actor authority');
// Losing one book cannot erase a still-current independently priced contract.
const oneBook={...structuredClone(currentPacket),cutoff:changedAt,quotes:currentPacket.quotes.filter((q:any)=>q.book!=='one'||q.market!=='receiving_yards'),executionQuotes:currentPacket.executionQuotes.filter((q:any)=>q.book!=='one'||q.market!=='receiving_yards')};
const oneBookResult=reconcileCurrent(oneBook,ready);
assert(!oneBookResult.memberDecisions.some(r=>r.market==='receiving_yards'&&r.sportsbook==='one'));
assert(oneBookResult.memberDecisions.some(r=>r.market==='receiving_yards'&&r.sportsbook==='two'&&r.grade==='Best Angle'));
const repriced={...structuredClone(currentPacket),cutoff:changedAt,quotes:currentPacket.quotes.map((q:any)=>({...q,american:q.market==='receptions'?q.side==='over'?160:-180:q.american})),executionQuotes:currentPacket.executionQuotes.map((q:any)=>({...q,american:q.market==='receptions'?q.side==='over'?160:-180:q.american}))};
const repricedNative=native(repriced);
const oldNativeFrame=testNflHandoffCapture(()=>finalAt)(base.decisions,currentPacket,final,'native');
const newPriceAuthority=testNflSourceAuthority(()=>changedAt)(repriced,final,true);
const staleNative:NflPlayerPropsProductionSnapshot=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:9,evaluatedAt:afterLock,nextBoard:repricedNative,previous,lockHandoff:mergeNflHandoffs([oldNativeFrame,newPriceAuthority])});
assert(!staleNative.memberDecisions.some(r=>r.market==='receptions'),'A declined AI scope cannot restore a formerly ready native price withdrawn by the later exact contract observation');
const freshNative:NflPlayerPropsProductionSnapshot=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:9,evaluatedAt:afterLock,nextBoard:repricedNative,previous,lockHandoff:framesFor(repriced,repricedNative)});
assert.equal(freshNative.memberDecisions.filter(r=>r.market==='receptions'&&!r.aiReview).length,2,'A genuinely ready current native fallback recovers its exact repriced contract');

// A current return recovers the very same frozen law and normal promotion path.
const returned={...structuredClone(currentPacket),cutoff:'2026-11-09T21:59:59.500Z'};
const returnedFrames=mergeNflHandoffs([framesFor(explicitEmpty,ready),framesFor(returned,ready,returned.cutoff)]);
const recovered:NflPlayerPropsProductionSnapshot=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:9,evaluatedAt:afterLock,nextBoard:ready,previous:priorReady,lockHandoff:returnedFrames});
assert.equal(recovered.memberDecisions.filter(r=>r.aiReview&&r.grade==='Best Angle').length,2);
assert(recovered.memberDecisions.filter(r=>r.aiReview).every(r=>r.aiReview!.lawHash===final.players[0].law!.hash),'Return cannot replace or reinterpret the accepted law');
assert(reconcileCurrent(returned,ready).memberDecisions.some(r=>r.aiReview),'An unchanged current final remains eligible');
// No actual current execution capture is different from an explicit empty set.
const unavailable={...structuredClone(currentPacket),cutoff:changedAt};delete unavailable.executionQuotes;
assert(reconcileCurrent(unavailable,ready).memberDecisions.some(r=>r.aiReview),'Missing execution metadata must not fabricate a withdrawal');
const afterOnly:NflPlayerPropsProductionSnapshot=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:9,evaluatedAt:afterLock,nextBoard:ready,previous:priorReady,lockHandoff:framesFor(explicitEmpty,ready,afterLock)});
assert(afterOnly.memberDecisions.some(r=>r.aiReview),'A postlock withdrawal cannot be backdated');
for(const source of [removed,explicitEmpty,otherActor,oneBook]){
 const preserved=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:9,evaluatedAt:afterLock,nextBoard:ready,previous:lockedReady,lockHandoff:framesFor(source,ready)});
 assert.deepEqual(preserved.memberDecisions,lockedReady.memberDecisions,'Every already public member lock retains its exact payload');
 assert.deepEqual(preserved.board.decisions,lockedReady.board.decisions,'Every already public board lock retains its exact payload');
}
assert.equal(priorReady.memberDecisions.filter(r=>r.aiReview&&r.grade==='Best Angle').length,2);
console.log('NFL current-execution first-lock guard passed: same-final scoped/book/actor withdrawal, explicit empty versus absent metadata, independent review GET failure, prelock suppression and same-law return promotion, postlock refusal and exact stored locks. Synthetic source/parser/binding/reconciler only.');
}
for(const crossDuringLookup of [true,false]){
Object.assign(process.env,{NODE_ENV:'test'});
Object.assign(process.env,{PLAYER_PROPS_AI_SITE_ENABLED:'true',PLAYER_PROPS_AI_PAID_RUNS_ENABLED:'true',PLAYER_PROPS_AI_OPENAI_API_KEY:'synthetic-never-real'});

const {capturedReviewSlots}=await import('../lib/playerPropsAi/liveWindow');

const {PROPS_AI_CALENDAR_RELEASE}=await import('../lib/playerPropsAi/calendar');
// The preparation phase now reserves generation opportunity before counting.
// Begin this paid-path fixture five minutes before lock; completion and the
// later GET/source crossing still exercise the original exact lock boundary.
const paidSourceAt='2026-11-09T21:55:00Z';
let tick=paidSourceAt,reviewGets=0,generationCalls=0,countCalls=0,completedObservedLocallyAt:string|null=null,finished:any=null,claimHash:string|null=null;
const frames:any[]=[],observed:any[]=[];let localCandidate:NflPlayerPropsRuntimeBoard|null=null;const readyAt:string[]=[];
const {restoreNflNativeGame}=await import('../lib/playerPropsAi/siteBindings');
const initialPacket=packet(paidSourceAt,true),nativeBefore=native(initialPacket),funded='espn:nfl:synthetic';
const job={job_key:'synthetic-final',sport:'nfl',game_id:funded,game_day:'2026-11-09',stage:'final',scheduled_start:start,lock_at:lock,due_at:'2026-11-09T21:35:00Z',billing_month:'2026-11',state:'pending'};
const calendar={release:PROPS_AI_CALENDAR_RELEASE,month:'2026-11',capturedAt:paidSourceAt,games:[{sport:'nfl',id:funded,start,lock,home:'MIN',away:'BUF',confirmed:true}],sources:Object.fromEntries(['nba','nfl','mlb'].map(s=>[s,{complete:true,source:'synthetic complete calendar'}]))};
const client:any={from:(table:string)=>{
 let selection='';const query:any={select:(s:string)=>{selection=s;return query;},eq:()=>query,gte:()=>query,in:()=>query,lte:()=>query,gt:()=>query,order:()=>query,single:async()=>({data:{release:'player_props_ai_control_2026_11_07_r1_explicit_off',paid_enabled:true},error:null}),maybeSingle:async()=>({data:{release:PROPS_AI_CALENDAR_RELEASE,captured_at:paidSourceAt,payload:calendar},error:null}),limit:async()=>{assert.equal(table,'player_props_ai_reviews');reviewGets++;if(reviewGets===1)return{data:[{result:early}],error:null};assert(finished,'Reviewer returned locally before final GET');completedObservedLocallyAt=tick;tick=crossDuringLookup?'2026-11-09T22:00:00.100Z':'2026-11-09T21:59:59.950Z';return{data:[{result:finished},{result:early}],error:null};},then:(resolve:any)=>{assert.equal(selection,'*');return Promise.resolve({data:[job],error:null}).then(resolve);}};return query;
},rpc:async(name:string,args:any)=>{
 if(name==='player_props_ai_plan_v4')return{data:{funded:true,budget:{}},error:null};
 if(name==='player_props_ai_reap')return{data:0,error:null};
 if(name==='player_props_ai_claim'){claimHash=args.p_hash;return{data:{claimed:true,token:'00000000-0000-0000-0000-000000000001',job:{...job,state:'running',parts:1,phase:1,model:'gpt-6-luna',requested_tier:'default',claim_token:'00000000-0000-0000-0000-000000000001'}},error:null};}
 if(name==='player_props_ai_send')return{data:{id:'00000000-0000-0000-0000-000000000002',model:'gpt-6-luna',requested_tier:'default',reserved_micro:100000},error:null};
 if(name==='player_props_ai_receipt')return{data:null,error:null};
 if(name==='player_props_ai_finish'){assert(args.p_result,'Synthetic draft should be admitted');finished={...args.p_result,issuedAt:tick,inputHash:claimHash};return{data:{state:'completed',result:finished},error:null};}
 throw Error('Unexpected mocked RPC '+name);
}};
const fetchImpl=async(url:any)=>{
 if(String(url).endsWith('/input_tokens')){countCalls++;return Response.json({input_tokens:1000});}
 assert.equal(String(url),'https://api.openai.com/v1/responses');generationCalls++;
 const p=initialPacket.players[0],aliases=evidenceAliases(initialPacket),lookup=(raw:string)=>[...aliases].find(([,x])=>x===raw)![0];
 const rp=final.players[0],law={weights:rp.law.weights.map((w:number)=>w*2),outcomes:rp.law.outcomes};
 const wire={wireRelease:PROPS_AI_WIRE_RELEASE,players:{[id]:verifiedReaderFixture(initialPacket,id,{assessment:rp.assessment,priorRead:Object.fromEntries(Object.entries(rp.priorRead).map(([key,value])=>[lookup(key),value])),coverage:Object.fromEntries(Object.entries(rp.coverage).map(([area,value]:any)=>{const{facts,...rest}=value;void facts;return[area,rest];})),evidenceIds:rp.evidenceIds.map(lookup),gaps:rp.gaps,law:encodeCanonicalScenarioLaw('nfl',p,law),confidence:rp.confidence,exceptions:rp.exceptions})}};
 tick=finalAt;return Response.json({id:'synthetic-response',model:'gpt-6-luna',status:'completed',service_tier:'default',usage:{input_tokens:1000,output_tokens:100},output:[{content:[{type:'output_text',text:JSON.stringify(wire)}]}]});
};
localCandidate=nativeBefore;
const paidSourceContexts:any[]=[];
const outcome=await reviewPropsForSite({client,sport:'nfl',writerRunId:'synthetic-owner',games:[{id:'game',start,away:'BUF',home:'MIN'}],deadline:Date.now()+300000,clock:()=>tick,fetchImpl:fetchImpl as typeof fetch,
 load:(_game:any,window:any,context:any)=>{paidSourceContexts.push(context);capturedReviewSlots({gameId:'game',start,lock},window,()=>[]);return packet(window.cutoff,true);},
 onSourceReady:(p:any,r:any,_at:any,lookupAvailable:boolean)=>{frames.push(testNflSourceAuthority(()=>tick)(p,r,lookupAvailable));frames.push(testNflHandoffCapture(()=>tick)(nativeBefore.decisions,p,r,'native'));},
 onReviewObserved:(p,r,lookupAvailable)=>{observed.push({input:r?.inputHash,at:tick});frames.push(testNflSourceAuthority(()=>tick)(p,r,lookupAvailable));},
 onReviewReady:(p,r)=>{readyAt.push(tick);localCandidate=restoreNflNativeGame(localCandidate!,nativeBefore,p,tick);localCandidate=applyNflSiteAi(localCandidate,p,siteAiDecisions(p,r,tick),tick);frames.push(testNflHandoffCapture(()=>tick)(localCandidate!.decisions,p,r,'ai'));}
});

assert.equal(generationCalls,1,'Exactly the one scheduled model generation is mocked');assert.equal(countCalls,1,'Exactly one scheduled request count is mocked');assert.equal(reviewGets,2);
assert(finished&&Date.parse(finished.issuedAt)<Date.parse(lock));assert.equal(completedObservedLocallyAt,finalAt);assert.deepEqual(readyAt,[finalAt]);
assert(observed.some(e=>e.input===finished.inputHash&&e.at===finalAt),'Local completion authority is observed before the accepted-review GET');
assert.deepEqual(paidSourceContexts.map(c=>c.purpose),['lock_authority','scheduled_review','member_publication']);assert.equal(paidSourceContexts[1].job.job_key,job.job_key,'Only the actual due slot carries its funded job identity');
assert.equal(outcome.games.length,1);
if(crossDuringLookup){assert(outcome.findings.some(f=>f.startsWith('current_source_unavailable:')));assert.equal(outcome.games[0].packet.cutoff,paidSourceAt,'Fallback preserves the exact generated source cutoff');}
else{assert(!outcome.findings.some(f=>f.startsWith('current_source_unavailable:')));assert(outcome.games[0].decisions.length>0,'The normal returned game is priceable before its second application');}
for(const game of outcome.games){if(Date.parse(tick)>=Date.parse(game.packet.lock))continue;localCandidate=restoreNflNativeGame(localCandidate!,nativeBefore,game.packet,tick);localCandidate=applyNflSiteAi(localCandidate,game.packet,game.decisions,tick);frames.push(testNflHandoffCapture(()=>tick)(localCandidate!.decisions,game.packet,game.authorityReview,'ai'));}
// Normal writer publication can cross T-60 only after the returned game's
// second genuine application/capture, with both proof versions accumulated.
if(!crossDuringLookup)tick='2026-11-09T22:00:00.100Z';
const result:NflPlayerPropsProductionSnapshot=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:9,evaluatedAt:tick,nextBoard:localCandidate!,previous,lockHandoff:mergeNflHandoffs(frames)});
assert(result.memberDecisions.some(r=>r.market==='receiving_yards'&&r.aiReview?.lawHash===finished.players[0].law.hash&&r.grade==='Best Angle'),'Real mocked scheduled completion B must publish from its actual prelock readiness');
assert(result.memberDecisions.filter(r=>r.market==='receptions').every(r=>!r.aiReview),'Prelock final decline authority uses native baseline after the later GET crosses lock');
assert(result.memberDecisions.filter(r=>r.aiReview).every(r=>r.aiReview!.lawHash===finished.players[0].law.hash),'Postlock GET/fallback must not resurrect early law A or undo preprepared B');
if(!crossDuringLookup){
 const aiFrames=frames.filter(f=>f.candidateProofs.length);assert.equal(aiFrames.length,2,'Both normal writer AI capture points are exercised');
 assert(result.memberDecisions.filter(r=>r.aiReview).every(r=>r.aiReview!.executionEvidence!.pricedAt==='2026-11-09T21:59:59.950Z'),'The later exact captured row survives first lock');
 const reversed=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:9,evaluatedAt:tick,nextBoard:localCandidate!,previous,lockHandoff:mergeNflHandoffs([...frames].reverse())});
 assert.deepEqual(reversed.memberDecisions,result.memberDecisions,'Normal callback/second-application proof order does not change the locked members');
}
console.log(`Mocked paid-path siteRuntime passed: one count/one generation, local B ready callback and ${crossDuringLookup?'postlock GET/source fallback':'second prelock returned-game overlay followed by publication crossing lock'}, qualified B/native decline and exact locks preserved.`);
}
console.log('Actual siteRuntime lock-authority controls passed: pre/post GET/source boundaries, source-before-overlay readiness, zero-price all-declined authority, lookup failures, unchanged early retention, exact cached cutoff and immutable public locks. Supabase and every network/model/count path mocked.');
}
void main().catch(error=>{console.error(error);process.exitCode=1});
