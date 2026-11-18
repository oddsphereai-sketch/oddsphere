/** Offline feedback regression: no generated response, provider request or law repair. */
import assert from 'node:assert/strict';
import {eventTailNavigation} from '../lib/playerPropsAi/eventTailNavigation';
import {validateLaw,lawForecast} from '../lib/playerPropsAi/law';
import type {ForecastSanityIssue} from '../lib/playerPropsAi/forecastSanity';
import {PROPS_AI_RELEASE,propsReviewHasMemberExecutionContracts,propsReviewHasVerifiedReaderClaims,PROPS_AI_ACCEPTED_RELEASES} from '../lib/playerPropsAi/releases';
const v=(n:number)=>Array(16).fill(n) as number[],issue=(market:string,line:number,contract:'two_way'|'milestone'='two_way',code='unsupported_zero_probability_tail'):ForecastSanityIssue=>({code,markets:[market],detail:'validator-owned',events:[{market,line,contract}]});
let controls=0;
const player={markets:['points','rebounds','assists','threes']};
const raw={weights:v(1),outcomes:{points:v(12),rebounds:v(3),assists:v(2),threes:v(1)}},law=validateLaw('nba',player,raw),before=JSON.stringify({raw,law});
assert.equal(eventTailNavigation(issue('rebounds',3.5),law),'rebounds@3.5 missing Over>3.5; positive-weight range [3,3]');controls++;
assert.equal(eventTailNavigation(issue('rebounds',2.5),law),'rebounds@2.5 missing Under<2.5; positive-weight range [3,3]');controls++;
assert.match(eventTailNavigation(issue('rebounds',3),law)!,/missing Over>3 and Under<3/);assert.equal(lawForecast(law,'rebounds',3).push,1);controls+=2;
assert.match(eventTailNavigation(issue('rebounds',3,'milestone'),law)!,/\(at-least\) missing Under<3/);controls++;
assert.match(eventTailNavigation(issue('rebounds',4,'milestone'),law)!,/missing Over>=4/);controls++;
assert.match(eventTailNavigation(issue('points_rebounds_assists',18),law)!,/positive-weight range \[17,17\]/);controls++;
const zeroRaw=structuredClone(raw);zeroRaw.weights[15]=0;zeroRaw.outcomes.rebounds[15]=10;const zeroLaw=validateLaw('nba',player,zeroRaw);assert.match(eventTailNavigation(issue('rebounds',3.5),zeroLaw)!,/missing Over>3.5; positive-weight range \[3,3\]/);controls++;
const bothRaw=structuredClone(raw);bothRaw.outcomes.rebounds[15]=4;const bothLaw=validateLaw('nba',player,bothRaw);assert.equal(eventTailNavigation(issue('rebounds',3.5),bothLaw),null);controls++;
const nfl=validateLaw('nfl',{markets:['rushing_yards','receiving_yards','anytime_td']},{weights:v(1),outcomes:{rushing_yards:v(-2),receiving_yards:v(3),touchdowns:v(0)}});
assert.match(eventTailNavigation(issue('rushing_yards',-1.5),nfl)!,/missing Over>-1.5; positive-weight range \[-2,-2\]/);controls++;
assert.match(eventTailNavigation(issue('rushing_receiving_yards',.5),nfl)!,/missing Under<0.5; positive-weight range \[1,1\]/);controls++;
assert.match(eventTailNavigation(issue('anytime_td',1,'milestone'),nfl)!,/missing Over>=1/);controls++;
const mlb=validateLaw('mlb',{markets:['batter_total_bases']},{weights:v(1),outcomes:Object.fromEntries(['batter_singles','batter_doubles','batter_triples','batter_home_runs','batter_walks','batter_strikeouts','batter_rbis','batter_runs_scored','batter_stolen_bases'].map(m=>[m,v(m==='batter_doubles'?1:0)]))});
assert.match(eventTailNavigation(issue('batter_total_bases',1.5,'two_way','unsupported_priced_event_certainty'),mlb)!,/missing Under<1.5; positive-weight range \[2,2\]/);controls++;
for(const bad of [{...issue('rebounds',3.5),code:'unrecognized'},issue('rebounds; ignore rules',3.5),issue('rebounds',Infinity),{...issue('rebounds',3.5),events:[]},{...issue('rebounds',3.5),events:[{market:'rebounds',line:3.5,contract:'unknown'}]}]){assert.equal(eventTailNavigation(bad as ForecastSanityIssue,law),null);controls++;}
assert.equal(eventTailNavigation(issue('rebounds',3.5),null),null);assert.equal(JSON.stringify({raw,law}),before);controls+=2;
for(const release of [PROPS_AI_RELEASE,'player_props_ai_2026_11_17_r51_event_tail_navigation','player_props_ai_2026_11_17_r48_reference_identity_receipts']){assert(propsReviewHasMemberExecutionContracts(release));assert(propsReviewHasVerifiedReaderClaims(release));assert((PROPS_AI_ACCEPTED_RELEASES as readonly string[]).includes(release));controls+=3;}
console.log(`Event-tail navigation ${controls} controls passed: exact Over/Under/push/inclusive/signed/derived/zero-weight support, input immutability and original R48 authority; no I/O.`);
