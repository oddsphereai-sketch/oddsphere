/** Mathematical/property controls only; zero network or model access. */
import assert from "node:assert/strict";
import {decodeGenerativeScenarioLaw,encodeCanonicalScenarioLaw,generativeStatistics} from "../lib/playerPropsAi/generativeCoordinates";
import {validateLaw,primitives,type PlayerLaw} from "../lib/playerPropsAi/law";
const n=16,vector=(v:number)=>Array<number>(n).fill(v);
for(let seed=1;seed<=200;seed++)for(const sport of ["nba","nfl","mlb"] as const){
 const player={markets:sport==="nba"?["points","rebounds","points_rebounds_assists"]:sport==="nfl"?["passing_yards","passing_attempts","rushing_attempts","rushing_yards","receiving_yards","receptions","anytime_td"]:["batter_home_runs","batter_hits_runs_rbis"]};
 const outcomes=Object.fromEntries(primitives(sport,player).map(k=>[k,Array.from({length:n},(_,i)=>{
  const x=seed+i,td=x%3,cmp=td+x%30,ints=x%2,hr=x%4;
  const values:Record<string,number>={threes:x%6,points:3*(x%6)+(x*7)%36,passing_tds:td,passing_completions:cmp,interceptions:ints,passing_attempts:cmp+ints+x%12,passing_yards:cmp?(x*17)%400-30:0,rushing_yards:(x*3)%100-10,receiving_yards:(x*5)%150-5,batter_home_runs:hr,batter_runs_scored:hr+x%3,batter_rbis:hr+x%5};return values[k]??x%7;
 })]));
 const law:PlayerLaw={weights:Array.from({length:n},(_,i)=>(seed+i)%13),outcomes},original=JSON.stringify(law),encoded=encodeCanonicalScenarioLaw(sport,player,law),decoded=decodeGenerativeScenarioLaw(sport,player,encoded);
 assert.equal(validateLaw(sport,player,decoded).hash,validateLaw(sport,player,law).hash);assert.equal(JSON.stringify(law),original);
 const reordered={weights:encoded.weights,outcomes:Object.fromEntries(Object.entries(encoded.outcomes).reverse())};assert.equal(validateLaw(sport,player,decodeGenerativeScenarioLaw(sport,player,reordered)).hash,validateLaw(sport,player,law).hash);
}
const nba={markets:["points"]},validNba={weights:vector(1),outcomes:{points:vector(20),rebounds:vector(4),assists:vector(3),threes:vector(2)}},wire=encodeCanonicalScenarioLaw("nba",nba,validNba);
assert.throws(()=>decodeGenerativeScenarioLaw("nba",nba,validNba),/coordinates mismatch/);assert.throws(()=>decodeGenerativeScenarioLaw("nba",nba,{...wire,outcomes:{...wire.outcomes,unexpected:vector(1)}}),/mismatch/);
assert.throws(()=>decodeGenerativeScenarioLaw("nba",nba,{...wire,outcomes:{...wire.outcomes,points_excluding_made_threes:vector(-1)}}),/integer units/);
assert.throws(()=>decodeGenerativeScenarioLaw("nba",nba,{...wire,outcomes:{...wire.outcomes,points_excluding_made_threes:vector(10000),threes:vector(10000)}}),/Invalid integer stat units/);
assert.throws(()=>encodeCanonicalScenarioLaw("nba",nba,{...validNba,outcomes:{...validNba.outcomes,points:vector(1)}}),/contradict/);
const nfl={markets:["passing_yards"]},canonical={weights:vector(1),outcomes:{passing_attempts:vector(1),passing_completions:vector(0),passing_yards:vector(0),passing_tds:vector(0),interceptions:vector(0)}},zero=encodeCanonicalScenarioLaw("nfl",nfl,canonical),potential={...zero,outcomes:{...zero.outcomes,passing_yards_if_completion:vector(900)}};
const raw=JSON.stringify(potential);assert.equal(validateLaw("nfl",nfl,decodeGenerativeScenarioLaw("nfl",nfl,potential)).hash,validateLaw("nfl",nfl,canonical).hash);assert.equal(JSON.stringify(potential),raw);assert.notEqual(raw,JSON.stringify(zero));
assert.throws(()=>encodeCanonicalScenarioLaw("nfl",nfl,{...canonical,outcomes:{...canonical.outcomes,passing_yards:vector(1)}}),/completed pass/);
const negative={...canonical,outcomes:{...canonical.outcomes,passing_completions:vector(1),passing_yards:vector(-3)}};assert.equal(decodeGenerativeScenarioLaw("nfl",nfl,encodeCanonicalScenarioLaw("nfl",nfl,negative)).outcomes.passing_yards[0],-3);
assert.deepEqual(generativeStatistics("nfl",{markets:["rushing_yards"]}),["rushing_yards"]);
console.log("Named generative coordinates passed: 600 all-sport round trips preserve exact canonical R1 hashes, key-order independence, latent-byte distinction, true signed yards, zero-completion activation and invalid-count/overflow/old-canonical refusal. No network or paid calls.");
