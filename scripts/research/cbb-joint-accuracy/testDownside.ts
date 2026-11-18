import assert from "node:assert/strict";
import {stableDownside} from "./downside";
import {cbbWorkingNormalExpectedDownside as legacy} from "../../../lib/cbb/contextualScoreLawResearch";
// Independent positive-integrand Simpson integration after u=z*t. Tail beyond
// u=64 is <65*exp(-64); this oracle never subtracts Gaussian tail probabilities.
function integral(z:number) {
  const n=16384,h=64/n,fn=(u:number)=>u*Math.exp(-u-u*u/(2*z*z));
  let sum=fn(0)+fn(64);
  for(let j=1;j<n;j++)sum+=(j%2?4:2)*fn(j*h);
  return Math.exp(-.5*z*z)/Math.sqrt(2*Math.PI)*(h*sum/3)/(z*z);
}
for (const z of [12,13,20,30]) {
  const expected=integral(z), actual=stableDownside(z,1);
  assert.ok(Math.abs(actual/expected-1)<1e-10,`Independent Normal downside at z=${z}`);
  assert.ok(actual>=0 && actual<stableDownside(z-1,1));
}
for(const z of [0,.1,1,4,8,11.99])assert.equal(stableDownside(z,1),legacy(z,1),"Original normal-range arithmetic retained");
assert.equal(stableDownside(1e100,1e-100),0);
assert.equal(stableDownside(1,0),0);assert.equal(stableDownside(-1,0),1);
assert.ok(Math.abs(stableDownside(-1,1)-stableDownside(1,1)-1)<1e-15);
assert.throws(()=>stableDownside(1,-1));assert.throws(()=>stableDownside(Infinity,1));
console.log(JSON.stringify({status:"PASS",checks:18}));
