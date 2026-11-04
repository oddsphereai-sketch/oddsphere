import assert from 'node:assert/strict';
import {getNflV1WeekOneOutcomeForecast,buildNflIndependentScoreBaseForecast} from '../lib/services/football/nflV1WeekOneOutcome';
import {buildNflV1ActionableGradeBundle} from '../lib/services/football/nflV1ActionableGradeCandidate';
import {buildNflMarketQualification} from '../lib/services/football/nflMarketQualification';
import {readNflMarketInnovation} from '../lib/services/football/nflMarketInnovationRuntime';
import {applyNflMarketInnovationPosture} from '../lib/services/football/nflMarketInnovationPosture';
import {qualifyNflOwlsSplitsForSourceReaction} from '../lib/services/football/nflOwlsSplits';
import type {NflPreviewBookOdds} from '../lib/services/football/balldontlieNflPreviewSlate';
import type {NflRegularSharpSplitSet} from '../lib/services/football/sharpApiNflSplits';
const evaluatedAt='2026-11-04T14:30:00.000Z',gameStartsAt='2026-11-05T18:00:00.000Z';
const raw=getNflV1WeekOneOutcomeForecast({providerGameId:'1392224',awayTeam:'CLE',homeTeam:'JAX'});
const american=(p:number)=>p>=.5?-100*p/(1-p):100*(1-p)/p;
function fixture(direction:1|-1,pickedProbability=.62){
 const initial=buildNflIndependentScoreBaseForecast({baseForecast:raw,independentScore:{expectedHomeMargin:direction*5,expectedTotal:47,marketInputPolicy:'prohibited_from_independent_score'}});
 const hp=direction===1?pickedProbability:1-pickedProbability,margin=7*(2*hp-1),base={...initial,marginDistribution:{values:[-7,7],probabilities:[1-hp,hp]},totalDistribution:{values:[42,52],probabilities:[.5,.5]},homeWinProbability:hp,awayWinProbability:1-hp,tieProbability:0,expectedHomeScore:(47+margin)/2,expectedAwayScore:(47-margin)/2};
 const book=(sportsbook:string,at:string,p:number):NflPreviewBookOdds=>({providerGameId:raw.providerGameId,provider:'owls',providerEventId:'exact',sportsbook,observedAt:at,
  availableAt:new Date(Date.parse(at)+1000).toISOString(),moneyline:{homePrice:american(direction===1?p:1-p),awayPrice:american(direction===1?1-p:p)},
  spread:{homeLine:-3.5,awayLine:3.5,homePrice:-110,awayPrice:-110},total:{line:46.5,overPrice:-110,underPrice:-110}});
 const books:NflPreviewBookOdds[]=['draftkings','fanduel','betmgm'].map((name,i)=>({...book(name,'2026-11-04T14:05:00.000Z',i?(pickedProbability<.59?.57:.605):130/230),requestedAt:'2026-11-04T14:05:00.000Z',availableAt:'2026-11-04T14:05:01.000Z'}));
 const history=[book('circa','2026-11-04T12:30:00.000Z',.61),book('circa','2026-11-04T14:00:00.000Z',.61)];
 const split={provider:'owls',providerGameId:raw.providerGameId,sourceEventId:'exact',sourceSportsbook:'circa',capturedAt:'2026-11-04T13:01:00.000Z',providerFetchedAt:'2026-11-04T13:00:00.000Z',sourceLine:null,homeMoneyPct:direction===1?20:80,awayMoneyPct:direction===1?80:20,homeBetsPct:50,awayBetsPct:50};
 const qualified=qualifyNflOwlsSplitsForSourceReaction({splits:{moneyline:split,spread:{...split,sourceLine:-3.5},total:{...split,sourceLine:46.5}} as unknown as NflRegularSharpSplitSet,providerGameId:raw.providerGameId,evaluatedAt,gameStartsAt,history,excludedFamiliesByMarket:{moneyline:[],spread:[],total:[]}});
 const read=readNflMarketInnovation({independentForecast:base,independentInputPolicy:'market_inputs_prohibited',history,evaluatedAt,gameStartsAt,excludedFamiliesByMarket:{moneyline:['draftkings'],spread:['draftkings'],total:['draftkings']},marketReactionContext:{moneyline:{books:[],flows:qualified.flows.moneyline!}}});
 const qualifications=Object.fromEntries((['moneyline','spread','total']as const).map(market=>[market,buildNflMarketQualification({market,providerGameId:raw.providerGameId,evaluatedAt,gameStartsAt,forecast:base,basis:'market_free_independent_law',independentInputPolicy:'market_inputs_prohibited',sourceMarketId:`${raw.providerGameId}:${market}`,sourceReceipt:'exact-test-bound-independent-law',evidenceQualified:true})]));
 const shadowMoneyline={health:{blockingReasons:[]},decisionStage:'unlocked',lockedAt:null,evaluatedAt,evaluatedQuote:{sportsbook:'draftkings',line:null,price:-130,observedAt:books[0].observedAt},team:direction===1?'JAX':'CLE',modelProbability:pickedProbability,otherBooksConsensusFairProbability:.6} as unknown as Parameters<typeof buildNflV1ActionableGradeBundle>[0]['shadowMoneyline'];
 const production=buildNflV1ActionableGradeBundle({providerGameId:raw.providerGameId,awayTeam:'CLE',homeTeam:'JAX',gameStartsAt,current:books[0],comparableCurrentBooks:books,referenceBooks:[history[1]],shadowMoneyline,outcomeForecast:base,marketQualification:qualifications});
 const context={independentForecast:base,finalForecast:base,marketQualification:qualifications,books,referenceBooks:[history[1]],sourceHistory:[...history,{...history[1],moneyline:null}],executionAvailableAt:evaluatedAt};
 const args={production,innovation:read.receipt,homeTeam:'JAX',promotionContext:context};
 return{base,books,history,read,production,context,args};
}
for(const direction of[1,-1]as const){
 const f=fixture(direction),before=f.production.evaluatedBets.find(b=>b.market==='moneyline')!;
 assert.equal(before.grade,'Lean');assert.ok(before.modelProbability-before.marketFairProbability<.04);
 assert.deepEqual(f.read.outcome,f.base,'held source pressure does not change score/probability');
 const changed=applyNflMarketInnovationPosture(f.args),after=changed.production.evaluatedBets.find(b=>b.market==='moneyline')!;
 assert.equal(after.grade,'Best Angle');assert.equal(changed.posture.evaluations.find(e=>e.market==='moneyline')!.confirmation!.reason,'qualified_unchanged_moneyline_opposite_pressure_hold');
 assert.equal(changed.posture.evaluations.find(e=>e.market==='moneyline')!.confirmation!.unchangedMoneylineProof![0].sourceEventId,'exact');
 assert.ok(changed.posture.evaluations.find(e=>e.market==='moneyline')!.confirmation!.unchangedMoneylineProof![0].sourceTargetExpectedValue>=.02);
 assert.deepEqual({...after,grade:before.grade},before,'only grade changes; all numeric/execution/evidence values stay exact');
 const retain=(override:Partial<typeof f.args>,label:string)=>assert.equal(applyNflMarketInnovationPosture({...f.args,...override}).production.evaluatedBets.find(b=>b.market==='moneyline')!.grade,'Lean',label);
 retain({innovation:{...f.read.receipt,reactionContext:{}}},'static professional favorite cannot confirm');
 retain({promotionContext:{...f.context,sourceHistory:[]}},'missing raw source proof cannot confirm');
 retain({promotionContext:{...f.context,sourceHistory:f.history.map(h=>({...h,availableAt:undefined}))}},'missing source availability cannot confirm');
 retain({promotionContext:{...f.context,sourceHistory:f.history.map(h=>({...h,providerEventId:'other-event'}))}},'wrong native source event cannot confirm');
 retain({promotionContext:{...f.context,books:f.books.map(b=>({...b,requestedAt:'2026-11-04T13:59:00.000Z'}))}},'execution request before actual response receipt cannot confirm');
 retain({promotionContext:{...f.context,books:f.books.map(b=>({...b,availableAt:'2026-11-04T14:31:00.000Z'}))}},'future execution receipt cannot confirm');
 for(const availableAt of[undefined,'2026-11-04T14:31:00.000Z','2026-11-04T13:59:59.000Z']){
  retain({promotionContext:{...f.context,books:f.books.map((b,i)=>i===1?{...b,availableAt}:b)}},'nonauthor comparator needs actual nonfuture arrival after its own quote');
  retain({promotionContext:{...f.context,referenceBooks:f.context.referenceBooks.map(b=>({...b,availableAt}))}},'professional comparator needs actual nonfuture arrival after its own quote');
 }
 retain({promotionContext:{...f.context,finalForecast:{...f.base,homeWinProbability:f.base.homeWinProbability+.001}}},'modified law cannot enter unchanged route');
 const flow=f.read.receipt.reactionContext!.moneyline!.flows[0];
 retain({innovation:{...f.read.receipt,reactionContext:{moneyline:{books:[],flows:[{...flow,authority:'public_source_contract_reaction_context_only'}]}}}},'public pressure cannot masquerade as professional flow');
 retain({innovation:{...f.read.receipt,reactionContext:{moneyline:{books:[],flows:[{...flow,availableAt:undefined}]}}}},'unknown pressure availability cannot confirm');
 retain({innovation:{...f.read.receipt,reactionContext:{moneyline:{books:[],flows:[{...flow,availableAt:evaluatedAt}]}}}},'price preceding pressure capture is not causal response');
 retain({innovation:{...f.read.receipt,paths:f.read.receipt.paths!.map(p=>p.market==='moneyline'?{...p,hasUnresolvedAdverseLeg:true}:p)}},'actual unresolved opposition cannot confirm');
 const intermediate={...f.history[0],observedAt:'2026-11-04T13:30:00.000Z',availableAt:'2026-11-04T13:30:01.000Z',moneyline:{homePrice:-110,awayPrice:-110}};
 retain({promotionContext:{...f.context,sourceHistory:[f.history[0],intermediate,f.history[1]]}},'buyback ending at same quote is not a clean hold');
 const badSource={...f.history[1],moneyline:{homePrice:american(direction===1?.5:.5),awayPrice:american(.5)}};
 retain({promotionContext:{...f.context,referenceBooks:[badSource]}},'nonpositive professional exact-target economics cannot confirm');
 for(const locked of[true,false]){
  const production=locked?f.production:{...f.production,evaluatedBets:f.production.evaluatedBets.map(b=>({...b,stage:'t60_locked' as const,lockedAt:evaluatedAt}))};
  assert.strictEqual(applyNflMarketInnovationPosture({...f.args,production,existingLockedRecord:locked}).production,production,'stored locks remain exact');
 }
}
const weak=fixture(1,.5899);assert.equal(applyNflMarketInnovationPosture(weak.args).production.evaluatedBets.find(b=>b.market==='moneyline')!.grade,'Lean','existing59% premium probability remains');
console.log('PASS NFL unchanged ML: actual opposite-pressure hold promotes both sides; paired static/unknown/identity/chronology/price/opposition/buyback/low-confidence and lock guards preserve exact tuples.');
