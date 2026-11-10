/** Execute the actual writer with imported I/O boundaries mocked. No HTTP/DB. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as evidence from '../lib/playerPropsAi/nflIdentityFailureEvidence';
import {syntheticNflIdentityFailureArgs} from './test-player-props-ai-nfl-identity-failure-evidence';
import type {runNflPlayerPropsProductionWriter} from '../lib/services/football/nflPlayerPropsProductionWriter';
import type {reviewPropsForSite} from '../lib/playerPropsAi/siteRuntime';
import {digest} from '../lib/playerPropsAi/evidence';

globalThis.fetch=async()=>{throw Error('Actual-writer integration proof forbids HTTP');};
type Mode='identity'|'unrelated'|'construction'|'append_refused'|'deadline'|'no_owner'|'disabled'|'success';
type ReviewArgs=Parameters<typeof reviewPropsForSite>[0];
async function run(mode:Mode){
 const fixture=syntheticNflIdentityFailureArgs(),fixed=Date.parse(fixture.observedAt),trace:string[]=[],errors:unknown[]=[],purposes:string[]=[];
 let elapsed=0,builds=0,rpcs=0,reviews=0;
 const sourceError=new Error(mode==='unrelated'?'synthetic unrelated statistics failure':'NFL offered-player identity coverage incomplete:3');
 const protectedBefore=digest(fixture);
 class Clock extends Date{constructor(value?:string|number){super(value??fixed+elapsed);}static now(){return fixed+elapsed;}}
 const board={release:'synthetic',generatedAt:fixture.snapshot.generatedAt,evaluatedAt:fixture.snapshot.generatedAt,decisions:[],counts:{'Best Angle':0,Lean:0,Watchlist:0,'No Play':0,Held:0,actionable:0},diagnostics:{},marketEvidence:{i:[]}};
 const snapshot={...fixture.snapshot,board,memberDecisions:[]};
 const emptyCurrentGame={gameId:fixture.game.id,release:'synthetic-explicit-empty-receipt'};
 const previousSnapshot={...snapshot,source:'synthetic-original-previous'};
 const appendClient={rpc:(name:string,body:{p_writer_run:string;p_capture:evidence.NflIdentityFailureRecord})=>{
  assert.equal(name,'player_props_ai_append_source_failure_v1');assert.equal(body.p_writer_run,fixture.writerRunId);assert.equal(body.p_capture.writerRunId,fixture.writerRunId);rpcs++;trace.push('private_identity_append');
  assert.equal(body.p_capture.observedAtMeaning,'requested_source_cutoff');
  const decoded=evidence.decodeNflIdentityFailureArchive(body.p_capture) as {nativeHeader:{generatedAt:string};observationsHeader:{generatedAt:string}};
  assert.equal(decoded.nativeHeader.generatedAt,snapshot.generatedAt,'Original source availability is never rewritten to the cutoff');assert.equal(decoded.observationsHeader.generatedAt,fixture.observations.generatedAt);
  return{abortSignal:async(signal:AbortSignal)=>{assert(signal instanceof AbortSignal);return{data:{status:mode==='append_refused'?'unavailable':'stored'},error:null};}};
 }};
 const modules:Record<string,Record<string,unknown>>={
  nflIdentityFailureEvidence:{...evidence,buildNflIdentityFailureEvidence:(args:Parameters<typeof evidence.buildNflIdentityFailureEvidence>[0])=>{builds++;if(mode==='construction')throw Error('synthetic archive construction failure');return evidence.buildNflIdentityFailureEvidence(args);}},
  publication:{siteAiDecisions:()=>[]},
  nflLockAuthority:{captureNflHandoffBundle:()=>({}),observeNflSourceAuthority:()=>({}),mergeNflHandoffs:()=>({frames:[]})},
  siteConfig:{propsAiSiteConfig:()=>({integrated:true})},
  siteRuntime:{reviewPropsForSite:async(args:ReviewArgs)=>{
   reviews++;
   for(const purpose of ['lock_authority','scheduled_review','scheduled_review','member_publication'] as const){
    purposes.push(purpose);const context=purpose==='scheduled_review'?{purpose,job:fixture.job}:{purpose};
    try{await args.load(fixture.game,fixture.window,context as Parameters<ReviewArgs['load']>[2]);assert.equal(mode,'success');}
    catch(error){errors.push(error);assert.equal(error,sourceError,'Diagnostic construction/storage must not replace the original source failure');}
   }
   return{status:'active',games:[],findings:[]};
  }},
  liveSources:{liveNflPacket:(args:{emptyCurrentGame:unknown;withdrawalSnapshot:unknown})=>{assert.strictEqual(args.emptyCurrentGame,emptyCurrentGame,'Sole writer forwards the exact current collection receipt');assert.strictEqual(args.withdrawalSnapshot,previousSnapshot,'Original previous snapshot owns withdrawal-only aliases even when fresh native construction has no actors');if(mode==='success')return{};throw sourceError;}},
  siteBindings:{applyNflSiteAi:()=>board,restoreNflNativeGame:()=>board},
  nflPlayerPropsCollector:{NFL_PLAYER_PROPS_COLLECTION_LIMITS:{maxGames:18,maxPlayerIdentities:320,playerIdentityBatchSize:40},collectNflPlayerPropsObservations:async()=>({snapshot:fixture.observations,referenceResearchObservations:[],emptyCurrentGames:[emptyCurrentGame]})},
  nflPlayerPropsInferenceContext:{buildNflPlayerPropsInferenceContextFromForwardEvidence:()=>({...fixture.context,requestBudget:{totalMaximum:0}})},
  nflForwardEvidenceStore:{readNflForwardEvidence:async()=>({})},
  nflPlayerPropsMarketBoard:{buildNflPlayerPropsExactBoard:()=>[]},
  nflPlayerPropsRuntime:{buildNflPlayerPropsRuntimeBoard:()=>structuredClone(board),buildNflPlayerPropsRuntimeFeatureRows:()=>[],buildNflPlayerPropsRuntimeMarketEvidence:()=>({capture:{i:[]}}),
   NFL_PLAYER_PROPS_BOARD_RELEASE:'synthetic',NFL_PLAYER_PROPS_CALIBRATION_RELEASE:'synthetic',NFL_PLAYER_PROPS_DECISION_RELEASE:'synthetic',NFL_PLAYER_PROPS_MODEL_RELEASE:'synthetic',NFL_PLAYER_PROPS_SOURCE_AWARE_QUALIFIED_MARKETS:[],
   nflPlayerPropsRuntimePolicy:()=>({maximumQuoteAgeHours:1}),verifyNflPlayerPropsRuntimeParity:()=>{}},
  nflPlayerPropsProductionContract:{buildNflPlayerPropsTrackingRows:()=>[],NFL_PLAYER_PROPS_PRODUCTION_CANDIDATE_RELEASE:'synthetic',reconcileNflPlayerPropsProductionSnapshot:()=>structuredClone(snapshot)},
  nflPlayerPropsSnapshotStore:{readNflPlayerPropsSnapshot:async()=>previousSnapshot,writeNflPlayerPropsSnapshot:async()=>{trace.push('member_snapshot');}},
  nflPlayerPropsTrackingStore:{updateNflPlayerPropsClosingPrices:async()=>0,updateNflPlayerPropsClosingPricesFromObserver:async()=>0,writeLockedNflPlayerPropsTracking:async()=>{trace.push('official_tracking');}},
  nflPlayerPropsCurrentSeasonState:{NFL_PLAYER_PROPS_CURRENT_SEASON_GAMES_PAGE_MAXIMUM:1,NFL_PLAYER_PROPS_CURRENT_SEASON_STATS_PAGE_MAXIMUM:1,NFL_PLAYER_PROPS_CURRENT_SEASON_TEAM_STATS_PAGE_MAXIMUM:1,
   readNflPlayerPropsCurrentSeasonState:async()=>null,refreshNflPlayerPropsCurrentSeasonState:async()=>({state:{},apiCalls:0,gamesAdded:0,teamStatsAdded:0,statsAdded:0}),writeNflPlayerPropsCurrentSeasonState:async()=>{trace.push('current_season');}},
  nflPlayerPropsSettlement:{NFL_PLAYER_PROPS_SETTLEMENT_MAX_GAMES_PER_CYCLE:1,NFL_PLAYER_PROPS_SETTLEMENT_MAX_SNAP_PAGES:1,NFL_PLAYER_PROPS_SETTLEMENT_MAX_DESIGNATION_PAGES:1,NFL_PLAYER_PROPS_SETTLEMENT_RELEASE:'synthetic',
   settleNflPlayerPropsRecords:async()=>{trace.push('settlement');return{pending:0,eligible:0,eligibleGames:0,processedGames:0,deferredGames:0,recordReadLimitReached:false,settled:0,apiCalls:0};},countNflPlayerPropsUnresolvedSettlementIdentities:async()=>0},
  nflPlayerPropsPrediction:{nflPlayerPropsOverUnderMarketKey:()=>'',nflPlayerPropsTouchdownPlayerKey:()=>'',selectNflPlayerPropsOverForecasts:()=>new Set(),selectNflPlayerPropsTouchdownScorers:()=>new Set()},
  nflPlayerPropsMarketObserverStore:{captureNflPlayerPropsMarketObserver:async()=>{trace.push('market_observer');return{};},captureNflPlayerPropsMarketObserverSafely:async(run:()=>Promise<unknown>)=>run(),readNflPlayerPropsMarketObserverHistory:async()=>({rows:[]})},
  nflPlayerPropsPrivateTrackingStore:{captureNflPlayerPropsPrivateTracking:async()=>{trace.push('private_tracking');if(mode==='deadline')elapsed=440000;return{};},captureNflPlayerPropsPrivateTrackingSafely:async(run:()=>Promise<unknown>)=>run()},
  nflPlayerPropsReferenceOfferStore:{readNflPlayerPropsReferenceOffers:async()=>({offers:[]}),writeNflPlayerPropsReferenceOffers:async()=>{}},
 };
 const moduleFixture={exports:{}};
 const javascript=ts.transpileModule(readFileSync('lib/services/football/nflPlayerPropsProductionWriter.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const requireMock=(request:string)=>{const name=request.split('/').at(-1)!;assert(Object.hasOwn(modules,name),`Unmocked writer dependency ${request}`);return new Proxy(modules[name],{get:(target,key)=>{if(key==='__esModule')return false;assert(Object.hasOwn(target,key),`Unmocked writer dependency member ${name}.${String(key)}`);return target[key as string];}});};
 vm.runInNewContext(javascript,{module:moduleFixture,exports:moduleFixture.exports,require:requireMock,Date:Clock,console,fetch:globalThis.fetch},{filename:'actual-nfl-production-writer-under-offline-test.cjs'});
 const writer=(moduleFixture.exports as {runNflPlayerPropsProductionWriter:typeof runNflPlayerPropsProductionWriter}).runNflPlayerPropsProductionWriter;
 const result=await writer({client:appendClient as unknown as Parameters<typeof writer>[0]['client'],writerRunId:mode==='no_owner'?undefined:fixture.writerRunId,season:2026,week:10,now:fixture.observedAt,apply:mode!=='disabled',ballDontLieApiKey:'synthetic-never-real',fetchImpl:globalThis.fetch});
 assert.equal(digest(fixture),protectedBefore,'Actual writer never mutates captured source fixtures');
 if(mode==='disabled'){assert.equal(reviews,0);assert.equal(builds,0);assert.equal(rpcs,0);assert.equal(result.published,false);}
 else{
  assert.equal(reviews,1);assert.deepEqual(purposes,['lock_authority','scheduled_review','scheduled_review','member_publication']);assert.equal(result.published,true);
  if(mode==='success'){assert.equal(errors.length,0);assert.equal(builds,0);assert.equal(rpcs,0);}
  else{assert.equal(errors.length,4);if(mode==='unrelated'||mode==='no_owner'){assert.equal(builds,0);assert.equal(rpcs,0);}
   else if(mode==='construction'){assert.equal(builds,1,'Even diagnostic construction failure may only be attempted once per due job');assert.equal(rpcs,0);assert.equal(result.identityFailureEvidence?.constructionFailures,1);}
   else{assert.equal(builds,1,'Only actual scheduled source failure is captured; repeated same-job load is deduplicated');assert.equal(result.identityFailureEvidence?.captures,1);
    if(mode==='deadline'){assert.equal(rpcs,0);assert.deepEqual(JSON.parse(JSON.stringify(result.identityFailureEvidence?.statuses)),{unavailable:1});}
    else{assert.equal(rpcs,1);assert.deepEqual(JSON.parse(JSON.stringify(result.identityFailureEvidence?.statuses)),{[mode==='append_refused'?'unavailable':'stored']:1});
     for(const essential of ['member_snapshot','official_tracking','market_observer','settlement','private_tracking'])assert(trace.indexOf(essential)<trace.indexOf('private_identity_append'),`Actual writer flush must follow ${essential}`);
    }
   }
  }
 }
 return{mode,builds,rpcs};
}
async function main(){const results=[];for(const mode of ['identity','unrelated','construction','append_refused','deadline','no_owner','disabled','success'] as const)results.push(await run(mode));console.log('Actual NFL writer source-failure integration passed: real wrapper/purpose gating, original error identity, once-only construction, post-publication bounded flush, owner binding, unavailable/deadline isolation and healthy/no-owner/no-apply controls. All dependencies mocked; no HTTP, production DB or paid calls.',JSON.stringify(results));}
main().catch(error=>{console.error(error);process.exitCode=1;});
