import assert from 'node:assert/strict';
import {gradeAiEventFromExactPairedMass,gradeAiEventFromForecastMass,priceAiLaw} from '../lib/playerPropsAi/pricing';
import {qualifiesExactPropsBestForecast,qualifiesPropsBestForecast} from '../lib/playerPropsAi/forecastStrength';
import {PROPS_AI_LAW_RELEASE,CANONICAL_BOOK_PROPS_AI_LAW_RELEASE,propsAiLawGradeRelease,propsAiLawSelectionRelease} from '../lib/playerPropsAi/releases';
import type {AcceptedPlayerLaw} from '../lib/playerPropsAi/law';
import {nbaAuthorityFixture} from './test-player-props-ai-nba-lock-authority';
import {applyNbaSiteAi} from '../lib/playerPropsAi/siteBindings';
import type {SiteAiDecision} from '../lib/playerPropsAi/publication';
import {PROPS_AI_RELEASE} from '../lib/playerPropsAi/releases';
import type {Quote} from '../lib/playerPropsAi/evidenceContract';
import {gradeNflPlayerPropsCrossMarketCandidate,gradeNflPlayerPropsCrossMarketForecastCandidate,gradeNflPlayerPropsTouchdownForecastCandidate,nflPlayerPropsCoherentPosteriorDistribution} from '../lib/services/football/nflPlayerPropsRuntime';
globalThis.fetch=async()=>{throw Error('Forecast-strength controls forbid HTTP');};
const x={win:50549,loss:49451,push:0,total:100000,american:140,opposingAmerican:-195,confidence:2,exception:null};
assert.equal(gradeAiEventFromExactPairedMass(x).grade,'Best Angle','Original R4 policy is permanent');
assert.equal(gradeAiEventFromForecastMass(x).grade,'Lean','Value at a nearly even forecast is not top conviction');
assert.equal(gradeAiEventFromForecastMass(x).ev,gradeAiEventFromExactPairedMass(x).ev);
let demotions=0,promotions=0,actionableBefore=0,actionableAfter=0;
for(const win of [1,49,50,61,62,63,75,99])for(const push of [0,1,20])for(const american of [-201,-200,-110,140,10000])for(const confidence of [0,1,2]){
 const v={...x,win,loss:100-win,push,total:100+push,american,confidence};
 const old=gradeAiEventFromExactPairedMass(v),next=gradeAiEventFromForecastMass(v);
 assert.equal(next.ev,old.ev);assert.deepEqual(next.confidenceLean,old.confidenceLean);
 const strong=win*50>=(100+push)*31&&american>=-200;
 assert.equal(next.grade,old.grade==='Best Angle'&&!strong?'Lean':old.grade);
 actionableBefore+=Number(['Best Angle','Lean'].includes(old.grade));actionableAfter+=Number(['Best Angle','Lean'].includes(next.grade));
 demotions+=Number(old.grade==='Best Angle'&&next.grade==='Lean');
 for(const scale of [1,2,1000])assert.equal(qualifiesExactPropsBestForecast(win*scale,(100+push)*scale,american),strong);
 if(!strong&&confidence===2){const recovered={...v,win:70,loss:30,push:0,total:100,american:-110};assert.equal(gradeAiEventFromForecastMass(recovered).grade,'Best Angle');promotions++;}
 assert.equal(gradeAiEventFromForecastMass({...v,exception:'unsupported original source'}).grade,'No Play');
}
assert(demotions>0&&promotions>0);assert.equal(actionableBefore,actionableAfter,'No hidden contraction of actionable coverage');
assert(qualifiesPropsBestForecast(.62,-200));assert(!qualifiesPropsBestForecast(.619999999,-200));assert(!qualifiesPropsBestForecast(.9,-201));
assert(!qualifiesExactPropsBestForecast(62,101,-110),'Pushes cannot count as wins');
// Genuine qualified alternate: top forecast with positive value beats a larger
// price edge on a coin flip. Original R4 still selects the highest exact EV.
const weights=[50,13,37,...Array(13).fill(0)],outcomes={receptions:[6,5,2,...Array(13).fill(0)]};
const law={release:PROPS_AI_LAW_RELEASE,weights:weights.map(n=>n/100),integerWeights:weights,outcomes,hash:'synthetic-only'} satisfies AcceptedPlayerLaw;
const now='2026-11-19T17:00:00Z';
const quotes=[{id:'strong',book:'book',provider:'provider',line:4.5,side:'over' as const,american:-110,availableAt:now,confirmedAt:now,current:true,actionRule:'qualifying_participation' as const},{id:'coin',book:'book',provider:'provider',line:5.5,side:'over' as const,american:200,availableAt:now,confirmedAt:now,current:true,actionRule:'qualifying_participation' as const}];
const args={law,market:'receptions',quotes,now,maxAgeMs:1000,confidence:2,exception:null};
assert.equal(priceAiLaw(args)!.quote.id,'strong');assert.equal(priceAiLaw(args)!.grade,'Best Angle');
assert.equal(priceAiLaw({...args,law:{...law,release:CANONICAL_BOOK_PROPS_AI_LAW_RELEASE}})!.quote.id,'coin');
assert.equal(priceAiLaw({...args,quotes:[quotes[1]]})!.grade,'Lean','No stronger quote may be invented');
assert.equal(priceAiLaw({...args,quotes:[{...quotes[0],current:false},quotes[1]]})!.quote.id,'coin');
assert.equal(propsAiLawGradeRelease(CANONICAL_BOOK_PROPS_AI_LAW_RELEASE),'player_props_ai_grade_2026_11_17_r6_canonical_book_pairing');
assert.equal(propsAiLawSelectionRelease(CANONICAL_BOOK_PROPS_AI_LAW_RELEASE),'player_props_ai_selection_2026_11_17_r9_canonical_book_pairing');
const thresholds={minimumEv:.01,minimumProbabilityEdge:.01,minimumParticipationProbability:.7,minimumIndependentBooks:1};
const native={commonHolds:[],independentBooks:2,divergenceImplausible:false,eligibleSide:true,marketResidualQualified:true,bestAngleEnabled:true,leanEnabled:true,watchlistEnabled:true,expectedValue:.2131868131868131,probabilityEdge:.12,participationProbability:.9,movement:'neutral' as const,leanThresholds:thresholds,bestAngleThresholds:thresholds};
assert.equal(gradeNflPlayerPropsCrossMarketCandidate(native),'Best Angle');
assert.equal(gradeNflPlayerPropsCrossMarketForecastCandidate({...native,winProbability:.5054945054945055,americanPrice:140}),'Lean');
assert.equal(gradeNflPlayerPropsCrossMarketForecastCandidate({...native,winProbability:.7,americanPrice:-200}),'Best Angle');
assert.equal(gradeNflPlayerPropsCrossMarketForecastCandidate({...native,winProbability:.9,americanPrice:-201}),'Lean');
assert.equal(gradeNflPlayerPropsCrossMarketForecastCandidate({...native,commonHolds:['actual missing source'],winProbability:.9,americanPrice:-110}),'Held');
assert.equal(gradeNflPlayerPropsTouchdownForecastCandidate({commonHolds:[],independentBooks:2,sharpReferenceBooks:1,americanPrice:500,expectedValue:.5,probabilityEdge:.2,participationProbability:.99,winProbability:.3}),'Lean');
const posterior=nflPlayerPropsCoherentPosteriorDistribution({market:'receptions',line:4.5,calibratedOverProbability:.5054945054945055,independentProjection:3.378202819341442});
assert.equal(posterior.projection,4.5214419380434965,'Do not cosmetically move the real posterior median');
// Actual member adapter, synthetic post-admission fixture. The native selected
// contract is still offered; the stronger qualified contract must really replace
// that primary, while old-law selection and locked values retain precedence.
const f=nbaAuthorityFixture(),at=f.packet.cutoff;
const marketLaw={...law,outcomes:{points:[20,17,12,...Array(13).fill(0)],rebounds:Array(16).fill(0),assists:Array(16).fill(0),threes:Array(16).fill(0)}};
const currentQuotes:Quote[]=quotes.map((q,i)=>({id:q.id,playerId:'a',market:'points',provider:q.provider,book:q.book,line:i===0?15.5:18.5,side:'over',american:q.american,observedAt:at,receivedAt:at,receivedAtProvenance:'provider_response',opening:false,live:false}));
const packet={...f.packet,players:f.packet.players.slice(0,1).map(p=>({...p,markets:['points']})),quotes:currentQuotes,executionQuotes:currentQuotes};
function choicesFor(release:AcceptedPlayerLaw['release']):SiteAiDecision[]{
 return currentQuotes.map(q=>{
  const priced=priceAiLaw({law:{...marketLaw,release} as AcceptedPlayerLaw,market:'points',quotes:[{...q,availableAt:at,confirmedAt:at,current:true,actionRule:'qualifying_participation'}],now:at,maxAgeMs:1000,confidence:2,exception:null})!;
  return{playerId:'a',market:'points',line:q.line,side:priced.side,book:q.book,provider:q.provider,american:q.american,projection:priced.forecast.mean,probability:priced.probability,over:priced.forecast.over,under:priced.forecast.under,push:priced.push,expectedValue:priced.expectedValue,fairAmerican:priced.fairAmerican,grade:priced.grade,quote:q,exactEventMass:priced.exactEventMass,
   evidence:{release:PROPS_AI_RELEASE,lawRelease:release,gradeRelease:propsAiLawGradeRelease(release),selectionRelease:propsAiLawSelectionRelease(release),publicationRelease:'synthetic',reviewId:'synthetic',lawHash:marketLaw.hash,inputHash:'synthetic',reviewedAt:at,stage:'final',model:'synthetic',confidence:2,confidenceMeaning:'AI-estimated evidence strength; not empirical calibration',quoteConfirmedAt:at,selectedSide:priced.side,assessment:'Synthetic supported forecast.',coverage:{},exception:null}} as SiteAiDecision;
 });
}
const row={...f.row('a','points'),line:18.5,sportsbook:'book',projection:19.5},base=f.snapshot([row]);
const oldChoices=choicesFor(CANONICAL_BOOK_PROPS_AI_LAW_RELEASE),newChoices=choicesFor(PROPS_AI_LAW_RELEASE);
assert.equal(applyNbaSiteAi(base,packet,oldChoices,at).decisions[0].line,18.5,'Original R4 matched-contract selection stays exact');
const promoted=applyNbaSiteAi(base,packet,newChoices,at).decisions[0];
assert.equal(promoted.line,15.5);assert.equal(promoted.grade,'Best Angle');assert.equal(promoted.probability,.63);
assert.equal(promoted.projection,newChoices[0].projection);assert.equal(promoted.americanPrice,-110);
const locked=f.snapshot([{...row,lockedAt:at}]),before=JSON.stringify(locked);
assert.strictEqual(applyNbaSiteAi(locked,packet,newChoices,at),locked);assert.equal(JSON.stringify(locked),before);
console.log(JSON.stringify({status:'PASS',demotions,promotions,actionableBefore,actionableAfter,originalPolicyPreserved:true,originalPosteriorUnchanged:true,networkCalls:0}));
