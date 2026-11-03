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
import {deriveUclMatchResultDecision,deriveUclPreviewGrade} from "../lib/services/ucl/uclPreviewGrade";
import {buildEplDailyEdgePreview,type EplStoredPriceObservation} from "../lib/services/epl/buildEplDailyEdgePreview";

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
  let journal:EplStoredPriceObservation[]=[];
  const board=await buildUclDailyEdgePreview(slate,{cacheNamespace:'test-ucl-native-recovery',cacheIdentity:'actual18-native-recovery',captureAllBookPrices:rows=>{journal=rows;},marketProvider:{loadFixture:async f=>{assert.ok(f.providerId);calls.set(f.providerId,(calls.get(f.providerId)??0)+1);return fixtures.get(f.providerId)!;}}});
  assert.equal(board.games.length,18);
  for(const id of[4243843,4438978]){
   const g=board.games.find(g=>g.external_id===id)!;
   assert.equal(calls.get(id),id===4438978?2:1,'only actual incomplete fixtures take the normal bounded retry');
   assert.ok((g.soccerModelProvenance?.eligibleAlternativeBooks.length??0)>=2,'native identities must reach the final reader after recovery');
   assert.equal(g.soccerModelProvenance?.source,'independent_club_pmf');
   assert.ok(Math.abs(g.soccerProjection!.expectedGoals.home+g.soccerProjection!.expectedGoals.away-independent.expectedGoals.home-independent.expectedGoals.away)<1e-8,
    'current native levels without a recorded path must not overwrite independent goals');
  }
  assert.equal(board.games.find(g=>g.external_id===4243843)!.markets.first_inning.priceAmerican,-180,'actual LASK DK BTTS price survives the complete builder');
  const nativeTotals=journal.filter(row=>row.market==='total');
  assert.ok(nativeTotals.some(row=>row.line===3.25)&&nativeTotals.some(row=>row.line===3.5),'actual native lines enter the existing journal');
  const expectedNativeCount=[...fixtures.values()].reduce((sum,f)=>sum+f.odds.filter(row=>row.market==='total').length,0);
  assert.equal(expectedNativeCount,110);
  assert.equal(nativeTotals.length,108,'two actual orphan HardRock sides are excluded; only received complete source pairs are journaled');
  for(const row of nativeTotals){
   assert.ok(fixtures.get(row.providerId)!.odds.some(source=>source.market==='total'&&source.sportsbook===row.sportsbook
    &&source.selection===row.side&&source.line===row.line&&source.odds_american===row.american&&source.fetched_at===row.recordedAt),
    'native journal preserves actual contract, price and original quote clock');
  }
  let eplJournal:EplStoredPriceObservation[]=[];
  await buildEplDailyEdgePreview(slate,{cacheNamespace:'test-epl-native-history-default',cacheIdentity:'epl-default2.5',captureAllBookPrices:rows=>{eplJournal=rows;},
   marketProvider:{loadFixture:async f=>fixtures.get(f.providerId!)!}});
  assert.ok(eplJournal.filter(row=>row.market==='total').every(row=>row.line===2.5),'EPL journal keeps its existing exact2.5 contract');
  const gradeCounts=Object.fromEntries(['moneyline','total','first_inning'].map(key=>[key,board.games.reduce((counts,game)=>{
   const grade=game.markets[key as keyof typeof game.markets].verdict?.key??'unknown';counts[grade]=(counts[grade]??0)+1;return counts;
  },{} as Record<string,number>)]));
  console.log('Controlled1.4/1.3-prior18-source final builder grade counts (not live performance):',JSON.stringify(gradeCounts));
  const withoutNativeGoals=await buildEplDailyEdgePreview(slate,{cacheNamespace:'test-ucl-native-goals-ablation',cacheIdentity:'same-prior-same-sources-no-goal-constraints',skipForwardEvidence:true,
   marketProvider:{loadFixture:async f=>fixtures.get(f.providerId!)!},authorities:{gradeRelease:UCL_CALIBRATION_RELEASE,
    nativeGoalMarketContracts:true,useCoherentMatchResultForecast:true,
    deriveCoherentOutcome:input=>deriveUclCoherentMarketOutcome({...input,totalVectors:[],bttsVectors:[]}),
    deriveMatchResultDecision:deriveUclMatchResultDecision,derivePreviewGrade:deriveUclPreviewGrade,
    selectMatchResultSide:prediction=>{const side=(["home","draw","away"] as const).reduce((best,s)=>prediction.probabilities[s]>prediction.probabilities[best]?s:best,"home");return{release:prediction.release,side,rawSide:side,applied:false};},
   }});
  const isActionable=(key:string|undefined)=>key==='lean'||key==='best_angle';
  let promoted=0,demoted=0,changedSides=0;
  const absentCounts:Record<string,Record<string,number>>={};
  for(const key of ['moneyline','total','first_inning'] as const){absentCounts[key]={};for(const after of board.games){
   const before=withoutNativeGoals.games.find(g=>g.external_id===after.external_id)!.markets[key];
   const next=after.markets[key];const label=before.verdict?.key??'unknown';absentCounts[key]![label]=(absentCounts[key]![label]??0)+1;
   if(!isActionable(before.verdict?.key)&&isActionable(next.verdict?.key))promoted++;
   if(isActionable(before.verdict?.key)&&!isActionable(next.verdict?.key))demoted++;
   if(before.pick!==next.pick)changedSides++;
  }}
  assert.equal(promoted,0,'current levels alone cannot manufacture actionables through book-target replacement');
  assert.equal(demoted,0,'current levels alone cannot flatten the independent board');
  console.log('Controlled current-level input identity (no recorded path; not live or outcome qualification):',JSON.stringify({before:absentCounts,after:gradeCounts,promoted,demoted,netActionable:promoted-demoted,changedSides}));
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
