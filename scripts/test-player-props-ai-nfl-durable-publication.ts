import {PROPS_AI_WIRE_RELEASE} from "../lib/playerPropsAi/scenarioCoordinates";
import {verifiedReaderFixture} from "./lib/player-props-ai-reader-fixture";
/* eslint-disable @typescript-eslint/no-explicit-any -- Synthetic Supabase/HTTP and malformed JSON boundary fixtures are validated by the actual runtime. */
/** All data synthetic. Actual site runtime/parser/binding/reconciler; no HTTP, DB, or paid calls. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as identityEvidence from '../lib/playerPropsAi/nflIdentityFailureEvidence';
import {syntheticNflIdentityFailureArgs} from './test-player-props-ai-nfl-identity-failure-evidence';
import * as actualRuntime from '../lib/services/football/nflPlayerPropsRuntime';
import * as actualContract from '../lib/services/football/nflPlayerPropsProductionContract';
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


const {testNflSourceAuthority,testNflHandoffCapture,mergeNflHandoffs}=await import('../lib/playerPropsAi/nflLockAuthority');
Object.assign(process.env,{NODE_ENV:'test',PLAYER_PROPS_AI_SITE_ENABLED:'true',PLAYER_PROPS_AI_PAID_RUNS_ENABLED:'false',PLAYER_PROPS_AI_OPENAI_API_KEY:'synthetic-never-real',OPENAI_API_KEY:'synthetic-never-real'});
const initialAt='2026-11-09T21:59:58.200Z',afterLock='2026-11-09T22:00:00.100Z';
const earlyPacket=packet(earlyIssued),early=review(earlyPacket),currentPacket=packet(finalAt,true),final=review(currentPacket,true),base=native(currentPacket);
const earlyCurrent=packet(earlyAt),earlyBoard=applyNflSiteAi(native(earlyCurrent),earlyCurrent,siteAiDecisions(earlyCurrent,early,earlyAt),earlyAt);
const previous:NflPlayerPropsProductionSnapshot=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:9,evaluatedAt:earlyAt,nextBoard:earlyBoard});
const publicLocked:NflPlayerPropsProductionSnapshot=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:9,evaluatedAt:lock,nextBoard:native(earlyCurrent),previous});
function allDeclined(){const p=final.players[0],wire={wireRelease:PROPS_AI_WIRE_RELEASE,players:{[id]:verifiedReaderFixture(currentPacket,id,{assessment:'The supplied sources do not qualify a numerical forecast.',priorRead:priorReads(currentPacket),coverage:Object.fromEntries(Object.entries(p.coverage).map(([area,value]:any)=>{const{facts,...raw}=value;void facts;return[area,raw];})),evidenceIds:['e0'],gaps:['Both scopes explicitly remain unqualified.'],law:null,confidence:[0,0],exceptions:['Reviewed scope is unqualified.','Reviewed scope is unqualified.']})}};return{...final,...parseJointReview(currentPacket,wire)};}

 type Mode='ready_then_delay'|'fault_after_ready'|'source_write_failure'|'decline'|'withdrawal'|'duplicate'|'late_before_send'|'ack_after_lock'|'legacy'|'restart'|'changed_no_native'|'later_game'|'partial_write_failure'|'midnight'|'same_early'|'unknown_lookup'|'unknown_ack';
 async function run(mode:Mode){
  let tick=initialAt,writes=0,stateWrites=0,readies=0;
  const lookupReceipts:boolean[]=[];
  const trace:string[]=[],snapshots:NflPlayerPropsProductionSnapshot[]=[];
  const initial=mode==='legacy'?publicLocked:previous;
  let persisted=structuredClone(initial);
  const immutableLocks=JSON.stringify(publicLocked.memberDecisions);
  const clock=()=>tick;
  class Clock extends Date{constructor(value?:string|number){super(value??tick);}static now(){return Date.parse(tick);}}
  const fixture=syntheticNflIdentityFailureArgs(initialAt);
  const source={...fixture.observations,providerRequests:{},observations:[],games:[]};
  const secondStart=new Date(Date.parse(start)+(mode==='midnight'?140:20)*60000).toISOString(),secondLock=new Date(Date.parse(lock)+(mode==='midnight'?140:20)*60000).toISOString();
  const contexts={...fixture.context,requestBudget:{totalMaximum:0},games:[{canonicalGameId:'game',scheduledStart:start,awayTeam:'BUF',homeTeam:'MIN'},...(['later_game','partial_write_failure','midnight','unknown_ack'].includes(mode)?[{canonicalGameId:'second',scheduledStart:secondStart,awayTeam:'BUF',homeTeam:'MIN'}]:[])]};
  const sourceAuthority=testNflSourceAuthority(clock),capture=testNflHandoffCapture(clock);
  const cycleNative=mode==='changed_no_native'?{...base,decisions:[],counts:{...base.counts,'Best Angle':0,Lean:0,Watchlist:0,'No Play':0,Held:0,actionable:0}}:['later_game','partial_write_failure','midnight','unknown_ack'].includes(mode)?boardRows([...base.decisions,...base.decisions.map(row=>({...row,gameId:'second',scheduledStart:secondStart,lockAt:secondLock}))]):base;
  const modules:Record<string,Record<string,unknown>>={
   evidence:{digest},publication:{siteAiDecisions},nflIdentityFailureEvidence:identityEvidence,
   nflLockAuthority:{observeNflSourceAuthority:(p:any,r:any,lookup:boolean)=>{lookupReceipts.push(lookup);return sourceAuthority(p,r,lookup);},captureNflHandoffBundle:capture,mergeNflHandoffs},
   siteConfig:{propsAiSiteConfig:()=>({integrated:true})},
   siteRuntime:{reviewPropsForSite:async(args:any)=>{
    const p=mode==='same_early'?earlyCurrent:mode==='withdrawal'?{...currentPacket,executionQuotes:[],quotes:[]}:mode==='changed_no_native'?{...earlyCurrent,players:earlyCurrent.players.map((p:any)=>({...p,evidence:[...p.evidence,{id:'synthetic-new-matchup',kind:'matchup',source:'synthetic fresh context',availableAt:earlyCurrent.cutoff,value:{opponentDefense:'new verified scheme'}}]}))}:currentPacket;
    const r=mode==='same_early'?early:mode==='decline'?allDeclined():final;
    if(mode==='unknown_lookup'){await args.onSourceReady(p,early,tick,false);await args.onReviewObserved(p,early,false);return{status:'active',games:[{game:{id:'game',start},packet:p,decisions:[],authorityReview:early,observedAt:tick}],findings:['accepted_review_read_failed_use_trusted_local']};}
    if(mode==='source_write_failure'){
     await assert.rejects(()=>args.onSourceReady(p,early,tick,true),/synthetic snapshot failure/);
     assert.equal(writes,1);assert.equal(readies,0,'Its failed source write cannot authorize paid work');
     return{status:'active',games:[],findings:['lock_source_unavailable:game:synthetic']};
    }
    if(mode==='late_before_send'){
     await assert.rejects(()=>args.onSourceReady(p,early,tick,true),/publication window closed/);
     assert.equal(writes,0,'Clock crossing during prerequisite state write refuses the snapshot send');
     return{status:'active',games:[],findings:['lock_source_unavailable:game:synthetic']};
    }
    await args.onSourceReady(p,early,tick,true);
    if(mode==='same_early'){assert(persisted.memberDecisions.some(row=>row.aiReview?.lawHash===early.players[0].law!.hash),'Same-context ordinary source refresh retains the exact accepted early law');return{status:'active',games:[],findings:[]};}
    if(mode==='changed_no_native'){assert.equal(persisted.memberDecisions.length,0,'A changed-context source without a qualified current numeric row cannot keep stale early AI before lock');return{status:'active',games:[],findings:[]};}
    if(mode==='withdrawal'){assert.equal(persisted.memberDecisions.length,0,'Actual empty execution withdraws prior AI before lock');}
    if(mode==='ack_after_lock'){
     assert(Date.parse(tick)>Date.parse(lock));assert.equal(snapshots.length,1);
     return{status:'active',games:[],findings:[]};
    }
    tick='2026-11-09T21:59:58.700Z';
    if(mode==='unknown_ack'){
     await assert.rejects(()=>args.onReviewReady(p,r),/indeterminate snapshot acknowledgement/);
     assert(persisted.memberDecisions.some(row=>row.aiReview?.lawHash===final.players[0].law!.hash),'Server committed the final before losing its acknowledgement');
     const committed=JSON.stringify(persisted),second={...currentPacket,gameId:'second',sourceGameId:'second',start:secondStart,lock:secondLock,cutoff:tick};
     await assert.rejects(()=>args.onSourceReady(second,null,tick,true),/indeterminate snapshot acknowledgement/);
     assert.equal(writes,2,'No later callback can write from stale ACKed state after an unknown store outcome');
     assert.equal(JSON.stringify(persisted),committed,'The server-committed final cannot be replaced by the older ACKed early');
     return{status:'active',games:[],findings:['lock_source_unavailable:second:synthetic']};
    }
    await args.onReviewReady(p,r);readies++;
    assert(writes>=1,'A completed callback awaits its canonical member write');
    if(mode!=='legacy'&&mode!=='withdrawal'){
     if(mode==='decline')assert(persisted.memberDecisions.every(row=>!row.aiReview),'An all-declined final durably replaces the earlier AI with qualified native');
     else assert(persisted.memberDecisions.some(row=>row.aiReview?.lawHash===final.players[0].law!.hash),'Ready final numerical law reaches the canonical snapshot before callback return');
    }
    assert(Date.parse(tick)<Date.parse(lock),'The positive callback ACK is actually observed before lock');
    trace.push('ready_ack_before_lock');
    if(mode==='duplicate'){const before=writes;await Promise.all([args.onReviewReady(p,r),args.onReviewReady(p,r)]);assert.equal(writes,before,'Duplicate same-input callbacks serialize and skip only after ACK');}
    if(mode==='later_game'||mode==='partial_write_failure'||mode==='midnight'){
     const originalA=persisted.memberDecisions.filter(row=>row.gameId==='game').map(row=>({...row,state:'locked'}));
     tick=mode==='midnight'?'2026-11-10T00:00:01Z':afterLock;
     const second={...currentPacket,gameId:'second',sourceGameId:'second',start:secondStart,lock:secondLock,cutoff:tick};
     const secondReview={...final,gameId:'second',sourceGameId:'second',start:secondStart,lock:secondLock,cutoff:tick,issuedAt:tick,inputHash:digest(second),inputEvidence:{digest:digest(second)},criticalContextHashes:criticalContextHashes(second)};
     if(mode==='partial_write_failure')await assert.rejects(()=>args.onSourceReady(second,null,tick,true),/synthetic later write failure/);
     else{await args.onSourceReady(second,null,tick,true);await args.onReviewReady(second,secondReview);assert.deepEqual(persisted.memberDecisions.filter(row=>row.gameId==='game'),originalA,'Later game header first freezes prior ACKed game with exact stored payloads');}
    }
    if(mode==='fault_after_ready')throw Error('synthetic process fault after ready');
    tick=afterLock;
    return{status:'active',games:[],findings:[]};
   }},
   liveSources:{liveNflPacket:()=>currentPacket},siteBindings:{applyNflSiteAi,restoreNflNativeGame:(await import('../lib/playerPropsAi/siteBindings')).restoreNflNativeGame},
   nflPlayerPropsCollector:{NFL_PLAYER_PROPS_COLLECTION_LIMITS:{maxGames:18,maxPlayerIdentities:320,playerIdentityBatchSize:40},collectNflPlayerPropsObservations:async()=>({snapshot:source,referenceResearchObservations:[],emptyCurrentGames:[]})},
   nflPlayerPropsInferenceContext:{buildNflPlayerPropsInferenceContextFromForwardEvidence:()=>contexts},nflForwardEvidenceStore:{readNflForwardEvidence:async()=>({})},
   nflPlayerPropsMarketBoard:{buildNflPlayerPropsExactBoard:()=>[]},
   nflPlayerPropsRuntime:{...actualRuntime,buildNflPlayerPropsRuntimeBoard:()=>structuredClone(cycleNative),buildNflPlayerPropsRuntimeFeatureRows:()=>[],buildNflPlayerPropsRuntimeMarketEvidence:()=>({capture:{i:[]}}),verifyNflPlayerPropsRuntimeParity:()=>{}},
   nflPlayerPropsProductionContract:actualContract,
   nflPlayerPropsSnapshotStore:{readNflPlayerPropsSnapshot:async()=>structuredClone(persisted),writeNflPlayerPropsSnapshot:async({snapshot}:any)=>{
    writes++;assert.equal(snapshot.board.publicationEnabled,true,'Draft runtime flags never alter the stored publication contract');assert.equal(snapshot.board.trackingEnabled,true);assert(stateWrites>0,'Current-season state precedes the first canonical snapshot');
    if(mode==='partial_write_failure'&&writes===3)throw Error('synthetic later write failure');
    if(mode==='source_write_failure'&&writes===1)throw Error('synthetic snapshot failure');
    if(mode==='ack_after_lock')tick=afterLock;
    persisted=structuredClone(snapshot);snapshots.push(persisted);if(mode==='unknown_ack'&&writes===2)throw Error('indeterminate snapshot acknowledgement');trace.push('snapshot_ack');
   }},
   nflPlayerPropsTrackingStore:{updateNflPlayerPropsClosingPrices:async()=>0,updateNflPlayerPropsClosingPricesFromObserver:async()=>0,writeLockedNflPlayerPropsTracking:async()=>{}},
   nflPlayerPropsCurrentSeasonState:{NFL_PLAYER_PROPS_CURRENT_SEASON_GAMES_PAGE_MAXIMUM:1,NFL_PLAYER_PROPS_CURRENT_SEASON_STATS_PAGE_MAXIMUM:1,NFL_PLAYER_PROPS_CURRENT_SEASON_TEAM_STATS_PAGE_MAXIMUM:1,readNflPlayerPropsCurrentSeasonState:async()=>null,refreshNflPlayerPropsCurrentSeasonState:async()=>({state:{},apiCalls:0,gamesAdded:0,teamStatsAdded:0,statsAdded:0}),writeNflPlayerPropsCurrentSeasonState:async()=>{stateWrites++;if(mode==='late_before_send')tick=afterLock;}},
   nflPlayerPropsSettlement:{NFL_PLAYER_PROPS_SETTLEMENT_MAX_GAMES_PER_CYCLE:1,NFL_PLAYER_PROPS_SETTLEMENT_MAX_SNAP_PAGES:1,NFL_PLAYER_PROPS_SETTLEMENT_MAX_DESIGNATION_PAGES:1,NFL_PLAYER_PROPS_SETTLEMENT_RELEASE:'synthetic',settleNflPlayerPropsRecords:async()=>({pending:0,eligible:0,eligibleGames:0,processedGames:0,deferredGames:0,recordReadLimitReached:false,settled:0,apiCalls:0}),countNflPlayerPropsUnresolvedSettlementIdentities:async()=>0},
   nflPlayerPropsPrediction:{nflPlayerPropsOverUnderMarketKey:()=>'',nflPlayerPropsTouchdownPlayerKey:()=>'',selectNflPlayerPropsOverForecasts:()=>new Set(),selectNflPlayerPropsTouchdownScorers:()=>new Set()},
   nflPlayerPropsMarketObserverStore:{captureNflPlayerPropsMarketObserver:async()=>({}),captureNflPlayerPropsMarketObserverSafely:async(run:any)=>run(),readNflPlayerPropsMarketObserverHistory:async()=>({rows:[]})},
   nflPlayerPropsPrivateTrackingStore:{captureNflPlayerPropsPrivateTracking:async()=>({}),captureNflPlayerPropsPrivateTrackingSafely:async(run:any)=>run()},
   nflPlayerPropsReferenceOfferStore:{readNflPlayerPropsReferenceOffers:async()=>({offers:[]}),writeNflPlayerPropsReferenceOffers:async()=>{}},
  };
  const moduleFixture={exports:{}};
  const javascript=ts.transpileModule(readFileSync('lib/services/football/nflPlayerPropsProductionWriter.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const requireMock=(request:string)=>{const name=request.split('/').at(-1)!;assert(Object.hasOwn(modules,name),`Unmocked writer dependency ${request}`);return new Proxy(modules[name],{get:(target,key)=>{if(key==='__esModule')return false;assert(Object.hasOwn(target,key),`Unmocked writer dependency member ${name}.${String(key)}`);return target[key as string];}});};
  vm.runInNewContext(javascript,{module:moduleFixture,exports:moduleFixture.exports,require:requireMock,Date:Clock,console,fetch:globalThis.fetch},{filename:'actual-nfl-durable-writer-under-offline-test.cjs'});
  const writer=(moduleFixture.exports as any).runNflPlayerPropsProductionWriter;
  const invoke=()=>writer({client:{} as never,writerRunId:'synthetic-owner',season:2026,week:9,now:initialAt,apply:true,ballDontLieApiKey:'synthetic-never-real',fetchImpl:globalThis.fetch});
  if(['fault_after_ready','source_write_failure','late_before_send','partial_write_failure','unknown_ack'].includes(mode))await assert.rejects(invoke,/synthetic|publication window closed|indeterminate snapshot acknowledgement/);else await invoke();
  if(mode==='fault_after_ready'||mode==='partial_write_failure'){assert(persisted.memberDecisions.some(row=>row.aiReview?.lawHash===final.players[0].law!.hash));assert.equal(readies,1);}
  if(mode==='source_write_failure'||mode==='late_before_send')assert.deepEqual(persisted,initial,'A refused write never advances or replaces the canonical pointer');
  if(mode==='legacy')assert.equal(JSON.stringify(persisted.memberDecisions),immutableLocks,'All original member locks preserve exact writer/reader precedence');
  if(mode==='unknown_lookup'){assert(lookupReceipts.length>0&&lookupReceipts.every(v=>v===false),'A returned game cannot upgrade unknown review lookup into true authority');assert(persisted.memberDecisions.filter(row=>row.aiReview).every(row=>row.aiReview!.lawHash===early.players[0].law!.hash),'Unknown lookup never invents a final review');}
  if(mode==='restart'){
   // A next ordinary writer starts from the acknowledged canonical snapshot;
   // no inference replay or reconstructed prior is used to freeze the final.
   const after:NflPlayerPropsProductionSnapshot=reconcileNflPlayerPropsProductionSnapshot({season:2026,week:9,evaluatedAt:afterLock,nextBoard:base,previous:persisted});
   assert(after.memberDecisions.filter(row=>row.aiReview).every(row=>row.aiReview!.lawHash===final.players[0].law!.hash));
  }
  return{mode,writes,stateWrites,readies,locks: persisted.memberDecisions.filter(r=>r.state==='locked').length};
 }
 const results=[];for(const mode of ['ready_then_delay','fault_after_ready','source_write_failure','decline','withdrawal','duplicate','late_before_send','ack_after_lock','legacy','restart','changed_no_native','later_game','partial_write_failure','midnight','same_early','unknown_lookup','unknown_ack'] as const)results.push(await run(mode));
 console.log('NFL durable actual-writer handoff passed: awaited prelock source/review publication, later delay/fault, failed source ACK hold, decline/empty withdrawal, duplicate serialization, pre-send cutoff, honest delayed ACK, exact legacy locks and restart first-lock precedence. Plain store under the existing sole lease, not server-clock/CAS proof. All I/O mocked.',JSON.stringify(results));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
