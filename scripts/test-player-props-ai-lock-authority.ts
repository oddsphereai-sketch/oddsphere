import {PROPS_AI_WIRE_RELEASE} from "../lib/playerPropsAi/scenarioCoordinates";
import {verifiedReaderFixture} from "./lib/player-props-ai-reader-fixture";
/* eslint-disable @typescript-eslint/no-explicit-any -- Synthetic malformed JSON fixtures intentionally exercise runtime parser and DTO admission. */
/** All data synthetic. Full actual parser/binding/reconciler; no HTTP or paid calls. */
import assert from 'node:assert/strict';
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
const earlyInput=packet(earlyIssued),a=review(earlyInput),nearInput=packet(earlyAt),earlyChoices=siteAiDecisions(nearInput,a,earlyAt);assert.equal(earlyChoices.length,2);
const earlyBoard=applyNflSiteAi(native(nearInput),nearInput,earlyChoices,earlyAt),previous=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:9,evaluatedAt:earlyAt,nextBoard:earlyBoard});
const finalInput=packet(finalAt,true),b=review(finalInput,true);assert.deepEqual(b.players[0].sourceDeclinedMarkets,['receptions']);
const finalChoices=siteAiDecisions(finalInput,b,publishBefore);assert.equal(finalChoices.length,2);assert.ok(finalChoices.every((c:any)=>c.market==='receiving_yards'&&c.grade==='Best Angle'));
const extraActor=structuredClone(finalInput);extraActor.players.push({...extraActor.players[0],id:'nfl-bdl-player:2',name:'New source actor',evidence:extraActor.players[0].evidence.map((e:any)=>({...e,id:`new:${e.id}`}))});assert.equal(siteAiDecisions(extraActor,b,publishBefore).length,2,'a newly added unreviewed actor does not erase the existing actor read');
const changedPacket=structuredClone(finalInput);changedPacket.players[0].evidence.push({id:'late-role',kind:'availability',source:'synthetic current report',availableAt:finalAt,value:{status:'Questionable'}});assert.equal(siteAiDecisions(changedPacket,b,publishBefore).length,0,'changed actor context invalidates its stored final read');
const finalBoard=applyNflSiteAi(native(finalInput),finalInput,finalChoices,publishBefore);
assert.ok(finalBoard.decisions.filter((r:any)=>r.market==='receptions').every((r:any)=>!r.aiReview),'fresh baseline decline does not itself retain old AI before reconciliation');
const prelock=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:9,evaluatedAt:publishBefore,nextBoard:finalBoard,previous});
assert.ok(prelock.board.decisions.filter((r:any)=>r.market==='receiving_yards').every((r:any)=>r.aiReview?.lawHash===b.players[0].law.hash));
assert.ok(prelock.board.decisions.filter((r:any)=>r.market==='receptions').every((r:any)=>!r.aiReview));
// Actual writer handoff: AI application occurs before lock; publication clock
// crosses the boundary before its existing reconcile call with old previous.
const crossed=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:9,evaluatedAt:lock,nextBoard:finalBoard,previous});
const hashes=[...new Set(crossed.board.decisions.filter((r:any)=>r.aiReview).map((r:any)=>r.aiReview.lawHash))];assert.ok(hashes.includes(a.players[0].law.hash)&&hashes.includes(b.players[0].law.hash));
assert.ok(crossed.memberDecisions.some((r:any)=>r.market==='receptions'&&r.aiReview?.lawHash===a.players[0].law.hash),'declined old scope is revived from early law at lock');
assert.ok(crossed.memberDecisions.some((r:any)=>r.market==='receiving_yards'&&r.aiReview?.lawHash===b.players[0].law.hash),'new qualified main line promotes final law');
// Normal prelock write avoids that resurrection; confirmed counterexample is
// the lock-crossing handoff, not every ordinary final review.
const ordinaryLock=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:9,evaluatedAt:lock,nextBoard:native(finalInput),previous:prelock});
assert.ok(ordinaryLock.board.decisions.filter((r:any)=>r.market==='receptions').every((r:any)=>!r.aiReview));
const changed=native(finalInput);changed.decisions=changed.decisions.map((r:any)=>({...r,roleFingerprint:'changed-injury-context',forecastContext:{...r.forecastContext,availability:{...r.forecastContext.availability,status:'Questionable'}}}));
const contextLock=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:9,evaluatedAt:lock,nextBoard:changed,previous});assert.ok(contextLock.memberDecisions.some((r:any)=>r.market==='receptions'&&r.aiReview?.lawHash===a.players[0].law.hash),'exact-price retention ignores a changed current role fingerprint');
const changedBefore=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:9,evaluatedAt:publishBefore,nextBoard:changed,previous});assert.ok(changedBefore.board.decisions.every((r:any)=>!r.aiReview),'before lock the current changed-context native board wins');
const alreadyLocked=crossed,protectedAfter=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:9,evaluatedAt:'2026-11-09T22:01:00Z',nextBoard:native(finalInput),previous:alreadyLocked});assert.deepEqual(protectedAfter.memberDecisions,alreadyLocked.memberDecisions);assert.deepEqual(protectedAfter.board.decisions,alreadyLocked.board.decisions);
console.log(JSON.stringify({syntheticOnly:true,noNetwork:true,prelockFinalQualifiedPromotion:true,prelockDeclinedScopeUsesFreshNative:true,nflCrossLockMemberUsesTwoLaws:true,declinedOldEarlyScopeResurrected:true,currentChangedContextIgnoredByLockRetention:true,ordinaryFinalPrelockWriteAvoidsResurrection:true,existingLockedPayloadsPreserved:true},null,2));


const {testNflAuthority:buildAuthorities,testNflHandoffProof:proveRow,resolveScope,captureNflHandoffBundle:productionCapture,testNflHandoffCapture,mergeNflHandoffs,prepareNflLockHandoff}=await import('../lib/playerPropsAi/nflLockAuthority');
Object.assign(process.env,{NODE_ENV:'test'});
const captureNflHandoffBundle=(rows:any,packet:any,review:any,kind:'ai'|'native',clock:()=>string)=>testNflHandoffCapture(clock)(rows,packet,review,kind);
assert.throws(()=>Reflect.apply(productionCapture,null,[[],finalInput,b,'native',()=>finalAt]),/rejects supplied clocks/);
const observed='2026-11-09T21:59:58.500Z',nativeReady='2026-11-09T21:59:58.200Z';
const authority=buildAuthorities(finalInput,b,observed)[0],nativeRows=native(finalInput).decisions;
const nativeBundle=captureNflHandoffBundle(nativeRows,finalInput,b,'native',()=>nativeReady),nativeProofs=nativeBundle.nativeProofs;
const aiBundle=captureNflHandoffBundle(finalBoard.decisions,finalInput,b,'ai',()=>publishBefore),candidateProofs=aiBundle.candidateProofs;
const handoff=(authorities:any[],overrides:any={})=>{const {nativeRows:nr=nativeRows,nativeProofs:np=nativeProofs,candidateProofs:cp=candidateProofs,...args}=overrides;return{snapshot:reconcileNflPlayerPropsProductionSnapshot({season:2026,week:9,evaluatedAt:lock,nextBoard:finalBoard,previous,...args,lockHandoff:{...mergeNflHandoffs([nativeBundle,aiBundle]),authorities,nativeRows:nr,nativeProofs:np,candidateProofs:cp}})}};

const fixed=handoff([authority]);
// The normal writer captures onReviewReady, then reapplies/captures its returned
// game before publication. Both rows are genuine, but pricedAt changes. Crossing
// the lock after the second overlay must select that immutable row's proof.
const reappliedAt='2026-11-09T21:59:59.950Z';
const reapplied=applyNflSiteAi(native(finalInput),finalInput,siteAiDecisions(finalInput,b,reappliedAt),reappliedAt);
const secondBundle=captureNflHandoffBundle(reapplied.decisions,finalInput,b,'ai',()=>reappliedAt);
assert.equal(secondBundle.candidateProofs.length,aiBundle.candidateProofs.length);
const repeatSnapshot=(bundles:any[],overrides:any={})=>reconcileNflPlayerPropsProductionSnapshot({season:2026,week:9,evaluatedAt:lock,nextBoard:reapplied,previous,
 lockHandoff:{...mergeNflHandoffs(bundles),authorities:[authority],...overrides}});
const repeated=repeatSnapshot([nativeBundle,aiBundle,secondBundle]);
const reversed=repeatSnapshot([secondBundle,aiBundle,nativeBundle]);
assert.deepEqual(repeated.memberDecisions,reversed.memberDecisions,'Exact row proof selection is independent of capture order');
assert(repeated.memberDecisions.filter((r:any)=>r.aiReview).every((r:any)=>r.aiReview.executionEvidence.pricedAt===reappliedAt));
assert.equal(repeated.memberDecisions.filter((r:any)=>r.aiReview?.lawHash===b.players[0].law.hash&&r.grade==='Best Angle').length,2,'Both selected-side Best Angles retain the latest law');
const unchangedFinal=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:9,evaluatedAt:lock,nextBoard:reapplied,previous:prelock,lockHandoff:{...mergeNflHandoffs([nativeBundle,aiBundle,secondBundle]),authorities:[authority]}});
assert(unchangedFinal.memberDecisions.some((r:any)=>r.aiReview),'The unchanged final authority retains its qualified AI scopes');
assert(unchangedFinal.memberDecisions.filter((r:any)=>r.aiReview).every((r:any)=>r.aiReview.executionEvidence.pricedAt===reappliedAt),'An unchanged final authority also selects the exact newer row without requiring supersession');
const noExact=repeatSnapshot([aiBundle],{nativeRows:[],nativeProofs:[]});
assert.equal(noExact.memberDecisions.length,0,'A genuine proof for another row is unavailable, not a fatal tampering assertion');
const changedAfterCapture={...reapplied,decisions:reapplied.decisions.map((r:any)=>({...r,projection:r.projection+1}))};
const changedAfterResult=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:9,evaluatedAt:lock,nextBoard:changedAfterCapture,previous,lockHandoff:{...mergeNflHandoffs([secondBundle]),authorities:[authority],nativeRows:[],nativeProofs:[]}});
assert.equal(changedAfterResult.memberDecisions.length,0,'A row mutated after capture cannot borrow its original proof');
const lateSecond=captureNflHandoffBundle(reapplied.decisions,finalInput,b,'ai',()=> '2026-11-09T22:00:01Z');
for(const bundles of [[aiBundle,lateSecond],[lateSecond,aiBundle]])assert.equal(repeatSnapshot(bundles,{nativeRows:[],nativeProofs:[]}).memberDecisions.length,0,'An older different row cannot backdate the only exact-row late proof');
assert.deepEqual(repeatSnapshot([lateSecond,secondBundle,aiBundle,nativeBundle]).memberDecisions,repeated.memberDecisions,'A later ineligible capture cannot hide an exact genuine prelock proof');
const forged=structuredClone(secondBundle.candidateProofs[0]);
assert.throws(()=>repeatSnapshot([aiBundle],{nativeRows:[],nativeProofs:[],candidateProofs:[forged]}),/originate in this capture|binding/,'Reconstructed proofs remain refused even with matching row hashes');
assert.throws(()=>{secondBundle.candidateProofs[0].rowHash='forged';},TypeError,'Captured proof remains immutable');
const preservedRepeated=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:9,evaluatedAt:lock,nextBoard:reapplied,previous:alreadyLocked,lockHandoff:{...mergeNflHandoffs([aiBundle,secondBundle]),authorities:[authority]}});
assert.deepEqual(preservedRepeated.memberDecisions,alreadyLocked.memberDecisions,'Existing stored member locks precede repeated-capture selection');
console.log('Repeated NFL AI capture passed: actual parser/binding/captures/reconciler, second overlay at T-60, capture-order invariance, paired Best Angle recovery, unmatched genuine proof refusal, late-only refusal, tamper refusal and exact stored locks.');
assert.ok(fixed.snapshot.memberDecisions.some((r:any)=>r.market==='receiving_yards'&&r.aiReview?.lawHash===b.players[0].law.hash));
assert.ok(fixed.snapshot.memberDecisions.filter((r:any)=>r.market==='receptions').every((r:any)=>!r.aiReview));
assert.ok(fixed.snapshot.board.decisions.every((r:any)=>!r.aiReview||r.aiReview.lawHash===b.players[0].law.hash));
const sourcePlayer=b.players[0],declinedWire={wireRelease:PROPS_AI_WIRE_RELEASE,players:{[id]:verifiedReaderFixture(finalInput,id,{assessment:'The complete supplied review cannot qualify these numerical scopes.',priorRead:priorReads(finalInput),coverage:Object.fromEntries(Object.entries(sourcePlayer.coverage).map(([area,value]:any)=>{const {facts,...raw}=value;void facts;return[area,raw];})),evidenceIds:['e0'],gaps:['No admissible law for these reviewed scopes.'],law:null,confidence:[0,0],exceptions:['Explicit reviewed scope decline.','Explicit reviewed scope decline.']})}};
const allDeclined={...b,...parseJointReview(finalInput,declinedWire)};
const declinedAuthority=buildAuthorities(finalInput,allDeclined,observed)[0],declinedResult=handoff([declinedAuthority],{nextBoard:native(finalInput),candidateProofs:[]});
assert.ok(declinedResult.snapshot.memberDecisions.length>0);assert.ok(declinedResult.snapshot.memberDecisions.every((r:any)=>!r.aiReview));
const cp=structuredClone(finalInput);cp.players[0].evidence.push({id:'new-injury',kind:'availability',source:'synthetic',availableAt:finalAt,value:{status:'Questionable'}});
for(const e of cp.players[0].evidence)if(e.kind==='independent_model')e.value.context.availability.status='Questionable';
const changedAuthority=buildAuthorities(cp,b,observed)[0];assert.ok(changedAuthority.scopes.every((s:any)=>s.status==='context_changed'));
const currentNative=native(cp).decisions.map((r:any)=>({...r,roleFingerprint:'changed-current-role',forecastContext:{...r.forecastContext,availability:{...r.forecastContext.availability,status:'Questionable'}}}));
const currentNativeProof=captureNflHandoffBundle(currentNative,cp,b,'native',()=>nativeReady).nativeProofs;
const newerNativeBundle=captureNflHandoffBundle(currentNative,cp,b,'native',()=>observed);
const nativeResults=[mergeNflHandoffs([nativeBundle,newerNativeBundle]),mergeNflHandoffs([newerNativeBundle,nativeBundle])].map(captures=>prepareNflLockHandoff({...captures,authorities:[changedAuthority],nextRows:currentNative,previousRows:previous.board.decisions,previousGeneratedAt:previous.generatedAt,now:lock}));
assert.equal(nativeResults[0].nextRows.length,currentNative.length,'Repeated native captures choose an exact row/proof from the current context');
assert.deepEqual(nativeResults[0].nextRows,nativeResults[1].nextRows,'Native fallback selection is independent of capture order');
const changedResult=handoff([changedAuthority],{nextBoard:boardRows(currentNative),nativeRows:currentNative,nativeProofs:currentNativeProof,candidateProofs:[]});assert.ok(changedResult.snapshot.memberDecisions.every((r:any)=>!r.aiReview));
const missingBaseline=handoff([declinedAuthority],{nextBoard:native(finalInput),nativeRows:[],nativeProofs:[],candidateProofs:[]});assert.equal(missingBaseline.snapshot.memberDecisions.length,0,'explicitly unavailable cannot resurrect old AI or invent numeric defaults');
const postlockProofs=nativeRows.map((r:any)=>proveRow(r,'native',authority.currentContextHash,'2026-11-09T22:00:01Z',finalAt));
const late=handoff([declinedAuthority],{nextBoard:native(finalInput),nativeProofs:postlockProofs,candidateProofs:[]});assert.equal(late.snapshot.memberDecisions.length,0,'backdated row observed/evaluated clocks do not make a postlock-constructed baseline eligible');
const lateOverlay=finalBoard.decisions.filter((r:any)=>r.aiReview).map((r:any)=>proveRow(r,'ai',authority.currentContextHash,'2026-11-09T22:00:01Z',finalAt));
const overlayResult=handoff([authority],{candidateProofs:lateOverlay});assert.ok(overlayResult.snapshot.memberDecisions.every((r:any)=>!r.aiReview),'postlock-created overlay is not retrospectively admitted');
const actors=buildAuthorities(extraActor,b,observed);assert.equal(actors[1].scopes[0].status,'unreviewed_actor');assert.equal(resolveScope({authority:actors[1],market:'receptions',candidate:finalBoard.decisions[0],candidateProof:candidateProofs[0],now:lock}).kind,'unavailable');assert.equal(actors[0].currentContextHash,authority.currentContextHash);
const preserved=handoff([declinedAuthority],{previous:alreadyLocked});assert.deepEqual(preserved.snapshot.memberDecisions,alreadyLocked.memberDecisions);assert.deepEqual(preserved.snapshot.board.decisions,alreadyLocked.board.decisions);
const tampered=structuredClone(authority);tampered.scopes[0].status='declined';assert.throws(()=>resolveScope({authority:tampered,market:'receiving_yards',now:lock}),/binding|capture/);
const preCounts={originalActionables:crossed.memberDecisions.filter((r:any)=>['Best Angle','Lean'].includes(r.grade)).length,repairedActionables:fixed.snapshot.memberDecisions.filter((r:any)=>['Best Angle','Lean'].includes(r.grade)).length,freshNativeActionables:nativeRows.filter((r:any)=>['Best Angle','Lean'].includes(r.grade)).length,originalMemberRows:crossed.memberDecisions.length,originalAiLawCount:new Set(crossed.memberDecisions.filter((r:any)=>r.aiReview).map((r:any)=>r.aiReview.lawHash)).size,repairedMemberRows:fixed.snapshot.memberDecisions.length,repairedAiLawCount:new Set(fixed.snapshot.memberDecisions.filter((r:any)=>r.aiReview).map((r:any)=>r.aiReview.lawHash)).size,qualifiedFinalBestAngles:fixed.snapshot.memberDecisions.filter((r:any)=>r.aiReview?.lawHash===b.players[0].law.hash&&r.grade==='Best Angle').length,nativeDeclinedRows:fixed.snapshot.memberDecisions.filter((r:any)=>r.market==='receptions'&&!r.aiReview).length};
console.log(JSON.stringify({productionAuthorityPath:true,noNetwork:true,actualExistingReconcilerUsed:true,fixedQualifiedBAndDeclinedNative:true,allDeclinedZeroChoiceAuthorityHonest:true,currentChangedContextRefusesA:true,newActorIsolated:true,noPostlockCandidateOrBaselineFrozen:true,missingBaselineUnavailableNotFabricated:true,alreadyLockedBoardAndMembersExact:true,bindingTamperRejected:true,boardImpact:preCounts},null,2));

const sameEarlyAuthority=buildAuthorities(nearInput,a,'2026-11-09T21:58:00.500Z')[0],sameNative=native(nearInput).decisions,sameProofs=sameNative.map((r:any)=>proveRow(r,'native',sameEarlyAuthority.currentContextHash,earlyAt,earlyAt));
const noNewer=handoff([sameEarlyAuthority],{nextBoard:boardRows(sameNative),nativeRows:sameNative,nativeProofs:sameProofs,candidateProofs:[]});assert.ok(noNewer.snapshot.memberDecisions.every((r:any)=>r.aiReview?.lawHash===a.players[0].law.hash),'ordinary native refresh must not undo an unchanged valid early authority');
const postlockPacket=structuredClone(cp);postlockPacket.cutoff=finalAt;const postObserved='2026-11-09T22:00:01Z';
const postAuthority=buildAuthorities(postlockPacket,b,postObserved)[0],postNative=native(postlockPacket).decisions,postProofs=postNative.map((r:any)=>proveRow(r,'native',postAuthority.currentContextHash,postObserved,finalAt));
const postContext=handoff([postAuthority],{evaluatedAt:'2026-11-09T22:00:02Z',nextBoard:boardRows(postNative),nativeRows:postNative,nativeProofs:postProofs,candidateProofs:[]});assert.ok(postContext.snapshot.memberDecisions.every((r:any)=>r.aiReview?.lawHash===a.players[0].law.hash),'a postlock context observation cannot retrospectively revoke the prelock public early tuple');
assert.throws(()=>buildAuthorities({...postlockPacket,cutoff:postObserved},b,postObserved),/Review must precede lock/);
// Native confirmation cannot replace the native observedAt policy at lock.
const {nflPlayerPropsRuntimePolicy}=await import('../lib/services/football/nflPlayerPropsRuntime');
const {testNflSourceAuthority}=await import('../lib/playerPropsAi/nflLockAuthority');
const maxAge=nflPlayerPropsRuntimePolicy().maximumQuoteAgeHours*3600000;
for(const [delta,expected]of [[-1,0],[1,6]]as const){
 const aged=structuredClone(finalInput),at=new Date(Date.parse(lock)-maxAge+delta).toISOString();
 for(const q of aged.quotes)q.observedAt=at;
 const rows=native(aged).decisions,source=testNflSourceAuthority(()=>observed)(aged,null,false),capture=captureNflHandoffBundle(rows,aged,null,'native',()=>nativeReady);
 const result=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:9,evaluatedAt:lock,previous,nextBoard:boardRows(rows),lockHandoff:mergeNflHandoffs([source,capture])});
 assert.equal(result.memberDecisions.length,expected,'Native observed clock must be fresh at lock, with paired fresh recovery');
 assert(Object.keys(result.lockHandoffEvidence??{}).length>0,'Unavailable-only source decisions remain auditable internally');
}
const mismatchedNative=nativeRows.map(row=>structuredClone(row));mismatchedNative[0].forecastContext.availability.status='Out';
assert.equal(captureNflHandoffBundle(mismatchedNative,finalInput,b,'native',()=>nativeReady).nativeProofs.length,nativeProofs.length-1,'A quote match cannot retag a native model context');
assert(Object.isFrozen(nativeBundle.nativeRows[0]));assert.throws(()=>{nativeBundle.nativeRows[0].projection=999;},TypeError);
const noPrevious=handoff([postAuthority],{previous:null,evaluatedAt:'2026-11-09T22:00:02Z',nextBoard:boardRows(postNative),nativeRows:postNative,nativeProofs:postProofs,candidateProofs:[]});assert.equal(noPrevious.snapshot.memberDecisions.length,0,'postlock native calculation without prior public evidence is unavailable');
console.log(JSON.stringify({normalEarlyAuthorityRetained:true,postlockContextDoesNotRetroinvalidate:true,postlockNativeWithoutPrelockEvidenceUnavailable:true},null,2));

}
void main().catch(error=>{console.error(error);process.exitCode=1});
