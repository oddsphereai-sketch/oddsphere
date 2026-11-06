/** Synthetic frozen-law integration only: no fitted model, artifact download,
 * provider request, real database or prediction writer is invoked. */
import assert from "node:assert/strict";
import {normalCdf} from "../lib/cbb/model";
import {buildCbbInterpretedDecision} from "../lib/cbb/contextualInterpretedDecision";
import {buildCbbContextualMarketInterpretation} from "../lib/cbb/contextualMarketInterpretation";
import {CBB_OUTCOME_DECISION_RELEASE,cbbOutcomeIndependentInputSha256} from "../lib/cbb/contextualOutcomeDecision";
import {buildCbbContextualOutcomeBoard,CBB_CONTEXTUAL_OUTCOME_PREVIOUS_DECISION_RELEASE,CBB_CONTEXTUAL_OUTCOME_PREVIOUS_GRADE_RELEASE,CBB_CONTEXTUAL_OUTCOME_LEGACY_DECISION_RELEASE,CBB_CONTEXTUAL_OUTCOME_LEGACY_GRADE_RELEASE,CBB_CONTEXTUAL_OUTCOME_LEGACY_RISK_DECISION_RELEASE,CBB_CONTEXTUAL_OUTCOME_LEGACY_RISK_GRADE_RELEASE,type CbbOutcomeDecision} from "../lib/cbb/contextualOutcomeBoard";
import {CBB_CONTEXTUAL_OUTCOME_MODEL_RELEASE,CBB_CONTEXTUAL_OUTCOME_CALIBRATION_RELEASE,CBB_CONTEXTUAL_OUTCOME_LEGACY_MODEL_RELEASE,CBB_CONTEXTUAL_OUTCOME_MANIFEST,loadCbbContextualOutcomeRuntime,resolveCbbContextualOutcomeRelease,readCbbContextualOutcomeEvidence,type CbbReleasedOutcomeBoard} from "../lib/services/cbb/cbbContextualOutcomeRuntime";
import {encodeCbbContextualEvidence,decodeCbbContextualEvidence} from "../lib/services/cbb/cbbContextualEvidenceCodec";
import {adaptCbbProvisionalGame} from "../lib/services/cbb/adaptCbbProvisionalToDailyEdge";
import {writeCbbMemberGame,cbbMemberGameForReader,type CbbStoredMemberGame} from "../lib/services/cbb/cbbMemberGameStore";
import {writeLockedCbbTracking,assertCbbContextualLockedRecord,cbbLockedModelRelease,cbbLockedGradeRelease,CBB_TRACKING_WRITER_RELEASE} from "../lib/services/cbb/cbbTrackingWriter";
import {readCbbProvisionalSnapshot} from "../lib/cbb/provisionalLifecycle";
import {buildCbbProvisionalBoard} from "../lib/cbb/provisionalBoard";
import {buildCbbGameForecastBoard} from "../lib/cbb/gameForecastBoard";
import {dailyEdgePresentationVerdict} from "../app/lab/lib/dailyEdgeMarketPresentation";
import {deriveVerdict} from "../lib/services/verdictDerivation";
import {selectTopAvailableAngles} from "../app/lab/components/daily-edge/selectTopAvailableAngles";
import {CBB_FULL_D1_SCORE_RELEASE} from "../lib/cbb/fullDivisionOneReleases";
import type {CbbContextualFeatureInput,CbbContextualQuote} from "../lib/cbb/contextualForecastFeatures";
import type {CbbForecast,CbbGame,CbbMarket} from "../lib/cbb/types";
const at="2026-11-06T18:00:00.000Z",start="2026-11-06T23:00:00.000Z",lock="2026-11-06T22:00:00.000Z";
const team=(id:number,name:string)=>({id,name,full_name:name,abbreviation:name.split(" ")[0].toUpperCase(),college:name,conference_id:1});
const game:CbbGame={id:9001,date:start,season:2026,status:"pre",period:0,home_score:0,away_score:0,home_team:team(71,"Alpha College"),visitor_team:team(72,"Beta College")};
const margin=2,sd=11,zero=normalCdf((.5-margin)/sd)-normalCdf((-.5-margin)/sd);
const independent:CbbForecast={release:CBB_FULL_D1_SCORE_RELEASE,gameId:game.id,asOf:at,homeId:71,awayId:72,homeScore:74,awayScore:72,margin,total:146,possessions:70,homeWinProbability:(1-normalCdf((.5-margin)/sd))/(1-zero),inputStatus:"complete",issues:[],uncertainty:{marginSd:sd,totalSd:15,marginTotalCorrelation:.1,marginCorrection:0,totalCorrection:0,fitThroughSeason:2024,games:100}};
const quote=(market:CbbMarket):CbbContextualQuote=>({provider:"owls",gameId:game.id,sportsbook:"draftkings",market,line:market==="moneyline"?null:market==="spread"?-3.5:36.5,firstPrice:market==="moneyline"?-900:-110,secondPrice:market==="moneyline"?600:-110,providerObservedAt:"2026-11-06T17:58:00Z",fetchedAt:"2026-11-06T17:59:00Z",requestedAt:"2026-11-06T17:58:59Z",phase:"current",orientationVerified:true,sourceEventId:"event9001"});
const targets=[quote("moneyline"),quote("spread"),quote("total")];
function releasedBoard(priced=true,customTargets=targets,latent={marginMean:5,totalMean:25,marginSd:11,totalSd:15,correlation:.1},legacyContextual=false,modelRelease:string=testedRelease.modelRelease,previousContextual=false):CbbReleasedOutcomeBoard{
 const release=resolveCbbContextualOutcomeRelease(modelRelease);assert(release);const manifest=release.manifest;
 const input:CbbContextualFeatureInput={independent,asOf:at,startsAt:start,currentQuotes:priced?customTargets:[]},d=buildCbbInterpretedDecision({input,interpretation:buildCbbContextualMarketInterpretation(input),latent,targets:priced?customTargets:[],
  recommendationRisk:legacyContextual?undefined:{marginLocationSd:0,totalLocationSd:0,calibrationGames:137}});
 if(legacyContextual){for(const row of d.marketDecisions)delete (row as {recommendationRisk?:unknown}).recommendationRisk;}
 // Fixed-law metadata exercises the stored receipt contract. It makes no claim
 // that these synthetic points were produced by the private fitted artifact.
 const decision={release:legacyContextual?CBB_CONTEXTUAL_OUTCOME_LEGACY_DECISION_RELEASE:previousContextual?CBB_CONTEXTUAL_OUTCOME_PREVIOUS_DECISION_RELEASE:modelRelease===CBB_CONTEXTUAL_OUTCOME_LEGACY_MODEL_RELEASE?CBB_CONTEXTUAL_OUTCOME_LEGACY_RISK_DECISION_RELEASE:CBB_OUTCOME_DECISION_RELEASE,authority:"offline_research_only",mode:"future",gameId:game.id,asOf:at,fixtureIdentity:{homeId:71,awayId:72},independentInputSha256:cbbOutcomeIndependentInputSha256(independent),
  artifact:{release:manifest.engineRelease,methodSha256:manifest.methodSha256,trainingRowsSha256:"a".repeat(64),availableBy:manifest.availableBy,objectSha256:manifest.modelObjectSha256,...(modelRelease===CBB_CONTEXTUAL_OUTCOME_LEGACY_MODEL_RELEASE?{factorObjectSha256:"b".repeat(64)}:{})},
  interpretation:d.interpretation,finalScore:d.finalScore,finalUncertainty:d.finalUncertainty,gameOutcome:{selection:d.finalScore.homeWinProbability>=.5?"first":"second",probability:Math.max(d.finalScore.homeWinProbability,1-d.finalScore.homeWinProbability)},marketDecisions:d.marketDecisions,gradePolicy:d.policy,
  workingForecast:{},calibration:{forecastArtifactObjectSha256:manifest.modelObjectSha256,calibrationMethodSha256:manifest.calibrationMethodSha256},numericalTrace:{workingLatentLocations:latent,finalLatentDistribution:latent,law:d.lawNumerics,reference:d.sourceReferenceNumerics},interpretationMeaning:"Synthetic frozen joint-law receipt",limits:"No model-fit claim"} as unknown as CbbOutcomeDecision;
 const b=buildCbbContextualOutcomeBoard({decision,independent}),{contextualOutcomeDecision:stored,...context}=b.marketContext,{interpretation,finalScore,marketDecisions,...trace}=stored;
 const identity={gameId:game.id,asOf:at,modelRelease:release.modelRelease,gradeRelease:b.gradeRelease,independentRelease:independent.release,artifactObjectSha256:manifest.modelObjectSha256};
 const evidence=encodeCbbContextualEvidence(JSON.stringify({identity,input,interpretation,finalScore,marketDecisions,trace:{release:release.evidenceRelease,decision:trace,independent,coverage:null}}));
 return {...b,authority:"released_contextual_outcome",modelRelease:release.modelRelease,calibrationRelease:release.calibrationRelease,marketContext:{...context,contextualOutcomeEvidence:evidence,contextualOutcomeSummary:{release:release.evidenceRelease,interpretationRelease:interpretation.release,decisionRelease:decision.release,artifact:decision.artifact,fixtureIdentity:decision.fixtureIdentity,independentInputSha256:decision.independentInputSha256,calibrationRelease:release.calibrationRelease,calibrationMethodSha256:manifest.calibrationMethodSha256,workingForecast:decision.workingForecast,gradePolicy:decision.gradePolicy,evidenceBytes:{raw:evidence.uncompressedBytes,gzip:evidence.compressedBytes}}}} as CbbReleasedOutcomeBoard;
}
const testedRelease=resolveCbbContextualOutcomeRelease(CBB_CONTEXTUAL_OUTCOME_MODEL_RELEASE)??resolveCbbContextualOutcomeRelease(CBB_CONTEXTUAL_OUTCOME_LEGACY_MODEL_RELEASE)!;
const reversed=(v:unknown):unknown=>Array.isArray(v)?v.map(reversed):v&&typeof v==="object"?Object.fromEntries(Object.entries(v).reverse().map(([k,x])=>[k,reversed(x)])):v;
export async function testCbbContextualOutcomeLocks(){
 let network=0;const previousFetch=globalThis.fetch;globalThis.fetch=async()=>{network++;throw Error("unexpected network");};
 try{
  const currentRelease=testedRelease,legacyRelease=resolveCbbContextualOutcomeRelease(CBB_CONTEXTUAL_OUTCOME_LEGACY_MODEL_RELEASE)!;
  assert(Object.isFrozen(currentRelease)&&Object.isFrozen(currentRelease.manifest)&&Object.isFrozen(legacyRelease)&&Object.isFrozen(legacyRelease.manifest));
  assert.equal(resolveCbbContextualOutcomeRelease("unrecognized_contextual_model"),null);
  assert.equal(resolveCbbContextualOutcomeRelease("cbb_contextual_outcome_2026_11_06_r2_whole_market_context"),null,"Rejected private R2 was never a released legacy model");
  assert.throws(()=>cbbLockedModelRelease({release:"private_rejected_candidate",modelRelease:"cbb_contextual_outcome_2026_11_06_r2_whole_market_context"}),/locked model release is unknown/);
  assert.equal(legacyRelease.manifest.runtimeModelRelease,CBB_CONTEXTUAL_OUTCOME_LEGACY_MODEL_RELEASE);
  assert.equal(legacyRelease.calibrationRelease,"cbb_contextual_covariance_2026_11_05_r1");assert.equal(legacyRelease.modelUsed,"cbb_contextual_outcome_r1");
  if(CBB_CONTEXTUAL_OUTCOME_MANIFEST){assert.equal(currentRelease.manifest.runtimeModelRelease,CBB_CONTEXTUAL_OUTCOME_MODEL_RELEASE);assert.equal(currentRelease.modelUsed,"cbb_contextual_outcome_r7");assert.notEqual(currentRelease.manifest.modelObjectSha256,legacyRelease.manifest.modelObjectSha256);}
  else{assert.equal(resolveCbbContextualOutcomeRelease(CBB_CONTEXTUAL_OUTCOME_MODEL_RELEASE),null);await assert.rejects(loadCbbContextualOutcomeRuntime(),/manifest pending/);}
  assert.equal(resolveCbbContextualOutcomeRelease("cbb_contextual_outcome_2026_11_06_r3_independent_evidence_components"),null,"Unreleased held R3 is not a production legacy");
  assert.equal(resolveCbbContextualOutcomeRelease("cbb_contextual_outcome_2026_11_06_r4_direct_outcome"),null,"Failed unpublished R4 is not a production legacy");
  assert.equal(resolveCbbContextualOutcomeRelease("cbb_contextual_outcome_2026_11_06_r5_direct_outcome_clock_units"),null,"Held unpublished R5 is not a production legacy");
  assert.equal(resolveCbbContextualOutcomeRelease("cbb_contextual_outcome_2026_11_06_r6_direct_total_retained_margin"),null,"Held unpublished R6 is not a production legacy");
  const board=releasedBoard(),read=readCbbContextualOutcomeEvidence(board);assert(read);assert.deepEqual(readCbbContextualOutcomeEvidence(reversed(board) as CbbReleasedOutcomeBoard)?.decision.finalScore,read.decision.finalScore,"JSONB key reordering changes no stored law identity");
  const snapshot={release:"cbb_candidate_2026_10_29_r1_locked_board_contract" as const,gameId:game.id,startsAt:start,capturedAt:at,lockedAt:null,board},dto=adaptCbbProvisionalGame({game,snapshot,homeLogo:null,awayLogo:null,now:at,marketQuotes:targets});
  const ml=board.rows[0];assert.equal(ml.grade,"No Play");assert(ml.expectedValue!<0);assert.equal(dto.markets.moneyline.modelProb,ml.probability);assert.equal(dto.markets.moneyline.confidence,ml.probability);assert.equal(dto.markets.moneyline.recommendationConfidence,null);assert(dto.markets.moneyline.reviewFlags.includes("informational_non_actionable_price"));assert.equal(dto.markets.moneyline.held,false);assert.equal(dto.markets.moneyline.marketPrediction?.status,"available");assert(!dto.breakdown?.modelBreakdown?.startsWith("Independent projection"));
  for(const row of board.rows){const m=dto.markets[row.market==="spread"?"first_inning":row.market];assert.equal(m.modelProb,row.probability);assert.equal(m.priceAmerican,row.price);assert.equal(m.verdict.label,row.grade);}
  const policyBoard=releasedBoard(true,targets.map(q=>q.market==="total"?{...q,line:160}:q),{marginMean:5,totalMean:146,marginSd:11,totalSd:15,correlation:.1}),policyDto=adaptCbbProvisionalGame({game,snapshot:{...snapshot,board:policyBoard},homeLogo:null,awayLogo:null,now:at});
  assert.equal(policyDto.markets.total.verdict.key,"best_angle");assert.equal(policyDto.markets.total.grade,"best_signal");assert.equal(policyBoard.rows[2].actualActionConfirmation,false,"This synthetic Best has no professional action witness");assert.notEqual(policyDto.markets.total.marketSignal,"market_confirmed","Best does not invent professional confirmation");
  assert.equal(policyDto.markets.first_inning.verdict.key,"lean");assert.equal(policyDto.markets.first_inning.grade,"model_only");
  for(const [key,expected] of [["total","best_angle"],["first_inning","lean"]] as const){const m=policyDto.markets[key];assert.equal(dailyEdgePresentationVerdict(m).key,expected);assert.equal(deriveVerdict({headlineGrade:m.grade,perMarketConfidence:{ml:m.confidence,total:null,nrfi:null}}),expected,"Shared grade consumer preserves the stored contextual tier");}
  const zeroTargets=targets.map(q=>({...q,line:q.market==="moneyline"?null:q.market==="spread"?0:146,firstPrice:100,secondPrice:100})),zeroBoard=releasedBoard(true,zeroTargets,{marginMean:0,totalMean:146,marginSd:11,totalSd:15,correlation:0}),zeroSnapshot={...snapshot,board:zeroBoard},zeroDto=adaptCbbProvisionalGame({game,snapshot:zeroSnapshot,homeLogo:null,awayLogo:null,now:at}),zeroMarket=zeroDto.markets.moneyline;
  assert(Math.abs(zeroBoard.rows[0].expectedValue!)<1e-12,"Symmetric even-money law has zero value within its integration error; raw floating result is preserved");assert.equal(zeroMarket.verdict.key,"watchlist");assert.equal(dailyEdgePresentationVerdict(zeroMarket).key,"watchlist");assert.equal(zeroMarket.modelProb,zeroBoard.rows[0].probability);assert.equal(zeroMarket.confidence,zeroBoard.rows[0].probability);assert.equal(zeroMarket.recommendationConfidence,null);assert(zeroMarket.reviewFlags.includes("informational_non_actionable_price"));
  assert(zeroBoard.rows.every(row=>row.grade==="Watchlist"));assert.equal(zeroDto.breakdown.verdict.key,"watchlist");assert.deepEqual(selectTopAvailableAngles([zeroDto]).games,[],"Shared fallback cannot promote an informational zero-value Watch");
  let stored:CbbStoredMemberGame|null=null,writes=0;const db={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:stored?{payload:stored}:null,error:null})})}),upsert:async(row:{payload:CbbStoredMemberGame})=>{stored=structuredClone(row.payload);writes++;return{error:null};}})} as unknown as Parameters<typeof writeCbbMemberGame>[1];
  const first=await writeCbbMemberGame({game,candidate:board,homeLogo:null,awayLogo:null,now:at,marketQuotes:targets},db);const frozen=await writeCbbMemberGame({game,candidate:null,homeLogo:null,awayLogo:null,now:lock},db);
  assert.equal(writes,2);assert.deepEqual(frozen.record.memberGame.projected,first.record.memberGame.projected);assert.deepEqual(frozen.record.snapshot.board,first.record.snapshot.board,"Lock clones an already evaluated board, not a reforecast");const frozenBytes=JSON.stringify(frozen.record);
  assert.equal(cbbLockedModelRelease(board),testedRelease.modelRelease);assert.equal(cbbLockedGradeRelease(board),board.gradeRelease);assertCbbContextualLockedRecord(frozen.record);
  const corrupted=structuredClone(frozen.record);(corrupted.snapshot.board as CbbReleasedOutcomeBoard).marketContext.contextualOutcomeEvidence={...board.marketContext.contextualOutcomeEvidence,payload:"invalid"};stored=corrupted;const corruptBytes=JSON.stringify(corrupted);const ignored=await writeCbbMemberGame({game,candidate:{...board,score:{...board.score,home:NaN}},homeLogo:null,awayLogo:null,now:"2026-11-06T22:05:00Z"},db);assert.equal(ignored.written,false);assert.equal(JSON.stringify(stored),corruptBytes,"Locked writer returns before even a corrupt newer receipt is decoded");assert.deepEqual(cbbMemberGameForReader(corrupted,{...game,status:"post",status_state:"final",home_score:70,away_score:65}).markets,corrupted.memberGame.markets,"Locked reader never decodes/reconstructs evidence");assert.equal(readCbbProvisionalSnapshot({locked:corrupted.snapshot,unlocked:snapshot}),corrupted.snapshot);
  const tracked:Record<string,unknown>[]=[];const fixture={id:501,external_id:game.id,game_date:start,slate_date:"2026-11-06",home_team:{external_id:71,display_name:game.home_team.full_name},away_team:{external_id:72,display_name:game.visitor_team.full_name}};
  const tracking={from:(table:string)=>table==="games"?{select:()=>{const q={eq:()=>q,maybeSingle:async()=>({data:fixture,error:null})};return q;}}:{select:()=>{const q={eq:()=>q,then:(resolve:(r:unknown)=>unknown)=>resolve({data:tracked,error:null})};return q;},insert:async(row:Record<string,unknown>)=>{tracked.push(structuredClone(row));return{error:null};}}} as unknown as Parameters<typeof writeLockedCbbTracking>[1];
  assert.equal(await writeLockedCbbTracking(frozen.record,tracking),3);assert(tracked.every(r=>r.model_version===testedRelease.modelRelease&&r.calibration_version===testedRelease.calibrationRelease&&r.model_used===testedRelease.modelUsed&&(r.snapshot_json as Record<string,unknown>).release===CBB_TRACKING_WRITER_RELEASE));for(const row of tracked){row.model_probability=Number((row.model_probability as number).toFixed(6));row.confidence=Number((row.confidence as number).toFixed(2));row.expected_value=Number((row.expected_value as number).toFixed(4));}const trackingBytes=JSON.stringify(tracked);assert.equal(await writeLockedCbbTracking(frozen.record,tracking),0,"SQL decimal summaries round-trip while exact JSON law values stay authoritative");assert.equal(JSON.stringify(tracked),trackingBytes);assert.equal(JSON.stringify(frozen.record),frozenBytes,"Tracking never mutates the frozen member evidence");
  const priorP=tracked[0].model_probability;tracked[0].model_probability=.01;await assert.rejects(writeLockedCbbTracking(frozen.record,tracking),/immutable tracking row conflicts/);tracked[0].model_probability=priorP;
  const priorExact=(tracked[0].snapshot_json as Record<string,unknown>).selectedProbability;(tracked[0].snapshot_json as Record<string,unknown>).selectedProbability=.01;await assert.rejects(writeLockedCbbTracking(frozen.record,tracking),/immutable tracking row conflicts/);(tracked[0].snapshot_json as Record<string,unknown>).selectedProbability=priorExact;
  const badLaw=structuredClone(frozen.record),badLawBoard=badLaw.snapshot.board as CbbReleasedOutcomeBoard,body=structuredClone(decodeCbbContextualEvidence(badLawBoard.marketContext.contextualOutcomeEvidence,badLawBoard.marketContext.contextualOutcomeEvidence.identity).evidence);
  (body.trace as {decision:CbbOutcomeDecision}).decision.numericalTrace.law.homeMean+=1;badLawBoard.gameForecast.law.law.homeMean+=1;badLawBoard.marketContext.contextualOutcomeEvidence=encodeCbbContextualEvidence(body);assert.throws(()=>assertCbbContextualLockedRecord(badLaw),/stored joint-law summary/ ,"Re-encoded matching evidence cannot make a false stored law summary authoritative");
  fixture.home_team.external_id=999;await assert.rejects(writeLockedCbbTracking(frozen.record,tracking),/invalid school identity/);fixture.home_team.external_id=71;
  const badDto=structuredClone(frozen.record);badDto.memberGame.markets.total.modelProb=.01;await assert.rejects(writeLockedCbbTracking(badDto,tracking),/exact stored law\/price\/DTO/);await assert.rejects(writeLockedCbbTracking(corrupted,tracking),/evidence:/);
  stored=null;await writeCbbMemberGame({game,candidate:zeroBoard,homeLogo:null,awayLogo:null,now:at,marketQuotes:zeroTargets},db);const zeroLocked=(await writeCbbMemberGame({game,candidate:null,homeLogo:null,awayLogo:null,now:lock},db)).record,zeroBytes=JSON.stringify(zeroLocked);
  assertCbbContextualLockedRecord(zeroLocked);assert.equal(zeroLocked.memberGame.markets.moneyline.recommendationConfidence,null);assert.equal(dailyEdgePresentationVerdict(cbbMemberGameForReader(zeroLocked,game).markets.moneyline).key,"watchlist");
  tracked.length=0;await writeLockedCbbTracking(zeroLocked,tracking);const zeroTracked=tracked.find(r=>r.market==="moneyline")!;assert.equal(zeroTracked.no_bet,true);assert.equal(zeroTracked.play_grade,"watchlist");assert.equal(zeroTracked.model_probability,zeroBoard.rows[0].probability);assert.equal(zeroTracked.expected_value,zeroBoard.rows[0].expectedValue);const zeroTrackingBytes=JSON.stringify(tracked);assert.equal(await writeLockedCbbTracking(zeroLocked,tracking),0);assert.equal(JSON.stringify(tracked),zeroTrackingBytes);assert.equal(JSON.stringify(zeroLocked),zeroBytes,"Informational boundary lock remains byte-exact through reader and tracking");
  const badZero=structuredClone(zeroLocked);badZero.memberGame.markets.moneyline.recommendationConfidence=50;assert.throws(()=>assertCbbContextualLockedRecord(badZero),/exact stored law\/price\/DTO/,"A Watch cannot regain recommendation confidence in tracking");
  const passTargets=targets.map(q=>({...q,line:q.market==="moneyline"?null:q.market==="spread"?0:160,firstPrice:q.market==="total"?1500:-2000,secondPrice:q.market==="total"?-2000:1500})),passBoard=releasedBoard(true,passTargets,{marginMean:16,totalMean:146,marginSd:11,totalSd:15,correlation:.1}),passDto=adaptCbbProvisionalGame({game,snapshot:{...snapshot,board:passBoard},homeLogo:null,awayLogo:null,now:at});
  assert(passBoard.rows.every(row=>row.grade==="No Play"));assert(passBoard.rows[0].probability!>.9,"A likely winner remains a complete forecast at its poor price");assert.equal(passDto.breakdown.verdict.key,"no_play");assert.deepEqual(selectTopAvailableAngles([passDto]).games,[]);
  const positiveSteep=releasedBoard(true,passTargets,{marginMean:24,totalMean:146,marginSd:11,totalSd:15,correlation:.1}).rows[0];assert.equal(positiveSteep.price,-2000);assert(positiveSteep.expectedValue!>0);assert.equal(positiveSteep.grade,"Lean","No Play is economic rather than an added extreme-price prohibition");
  for(const row of passBoard.rows){const market=passDto.markets[row.market==="spread"?"first_inning":row.market];assert.equal(market.held,false);assert.equal(market.grade,null,"Domain grade vocabulary has no No Play token; the explicit verdict owns this lane");assert.equal(dailyEdgePresentationVerdict(market).key,"no_play");assert.equal(market.modelProb,row.probability);assert.equal(market.confidence,row.probability);assert.equal(market.priceAmerican,row.price);assert.equal(market.recommendationConfidence,null);assert.equal(market.marketPrediction?.status,"available");assert(market.pick);assert(market.reviewFlags.includes("informational_non_actionable_price"));}
  stored=null;await writeCbbMemberGame({game,candidate:passBoard,homeLogo:null,awayLogo:null,now:at,marketQuotes:passTargets},db);const passLocked=(await writeCbbMemberGame({game,candidate:null,homeLogo:null,awayLogo:null,now:lock},db)).record,passBytes=JSON.stringify(passLocked);assertCbbContextualLockedRecord(passLocked);tracked.length=0;assert.equal(await writeLockedCbbTracking(passLocked,tracking),3);assert(tracked.every(row=>row.play_grade==="no_play"&&row.no_bet===true&&row.held===false&&row.no_bet_reason&&row.odds_american===-2000));
  for(const row of passBoard.rows){const trackedRow=tracked.find(r=>r.market===row.market)!;assert.equal(trackedRow.model_probability,row.probability);assert.equal(trackedRow.expected_value,row.expectedValue);assert.equal((trackedRow.snapshot_json as Record<string,unknown>).selectedPushProbability,row.pushProbability);}
  const passTrackingBytes=JSON.stringify(tracked);assert.equal(await writeLockedCbbTracking(passLocked,tracking),0);assert.equal(JSON.stringify(tracked),passTrackingBytes);for(const [home,away,expected] of [[90,70,"win"],[70,90,"loss"]] as const){const final=cbbMemberGameForReader(passLocked,{...game,status:"post",status_state:"final",home_score:home,away_score:away});assert.equal(final.result?.markets.moneyline.pickResult,expected);assert.equal(final.result?.markets.moneyline.gradeUnits,null);assert.equal(final.result?.markets.first_inning.gradeUnits,null);assert.equal(final.result?.markets.total.gradeUnits,null);assert.deepEqual(final.markets,passLocked.memberGame.markets,"Settling forecast accuracy does not reinterpret a frozen priced pass");}assert.equal(JSON.stringify(passLocked),passBytes);
  const badPass=structuredClone(passLocked);badPass.memberGame.markets.moneyline.held=true;assert.throws(()=>assertCbbContextualLockedRecord(badPass),/exact stored law\/price\/DTO/,"A complete priced No Play cannot be relabeled Held");
  // A new-model frozen winner uses the stored nonnegative/no-tie joint law,
  // which differs from legacy marginal-normal winner verification.
  const u=releasedBoard(false);stored=null;await writeCbbMemberGame({game,candidate:u,homeLogo:null,awayLogo:null,now:at},db);const unpriced=(await writeCbbMemberGame({game,candidate:null,homeLogo:null,awayLogo:null,now:lock},db)).record;tracked.length=0;assert.equal(await writeLockedCbbTracking(unpriced,tracking),1);assert.equal(tracked[0].odds_american,null);assert.equal(tracked[0].expected_value,null);assert.equal(tracked[0].no_bet,true);assert.equal(unpriced.memberGame.markets.moneyline.modelProb,u.gameForecast.probability);assert.equal(cbbMemberGameForReader(unpriced,{...game,status:"post",status_state:"final",home_score:70,away_score:65}).result?.markets.moneyline.gradeUnits,null);
  // Legacy member/tracking contracts do not acquire a contextual decoder,
  // covariance release, new source labels or corrected probabilities.
  const legacy=buildCbbProvisionalBoard(independent,targets);stored=null;await writeCbbMemberGame({game,candidate:legacy,homeLogo:null,awayLogo:null,now:at},db);const old=(await writeCbbMemberGame({game,candidate:null,homeLogo:null,awayLogo:null,now:lock},db)).record;tracked.length=0;await writeLockedCbbTracking(old,tracking);for(const r of tracked)(r.snapshot_json as Record<string,unknown>).release="cbb_tracking_writer_2026_11_05_r24_coordinated_source_lineage";const oldRecords=JSON.stringify(tracked),oldBytes=JSON.stringify(old);assert.equal(await writeLockedCbbTracking(old,tracking),0);assert.equal(JSON.stringify(tracked),oldRecords);assert.equal(JSON.stringify(old),oldBytes);assert.equal(assertCbbContextualLockedRecord(old),null);
  const legacyNoQuote=buildCbbGameForecastBoard(independent,{kind:"cross_division"});stored=null;await writeCbbMemberGame({game,candidate:legacyNoQuote,homeLogo:null,awayLogo:null,now:at},db);const oldWinner=(await writeCbbMemberGame({game,candidate:null,homeLogo:null,awayLogo:null,now:lock},db)).record;tracked.length=0;assert.equal(await writeLockedCbbTracking(oldWinner,tracking),1,"Old R1 normal-law winner retains its own verifier and no wager");assert.equal(tracked[0].odds_american,null);
  // A genuine R1 manifest identity continues to own its stored receipt and
  // calibration when R7 becomes active. No old input is sent to the new engine.
  const legacyContextualBoard=releasedBoard(true,passTargets,{marginMean:16,totalMean:146,marginSd:11,totalSd:15,correlation:.1},false,CBB_CONTEXTUAL_OUTCOME_LEGACY_MODEL_RELEASE);
  const legacyBoardBytes=JSON.stringify(legacyContextualBoard),legacyEnvelope=legacyContextualBoard.marketContext.contextualOutcomeEvidence;
  const legacyOriginalJSON=decodeCbbContextualEvidence(legacyEnvelope,legacyEnvelope.identity).originalJSON;
  assert.equal(legacyContextualBoard.gradeRelease,CBB_CONTEXTUAL_OUTCOME_LEGACY_RISK_GRADE_RELEASE);
  assert(readCbbContextualOutcomeEvidence(legacyContextualBoard));assert.equal(cbbLockedModelRelease(legacyContextualBoard),CBB_CONTEXTUAL_OUTCOME_LEGACY_MODEL_RELEASE);
  assert.equal(JSON.stringify(legacyContextualBoard),legacyBoardBytes);
  assert.equal(decodeCbbContextualEvidence(legacyEnvelope,legacyEnvelope.identity).originalJSON,legacyOriginalJSON,"R1 codec retains the exact original JSON bytes");
  const wrongDecision=structuredClone(legacyContextualBoard),wrongDecisionBody=structuredClone(decodeCbbContextualEvidence(legacyEnvelope,legacyEnvelope.identity).evidence);
  (wrongDecisionBody.trace as {decision:{release:string}}).decision.release=CBB_OUTCOME_DECISION_RELEASE;wrongDecision.marketContext.contextualOutcomeEvidence=encodeCbbContextualEvidence(wrongDecisionBody);
  assert.throws(()=>readCbbContextualOutcomeEvidence(wrongDecision),/decision does not belong to its model release/,"R1 cannot acquire composite decision semantics under its own old manifest");
  if(CBB_CONTEXTUAL_OUTCOME_MANIFEST){
  const relabeled=structuredClone(legacyContextualBoard);relabeled.modelRelease=CBB_CONTEXTUAL_OUTCOME_MODEL_RELEASE;
  assert.throws(()=>readCbbContextualOutcomeEvidence(relabeled),/calibration release differs/);
  relabeled.calibrationRelease=CBB_CONTEXTUAL_OUTCOME_CALIBRATION_RELEASE;
  assert.throws(()=>readCbbContextualOutcomeEvidence(relabeled),/identity mismatch/,"R1 envelope cannot acquire R7 identity by relabeling its board");
  const upgradedBody=structuredClone(decodeCbbContextualEvidence(legacyEnvelope,legacyEnvelope.identity).evidence);
  upgradedBody.identity.modelRelease=currentRelease.modelRelease;upgradedBody.identity.artifactObjectSha256=currentRelease.manifest.modelObjectSha256;
  (upgradedBody.trace as {release:string}).release=currentRelease.evidenceRelease;
  relabeled.marketContext.contextualOutcomeEvidence=encodeCbbContextualEvidence(upgradedBody);
  assert.throws(()=>readCbbContextualOutcomeEvidence(relabeled),/stored artifact or calibration differs|decision does not belong/,"Re-encoding identity cannot transplant an R1 decision into R7");
  }
  stored=null;await writeCbbMemberGame({game,candidate:legacyContextualBoard,homeLogo:null,awayLogo:null,now:at,marketQuotes:passTargets},db);
  const r1Lock=(await writeCbbMemberGame({game,candidate:null,homeLogo:null,awayLogo:null,now:lock},db)).record,r1Bytes=JSON.stringify(r1Lock);
  assertCbbContextualLockedRecord(r1Lock);tracked.length=0;assert.equal(await writeLockedCbbTracking(r1Lock,tracking),3);
  assert(tracked.every(row=>row.model_version===legacyRelease.modelRelease&&row.calibration_version===legacyRelease.calibrationRelease&&row.model_used===legacyRelease.modelUsed));
  for(const row of tracked)(row.snapshot_json as Record<string,unknown>).release="cbb_tracking_writer_2026_11_05_r30_contextual_recommendation_risk";
  const r1TrackingBytes=JSON.stringify(tracked);assert.equal(await writeLockedCbbTracking(r1Lock,tracking),0);
  assert.equal(JSON.stringify(tracked),r1TrackingBytes,"Existing R1 tracking never upgrades its release or receipt");
  for(const [home,away] of [[90,70],[70,90]]){
   const result=cbbMemberGameForReader(r1Lock,{...game,status:"post",status_state:"final",home_score:home,away_score:away});
   assert.deepEqual(result.markets,r1Lock.memberGame.markets);assert.equal(result.result?.markets.moneyline.gradeUnits,null);assert.equal(result.result?.markets.first_inning.gradeUnits,null);assert.equal(result.result?.markets.total.gradeUnits,null);
  }
  assert.equal((await writeCbbMemberGame({game,candidate:board,homeLogo:null,awayLogo:null,now:lock},db)).written,false);
  assert.equal(JSON.stringify(r1Lock),r1Bytes,"Active R7 writer cannot replace any R1 frozen score, probability, grade, price or evidence");
  // New risk-based priced passes can retain positive nominal EV. They remain
  // complete forecasts without recommendation confidence or wager exposure.
  const extremeTargets=[{...targets[0],firstPrice:-100000,secondPrice:5000},...targets.slice(1)];
  const extremeBoard=releasedBoard(true,extremeTargets,{marginMean:60,totalMean:146,marginSd:11,totalSd:15,correlation:.1});
  assert.equal(extremeBoard.rows[0].grade,"No Play");assert(extremeBoard.rows[0].expectedValue!>0);
  stored=null;await writeCbbMemberGame({game,candidate:extremeBoard,homeLogo:null,awayLogo:null,now:at,marketQuotes:extremeTargets},db);
  const extremeLock=(await writeCbbMemberGame({game,candidate:null,homeLogo:null,awayLogo:null,now:lock},db)).record;
  assert.equal(extremeLock.memberGame.markets.moneyline.verdict.key,"no_play");
  assert.equal(extremeLock.memberGame.markets.moneyline.recommendationConfidence,null);
  assert.equal(extremeLock.memberGame.markets.moneyline.modelProb,extremeBoard.rows[0].probability);
  tracked.length=0;assert.equal(await writeLockedCbbTracking(extremeLock,tracking),3);
  const extremeML=tracked.find(row=>row.market==="moneyline")!;
  assert.equal(extremeML.no_bet,true);assert.equal(extremeML.play_grade,"no_play");
  assert.equal(extremeML.expected_value,extremeBoard.rows[0].expectedValue);
  const extremeBytes=JSON.stringify(extremeLock),extremeTracking=JSON.stringify(tracked);
  assert.equal(await writeLockedCbbTracking(extremeLock,tracking),0);
  assert.equal(JSON.stringify(extremeLock),extremeBytes);assert.equal(JSON.stringify(tracked),extremeTracking);
  // The preceding decision R7 / grade R6 family shares model R1, but retains its
  // original grades and tracking evidence when the new grade family ships.
  const priorContextual=releasedBoard(true,targets,undefined,true,CBB_CONTEXTUAL_OUTCOME_LEGACY_MODEL_RELEASE);
  assert.equal(priorContextual.gradeRelease,CBB_CONTEXTUAL_OUTCOME_LEGACY_GRADE_RELEASE);
  stored=null;await writeCbbMemberGame({game,candidate:priorContextual,homeLogo:null,awayLogo:null,now:at,marketQuotes:targets},db);
  const priorLock=(await writeCbbMemberGame({game,candidate:null,homeLogo:null,awayLogo:null,now:lock},db)).record;
  const priorBytes=JSON.stringify(priorLock);tracked.length=0;assert.equal(await writeLockedCbbTracking(priorLock,tracking),3);
  for(const row of tracked)(row.snapshot_json as Record<string,unknown>).release="cbb_tracking_writer_2026_11_05_r29_contextual_noplay_price_lanes";
  const priorTrackingBytes=JSON.stringify(tracked);
  assert.equal(await writeLockedCbbTracking(priorLock,tracking),0);
  assert.equal(JSON.stringify(tracked),priorTrackingBytes);assert.equal(JSON.stringify(priorLock),priorBytes);
  assert.deepEqual(cbbMemberGameForReader(priorLock,game).markets,priorLock.memberGame.markets);
  assert.equal((await writeCbbMemberGame({game,candidate:board,homeLogo:null,awayLogo:null,now:lock},db)).written,false);
  assert.equal(JSON.stringify(priorLock),priorBytes,"New risk grading cannot replace a legacy contextual lock");
   const previousBoard=releasedBoard(true,targets,undefined,false,testedRelease.modelRelease,true);
   assert.equal(previousBoard.gradeRelease,CBB_CONTEXTUAL_OUTCOME_PREVIOUS_GRADE_RELEASE);
   stored=null;await writeCbbMemberGame({game,candidate:previousBoard,homeLogo:null,awayLogo:null,now:at,marketQuotes:targets},db);
   const previousLock=(await writeCbbMemberGame({game,candidate:null,homeLogo:null,awayLogo:null,now:lock},db)).record;
   const previousBytes=JSON.stringify(previousLock);
   const confidenceTargets=targets.map(q=>q.market==="moneyline"?{...q,firstPrice:-150,secondPrice:130}:q);
   const confidenceBoard=releasedBoard(true,confidenceTargets,{marginMean:2.5,totalMean:145,marginSd:12,totalSd:15,correlation:0});
   assert.equal(confidenceBoard.rows[0].grade,"Lean");assert(confidenceBoard.rows[0].expectedValue!<0);
   assert.deepEqual(readCbbContextualOutcomeEvidence(reversed(confidenceBoard) as CbbReleasedOutcomeBoard)?.decision.finalScore,confidenceBoard.score,"JSONB key order cannot alter a confidence-qualified decision");
   assert.equal((await writeCbbMemberGame({game,candidate:confidenceBoard,homeLogo:null,awayLogo:null,now:lock},db)).written,false);
   assert.equal(JSON.stringify(previousLock),previousBytes,"The new confidence policy cannot replace an R10/R9 lock");
   assert.deepEqual(cbbMemberGameForReader(previousLock,game).markets,previousLock.memberGame.markets);
   stored=null;await writeCbbMemberGame({game,candidate:confidenceBoard,homeLogo:null,awayLogo:null,now:at,marketQuotes:confidenceTargets},db);
   const confidenceLock=(await writeCbbMemberGame({game,candidate:null,homeLogo:null,awayLogo:null,now:lock},db)).record;
   assertCbbContextualLockedRecord(confidenceLock);tracked.length=0;await writeLockedCbbTracking(confidenceLock,tracking);
   const confidenceTracked=tracked.find(row=>row.market==="moneyline")!;
   assert.equal(confidenceTracked.play_grade,"lean");assert.equal(confidenceTracked.expected_value,confidenceBoard.rows[0].expectedValue);
   assert.equal(confidenceLock.memberGame.markets.moneyline.verdict.key,"lean");
   assert.equal(network,0,"No artifact fetch/provider path was used for adapter, locking, reading or tracking");
 }finally{globalThis.fetch=previousFetch;}
 console.log(`PASS contextual outcome lock integration: ${CBB_CONTEXTUAL_OUTCOME_MANIFEST?"active R7 plus legacy R1":"pending R7 fails closed; genuine R1 only"}, exact own-manifest/codec/DTO/tracking identities, priced pass and Watch boundaries, lock writer+reader precedence, no tracking reforecast or upgrade, zero real IO`);
}
if(process.argv[1]?.endsWith("test-cbb-contextual-outcome-locks.ts"))testCbbContextualOutcomeLocks().catch(e=>{console.error(e);process.exitCode=1;});
