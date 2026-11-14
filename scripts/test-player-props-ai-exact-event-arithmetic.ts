/** Prospective exact integer events and immutable legacy arithmetic. No I/O. */
import assert from 'node:assert/strict';
import {validateLaw,lawForecast,lawEventMass,type PlayerLaw,type AcceptedPlayerLaw} from '../lib/playerPropsAi/law';
import {priceAiLaw,gradeAiEventFromMass,type AiExecutionQuote} from '../lib/playerPropsAi/pricing';
import {digest} from '../lib/playerPropsAi/evidence';
import {LEGACY_PROPS_AI_LAW_RELEASE,LEGACY_PROPS_AI_GRADE_RELEASE,PROPS_AI_GRADE_RELEASE,PRIOR_PROPS_AI_LAW_RELEASE,PRIOR_PROPS_AI_GRADE_RELEASE} from '../lib/playerPropsAi/releases';
globalThis.fetch=async()=>{throw Error('Exact event arithmetic forbids network');};
const zero=()=>Array<number>(16).fill(0),at='2030-11-11T18:00:00Z';
const q=(side:'over'|'under',american:number,book='samebook'):AiExecutionQuote=>({id:side+book,book,provider:'synthetic',line:.5,side,american,availableAt:at,confirmedAt:at,current:true,actionRule:'qualifying_participation'});
const price=(law:AcceptedPlayerLaw,over=150,under=-170)=>priceAiLaw({law,market:'receptions',quotes:[q('over',over),q('under',under)],now:at,maxAgeMs:60000,confidence:2,exception:null})!;
const weights=[3,68,95,84,35,48,23,60],raw:PlayerLaw={weights:[...weights,...weights.slice().reverse()],outcomes:{receptions:[...Array(8).fill(0),...Array(8).fill(1)]}};
const reverse:PlayerLaw={weights:raw.weights.slice().reverse(),outcomes:{receptions:raw.outcomes.receptions.slice().reverse()}};
const legacy=(input:PlayerLaw):AcceptedPlayerLaw=>{const total=input.weights.reduce((a,b)=>a+b,0),body={release:LEGACY_PROPS_AI_LAW_RELEASE,weights:input.weights.map(w=>w/total),outcomes:structuredClone(input.outcomes)};return{...body,hash:digest(body)};};
const old=legacy(raw),oldBytes=JSON.stringify(old),oldPrice=price(old);
assert.equal(lawForecast(old,'receptions',.5).preferredSide,'under');assert.equal(oldPrice.grade,'Watchlist');assert.equal(oldPrice.gradeRelease,LEGACY_PROPS_AI_GRADE_RELEASE);
let assertions=0;
for(let shift=0;shift<16;shift++)for(const scale of [1,2,10]){
 const indices=Array.from({length:16},(_,i)=>(i+shift)%16);if(shift%2)indices.reverse();
 const input={weights:indices.map(i=>raw.weights[i]*scale),outcomes:{receptions:indices.map(i=>raw.outcomes.receptions[i])}},law=validateLaw('nfl',{markets:['receptions']},input),f=lawForecast(law,'receptions',.5),p=price(law);
 assert.deepEqual(f,{mean:.5,over:.5,under:.5,push:0,preferredSide:'over'});assert.equal(p.side,'over');assert.equal(p.expectedValue,.25);assert.equal(p.grade,'Best Angle');assert.equal(p.gradeRelease,PROPS_AI_GRADE_RELEASE);assert.equal(p.recommendationBasis,'estimated_value');assert.deepEqual(law.integerWeights,input.weights);assertions+=7;
}
const exactZero=validateLaw('nfl',{markets:['receptions']},{weights:[5,2,...zero().slice(2)],outcomes:{receptions:[1,0,...zero().slice(2)]}}),breakEven=price(exactZero,-250,200);
assert.equal(breakEven.expectedValue,0);assert.notEqual(breakEven.grade,'Best Angle');assert.notEqual(breakEven.recommendationBasis,'estimated_value');
const noPairArgs={market:'receptions',quotes:[q('over',-250)],now:at,maxAgeMs:60000,confidence:2,exception:null};
const zeroLegacy=legacy({weights:[5,2,...zero().slice(2)],outcomes:{receptions:[1,0,...zero().slice(2)]}});
const noPairOld=priceAiLaw({...noPairArgs,law:zeroLegacy})!,noPairNew=priceAiLaw({...noPairArgs,law:exactZero})!;
assert.equal(noPairOld.grade,'Best Angle');assert.equal(noPairNew.grade,'Watchlist');assert.equal(noPairNew.expectedValue,0);
const boardImpact={syntheticEvents:2,beforeActionable:1,afterActionable:1,promotions:1,demotions:1,meaning:'Exact-tie genuine positive Over recovery pairs with removal of a false positive-EV unpaired Best; no board quota.'};
assert.equal(price(exactZero,-249,200).grade,'Best Angle');assert(price(exactZero,-251,200).expectedValue<0);
assert.equal(gradeAiEventFromMass({win:5,loss:2,push:0,total:7,american:-250,opposingAmerican:200,confidence:2,exception:null}).grade,'Lean','A genuine paired-confidence zero-EV Lean remains allowed');
const favorUnder=validateLaw('nfl',{markets:['receptions']},{weights:[6,4,...zero().slice(2)],outcomes:{receptions:[0,1,...zero().slice(2)]}});assert.equal(price(favorUnder,-170,150).side,'under');assert.equal(price(favorUnder,-170,150).grade,'Best Angle');
const minimum=validateLaw('nfl',{markets:['receptions']},{weights:[10000,9999,...Array(14).fill(10000)],outcomes:{receptions:[...Array(8).fill(0),...Array(8).fill(1)]}});assert.equal(lawForecast(minimum,'receptions',.5).preferredSide,'over');
const eventCases:[import('../lib/playerPropsAi/evidenceContract').Sport,string,Record<string,number[]>,number,boolean][]=[
 ['nba','points_rebounds',{points:[0,2,...zero().slice(2)],rebounds:[1,3,...zero().slice(2)],assists:zero(),threes:zero()},3,false],
 ['nfl','rushing_receiving_yards',{rushing_yards:[-2,4,...zero().slice(2)],receiving_yards:[1,5,...zero().slice(2)]},0,false],
 ['nfl','anytime_td',{touchdowns:[0,1,...zero().slice(2)]},1,true],
 ['mlb','pitcher_strikeouts',{pitcher_strikeouts:[0,1,...zero().slice(2)],pitcher_outs:Array(16).fill(3),pitcher_hits_allowed:zero(),pitcher_walks:zero(),pitcher_earned_runs:zero()},.5,false],
 ['mlb','batter_total_bases',{batter_singles:[0,1,...zero().slice(2)],batter_doubles:zero(),batter_triples:zero(),batter_home_runs:zero(),batter_walks:zero(),batter_strikeouts:zero(),batter_rbis:zero(),batter_runs_scored:zero(),batter_stolen_bases:zero()},1,false],
];
for(const [sport,market,outcomes,line,milestone] of eventCases){
 const input:PlayerLaw={weights:[2,3,...zero().slice(2)],outcomes:structuredClone(outcomes)};
 const a=validateLaw(sport,{markets:[market]},input),b=validateLaw(sport,{markets:[market]},{weights:input.weights.slice().reverse(),outcomes:Object.fromEntries(Object.entries(input.outcomes).map(([k,v])=>[k,v.slice().reverse()]))});assert.deepEqual(lawForecast(a,market,line,milestone),lawForecast(b,market,line,milestone));const m=lawEventMass(a,market,line,milestone);assert.equal(m.over+m.under+m.push,m.total);assertions+=2;
}
const forged=structuredClone(exactZero);if(forged.release!==LEGACY_PROPS_AI_LAW_RELEASE)forged.integerWeights[0]++;assert.throws(()=>lawForecast(forged,'receptions',.5),/disagree/);
assert.throws(()=>lawEventMass(old,'receptions',.5),/requires original R2/);assert.throws(()=>gradeAiEventFromMass({win:1,loss:1,push:0,total:3,american:150,opposingAmerican:-170,confidence:2,exception:null}),/mass/);
assert.equal(JSON.stringify(old),oldBytes);assert.deepEqual(price(old),oldPrice);assert.notEqual(validateLaw('nfl',{markets:['receptions']},reverse).hash,old.hash);
console.log(JSON.stringify({exactEventArithmetic:true,permutationAndScalingCases:48,assertions:assertions+18,legacyR1Exact:true,zeroEVNotBest:true,genuineOverAndUnderRecovery:true,syntheticBoardImpact:boardImpact,networkCalls:0}));

// R2 keeps its exact original hash/body and R4 paired-price arithmetic even
// after new admissions become R3. Never derive a legacy law from new weights.
const priorBody={release:PRIOR_PROPS_AI_LAW_RELEASE,weights:[128/228,100/228,...zero().slice(2)],integerWeights:[128,100,...zero().slice(2)],outcomes:{receptions:[1,0,...zero().slice(2)]}};
const priorLaw:AcceptedPlayerLaw={...priorBody,hash:digest(priorBody)},priorBytes=JSON.stringify(priorLaw);
const priorPrice=price(priorLaw,-148,128);assert.equal(priorPrice.grade,'Watchlist');assert.equal(priorPrice.gradeRelease,PRIOR_PROPS_AI_GRADE_RELEASE);
assert.equal(JSON.stringify(priorLaw),priorBytes);assert.equal(priorLaw.hash,digest(priorBody));assert.deepEqual(priorLaw.integerWeights,priorBody.integerWeights);
