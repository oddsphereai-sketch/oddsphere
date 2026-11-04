import assert from 'node:assert/strict';
import {evaluateUclPublicationCoverage} from '../lib/services/ucl/uclPublicationReadiness';
import {UCL_PREVIEW_GRADE_RELEASE} from '../lib/services/ucl/uclTransferredGrade';
import type {DailyEdgeResponse} from '../app/lab/lib/labTypes';

export function testUclConfidencePublication(){
 const held={held:true,currentPriceAmerican:null,soccerPriceBoard:null,verdict:{key:'no_play',label:'No Play'}};
 const receipt=(side:string)=>({status:'applied',pickedSide:side,direction:side,latestInformativeDirection:side,
  currentSupportsPick:true,latestInformativeSupportsPick:true,latestLegFullyObserved:true,roundTrip:false,
  conflicted:false,opposingCandidates:false,retraced:false,currentTargetProbabilityBasis:'direct_paired_market',
  currentTargetProbabilities:side==='home'?{home:.605,draw:.2,away:.195}:side==='over'?{over:.605,under:.395}:{yes:.605,no:.395},
  selected:{sourceClass:'named_originator'}});
 const market=(side:string)=>({held:false,priceAmerican:-160,currentPriceAmerican:-160,marketFairProb:.605,
  modelProb:.6,pinnacleEvPct:-2.5,reviewFlags:[UCL_PREVIEW_GRADE_RELEASE] as string[],line:side==='over'?2.5:null,
  soccerPriceBoard:{rows:[{side,price_american:-160,selected:true}]},verdict:{key:'lean',label:'Lean'},
  ...(side==='home'?{soccerMatchResultContext:{displayed_side:side}}:side==='over'?{soccerTotalContext:{displayed_side:side}}:{soccerBttsContext:{displayed_side:side}})});
 const game={external_id:1,lockState:'open',lockedAt:null,markets:{moneyline:market('home'),total:market('over'),first_inning:market('yes')},soccerDoubleChanceMarket:held,
  soccerProjection:{goalOutlookProbabilities:{home:.6,draw:.2,away:.2,over25:.6,under25:.4,bttsYes:.6,bttsNo:.4}},
  soccerModelProvenance:{goalsReader:{relativeMarketReader:{markets:{match_result:receipt('home'),total:receipt('over'),btts:receipt('yes')}}}}};
 const check=(g:unknown)=>evaluateUclPublicationCoverage({matches:[{id:1,status:'scheduled'}]} as never,{games:[g]} as Pick<DailyEdgeResponse,'games'>);
 const valid=check(game);assert.deepEqual(valid.errors,[]);assert.equal(valid.nonpositiveEvActionables,3);
 assert.equal(valid.qualifiedConfidenceLeans,3);assert.equal(valid.unqualifiedActionables,0);
 for(const mutation of [
  (g:typeof game)=>{g.markets.total.modelProb=.61;},
  (g:typeof game)=>{g.markets.total.pinnacleEvPct=0;},
  (g:typeof game)=>{g.markets.total.verdict.key='best_angle';},
  (g:typeof game)=>{g.markets.total.currentPriceAmerican=-170;},
  (g:typeof game)=>{g.markets.total.reviewFlags=[];},
  (g:typeof game)=>{g.soccerModelProvenance.goalsReader.relativeMarketReader.markets.total.currentSupportsPick=false;},
 ]){const g=structuredClone(game);mutation(g);const result=check(g);assert.equal(result.unqualifiedActionables,1);assert.ok(result.errors.length>0,
  'publication must retain exact probability/EV/release/price/market-evidence guards');}
 const legacy={...structuredClone(game),lockState:'locked',lockedAt:'2026-11-03T16:45:00Z'};
 legacy.markets.total.reviewFlags=['old-locked-release'];
 const frozen=JSON.stringify(legacy);assert.deepEqual(check(legacy).errors,[]);assert.equal(JSON.stringify(legacy),frozen,
  'current qualification cannot reinterpret or mutate a stored locked release');
 console.log('PASS UCL publication accepts only policy-qualified confidence Leans, preserves exact EV and rejects malformed actionables; legacy locked precedence intact.');
}

if(process.argv[1]?.endsWith('test-ucl-confidence-publication.ts'))testUclConfidencePublication();
