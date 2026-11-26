/** Synthetic arithmetic against unchanged real guards; no generated/player target. */
import assert from 'node:assert/strict';
import {PRODUCT_RELEASE,type GamePacket,type Evidence} from '../lib/playerPropsAi/evidenceContract';
import {validateLaw,lawForecast,primitives} from '../lib/playerPropsAi/law';
import {sourceForecastIssues,sourceMeanAdmissionSupport} from '../lib/playerPropsAi/forecastSanity';
import {sourceInput,jointReviewRequest} from '../lib/playerPropsAi/request';
import {numericSourceNavigation,COUPLED_MEAN_TAIL_GUIDANCE,NUMERIC_SOURCE_NAVIGATION_RELEASE} from '../lib/playerPropsAi/numericSourceNavigation';
import {PROPS_AI_RELEASE,PROPS_AI_PRIMARY_MODEL,propsReviewHasMemberExecutionContracts,propsReviewHasVerifiedReaderClaims,propsReviewHasSemanticChecks} from '../lib/playerPropsAi/releases';
import {nbaBenchmarkContextHash} from '../lib/playerPropsAi/nbaBenchmarkContext';
import {digest} from '../lib/playerPropsAi/evidence';
globalThis.fetch=async()=>{throw Error('Coupled guidance test forbids network');};
const at='2030-06-01T12:00:00Z',v=(n:number)=>Array<number>(16).fill(n);
const evidence:Evidence[]=[0,1,2].map(i=>({id:'synthetic-game-'+i,kind:'recent_games',source:'Synthetic played game',availableAt:at,value:{game:{startTime:`2030-05-${27+i}T18:00:00Z`,homeTeam:'A',awayTeam:'B'},box:{passing_attempts:20,passing_completions:10,passing_yards:100,passing_tds:1,passing_interceptions:0}}}));
evidence.push({id:'synthetic-price-prior',kind:'independent_model',source:'Synthetic supplied prior',availableAt:at,value:{market:'passing_tds',line:1.5,independentProjection:1,independentOver:.2,independentUnder:.8}});
const packet:GamePacket={release:PRODUCT_RELEASE,sport:'nfl',gameId:'synthetic-mean-tail',start:'2030-06-02T00:00:00Z',lock:'2030-06-01T23:00:00Z',cutoff:at,stage:'final',players:[{id:'synthetic-qb',name:'Synthetic QB',team:'A',opponent:'B',markets:['passing_tds'],missing:[],evidence}],quotes:[],sourceLimitations:[]};
const actor=packet.players[0],before=digest(packet),support=sourceMeanAdmissionSupport(packet,actor).passing_tds;
assert(support.active);assert.equal(support.minimum,1);assert.equal(support.maximum,1);
const law=(tds:number[])=>validateLaw('nfl',actor,{weights:v(1),outcomes:Object.fromEntries(primitives('nfl',actor).map(stat=>[stat,stat==='passing_tds'?tds:v(stat==='passing_attempts'?20:stat==='passing_completions'?10:stat==='passing_yards'?100:0)]))});
const primary=law(v(1)),regressed=law([...v(1).slice(1),2]),balanced=law([...v(1).slice(2),0,2]);
assert(sourceForecastIssues(packet,actor,primary).some(i=>i.code==='unsupported_zero_probability_tail'));
assert.equal(lawForecast(regressed,'passing_tds',1.5).mean,17/16);
assert(sourceForecastIssues(packet,actor,regressed).some(i=>i.code==='forecast_mean_outside_supplied_support'));
assert.equal(lawForecast(balanced,'passing_tds',1.5).mean,1);
assert.deepEqual(sourceForecastIssues(packet,actor,balanced),[],'A source-compatible toy mean and tails coexist without relaxing admission');
const input=sourceInput(packet),navigation=numericSourceNavigation(packet)!;
assert.equal(navigation.coupledMeanTailGuidance,COUPLED_MEAN_TAIL_GUIDANCE);
assert(input.includes(COUPLED_MEAN_TAIL_GUIDANCE));assert.match(NUMERIC_SOURCE_NAVIGATION_RELEASE,/r2_coupled_mean_tail_contract$/);
for(const correction of [undefined,'\nSynthetic original complete diagnostic.']){
 const request=jointReviewRequest(packet,PROPS_AI_PRIMARY_MODEL,7000,correction?'Synthetic original finding':undefined,correction);
 assert.equal(request.input,input);assert.equal(request.max_output_tokens,7000);
}
for(const release of [PROPS_AI_RELEASE,'player_props_ai_2026_11_26_r63_retained_fixture_provenance','player_props_ai_2026_11_25_r62_scoped_correction_output']){
 assert(propsReviewHasMemberExecutionContracts(release));assert(propsReviewHasVerifiedReaderClaims(release));assert(propsReviewHasSemanticChecks(release));
}
assert.equal(digest(packet),before);assert.equal(typeof nbaBenchmarkContextHash,'function');
console.log(JSON.stringify({result:'PASS',primaryMissingTailRejected:true,tailOnlyMeanRegressionRejected:true,balancedArithmeticPassesUnchangedGuards:true,sourceUnchanged:true,noPaidCalls:true,noPredictionOrComprehensionClaim:true}));
