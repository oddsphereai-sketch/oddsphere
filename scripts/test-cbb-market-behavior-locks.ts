import {CBB_SOURCE_ALIAS_MARKET_BEHAVIOR_MODEL_RELEASE,CBB_SOURCE_ALIAS_MARKET_BEHAVIOR_GRADE_RELEASE,CBB_SOURCE_ALIAS_MARKET_BEHAVIOR_RECEIPT_RELEASE} from "../lib/cbb/marketBehaviorCandidate";
import {CBB_CONTINUITY_MARKET_BEHAVIOR_MODEL_RELEASE,CBB_CONTINUITY_MARKET_BEHAVIOR_GRADE_RELEASE,CBB_CONTINUITY_MARKET_BEHAVIOR_RECEIPT_RELEASE} from "../lib/cbb/marketBehaviorCandidate";
import {CBB_INFORMATIONAL_WATCHLIST_GRADE_RELEASE} from "../lib/cbb/marketBehaviorCandidate";
import assert from "node:assert/strict";
import {normalCdf} from "../lib/cbb/model";
import {CBB_RETAIL_MARKET_BEHAVIOR_MODEL_RELEASE,CBB_RETAIL_MARKET_BEHAVIOR_GRADE_RELEASE,CBB_RETAIL_MARKET_BEHAVIOR_RECEIPT_RELEASE} from "../lib/cbb/marketBehaviorCandidate";
import {CBB_PREVIOUS_CURRENT_SCORE_RELEASE} from "../lib/cbb/currentScoreRuntime";
import {CBB_EPISODE_MARKET_BEHAVIOR_MODEL_RELEASE,CBB_EPISODE_MARKET_BEHAVIOR_GRADE_RELEASE,CBB_EPISODE_MARKET_BEHAVIOR_RECEIPT_RELEASE} from "../lib/cbb/marketBehaviorCandidate";
import {CBB_JOINT_MARKET_BEHAVIOR_MODEL_RELEASE,CBB_JOINT_MARKET_BEHAVIOR_GRADE_RELEASE,CBB_JOINT_MARKET_BEHAVIOR_RECEIPT_RELEASE} from "../lib/cbb/marketBehaviorCandidate";
import {CBB_ALIGNED_MARKET_BEHAVIOR_MODEL_RELEASE,CBB_ALIGNED_MARKET_BEHAVIOR_GRADE_RELEASE,CBB_ALIGNED_MARKET_BEHAVIOR_RECEIPT_RELEASE} from "../lib/cbb/marketBehaviorCandidate";
import {CBB_CURRENT_SCORE_RELEASE} from "../lib/cbb/currentScoreRuntime";
import {readCbbMarketBehavior,gradeCbbMarketBehavior,CBB_MARKET_BEHAVIOR_RECEIPT_RELEASE,CBB_MARKET_BEHAVIOR_MODEL_RELEASE,CBB_PREVIOUS_MARKET_BEHAVIOR_MODEL_RELEASE,CBB_MARKET_BEHAVIOR_GRADE_RELEASE,CBB_PRIOR_MARKET_BEHAVIOR_GRADE_RELEASE,CBB_PREVIOUS_MARKET_BEHAVIOR_GRADE_RELEASE,CBB_OLDER_MARKET_BEHAVIOR_GRADE_RELEASE} from "../lib/cbb/marketBehaviorCandidate";
import {gradeCbbProvisional} from "../lib/cbb/provisionalGradePolicy";
import {adaptCbbProvisionalGame} from "../lib/services/cbb/adaptCbbProvisionalToDailyEdge";
import {buildCbbProvisionalBoard} from "../lib/cbb/provisionalBoard";
import {writeCbbMemberGame,cbbMemberGameForReader,type CbbStoredMemberGame} from "../lib/services/cbb/cbbMemberGameStore";
import {writeLockedCbbTracking,cbbLockedGradeRelease,cbbLockedModelRelease} from "../lib/services/cbb/cbbTrackingWriter";
import {readCbbProvisionalSnapshot} from "../lib/cbb/provisionalLifecycle";
import {cbbCurrentSplitEvidence} from "../lib/cbb/owlsSplitEvidence";
import {cbbBehaviorFlows,cbbHistoryAtDecision} from "../lib/services/cbb/cbbMarketBehaviorInputs";
import type {CbbForecast,CbbGame,CbbQuote} from "../lib/cbb/types";
const at="2026-11-02T15:30:00.000Z",start="2026-11-02T19:00:00.000Z",lock="2026-11-02T18:00:00.000Z";
const team=(id:number,college:string,abbr:string)=>({id,college,name:college,full_name:college,abbreviation:abbr,conference_id:1});
const game:CbbGame={id:777,date:start,season:2026,status:"pre",period:0,home_team:team(1,"Cornell","COR"),visitor_team:team(2,"Pepperdine","PEPP"),home_score:0,away_score:0};
const margin=14,total=166,sd=11,zero=normalCdf((.5-margin)/sd)-normalCdf((-.5-margin)/sd);
const independent:CbbForecast={release:CBB_CURRENT_SCORE_RELEASE,gameId:777,asOf:at,homeId:1,awayId:2,homeScore:90,awayScore:76,margin,total,homeWinProbability:(1-normalCdf((.5-margin)/sd))/(1-zero),possessions:70,inputStatus:"complete",issues:[],uncertainty:{marginSd:sd,totalSd:16,marginTotalCorrelation:0,marginCorrection:0,totalCorrection:0,fitThroughSeason:2025,games:1000}};
const base={gameId:777,sportsbook:"draftkings",provider:"owls" as const,phase:"current" as const,orientationVerified:true,requestedAt:"2026-11-02T15:21:00Z",providerObservedAt:"2026-11-02T15:20:00Z",fetchedAt:"2026-11-02T15:21:00Z"};
const targets:CbbQuote[]=[{...base,market:"moneyline",line:null,firstPrice:130,secondPrice:-150},{...base,market:"spread",line:2.5,firstPrice:-110,secondPrice:-110},{...base,market:"total",line:164.5,firstPrice:-110,secondPrice:-110}];
const refs:CbbQuote[]=targets.map(q=>({...q,sportsbook:"pinnacle",line:q.market==="spread"?3:q.line}));
const read=readCbbMarketBehavior({independent,independentInputKey:"frozen-source",startsAt:start,targets,currentQuotes:refs,anchors:null});
const candidate=buildCbbProvisionalBoard(read.forecast,[...targets,...refs],{marketBehavior:read.receipt});
assert.ok(candidate.score.margin<0,"verified opposite current ML/spread jointly correct the independent winner");assert.equal(candidate.rows[0].selection,"second");
assert.equal(read.receipt.winnerArbitration.status,"applied");
let stored:CbbStoredMemberGame|null=null,writes=0;
const db={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:stored?{payload:stored}:null,error:null})})}),upsert:async(row:{payload:CbbStoredMemberGame})=>{stored=structuredClone(row.payload);writes++;return {error:null};}})} as unknown as Parameters<typeof writeCbbMemberGame>[1];
async function main(){
 const initial=await writeCbbMemberGame({game,candidate,homeLogo:null,awayLogo:null,now:at,marketQuotes:[...targets,...refs]},db);
 assert.equal(initial.record.memberGame.projected.home,candidate.score.home);assert.equal(initial.record.memberGame.markets.moneyline.pick,"PEPP ML");
 assert.equal(initial.record.memberGame.markets.first_inning.writerMovementDirection,undefined,"current winner arbitration is not recorded market movement");
 assert.ok(!initial.record.memberGame.breakdown?.modelBreakdown?.startsWith("Independent projection"),"final market-conditioned forecast cannot masquerade as independent");
 assert.equal(initial.record.memberGame.markets.first_inning.line,-2.5,"the DTO renders the final selected side after the coherent score correction");
 assert.equal(initial.record.memberGame.markets.first_inning.verdict.key,"watchlist","the new complete negative-EV forecast remains informational");
 assert.ok(candidate.rows.find(row=>row.market==="spread")!.expectedValue!<0);
 assert.equal(initial.record.memberGame.markets.first_inning.recommendationConfidence,null,"an informational negative-EV watch has no actionable recommendation confidence");
 assert.notEqual(initial.record.memberGame.markets.first_inning.sharpStatus,"confirm");
 assert.notEqual(initial.record.memberGame.markets.first_inning.marketSignal,"market_confirmed");
 assert.notEqual(initial.record.memberGame.markets.first_inning.guidedWatchOut,"Professional books disagree with this side.","the corrected final side must not inherit obsolete opposition to the original independent side");
 const frozen=await writeCbbMemberGame({game,candidate:null,homeLogo:null,awayLogo:null,now:lock},db);
 const bytes=JSON.stringify(stored);assert.equal(writes,2);
 const malformed={...candidate,score:{...candidate.score,home:Number.NaN}};
 const repeat=await writeCbbMemberGame({game,candidate:malformed,homeLogo:null,awayLogo:null,now:"2026-11-02T18:05:00Z"},db);
 assert.equal(repeat.written,false);assert.equal(writes,2);assert.equal(JSON.stringify(stored),bytes,"locked public payload returns before a newer or malformed market read");
 const rendered=cbbMemberGameForReader(frozen.record,{...game,status:"post",status_state:"final",home_score:80,away_score:85});
 assert.equal(rendered.projected.home,candidate.score.home);assert.deepEqual(rendered.markets,frozen.record.memberGame.markets,"reader result overlay cannot reinterpret the frozen score or grade");
 const tracked:Array<Record<string,unknown>>=[];
 const trackingDb={from:(table:string)=>table==="games"?{select:()=>{const q={eq:()=>q,maybeSingle:async()=>({data:{id:44,external_id:777,game_date:start,slate_date:"2026-11-02"},error:null})};return q;}}:{select:()=>{const q={eq:()=>q,then:(resolve:(r:unknown)=>unknown)=>resolve({data:tracked,error:null})};return q;},insert:async(row:Record<string,unknown>)=>{tracked.push(structuredClone(row));return {error:null};}}} as unknown as Parameters<typeof writeLockedCbbTracking>[1];
 assert.equal(await writeLockedCbbTracking(frozen.record,trackingDb),3);
 assert.ok(tracked.every(row=>row.model_version===CBB_MARKET_BEHAVIOR_MODEL_RELEASE&&row.calibration_version===CBB_MARKET_BEHAVIOR_GRADE_RELEASE));
 const trackingBytes=JSON.stringify(tracked);assert.equal(await writeLockedCbbTracking(frozen.record,trackingDb),0);assert.equal(JSON.stringify(tracked),trackingBytes);
 assert.equal(tracked.find(row=>row.market==="spread")?.line_value,-2.5);
 const corrupt=structuredClone(frozen.record);corrupt.snapshot.board.score.home+=1;
 await assert.rejects(writeLockedCbbTracking(corrupt,trackingDb),/receipt differs/);
 const alignedSources=["pinnacle","circa"].map((sportsbook,i)=>({...targets[1],sportsbook,line:i===0?-20.5:20.5,firstPrice:-140,secondPrice:120}));
 const alignedAnchors=alignedSources.map((q,i)=>({...q,line:-14.5-i,firstPrice:-110,secondPrice:-110,providerObservedAt:"2026-11-02T15:00:00Z",fetchedAt:"2026-11-02T15:01:00Z",requestedAt:undefined}));
 const alignedRead=readCbbMarketBehavior({independent,independentInputKey:"aligned-magnitude-fixture",startsAt:start,targets,currentQuotes:alignedSources,
  anchors:{release:CBB_MARKET_BEHAVIOR_RECEIPT_RELEASE,gameId:777,startsAt:start,independentRelease:CBB_CURRENT_SCORE_RELEASE,
   independentInputKey:"aligned-magnitude-fixture",capturedAt:"2026-11-02T15:01:00Z",quotes:alignedAnchors}});
 assert.equal(alignedRead.receipt.margin.status,"unresolved");assert.equal(alignedRead.receipt.margin.directionalEvidence,"opposed");
 const alignedBoard=buildCbbProvisionalBoard(alignedRead.forecast,[...targets,...alignedSources],{marketBehavior:alignedRead.receipt});
 const alignedRow=alignedBoard.rows.find(row=>row.market==="spread")!;
 assert.equal(alignedRow.referenceState,"mixed");assert.equal(alignedRow.pathResistance,true);assert.equal(alignedRow.grade,"Watchlist");
 assert.equal(alignedRead.forecast.margin,independent.margin);assert.equal(alignedRead.forecast.homeWinProbability,independent.homeWinProbability);
 const alignedSnapshot={...initial.record.snapshot,board:alignedBoard};
 const alignedDto=adaptCbbProvisionalGame({game,snapshot:alignedSnapshot,homeLogo:null,awayLogo:null,now:at});
 assert.equal(alignedDto.markets.first_inning.guidedWatchOut,"Market evidence is incomplete or unresolved for this price.");
 assert.notEqual(alignedDto.markets.first_inning.sharpStatus,"confirm");
 const oldSemanticsSnapshot=structuredClone(alignedSnapshot);oldSemanticsSnapshot.board.gradeRelease=CBB_OLDER_MARKET_BEHAVIOR_GRADE_RELEASE as typeof oldSemanticsSnapshot.board.gradeRelease;
 const oldSemanticsDto=adaptCbbProvisionalGame({game,snapshot:oldSemanticsSnapshot,homeLogo:null,awayLogo:null,now:at});
 assert.equal(oldSemanticsDto.markets.first_inning.guidedWatchOut,"Professional books disagree with this side.","legacy R5 adapter keeps its original wording when explicitly invoked");
 const {guidedWatchOut:newExplanation,...newMarket}=alignedDto.markets.first_inning;
 const {guidedWatchOut:oldExplanation,...oldMarket}=oldSemanticsDto.markets.first_inning;
 void newExplanation;void oldExplanation;
 assert.deepEqual(newMarket,oldMarket,"distinguishing unresolved magnitude changes only the explanation, never the stored pick/probability/grade/price");
 // Synthetic legacy R5 wire payload: the pre-R6 board/reason/receipt schema
 // must survive exactly, without adding new direction/checkpoint fields or
 // reinterpreting its stored market claims through the current adapter.
 const legacyR5=structuredClone(frozen.record);
 legacyR5.snapshot.board.release="cbb_candidate_2026_11_02_r9_resolved_price_grade";
 legacyR5.snapshot.board.gradeRelease=CBB_OLDER_MARKET_BEHAVIOR_GRADE_RELEASE;
 delete legacyR5.snapshot.board.marketContext.retainedLevelInput;
 const legacyRead=legacyR5.snapshot.board.marketContext.verifiedMarketRead!;
 Object.assign(legacyRead,{release:"cbb_market_behavior_2026_11_02_r2_received_source_path"});
 legacyRead.anchors.release="cbb_market_behavior_2026_11_02_r2_received_source_path";
 for(const axis of [legacyRead.margin,legacyRead.total]){
  delete (axis as Partial<typeof axis>).sourceDirection;
  delete (axis as Partial<typeof axis>).directionalEvidence;
 }
 for(const row of legacyR5.snapshot.board.rows)if(row.grade==="Watchlist")row.reason="edge_below_actionable_reserve";
 legacyR5.memberGame.markets.first_inning.whyLine="edge below actionable reserve";
 legacyR5.memberGame.markets.first_inning.guidedWatchOut="Preserved original R5 explanation.";
 const legacyBytes=JSON.stringify(legacyR5),writeCountBeforeLegacy=writes;
 assert.equal(cbbLockedGradeRelease(legacyR5.snapshot.board),CBB_OLDER_MARKET_BEHAVIOR_GRADE_RELEASE);
 assert.notEqual(CBB_MARKET_BEHAVIOR_GRADE_RELEASE,CBB_PREVIOUS_MARKET_BEHAVIOR_GRADE_RELEASE);
 assert.notEqual(CBB_PREVIOUS_MARKET_BEHAVIOR_GRADE_RELEASE,CBB_OLDER_MARKET_BEHAVIOR_GRADE_RELEASE);
 assert.equal(cbbLockedGradeRelease({...legacyR5.snapshot.board,gradeRelease:CBB_PREVIOUS_MARKET_BEHAVIOR_GRADE_RELEASE}),CBB_PREVIOUS_MARKET_BEHAVIOR_GRADE_RELEASE,
  "an existing R6 lock retains its grade release");
 stored=legacyR5;
 const newR6=structuredClone(candidate);newR6.score.home=999;
 for(const row of newR6.rows){row.reason="new_r6_reason";if(row.probability!==null)row.probability=.01;}
 const legacyWrite=await writeCbbMemberGame({game,candidate:newR6,homeLogo:null,awayLogo:null,now:"2026-11-02T19:05:00Z"},db);
 assert.equal(legacyWrite.written,false);assert.equal(writes,writeCountBeforeLegacy);
 assert.equal(legacyWrite.record,legacyR5);assert.equal(JSON.stringify(stored),legacyBytes,"R6 writer returns a legacy R5 lock before considering even a changed/post-start candidate");
 assert.equal(readCbbProvisionalSnapshot({locked:legacyR5.snapshot,unlocked:{...initial.record.snapshot,board:newR6}}),legacyR5.snapshot,"locked R5 board has precedence over a newer unlocked R6 board");
 const legacyRendered=cbbMemberGameForReader(legacyR5,{...game,status:"post",status_state:"final",home_score:80,away_score:85});
 const {result:legacyResult,...legacyReaderFields}=legacyRendered;
 const {result:storedLegacyResult,...storedLegacyFields}=legacyR5.memberGame;
 void legacyResult;void storedLegacyResult;
 assert.deepEqual(legacyReaderFields,storedLegacyFields,"only official result may accrue; every stored R5 DTO projection, probability, pick, price, grade and evidence field wins");
 assert.equal(legacyRendered.markets.first_inning.whyLine,"edge below actionable reserve","new explanatory reasons cannot rewrite an earlier public explanation");
 assert.equal(JSON.stringify(legacyR5),legacyBytes,"reader result overlay does not mutate the original R5 payload");
 const legacyTracked:Array<Record<string,unknown>>=[];
 const legacyTrackingDb={from:(table:string)=>table==="games"?{select:()=>{const q={eq:()=>q,maybeSingle:async()=>({data:{id:44,external_id:777,game_date:start,slate_date:"2026-11-02"},error:null})};return q;}}:{
  select:()=>{const q={eq:()=>q,then:(resolve:(r:unknown)=>unknown)=>resolve({data:legacyTracked,error:null})};return q;},
  insert:async(row:Record<string,unknown>)=>{legacyTracked.push(structuredClone(row));return {error:null};},
 }} as unknown as Parameters<typeof writeLockedCbbTracking>[1];
 assert.equal(await writeLockedCbbTracking(legacyR5,legacyTrackingDb),3,"a missing mirror can still record the actual R5 lock using its original grade lineage");
 assert.ok(legacyTracked.every(row=>row.model_version===CBB_MARKET_BEHAVIOR_MODEL_RELEASE&&row.calibration_version===CBB_OLDER_MARKET_BEHAVIOR_GRADE_RELEASE));
 for(const trackedRow of legacyTracked){
  const row=legacyR5.snapshot.board.rows.find(row=>row.market===trackedRow.market)!;
  assert.equal(trackedRow.model_probability,row.probability);assert.equal(trackedRow.expected_value,row.expectedValue);assert.equal(trackedRow.odds_american,row.price);
  const receipt=trackedRow.snapshot_json as Record<string,unknown>;
  assert.equal(receipt.gradeRelease,CBB_OLDER_MARKET_BEHAVIOR_GRADE_RELEASE);assert.equal(receipt.boardRelease,legacyR5.snapshot.board.release);
  // Simulate the existing R6 tracking writer's historical JSON; the new writer
  // must not upgrade that audit stamp or any previously stored numeric field.
  receipt.release="cbb_tracking_writer_2026_11_02_r6_received_market_lineage";
 }
 const legacyTrackingBytes=JSON.stringify(legacyTracked);
 assert.equal(await writeLockedCbbTracking(legacyR5,legacyTrackingDb),0);
 assert.equal(JSON.stringify(legacyTracked),legacyTrackingBytes,"existing R5 tracking fields and historical writer stamp stay exact under the R6 grade reader");
 assert.equal(JSON.stringify(legacyR5),legacyBytes,"tracking never normalizes legacy R2 receipts into the new receipt schema");
 const priorPublic=structuredClone(frozen.record);
 priorPublic.snapshot.board.release="cbb_candidate_2026_11_03_r10_explicit_market_evidence";
 priorPublic.snapshot.board.modelRelease=CBB_PREVIOUS_MARKET_BEHAVIOR_MODEL_RELEASE;
 priorPublic.snapshot.board.gradeRelease=CBB_PRIOR_MARKET_BEHAVIOR_GRADE_RELEASE;
 const priorRead=priorPublic.snapshot.board.marketContext.verifiedMarketRead!;
 Object.assign(priorRead,{release:"cbb_market_behavior_2026_11_03_r3_direction_and_magnitude",modelRelease:CBB_PREVIOUS_MARKET_BEHAVIOR_MODEL_RELEASE,
  independentRelease:CBB_CURRENT_SCORE_RELEASE});
 priorRead.anchors.release="cbb_market_behavior_2026_11_03_r3_direction_and_magnitude";
 priorRead.anchors.independentRelease=CBB_CURRENT_SCORE_RELEASE;
 const priorBytes=JSON.stringify(priorPublic),priorWrites=writes;
 stored=priorPublic;
 assert.equal(cbbLockedModelRelease(priorPublic.snapshot.board),CBB_PREVIOUS_MARKET_BEHAVIOR_MODEL_RELEASE);
 assert.equal(cbbLockedGradeRelease(priorPublic.snapshot.board),CBB_PRIOR_MARKET_BEHAVIOR_GRADE_RELEASE);
 const priorWrite=await writeCbbMemberGame({game,candidate:newR6,homeLogo:null,awayLogo:null,now:"2026-11-02T19:06:00Z"},db);
 assert.equal(priorWrite.written,false);assert.equal(writes,priorWrites);
 assert.equal(priorWrite.record,priorPublic);
 assert.equal(readCbbProvisionalSnapshot({locked:priorPublic.snapshot,unlocked:initial.record.snapshot}),priorPublic.snapshot);
 const priorRendered=cbbMemberGameForReader(priorPublic,{...game,status:"post",status_state:"final",home_score:80,away_score:85});
 const {result:priorResult,...priorReaderFields}=priorRendered;
 const {result:storedPriorResult,...storedPriorFields}=priorPublic.memberGame;
 void priorResult;void storedPriorResult;
 assert.deepEqual(priorReaderFields,storedPriorFields,"the latest public R7 lock takes precedence over the new R8 reader");
 const priorTracked:Array<Record<string,unknown>>=[];
 const priorTrackingDb={from:(table:string)=>table==="games"?{select:()=>{const q={eq:()=>q,maybeSingle:async()=>({data:{id:44,external_id:777,game_date:start,slate_date:"2026-11-02"},error:null})};return q;}}:{
  select:()=>{const q={eq:()=>q,then:(resolve:(r:unknown)=>unknown)=>resolve({data:priorTracked,error:null})};return q;},
  insert:async(row:Record<string,unknown>)=>{priorTracked.push(structuredClone(row));return {error:null};},
 }} as unknown as Parameters<typeof writeLockedCbbTracking>[1];
 assert.equal(await writeLockedCbbTracking(priorPublic,priorTrackingDb),3);
 assert.ok(priorTracked.every(row=>row.model_version===CBB_PREVIOUS_MARKET_BEHAVIOR_MODEL_RELEASE&&row.calibration_version===CBB_PRIOR_MARKET_BEHAVIOR_GRADE_RELEASE));
 assert.equal(JSON.stringify(priorPublic),priorBytes,"old R7 lock remains byte exact after writer, reader and tracking");
 const episodePublic=structuredClone(frozen.record);
 Object.assign(episodePublic.snapshot.board,{release:"cbb_candidate_2026_11_03_r13_source_episode_decisions",
  modelRelease:CBB_EPISODE_MARKET_BEHAVIOR_MODEL_RELEASE,gradeRelease:CBB_EPISODE_MARKET_BEHAVIOR_GRADE_RELEASE});
 const episodeReceipt=episodePublic.snapshot.board.marketContext.verifiedMarketRead!;
 Object.assign(episodeReceipt,{release:CBB_EPISODE_MARKET_BEHAVIOR_RECEIPT_RELEASE,modelRelease:CBB_EPISODE_MARKET_BEHAVIOR_MODEL_RELEASE});
 episodeReceipt.anchors.release=CBB_EPISODE_MARKET_BEHAVIOR_RECEIPT_RELEASE;
 Object.assign(episodeReceipt.forecastIdentity,{release:CBB_EPISODE_MARKET_BEHAVIOR_MODEL_RELEASE});
 const episodeBytes=JSON.stringify(episodePublic);stored=episodePublic;
 assert.equal((await writeCbbMemberGame({game,candidate:newR6,homeLogo:null,awayLogo:null,now:"2026-11-02T19:07:00Z"},db)).written,false);
 assert.equal(readCbbProvisionalSnapshot({locked:episodePublic.snapshot,unlocked:initial.record.snapshot}),episodePublic.snapshot);
 assert.deepEqual(cbbMemberGameForReader(episodePublic,game),episodePublic.memberGame);
 priorTracked.length=0;
 assert.equal(await writeLockedCbbTracking(episodePublic,priorTrackingDb),3);
 assert.ok(priorTracked.every(row=>row.model_version===CBB_EPISODE_MARKET_BEHAVIOR_MODEL_RELEASE&&
  row.calibration_version===CBB_EPISODE_MARKET_BEHAVIOR_GRADE_RELEASE&&row.model_used==="cbb_r10_observed_episode_authority"));
 assert.equal(await writeLockedCbbTracking(episodePublic,priorTrackingDb),0);
 assert.equal(JSON.stringify(episodePublic),episodeBytes,"R10/R12 lock survives new writer, reader and tracking exactly");
 const oldEpisodeAnchors=structuredClone(read.receipt.anchors);oldEpisodeAnchors.release=CBB_EPISODE_MARKET_BEHAVIOR_RECEIPT_RELEASE;
 const migrated=readCbbMarketBehavior({independent,independentInputKey:"frozen-source",startsAt:start,targets,currentQuotes:refs,anchors:oldEpisodeAnchors});
 assert.deepEqual(migrated.receipt.anchors.quotes,oldEpisodeAnchors.quotes,"unlocked R6 receipt anchors are reused without inventing a new opening");
 const retailPublic=structuredClone(episodePublic);
 Object.assign(retailPublic.snapshot.board,{release:"cbb_candidate_2026_11_03_r14_retail_response_receipts",modelRelease:CBB_RETAIL_MARKET_BEHAVIOR_MODEL_RELEASE,gradeRelease:CBB_RETAIL_MARKET_BEHAVIOR_GRADE_RELEASE});
 const retailReceipt=retailPublic.snapshot.board.marketContext.verifiedMarketRead!;
 Object.assign(retailReceipt,{release:CBB_RETAIL_MARKET_BEHAVIOR_RECEIPT_RELEASE,modelRelease:CBB_RETAIL_MARKET_BEHAVIOR_MODEL_RELEASE,independentRelease:CBB_PREVIOUS_CURRENT_SCORE_RELEASE});
 Object.assign(retailReceipt.forecastIdentity,{release:CBB_RETAIL_MARKET_BEHAVIOR_MODEL_RELEASE});
 Object.assign(retailReceipt.anchors,{release:CBB_RETAIL_MARKET_BEHAVIOR_RECEIPT_RELEASE,independentRelease:CBB_PREVIOUS_CURRENT_SCORE_RELEASE});
 const retailBytes=JSON.stringify(retailPublic);stored=retailPublic;
 assert.equal((await writeCbbMemberGame({game,candidate:newR6,homeLogo:null,awayLogo:null,now:"2026-11-02T19:08:00Z"},db)).written,false);
 assert.equal(readCbbProvisionalSnapshot({locked:retailPublic.snapshot,unlocked:initial.record.snapshot}),retailPublic.snapshot);
 assert.deepEqual(cbbMemberGameForReader(retailPublic,game),retailPublic.memberGame);
 priorTracked.length=0;assert.equal(await writeLockedCbbTracking(retailPublic,priorTrackingDb),3);
 assert.ok(priorTracked.every(row=>row.model_version===CBB_RETAIL_MARKET_BEHAVIOR_MODEL_RELEASE&&row.calibration_version===CBB_RETAIL_MARKET_BEHAVIOR_GRADE_RELEASE&&row.model_used==="cbb_r11_retail_response_receipts"));
 assert.equal(await writeLockedCbbTracking(retailPublic,priorTrackingDb),0);assert.equal(JSON.stringify(retailPublic),retailBytes);
 const alignedPublic=structuredClone(retailPublic);
 Object.assign(alignedPublic.snapshot.board,{release:"cbb_candidate_2026_11_03_r15_aligned_native_reactions",
  modelRelease:CBB_ALIGNED_MARKET_BEHAVIOR_MODEL_RELEASE,gradeRelease:CBB_ALIGNED_MARKET_BEHAVIOR_GRADE_RELEASE});
 const alignedReceipt=alignedPublic.snapshot.board.marketContext.verifiedMarketRead!;
 Object.assign(alignedReceipt,{release:CBB_ALIGNED_MARKET_BEHAVIOR_RECEIPT_RELEASE,modelRelease:CBB_ALIGNED_MARKET_BEHAVIOR_MODEL_RELEASE});
 Object.assign(alignedReceipt.forecastIdentity,{release:CBB_ALIGNED_MARKET_BEHAVIOR_MODEL_RELEASE});
 alignedReceipt.anchors.release=CBB_ALIGNED_MARKET_BEHAVIOR_RECEIPT_RELEASE;
 delete alignedReceipt.jointMarginDecision;delete alignedReceipt.originalIndependentUncertainty;
 const alignedBytes=JSON.stringify(alignedPublic),alignedWrites=writes;stored=alignedPublic;
 assert.equal((await writeCbbMemberGame({game,candidate:newR6,homeLogo:null,awayLogo:null,now:"2026-11-02T19:09:00Z"},db)).written,false);
 assert.equal(writes,alignedWrites);
 assert.equal(readCbbProvisionalSnapshot({locked:alignedPublic.snapshot,unlocked:initial.record.snapshot}),alignedPublic.snapshot);
 assert.deepEqual(cbbMemberGameForReader(alignedPublic,game),alignedPublic.memberGame,"the R12 stored member DTO takes precedence over the new joint-law semantics");
 priorTracked.length=0;assert.equal(await writeLockedCbbTracking(alignedPublic,priorTrackingDb),3);
 assert.ok(priorTracked.every(row=>row.model_version===CBB_ALIGNED_MARKET_BEHAVIOR_MODEL_RELEASE&&
  row.calibration_version===CBB_ALIGNED_MARKET_BEHAVIOR_GRADE_RELEASE&&row.model_used==="cbb_r12_aligned_native_reactions"));
 assert.equal(await writeLockedCbbTracking(alignedPublic,priorTrackingDb),0);
 assert.equal(JSON.stringify(alignedPublic),alignedBytes,"R12 score, probability, pick, grade, price, evidence and old uncertainty remain byte exact without new joint-law fields");
 const jointPublic=structuredClone(frozen.record);
 Object.assign(jointPublic.snapshot.board,{release:"cbb_candidate_2026_11_03_r16_joint_native_market_decision",
  modelRelease:CBB_JOINT_MARKET_BEHAVIOR_MODEL_RELEASE,gradeRelease:CBB_JOINT_MARKET_BEHAVIOR_GRADE_RELEASE});
 const jointReceipt=jointPublic.snapshot.board.marketContext.verifiedMarketRead!;
 Object.assign(jointReceipt,{release:CBB_JOINT_MARKET_BEHAVIOR_RECEIPT_RELEASE,modelRelease:CBB_JOINT_MARKET_BEHAVIOR_MODEL_RELEASE});
 Object.assign(jointReceipt.forecastIdentity,{release:CBB_JOINT_MARKET_BEHAVIOR_MODEL_RELEASE});
 jointReceipt.anchors.release=CBB_JOINT_MARKET_BEHAVIOR_RECEIPT_RELEASE;
 const jointBytes=JSON.stringify(jointPublic),jointWrites=writes;stored=jointPublic;
 assert.equal((await writeCbbMemberGame({game,candidate:newR6,homeLogo:null,awayLogo:null,now:"2026-11-02T19:09:30Z"},db)).written,false);
 assert.equal(writes,jointWrites);
 assert.equal(readCbbProvisionalSnapshot({locked:jointPublic.snapshot,unlocked:initial.record.snapshot}),jointPublic.snapshot);
 assert.deepEqual(cbbMemberGameForReader(jointPublic,game),jointPublic.memberGame,"new provider identities never reinterpret an R13 locked DTO");
 priorTracked.length=0;assert.equal(await writeLockedCbbTracking(jointPublic,priorTrackingDb),3);
 assert.ok(priorTracked.every(row=>row.model_version===CBB_JOINT_MARKET_BEHAVIOR_MODEL_RELEASE&&row.calibration_version===CBB_JOINT_MARKET_BEHAVIOR_GRADE_RELEASE&&row.model_used==="cbb_r13_joint_native_market_decision"));
 assert.equal(await writeLockedCbbTracking(jointPublic,priorTrackingDb),0);
 assert.equal(JSON.stringify(jointPublic),jointBytes,"R13/R15/R9 stored scores, probabilities, prices, grades, source evidence and uncertainty remain exact");
 const sourceAliasPublic=structuredClone(frozen.record);
 Object.assign(sourceAliasPublic.snapshot.board,{release:"cbb_candidate_2026_11_04_r17_current_board_source_aliases",
  modelRelease:CBB_SOURCE_ALIAS_MARKET_BEHAVIOR_MODEL_RELEASE,gradeRelease:CBB_SOURCE_ALIAS_MARKET_BEHAVIOR_GRADE_RELEASE});
 const sourceAliasReceipt=sourceAliasPublic.snapshot.board.marketContext.verifiedMarketRead!;
 Object.assign(sourceAliasReceipt,{release:CBB_SOURCE_ALIAS_MARKET_BEHAVIOR_RECEIPT_RELEASE,modelRelease:CBB_SOURCE_ALIAS_MARKET_BEHAVIOR_MODEL_RELEASE});
 Object.assign(sourceAliasReceipt.forecastIdentity,{release:CBB_SOURCE_ALIAS_MARKET_BEHAVIOR_MODEL_RELEASE});
 sourceAliasReceipt.anchors.release=CBB_SOURCE_ALIAS_MARKET_BEHAVIOR_RECEIPT_RELEASE;
 delete sourceAliasReceipt.jointMarginDecision?.relativeInterpretation;
 sourceAliasReceipt.pathTape.release="cbb_market_behavior_path_2026_11_03_r4_identical_preflow_state";
 const sourceAliasBytes=JSON.stringify(sourceAliasPublic),sourceAliasWrites=writes;stored=sourceAliasPublic;
 assert.equal((await writeCbbMemberGame({game,candidate:newR6,homeLogo:null,awayLogo:null,now:"2026-11-02T19:09:40Z"},db)).written,false);
 assert.equal(writes,sourceAliasWrites);
 assert.equal(readCbbProvisionalSnapshot({locked:sourceAliasPublic.snapshot,unlocked:initial.record.snapshot}),sourceAliasPublic.snapshot);
 assert.deepEqual(cbbMemberGameForReader(sourceAliasPublic,game),sourceAliasPublic.memberGame,"R14/R16/R10 stored DTO wins over new source-law and response semantics");
 priorTracked.length=0;assert.equal(await writeLockedCbbTracking(sourceAliasPublic,priorTrackingDb),3);
 assert.ok(priorTracked.every(row=>row.model_version===CBB_SOURCE_ALIAS_MARKET_BEHAVIOR_MODEL_RELEASE&&row.calibration_version===CBB_SOURCE_ALIAS_MARKET_BEHAVIOR_GRADE_RELEASE&&row.model_used==="cbb_r14_current_board_source_aliases"));
 assert.equal(await writeLockedCbbTracking(sourceAliasPublic,priorTrackingDb),0);
 assert.equal(JSON.stringify(sourceAliasPublic),sourceAliasBytes,"R14 score, probabilities, prices, grades, source clocks and evidence remain byte exact");
 const sourceAliasMigrated=readCbbMarketBehavior({independent,independentInputKey:"frozen-source",startsAt:start,targets,currentQuotes:refs,
  anchors:sourceAliasReceipt.anchors,previousPath:sourceAliasReceipt.pathTape});
 assert.deepEqual(sourceAliasMigrated.receipt.anchors.quotes,sourceAliasReceipt.anchors.quotes,"R10 actual anchors survive the response-frontier release");
 assert.ok(sourceAliasMigrated.receipt.pathTape.streams.length>=sourceAliasReceipt.pathTape.streams.length,"R4 prior path history remains compatible without a new opening");
 // R15/R17/R11 was the actual immediate predecessor. It did not store the
 // new contextual handoff interpretation; never synthesize that field on it.
 const continuityPublic=structuredClone(frozen.record);
 Object.assign(continuityPublic.snapshot.board,{release:"cbb_candidate_2026_11_04_r18_response_frontier_law_support",
  modelRelease:CBB_CONTINUITY_MARKET_BEHAVIOR_MODEL_RELEASE,gradeRelease:CBB_CONTINUITY_MARKET_BEHAVIOR_GRADE_RELEASE});
 const continuityReceipt=continuityPublic.snapshot.board.marketContext.verifiedMarketRead!;
 Object.assign(continuityReceipt,{release:CBB_CONTINUITY_MARKET_BEHAVIOR_RECEIPT_RELEASE,modelRelease:CBB_CONTINUITY_MARKET_BEHAVIOR_MODEL_RELEASE});
 Object.assign(continuityReceipt.forecastIdentity,{release:CBB_CONTINUITY_MARKET_BEHAVIOR_MODEL_RELEASE});
 continuityReceipt.anchors.release=CBB_CONTINUITY_MARKET_BEHAVIOR_RECEIPT_RELEASE;
 delete continuityReceipt.jointMarginDecision?.relativeInterpretation;
 assert.ok(continuityReceipt.jointMarginDecision);
 assert.equal(Object.hasOwn(continuityReceipt.jointMarginDecision,"relativeInterpretation"),false);
 // The old R15 payload actually classified negative exact-price value as
 // No Play. Freeze that historical classification before invoking R19.
 const historicalNoPlay=continuityPublic.snapshot.board.rows.find(row=>row.market==="spread")!;
 assert.ok(historicalNoPlay.expectedValue!<0);
 historicalNoPlay.grade="No Play";historicalNoPlay.reason="non_positive_exact_price_value";
 const historicalNoPlayDto=continuityPublic.memberGame.markets.first_inning;
 historicalNoPlayDto.grade=null;historicalNoPlayDto.verdict={key:"no_play",label:"No Play"};
 historicalNoPlayDto.whyLine="non positive exact price value";
 historicalNoPlayDto.recommendationConfidence=historicalNoPlay.probability!*100;
 const continuityBytes=JSON.stringify(continuityPublic),continuityWrites=writes;stored=continuityPublic;
 assert.equal(cbbLockedModelRelease(continuityPublic.snapshot.board),CBB_CONTINUITY_MARKET_BEHAVIOR_MODEL_RELEASE);
 assert.equal(cbbLockedGradeRelease(continuityPublic.snapshot.board),CBB_CONTINUITY_MARKET_BEHAVIOR_GRADE_RELEASE);
 const continuityWrite=await writeCbbMemberGame({game,candidate:newR6,homeLogo:null,awayLogo:null,now:"2026-11-02T19:09:50Z"},db);
 assert.equal(continuityWrite.written,false);assert.equal(continuityWrite.record,continuityPublic);assert.equal(writes,continuityWrites);
 assert.equal(continuityWrite.record.snapshot.board.rows.find(row=>row.market==="spread")!.grade,"No Play");
 assert.equal(readCbbProvisionalSnapshot({locked:continuityPublic.snapshot,unlocked:initial.record.snapshot}),continuityPublic.snapshot);
 assert.deepEqual(cbbMemberGameForReader(continuityPublic,game),continuityPublic.memberGame,
  "stored R15 DTO takes precedence over R16 retained-current-resistance semantics");
 assert.equal(cbbMemberGameForReader(continuityPublic,game).markets.first_inning.verdict.key,"no_play",
  "R19 informational Watchlist semantics never promote an existing R15 No Play");
 const continuityResult=cbbMemberGameForReader(continuityPublic,{...game,status:"post",status_state:"final",home_score:80,away_score:85});
 const {result:continuityOfficialResult,...continuityReaderFields}=continuityResult;
 const {result:continuityStoredResult,...continuityStoredFields}=continuityPublic.memberGame;
 void continuityOfficialResult;void continuityStoredResult;
 assert.deepEqual(continuityReaderFields,continuityStoredFields,"only the official result may accrue to the R15 stored DTO");
 priorTracked.length=0;assert.equal(await writeLockedCbbTracking(continuityPublic,priorTrackingDb),3);
 assert.ok(priorTracked.every(row=>row.model_version===CBB_CONTINUITY_MARKET_BEHAVIOR_MODEL_RELEASE&&
  row.calibration_version===CBB_CONTINUITY_MARKET_BEHAVIOR_GRADE_RELEASE&&row.model_used==="cbb_r15_response_frontier_law_support"));
 assert.equal(priorTracked.find(row=>row.market==="spread")!.play_grade,"no_play");
 for(const trackedRow of priorTracked){
  const row=continuityPublic.snapshot.board.rows.find(row=>row.market===trackedRow.market)!;
  assert.equal(trackedRow.model_probability,row.probability);assert.equal(trackedRow.expected_value,row.expectedValue);assert.equal(trackedRow.odds_american,row.price);
  const receipt=trackedRow.snapshot_json as Record<string,unknown>;
  assert.equal(receipt.modelRelease,CBB_CONTINUITY_MARKET_BEHAVIOR_MODEL_RELEASE);
  assert.equal(receipt.gradeRelease,CBB_CONTINUITY_MARKET_BEHAVIOR_GRADE_RELEASE);
  assert.equal(receipt.boardRelease,continuityPublic.snapshot.board.release);
  receipt.release="cbb_tracking_writer_2026_11_04_r16_response_frontier_law_support";
 }
 const continuityTrackingBytes=JSON.stringify(priorTracked);
 assert.equal(await writeLockedCbbTracking(continuityPublic,priorTrackingDb),0);
 assert.equal(JSON.stringify(priorTracked),continuityTrackingBytes,"existing R15 tracking identity and original writer stamp cannot be relabeled");
 assert.equal(JSON.stringify(continuityPublic),continuityBytes,"R15/R17/R11 lock stays byte exact through writer, reader and tracking");
 const continuityAnchorsBytes=JSON.stringify(continuityReceipt.anchors),continuityPathBytes=JSON.stringify(continuityReceipt.pathTape);
 const continuityMigrated=readCbbMarketBehavior({independent,independentInputKey:"frozen-source",startsAt:start,targets,currentQuotes:refs,
  anchors:continuityReceipt.anchors,previousPath:continuityReceipt.pathTape});
 assert.deepEqual(continuityMigrated.receipt.anchors.quotes,continuityReceipt.anchors.quotes,"R11 exact native anchors remain reusable on an unlocked R16 refresh");
 assert.equal(continuityMigrated.receipt.anchors.capturedAt,continuityReceipt.anchors.capturedAt);
 assert.equal(continuityMigrated.receipt.anchors.independentInputKey,continuityReceipt.anchors.independentInputKey);
 assert.equal(continuityMigrated.receipt.anchors.independentRelease,continuityReceipt.anchors.independentRelease);
 assert.equal(JSON.stringify(continuityReceipt.anchors),continuityAnchorsBytes);assert.equal(JSON.stringify(continuityReceipt.pathTape),continuityPathBytes);
 assert.equal(JSON.stringify(continuityPublic),continuityBytes,"unlocked anchor reuse never mutates the source locked payload");
 // Grade-only R20 must retain model R16 / receipt R12 identity and every
 // already-stored R19 classification, including the steep positive ML Watch.
 const informationalPublic=structuredClone(frozen.record);
 Object.assign(informationalPublic.snapshot.board,{release:"cbb_candidate_2026_11_04_r20_informational_watchlist",
  gradeRelease:CBB_INFORMATIONAL_WATCHLIST_GRADE_RELEASE});
 const informationalNoPlay=structuredClone(informationalPublic);
 informationalNoPlay.snapshot.board.rows.find(row=>row.market==="spread")!.grade="No Play";
 informationalNoPlay.memberGame.markets.first_inning.grade=null;
 informationalNoPlay.memberGame.markets.first_inning.verdict={key:"no_play",label:"No Play"};
 const priorInformationalDto=adaptCbbProvisionalGame({game,snapshot:{...initial.record.snapshot,board:informationalPublic.snapshot.board},homeLogo:null,awayLogo:null,now:at});
 assert.equal(priorInformationalDto.markets.first_inning.recommendationConfidence,null);
 assert.ok(priorInformationalDto.markets.first_inning.reviewFlags.includes("informational_non_actionable_price"),"R19 retains informational Watch flags after the R20 bump");
 const priorReasonDto=adaptCbbProvisionalGame({game,snapshot:{...alignedSnapshot,board:{...alignedBoard,gradeRelease:CBB_INFORMATIONAL_WATCHLIST_GRADE_RELEASE}},homeLogo:null,awayLogo:null,now:at});
 assert.equal(priorReasonDto.markets.first_inning.guidedWatchOut,"Market evidence is incomplete or unresolved for this price.","R19 retains its precise explanation contract");
 // Actual Charlotte numerical contract from the saved 21:02 board; only
 // fixture identity/time is transplanted into this fixed unit-test fixture.
 const charlotteIndependent:CbbForecast={...independent,homeScore:80.46742949297743,awayScore:63.93150185141175,
  margin:16.535927641565685,total:144.39893134438918,homeWinProbability:.9231859526730855,
  uncertainty:{games:11383,totalSd:16.993742849108834,marginSd:11.882808501656784,totalCorrection:.822132324525501,
   fitThroughSeason:2024,marginCorrection:-.13713535132332144,marginTotalCorrelation:.025514787619637783}};
 const charlotteTargets:CbbQuote[]=[{...base,market:"moneyline",line:null,firstPrice:-850,secondPrice:570},
  {...base,market:"spread",line:-11.5,firstPrice:-115,secondPrice:-105},{...base,market:"total",line:151.5,firstPrice:-110,secondPrice:-110}];
 const charlotteRead=readCbbMarketBehavior({independent:charlotteIndependent,independentInputKey:"actual-charlotte-contract",startsAt:start,targets:charlotteTargets,currentQuotes:[],anchors:null});
 const charlotteBoard=buildCbbProvisionalBoard(charlotteRead.forecast,charlotteTargets,{marketBehavior:charlotteRead.receipt});
 const charlotteMl=charlotteBoard.rows.find(row=>row.market==="moneyline")!;
 assert.equal(charlotteMl.grade,"Lean","the new complete positive-value steep ML is eligible on the current policy");
 assert.ok(Math.abs(charlotteMl.expectedValue!-.03179606475227198)<1e-12);
 const charlotteLegacyBoard=structuredClone(charlotteBoard);
 Object.assign(charlotteLegacyBoard,{release:"cbb_candidate_2026_11_04_r20_informational_watchlist",gradeRelease:CBB_INFORMATIONAL_WATCHLIST_GRADE_RELEASE});
 const legacyCharlotteMl=charlotteLegacyBoard.rows.find(row=>row.market==="moneyline")!;
 legacyCharlotteMl.grade="Watchlist";legacyCharlotteMl.reason="price_too_steep_for_actionable";
 stored=null;
 await writeCbbMemberGame({game,candidate:charlotteLegacyBoard,homeLogo:null,awayLogo:null,now:at},db);
 const charlotteFrozen=(await writeCbbMemberGame({game,candidate:null,homeLogo:null,awayLogo:null,now:lock},db)).record;
 assert.equal(charlotteFrozen.memberGame.markets.moneyline.verdict.key,"watchlist");
 for(const [name,oldRecord] of [["stored No Play",informationalNoPlay],["negative-EV Watch",informationalPublic],["positive Charlotte ML Watch",charlotteFrozen]] as const){
  const oldBytes=JSON.stringify(oldRecord),oldWrites:number=writes;stored=oldRecord;
  assert.equal(cbbLockedModelRelease(oldRecord.snapshot.board),CBB_MARKET_BEHAVIOR_MODEL_RELEASE);
  assert.equal(cbbLockedGradeRelease(oldRecord.snapshot.board),CBB_INFORMATIONAL_WATCHLIST_GRADE_RELEASE);
  assert.equal(oldRecord.snapshot.board.marketContext.verifiedMarketRead!.release,CBB_MARKET_BEHAVIOR_RECEIPT_RELEASE);
  assert.equal((await writeCbbMemberGame({game,candidate:charlotteBoard,homeLogo:null,awayLogo:null,now:"2026-11-02T19:10:00Z"},db)).written,false);
  assert.equal(writes,oldWrites);
  assert.equal(readCbbProvisionalSnapshot({locked:oldRecord.snapshot,unlocked:initial.record.snapshot}),oldRecord.snapshot);
  assert.deepEqual(cbbMemberGameForReader(oldRecord,game),oldRecord.memberGame,`${name}: original R19 DTO wins over R20 eligibility`);
  priorTracked.length=0;assert.equal(await writeLockedCbbTracking(oldRecord,priorTrackingDb),3);
  for(const trackedRow of priorTracked){
   const row=oldRecord.snapshot.board.rows.find(row=>row.market===trackedRow.market)!;
   assert.equal(trackedRow.model_version,CBB_MARKET_BEHAVIOR_MODEL_RELEASE);
   assert.equal(trackedRow.calibration_version,CBB_INFORMATIONAL_WATCHLIST_GRADE_RELEASE);
   assert.equal(trackedRow.model_used,"cbb_r16_contextual_authority_handoff");
   assert.equal(trackedRow.model_probability,row.probability);assert.equal(trackedRow.expected_value,row.expectedValue);assert.equal(trackedRow.odds_american,row.price);
   assert.equal(trackedRow.play_grade,row.grade==="No Play"?"no_play":row.grade==="Watchlist"?"watchlist":row.grade==="Lean"?"lean":"best_angle");
   (trackedRow.snapshot_json as Record<string,unknown>).release="cbb_tracking_writer_2026_11_04_r18_informational_watchlist";
  }
  const oldTrackingBytes=JSON.stringify(priorTracked);
  assert.equal(await writeLockedCbbTracking(oldRecord,priorTrackingDb),0);
  assert.equal(JSON.stringify(priorTracked),oldTrackingBytes,`${name}: original tracking stamp and grades stay exact`);
  assert.equal(JSON.stringify(oldRecord),oldBytes,`${name}: R19 lock remains byte exact after R20 writer/reader/tracking`);
 }
 const jointMigrated=readCbbMarketBehavior({independent,independentInputKey:"same-alias-input",startsAt:start,targets,currentQuotes:refs,anchors:jointReceipt.anchors});
 assert.deepEqual(jointMigrated.receipt.anchors.quotes,jointReceipt.anchors.quotes,"R9 actual anchors survive the source-identity release");
 const migratedPrior=readCbbMarketBehavior({independent,independentInputKey:"new-r4-input",startsAt:start,targets,currentQuotes:refs,anchors:retailReceipt.anchors});
 assert.deepEqual(migratedPrior.receipt.anchors.quotes,retailReceipt.anchors.quotes,"new verified prior cannot erase original R3 market anchors");
 assert.equal(migratedPrior.receipt.anchors.independentRelease,CBB_PREVIOUS_CURRENT_SCORE_RELEASE);
 assert.equal(migratedPrior.receipt.independentRelease,CBB_CURRENT_SCORE_RELEASE);
 assert.equal(migratedPrior.receipt.inputRevisionSinceAnchor,"changed");
 const odds={success:true,data:[{id:"named-exact",sport:"ncaab",home_team:"Cornell",away_team:"Pepperdine",commence_time:start,bookmakers:[]}]};
 const splits={sport:"ncaab",meta:{status:"ok"},data:[{event_id:"ncaab:Pepperdine@Cornell-20261102",home_team:"Cornell",away_team:"Pepperdine",splits:[{book:"circa",as_of:"2026-11-02T15:10:00Z",spread:{home_line:3.5,away_line:-3.5,home_bets_pct:30,away_bets_pct:70,home_handle_pct:10,away_handle_pct:90}}]}]};
 const source=cbbCurrentSplitEvidence(game,odds,splits,at,at),flows=cbbBehaviorFlows(source);
 assert.equal(flows.length,1);assert.equal(flows[0].sourceIdentity,"independent_named_fixture_join");assert.equal(flows[0].sourceEventId,splits.data[0].event_id);assert.equal(flows[0].line,3.5);assert.equal(flows[0].firstMoney,.1);
 assert.equal(cbbBehaviorFlows(cbbCurrentSplitEvidence(game,{success:true,data:[]},splits,at,at)).length,0,"an unverified participant/time event cannot create model pressure from labels");
 const confirmingSplits=structuredClone(splits);
 Object.assign(confirmingSplits.data[0].splits[0].spread,{home_line:-3.5,away_line:3.5,home_bets_pct:40,away_bets_pct:60,home_handle_pct:80,away_handle_pct:20});
 const realNamedFlow=cbbBehaviorFlows(cbbCurrentSplitEvidence(game,odds,confirmingSplits,"2026-11-02T15:11:00Z",at));
 const target={...targets[1],line:-3.5,firstPrice:150,secondPrice:-170},current={...target,sportsbook:"circa",firstPrice:-110,secondPrice:-110},anchor={...current,firstPrice:120,secondPrice:-140,providerObservedAt:"2026-11-02T15:00:00Z",fetchedAt:"2026-11-02T15:01:00Z"};
 const confirmingRead=readCbbMarketBehavior({independent,independentInputKey:"frozen-source",startsAt:start,targets:[target],currentQuotes:[current],flows:realNamedFlow,
   anchors:{release:CBB_MARKET_BEHAVIOR_RECEIPT_RELEASE,gameId:777,startsAt:start,independentRelease:CBB_CURRENT_SCORE_RELEASE,independentInputKey:"frozen-source",capturedAt:"2026-11-02T15:01:00Z",quotes:[anchor]}});
 const confirmingInput={forecast:confirmingRead.forecast,target,references:[current],asOf:at};
 assert.equal(gradeCbbProvisional(confirmingInput).grade,"Watchlist");
 assert.equal(gradeCbbMarketBehavior(confirmingInput,confirmingRead.receipt).grade,"Best Angle","verified Circa confirmation and premium final value can reach the proper tier without a one-tier-per-refresh restriction");
 const qualifiedBoard=buildCbbProvisionalBoard(confirmingRead.forecast,[target,current],{marketBehavior:confirmingRead.receipt});
 const qualifiedDto=adaptCbbProvisionalGame({game,snapshot:{...initial.record.snapshot,board:qualifiedBoard},homeLogo:null,awayLogo:null,now:at,marketQuotes:[target,current]});
 assert.equal(qualifiedDto.markets.first_inning.sharpStatus,"confirm");assert.equal(qualifiedDto.markets.first_inning.grade,"best_signal");
 assert.equal(qualifiedDto.markets.first_inning.writerMovementDirection,"support",
  "genuine observed professional movement toward the final pick must survive the new joint-law explanation without being confused with the model-to-source level difference");
 assert.equal(qualifiedDto.markets.first_inning.readerMovementSource,"writer_market_anchor");
 const priceOnlyTarget={...target,firstPrice:110,secondPrice:-130};
 const priceOnlyRead=readCbbMarketBehavior({independent,independentInputKey:"frozen-source",startsAt:start,targets:[priceOnlyTarget],currentQuotes:[current],
   anchors:{release:CBB_MARKET_BEHAVIOR_RECEIPT_RELEASE,gameId:777,startsAt:start,independentRelease:CBB_CURRENT_SCORE_RELEASE,independentInputKey:"frozen-source",capturedAt:"2026-11-02T15:01:00Z",quotes:[anchor]}});
 const priceBoard=buildCbbProvisionalBoard(priceOnlyRead.forecast,[priceOnlyTarget,current],{marketBehavior:priceOnlyRead.receipt});
 const priceDto=adaptCbbProvisionalGame({game,snapshot:{...initial.record.snapshot,board:priceBoard},homeLogo:null,awayLogo:null,now:at,marketQuotes:[priceOnlyTarget,current]});
 assert.equal(priceDto.markets.first_inning.verdict.key,"lean");assert.equal(priceDto.markets.first_inning.grade,"model_only");
 assert.notEqual(priceDto.markets.first_inning.sharpStatus,"confirm","price-only promotion cannot imply identified sharp flow");
 const history=[{date:"2026-11-02T09:29:59Z"},{date:"2026-11-02T09:30:00Z"},{date:"2026-11-02T09:30:01Z"}] as Parameters<typeof cbbHistoryAtDecision>[0];
 assert.deepEqual(cbbHistoryAtDecision(history,at),history.slice(0,2),"old independent replay uses its own six-hour availability cutoff");
 console.log("PASS CBB joint market lock path: coherent current-source winner correction, exact grade/DTO, T-60 freezing, legacy R5/R10/R11/R12/R15 writer-reader-tracking immutability and genuine native movement labels.");
}
main().catch(e=>{console.error(e);process.exitCode=1;});
