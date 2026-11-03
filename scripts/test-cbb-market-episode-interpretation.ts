import assert from "node:assert/strict";
import {interpretCbbRelativeMarketMove as read} from "../lib/cbb/marketEpisodeInterpretation";

assert.deepEqual(read(17,28,27.5),{kind:"confirms_independent",scoreDelta:0,observedDelta:-.5});
assert.deepEqual(read(17,28,29),{kind:"corrects_independent",scoreDelta:1,observedDelta:1});
assert.deepEqual(read(17,18,16),{kind:"crosses_independent",scoreDelta:-1,observedDelta:-2});
assert.deepEqual(read(17,17,16),{kind:"corrects_independent",scoreDelta:-1,observedDelta:-1});
assert.deepEqual(read(17,28,28),{kind:"unchanged",scoreDelta:0,observedDelta:0});
assert.throws(()=>read(17,NaN,28),/finite/);
console.log("PASS CBB offline independent-relative market interpretation");
