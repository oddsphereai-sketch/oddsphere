import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {assertCbbContextualForecastCalibrationBinding,cbbContextualForecastObjectSha256,freezeCbbContextualForecastArtifact,type CbbContextualForecastCalibrationBinding} from "../lib/cbb/contextualForecastCalibrationBinding";
import {cbbScoreCalibrationMethodSha256} from "../lib/cbb/contextualScoreCalibrationResearch";
const artifact={trainingGameIds:[1,3],availableBy:"2026-11-05T13:00:00Z",methodSha256:"a".repeat(64)};
const calibration:CbbContextualForecastCalibrationBinding={authority:"offline_development_only",forecastArtifactObjectSha256:cbbContextualForecastObjectSha256(artifact),forecastMethodSha256:artifact.methodSha256,
 calibrationMethodSha256:cbbScoreCalibrationMethodSha256(),availableBy:"2026-11-05T13:01:00Z",status:"converged",parameters:{logMarginScale:0,logTotalScale:0,beta:0},
 crossfit:{everyTrainingGameExactlyOnce:true,ownGameExcluded:true,trainingGameIdsSha256:createHash("sha256").update(JSON.stringify([1,3])).digest("hex"),rowsSha256:"b".repeat(64)}};
const args={artifact,calibration,asOf:"2026-11-05T13:02:00Z",mode:"future" as const};
assert.equal(assertCbbContextualForecastCalibrationBinding(args),true);
assert.throws(()=>assertCbbContextualForecastCalibrationBinding({...args,asOf:"2026-11-05T12:00:00Z"}),/unavailable/);
assert.equal(assertCbbContextualForecastCalibrationBinding({...args,asOf:"2026-11-04T12:00:00Z",mode:"retrospective_development"}),true);
assert.throws(()=>assertCbbContextualForecastCalibrationBinding({...args,artifact:{...artifact,trainingGameIds:[1,4]}}),/exact model-bound/);
assert.throws(()=>assertCbbContextualForecastCalibrationBinding({...args,artifact:{...artifact,trainingGameIds:[1,1]}}),/exact model-bound/);
assert.throws(()=>assertCbbContextualForecastCalibrationBinding({...args,calibration:{...calibration,parameters:{...calibration.parameters,beta:NaN}}}),/exact model-bound/);
assert.throws(()=>assertCbbContextualForecastCalibrationBinding({...args,calibration:{...calibration,crossfit:{...calibration.crossfit,rowsSha256:"x".repeat(64)}}}),/exact model-bound/);
assert.throws(()=>assertCbbContextualForecastCalibrationBinding({...args,calibration:{...calibration,availableBy:"2026-11-05T12:59:00Z"}}),/unavailable/);
const mutable={...artifact,nested:{value:1}},originalHash=cbbContextualForecastObjectSha256(mutable);mutable.nested.value=2;assert.notEqual(cbbContextualForecastObjectSha256(mutable),originalHash,"Mutable objects are never identity-cached");
const shallow=Object.freeze({...artifact,nested:{value:1}}),shallowHash=cbbContextualForecastObjectSha256(shallow);shallow.nested.value=2;assert.notEqual(cbbContextualForecastObjectSha256(shallow),shallowHash,"Top-level freeze cannot authorize hash reuse");
const deep=freezeCbbContextualForecastArtifact(shallow),exact=createHash("sha256").update(JSON.stringify(deep)).digest("hex");assert.equal(cbbContextualForecastObjectSha256(deep),exact);assert.throws(()=>{deep.nested.value=3;},TypeError);assert.equal(cbbContextualForecastObjectSha256(deep),exact);
console.log("PASS contextual forecast/calibration binding: exact model/cohort/method, whole parameters and causal availability; no fitting or live writes");
