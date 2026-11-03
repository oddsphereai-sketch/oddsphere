import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {mock} from "node:test";
import {__TEST__,soccerFixtureEventIdentities} from "../lib/providers/real_api/CurrentSoccerMarketProvider";
import type {RawOwlsOddsResponse} from "../lib/providers/owls/owlsSharpBookOdds";
import type {EplSharpFixtureMarket} from "../lib/providers/real_api/SharpApiEplMarketProvider";
import type {EplTeamEvidence} from "../lib/services/epl/buildEplShadowSlate";
import type {UclSlate} from "../lib/services/ucl/buildUclSlate";
import {buildUclDailyEdgePreview} from "../lib/services/ucl/buildUclDailyEdgePreview";
import {deriveUclCoherentMarketOutcome} from "../lib/services/ucl/uclCoherentMarketOutcome";
import {UCL_MODEL_RELEASE,UCL_CALIBRATION_RELEASE} from "../lib/services/ucl/uclModel";

export async function testUclNativeRecoveryBuilder(){
 const receipt=JSON.parse(readFileSync(new URL('./fixtures/ucl-current-native-inputs-20261103.json',import.meta.url),'utf8')) as {
  capturedAt:string;games:Array<{id:number;home:string;away:string;kickoff:string}>;response:RawOwlsOddsResponse;
 };
 const independent=deriveUclCoherentMarketOutcome({independentLambdaHome:1.4,independentLambdaAway:1.3,totalVectors:[],evaluatedMatchResultCanonicalBook:null,evaluatedTotalCanonicalBook:null,evaluatedBttsCanonicalBook:null,providerEventId:null,decisionAt:receipt.capturedAt,kickoff:receipt.games[0]!.kickoff});
 const evidence:EplTeamEvidence={priorSeasonRank:null,priorSeasonRecord:null,priorSeasonGoalDifference:null,providerPosition:null,providerRating:null,recentForm:[],recentPoints:0,sampleMatches:4,statMatches:4,xgMatches:4,avgGoalsFor:null,avgGoalsAgainst:null,avgXgFor:null,avgXgAgainst:null,avgShots:null,avgShotsOnTarget:null,avgPossession:null,avgBigChances:null,injuryCount:0,injuries:[],startersPosted:0};
 const fixtures=new Map<number,EplSharpFixtureMarket>();
 const calls=new Map<number,number>();
 const slate:UclSlate={season:2026,round:4,availableRounds:[4],boardDate:'2026-11-03',generatedAt:receipt.capturedAt,trainedThrough:'2026-11-02T00:00:00Z',trainingMatches:4,modelRelease:UCL_MODEL_RELEASE,calibrationRelease:UCL_CALIBRATION_RELEASE,recentHistory:{},competitionContexts:{},providerHealth:{fixtures:'ready',clubStats:'ready',recentStatTeamCoverage:1,recentXgTeamCoverage:1,historicalXgCoverage:1,bdlCurrentMoneyline:'pending',bdlOpeningMoneyline:'unavailable',sharpMarkets:'read_only_preview',playbook:'unsupported',uclHistory:{status:'ready',strategy:'validated_snapshot',rows:378,error:null,contractDeviation:null}},matches:receipt.games.map((g,i)=>{
  const source=__TEST__.normalizeOwlsFixture(receipt.response,'ucl',g,Date.parse(receipt.capturedAt));
  fixtures.set(g.id,{eventId:source.eventId,odds:source.rows,splits:[],splitsState:'unavailable',fixtureEventIdentities:soccerFixtureEventIdentities(source.rows)});
  return {id:g.id,round:4,kickoff:g.kickoff,status:'scheduled',statusDetail:null,homeTeam:{id:i*2+1,name:g.home,short_name:g.home,abbreviation:'HOM',location:g.home},awayTeam:{id:i*2+2,name:g.away,short_name:g.away,abbreviation:'AWY',location:g.away},homeScore:null,awayScore:null,venue:null,currentMoneylineOdds:[],openingOdds:[],modelUncertainty:{homeEffectiveMatches:4,awayEffectiveMatches:4},evidence:{home:evidence,away:evidence,lineupsPosted:false},prediction:{release:UCL_MODEL_RELEASE,calibrationRelease:UCL_CALIBRATION_RELEASE,lambdaHome:1.4,lambdaAway:1.3,expectedTotal:2.7,likelyScore:independent.likelyScore,representativeScore:independent.representativeScore,medianTotal:independent.medianTotal,mostLikelyTotal:independent.mostLikelyTotal,probabilities:{...independent.markets.match_result,over25:independent.markets.total.over,under25:independent.markets.total.under,bttsYes:independent.markets.btts.yes,bttsNo:independent.markets.btts.no},rawDerivedProbabilities:{over25:independent.markets.total.over,bttsYes:independent.markets.btts.yes},homeStrengthSource:'club_history',awayStrengthSource:'club_history',confidence:'standard',coherentJoint:independent.joint}};
 })};
 mock.timers.enable({apis:['Date'],now:Date.parse(receipt.capturedAt)});
 try{
  const board=await buildUclDailyEdgePreview(slate,{cacheNamespace:'test-ucl-native-recovery',cacheIdentity:'actual18-native-recovery',marketProvider:{loadFixture:async f=>{assert.ok(f.providerId);calls.set(f.providerId,(calls.get(f.providerId)??0)+1);return fixtures.get(f.providerId)!;}}});
  assert.equal(board.games.length,18);
  for(const id of[4243843,4438978]){
   const g=board.games.find(g=>g.external_id===id)!;
   assert.equal(calls.get(id),id===4438978?2:1,'only actual incomplete fixtures take the normal bounded retry');
   assert.ok((g.soccerModelProvenance?.eligibleAlternativeBooks.length??0)>=2,'native identities must reach the final reader after recovery');
   assert.equal(g.soccerModelProvenance?.source,'target_excluded_late_match_result_log_pool');
  }
  assert.equal(board.games.find(g=>g.external_id===4243843)!.markets.first_inning.priceAmerican,-180,'actual LASK DK BTTS price survives the complete builder');
  const lask=fixtures.get(4243843)!;
  fixtures.set(4243843,{...lask,odds:lask.odds.filter(row=>row.market!=='total')});calls.clear();
  const partialBoard=await buildUclDailyEdgePreview({...slate,matches:slate.matches.filter(m=>m.id===4243843)},{cacheNamespace:'test-ucl-native-recovery',cacheIdentity:'partial-lask-recovery',marketProvider:{loadFixture:async f=>{calls.set(f.providerId!,(calls.get(f.providerId!)??0)+1);return fixtures.get(f.providerId!)!;}}});
  assert.equal(calls.get(4243843),2);
  assert.ok((partialBoard.games[0]!.soccerModelProvenance?.eligibleAlternativeBooks.length??0)>=2,'LASK native source identities also survive a missing-market retry');
  let recoveryCalls=0;
  const como=fixtures.get(4438978)!;
  const unownedRecovery={...como,eventId:'unattested-recovery',fixtureEventIdentities:undefined,
   odds:como.odds.map(row=>({...row,provider_event_id:'unattested-recovery'}))};
  const unownedBoard=await buildUclDailyEdgePreview({...slate,matches:slate.matches.filter(m=>m.id===4438978)},
   {cacheNamespace:'test-ucl-native-recovery',cacheIdentity:'unattested-recovery-negative',marketProvider:{loadFixture:async()=>++recoveryCalls===1?como:unownedRecovery}});
  assert.equal(recoveryCalls,2);
  assert.deepEqual(unownedBoard.games[0]!.soccerModelProvenance?.eligibleAlternativeBooks,[],
   'primary attestations cannot authorize different selected recovery native rows, even when their global ID matches');
  console.log('PASS full UCL18-fixture native-source→bounded recovery→final reader/score/grade builder; both complementary catalogs retain market authority.');
 }finally{mock.timers.reset();}
}
