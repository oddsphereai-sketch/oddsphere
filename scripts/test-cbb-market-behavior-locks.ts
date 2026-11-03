import assert from "node:assert/strict";
import {normalCdf} from "../lib/cbb/model";
import {CBB_CURRENT_SCORE_RELEASE} from "../lib/cbb/currentScoreRuntime";
import {readCbbMarketBehavior,gradeCbbMarketBehavior,CBB_MARKET_BEHAVIOR_RECEIPT_RELEASE,CBB_MARKET_BEHAVIOR_MODEL_RELEASE,CBB_MARKET_BEHAVIOR_GRADE_RELEASE,CBB_PREVIOUS_MARKET_BEHAVIOR_GRADE_RELEASE,CBB_LEGACY_MARKET_BEHAVIOR_GRADE_RELEASE} from "../lib/cbb/marketBehaviorCandidate";
import {gradeCbbProvisional} from "../lib/cbb/provisionalGradePolicy";
import {adaptCbbProvisionalGame} from "../lib/services/cbb/adaptCbbProvisionalToDailyEdge";
import {buildCbbProvisionalBoard} from "../lib/cbb/provisionalBoard";
import {writeCbbMemberGame,cbbMemberGameForReader,type CbbStoredMemberGame} from "../lib/services/cbb/cbbMemberGameStore";
import {writeLockedCbbTracking,cbbLockedGradeRelease} from "../lib/services/cbb/cbbTrackingWriter";
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
assert.equal(candidate.score.margin,independent.margin);assert.equal(candidate.rows[0].selection,"first");
assert.equal(read.receipt.winnerArbitration.status,"context_only");
let stored:CbbStoredMemberGame|null=null,writes=0;
const db={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:stored?{payload:stored}:null,error:null})})}),upsert:async(row:{payload:CbbStoredMemberGame})=>{stored=structuredClone(row.payload);writes++;return {error:null};}})} as unknown as Parameters<typeof writeCbbMemberGame>[1];
async function main(){
 const initial=await writeCbbMemberGame({game,candidate,homeLogo:null,awayLogo:null,now:at,marketQuotes:[...targets,...refs]},db);
 assert.equal(initial.record.memberGame.projected.home,candidate.score.home);assert.equal(initial.record.memberGame.markets.moneyline.pick,"COR ML");
 assert.equal(initial.record.memberGame.markets.first_inning.writerMovementDirection,undefined,"current winner arbitration is not recorded market movement");
 assert.ok(!initial.record.memberGame.breakdown?.modelBreakdown?.startsWith("Independent projection"),"final market-conditioned forecast cannot masquerade as independent");
 assert.equal(initial.record.memberGame.markets.first_inning.line,2.5,"static opposition cannot synthesize a side flip");
 assert.equal(initial.record.memberGame.markets.first_inning.grade,"market_watch","static professional opposition remains distinct from model value");
 assert.notEqual(initial.record.memberGame.markets.first_inning.sharpStatus,"confirm");
 assert.notEqual(initial.record.memberGame.markets.first_inning.marketSignal,"market_confirmed");
 assert.equal(initial.record.memberGame.markets.first_inning.guidedWatchOut,"Professional books disagree with this side.","actual opposing reference retains the opposition explanation");
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
 assert.equal(tracked.find(row=>row.market==="spread")?.line_value,2.5);
 const corrupt=structuredClone(frozen.record);corrupt.snapshot.board.score.home+=1;
 await assert.rejects(writeLockedCbbTracking(corrupt,trackingDb),/receipt differs/);
 const alignedSources=["pinnacle","circa"].map(sportsbook=>({...targets[1],sportsbook,firstPrice:-140,secondPrice:120}));
 const alignedAnchors=alignedSources.map((q,i)=>({...q,line:4.5+i,firstPrice:-110,secondPrice:-110,providerObservedAt:"2026-11-02T15:00:00Z",fetchedAt:"2026-11-02T15:01:00Z",requestedAt:undefined}));
 const alignedRead=readCbbMarketBehavior({independent,independentInputKey:"aligned-magnitude-fixture",startsAt:start,targets,currentQuotes:alignedSources,
  anchors:{release:CBB_MARKET_BEHAVIOR_RECEIPT_RELEASE,gameId:777,startsAt:start,independentRelease:CBB_CURRENT_SCORE_RELEASE,
   independentInputKey:"aligned-magnitude-fixture",capturedAt:"2026-11-02T15:01:00Z",quotes:alignedAnchors}});
 assert.equal(alignedRead.receipt.margin.status,"unresolved");assert.equal(alignedRead.receipt.margin.directionalEvidence,"aligned");
 const alignedBoard=buildCbbProvisionalBoard(alignedRead.forecast,[...targets,...alignedSources],{marketBehavior:alignedRead.receipt});
 const alignedRow=alignedBoard.rows.find(row=>row.market==="spread")!;
 assert.equal(alignedRow.referenceState,"agrees");assert.equal(alignedRow.pathResistance,true);assert.equal(alignedRow.grade,"Lean");
 assert.equal(alignedRead.forecast.margin,independent.margin);assert.equal(alignedRead.forecast.homeWinProbability,independent.homeWinProbability);
 const alignedSnapshot={...initial.record.snapshot,board:alignedBoard};
 const alignedDto=adaptCbbProvisionalGame({game,snapshot:alignedSnapshot,homeLogo:null,awayLogo:null,now:at});
 assert.equal(alignedDto.markets.first_inning.guidedWatchOut,"Market evidence is incomplete or unresolved for this price.");
 assert.notEqual(alignedDto.markets.first_inning.sharpStatus,"confirm");
 const r6Snapshot=structuredClone(alignedSnapshot);r6Snapshot.board.gradeRelease=CBB_PREVIOUS_MARKET_BEHAVIOR_GRADE_RELEASE as typeof r6Snapshot.board.gradeRelease;
 const r6Dto=adaptCbbProvisionalGame({game,snapshot:r6Snapshot,homeLogo:null,awayLogo:null,now:at});
 assert.equal(r6Dto.markets.first_inning.guidedWatchOut,alignedDto.markets.first_inning.guidedWatchOut,"R6 precise reasons remain readable after the grade bump");
 const r6Locked=structuredClone(frozen.record);
 r6Locked.snapshot.board.gradeRelease=CBB_PREVIOUS_MARKET_BEHAVIOR_GRADE_RELEASE;
 r6Locked.snapshot.board.release="cbb_candidate_2026_11_03_r10_explicit_market_evidence";
 const r6Bytes=JSON.stringify(r6Locked),writesBeforeR6=writes;
 stored=r6Locked;
 const r6Write=await writeCbbMemberGame({game,candidate,homeLogo:null,awayLogo:null,now:"2026-11-02T18:10:00Z"},db);
 assert.equal(r6Write.written,false);assert.equal(writes,writesBeforeR6);
 assert.equal(JSON.stringify(stored),r6Bytes,"new grade writer preserves an R6 locked payload exactly");
 const r6Rendered=cbbMemberGameForReader(r6Locked,{...game,status:"post",status_state:"final",home_score:80,away_score:85});
 assert.deepEqual(r6Rendered.markets,r6Locked.memberGame.markets,"new grade reader retains R6 locked market fields");
 assert.equal(cbbLockedGradeRelease(r6Locked.snapshot.board),CBB_PREVIOUS_MARKET_BEHAVIOR_GRADE_RELEASE);
 const oldSemanticsSnapshot=structuredClone(alignedSnapshot);oldSemanticsSnapshot.board.gradeRelease=CBB_LEGACY_MARKET_BEHAVIOR_GRADE_RELEASE as typeof oldSemanticsSnapshot.board.gradeRelease;
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
 legacyR5.snapshot.board.gradeRelease=CBB_LEGACY_MARKET_BEHAVIOR_GRADE_RELEASE;
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
 assert.equal(cbbLockedGradeRelease(legacyR5.snapshot.board),CBB_LEGACY_MARKET_BEHAVIOR_GRADE_RELEASE);
 assert.notEqual(CBB_MARKET_BEHAVIOR_GRADE_RELEASE,CBB_LEGACY_MARKET_BEHAVIOR_GRADE_RELEASE);
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
 assert.ok(legacyTracked.every(row=>row.model_version===CBB_MARKET_BEHAVIOR_MODEL_RELEASE&&row.calibration_version===CBB_LEGACY_MARKET_BEHAVIOR_GRADE_RELEASE));
 for(const trackedRow of legacyTracked){
  const row=legacyR5.snapshot.board.rows.find(row=>row.market===trackedRow.market)!;
  assert.equal(trackedRow.model_probability,row.probability);assert.equal(trackedRow.expected_value,row.expectedValue);assert.equal(trackedRow.odds_american,row.price);
  const receipt=trackedRow.snapshot_json as Record<string,unknown>;
  assert.equal(receipt.gradeRelease,CBB_LEGACY_MARKET_BEHAVIOR_GRADE_RELEASE);assert.equal(receipt.boardRelease,legacyR5.snapshot.board.release);
  // Simulate the existing R6 tracking writer's historical JSON; the new writer
  // must not upgrade that audit stamp or any previously stored numeric field.
  receipt.release="cbb_tracking_writer_2026_11_02_r6_received_market_lineage";
 }
 const legacyTrackingBytes=JSON.stringify(legacyTracked);
 assert.equal(await writeLockedCbbTracking(legacyR5,legacyTrackingDb),0);
 assert.equal(JSON.stringify(legacyTracked),legacyTrackingBytes,"existing R5 tracking fields and historical writer stamp stay exact under the R6 grade reader");
 assert.equal(JSON.stringify(legacyR5),legacyBytes,"tracking never normalizes legacy R2 receipts into the new receipt schema");
 const odds={success:true,data:[{id:"named-exact",sport:"ncaab",home_team:"Cornell",away_team:"Pepperdine",commence_time:start,bookmakers:[]}]};
 const splits={sport:"ncaab",meta:{status:"ok"},data:[{event_id:"ncaab:Pepperdine@Cornell-20261102",home_team:"Cornell",away_team:"Pepperdine",splits:[{book:"circa",as_of:"2026-11-02T15:10:00Z",spread:{home_line:3.5,away_line:-3.5,home_bets_pct:30,away_bets_pct:70,home_handle_pct:10,away_handle_pct:90}}]}]};
 const source=cbbCurrentSplitEvidence(game,odds,splits,at,at),flows=cbbBehaviorFlows(source);
 assert.equal(flows.length,1);assert.equal(flows[0].sourceIdentity,"independent_named_fixture_join");assert.equal(flows[0].sourceEventId,splits.data[0].event_id);assert.equal(flows[0].line,3.5);assert.equal(flows[0].firstMoney,.1);
 assert.equal(cbbBehaviorFlows(cbbCurrentSplitEvidence(game,{success:true,data:[]},splits,at,at)).length,0,"an unverified participant/time event cannot create model pressure from labels");
 const confirmingSplits=structuredClone(splits);
 Object.assign(confirmingSplits.data[0].splits[0].spread,{home_bets_pct:40,away_bets_pct:60,home_handle_pct:80,away_handle_pct:20});
 const realNamedFlow=cbbBehaviorFlows(cbbCurrentSplitEvidence(game,odds,confirmingSplits,"2026-11-02T15:11:00Z",at));
 const target={...targets[1],line:3.5},current={...target,sportsbook:"circa"},anchor={...current,firstPrice:120,secondPrice:-140,providerObservedAt:"2026-11-02T15:00:00Z",fetchedAt:"2026-11-02T15:01:00Z"};
 const confirmingRead=readCbbMarketBehavior({independent,independentInputKey:"frozen-source",startsAt:start,targets:[target],currentQuotes:[current],flows:realNamedFlow,
   anchors:{release:CBB_MARKET_BEHAVIOR_RECEIPT_RELEASE,gameId:777,startsAt:start,independentRelease:CBB_CURRENT_SCORE_RELEASE,independentInputKey:"frozen-source",capturedAt:"2026-11-02T15:01:00Z",quotes:[anchor]}});
 const confirmingInput={forecast:confirmingRead.forecast,target,references:[current],asOf:at};
 assert.equal(gradeCbbProvisional(confirmingInput).grade,"Watchlist");
 assert.equal(gradeCbbMarketBehavior(confirmingInput,confirmingRead.receipt).grade,"Lean","actual supported Circa fixture/flow normalization reaches the paired promotion; no unavailable Pinnacle split source is required");
 const qualifiedBoard=buildCbbProvisionalBoard(confirmingRead.forecast,[target,current],{marketBehavior:confirmingRead.receipt});
 const qualifiedDto=adaptCbbProvisionalGame({game,snapshot:{...initial.record.snapshot,board:qualifiedBoard},homeLogo:null,awayLogo:null,now:at,marketQuotes:[target,current]});
 assert.equal(qualifiedDto.markets.first_inning.sharpStatus,"confirm");assert.equal(qualifiedDto.markets.first_inning.grade,"sharp_confirmed");
 const priceOnlyRead=readCbbMarketBehavior({independent,independentInputKey:"frozen-source",startsAt:start,targets:[target],currentQuotes:[current],
   anchors:{release:CBB_MARKET_BEHAVIOR_RECEIPT_RELEASE,gameId:777,startsAt:start,independentRelease:CBB_CURRENT_SCORE_RELEASE,independentInputKey:"frozen-source",capturedAt:"2026-11-02T15:01:00Z",quotes:[anchor]}});
 const priceBoard=buildCbbProvisionalBoard(priceOnlyRead.forecast,[target,current],{marketBehavior:priceOnlyRead.receipt});
 const priceDto=adaptCbbProvisionalGame({game,snapshot:{...initial.record.snapshot,board:priceBoard},homeLogo:null,awayLogo:null,now:at,marketQuotes:[target,current]});
 assert.equal(priceDto.markets.first_inning.verdict.key,"lean");assert.equal(priceDto.markets.first_inning.grade,"model_only");
 assert.notEqual(priceDto.markets.first_inning.sharpStatus,"confirm","price-only promotion cannot imply identified sharp flow");
 const history=[{date:"2026-11-02T09:29:59Z"},{date:"2026-11-02T09:30:00Z"},{date:"2026-11-02T09:30:01Z"}] as Parameters<typeof cbbHistoryAtDecision>[0];
 assert.deepEqual(cbbHistoryAtDecision(history,at),history.slice(0,2),"old independent replay uses its own six-hour availability cutoff");
 console.log("PASS CBB market behavior lock path: static disagreement without invented side change, T-60 freezes last public law, legacy R5 writer/reader/tracking immutability under R6, exact current model/grade tracking and independent source-flow join.");
}
main().catch(e=>{console.error(e);process.exitCode=1;});
