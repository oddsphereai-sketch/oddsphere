import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {CBB_CONTEXTUAL_OUTCOME_RELEASE,CBB_OUTCOME_BLOCKS,CBB_OUTCOME_NOISE_FEATURES,CBB_OUTCOME_NOISE_BETA_OFFSET,cbbOutcomeMethodSha256,type CbbOutcomeArtifact} from "../lib/cbb/contextualOutcomeForecast";
import {cbbMeasurementMethodSha256} from "../lib/cbb/contextualMeasurementForecast";
import {cbbScoreCalibrationMethodSha256,cbbScoreCalibrationTrainingIdsSha256} from "../lib/cbb/contextualScoreCalibrationResearch";
import {packageCbbPrivateOutcomeArtifact,decodeCbbPrivateOutcomeArtifact,createCbbPrivateOutcomeArtifactLoader} from "../lib/services/cbb/cbbOutcomeArtifactEnvelope";
const sha=(v:string)=>createHash("sha256").update(v).digest("hex");
// Deliberately tiny synthetic transport fixture, never a fitted/activated model.
const factor={methodSha256:cbbMeasurementMethodSha256(),trainingGameIds:[1],margin:{optimizer:{converged:true}},total:{optimizer:{converged:true}}};
const theta=Array.from({length:CBB_OUTCOME_NOISE_BETA_OFFSET},()=>0),zero=CBB_OUTCOME_NOISE_FEATURES.map(()=>0);
const axis=(name:"margin"|"total")=>({axis:name,inputs:[{referenceMean:name==="margin"?2:150,sourceLocationVariance:1,noiseFeatures:zero,blocks:Object.fromEntries(CBB_OUTCOME_BLOCKS.map(b=>[b,{names:[],values:[],known:[],parity:[]}]))}],
 theta,noiseNormalizer:{center:zero,scale:zero.map(()=>1),knownCounts:zero,active:[]},noiseBeta:zero,alpha:[0],cholesky:[[1]],optimizer:{theta,converged:true}});
const model={release:CBB_CONTEXTUAL_OUTCOME_RELEASE,authority:"offline_research_only",methodSha256:cbbOutcomeMethodSha256(),factorArtifact:factor,baseFactorObjectSha256:sha(JSON.stringify(factor)),trainingGameIds:[1],trainingGames:1,
 availableBy:"2026-11-05T00:00:00Z",margin:axis("margin"),total:axis("total")} as unknown as CbbOutcomeArtifact;
const modelJSON=JSON.stringify(model),objectSha=sha(modelJSON),parameters={logMarginScale:0,logTotalScale:0,beta:0},binding={authority:"offline_development_only",forecastArtifactObjectSha256:objectSha,forecastMethodSha256:model.methodSha256,
 calibrationMethodSha256:cbbScoreCalibrationMethodSha256(),availableBy:"2026-11-05T00:01:00Z",status:"converged",parameters,
 crossfit:{everyTrainingGameExactlyOnce:true,ownGameExcluded:true,trainingGameIdsSha256:cbbScoreCalibrationTrainingIdsSha256([1]),rowsSha256:"a".repeat(64)}};
const calibration={schema:"cbb_outcome_joint_calibration_v1",availableBy:binding.availableBy,fullModel:{fileSha256:sha(modelJSON),objectSha256:objectSha},calibration:{status:"converged",parameters},binding};
const args={runtimeModelRelease:"synthetic_transport_only",modelJSON,calibrationJSON:JSON.stringify(calibration)},packed=packageCbbPrivateOutcomeArtifact(args),decoded=decodeCbbPrivateOutcomeArtifact(packed.compressed,packed.manifest);
assert.deepEqual(decoded.model,model);assert.deepEqual(decoded.calibration,binding);
assert.throws(()=>packageCbbPrivateOutcomeArtifact({...args,calibrationJSON:JSON.stringify({...calibration,binding:{...binding,forecastArtifactObjectSha256:"b".repeat(64)}})}),/exact model-bound/);
assert.throws(()=>packageCbbPrivateOutcomeArtifact({...args,modelJSON:JSON.stringify({...model,margin:{...model.margin,optimizer:{...model.margin.optimizer,converged:false}}})}),/unresolved/);
assert.throws(()=>packageCbbPrivateOutcomeArtifact({...args,calibrationJSON:JSON.stringify({...calibration,calibration:{status:"converged",parameters:{...parameters,beta:1}}})}),/binding differs/);
assert.throws(()=>packageCbbPrivateOutcomeArtifact({...args,calibrationJSON:JSON.stringify({...calibration,availableBy:"2026-11-04T00:00:00Z",binding:{...binding,availableBy:"2026-11-04T00:00:00Z"}})}),/unavailable/);
const bad=Buffer.from(packed.compressed);bad[20]^=1;assert.throws(()=>decodeCbbPrivateOutcomeArtifact(bad,packed.manifest),/transport/);
assert.throws(()=>decodeCbbPrivateOutcomeArtifact(packed.compressed,{...packed.manifest,uncompressedBytes:16_000_001}),/manifest/);
assert.throws(()=>decodeCbbPrivateOutcomeArtifact(packed.compressed,{...packed.manifest,runtimeModelRelease:"different"}),/identity/);
void(async()=>{
 let calls=0;const mutable={...packed.manifest},loader=createCbbPrivateOutcomeArtifactLoader(mutable,async(key,maxBytes)=>{calls++;assert.equal(key,packed.manifest.compressedSha256+".json.gz");assert.equal(maxBytes,packed.manifest.compressedBytes);return packed.compressed;});
 mutable.runtimeModelRelease="mutated_after_loader_construction";const[a,b]=await Promise.all([loader(),loader()]);assert.equal(a,b);assert.equal(calls,1);
 assert.throws(()=>{a.model.margin.alpha[0]=999;},TypeError);assert.throws(()=>{a.calibration.parameters.beta=999;},TypeError);assert.equal((await loader()).model.margin.alpha[0],0);assert.equal((await loader()).calibration.parameters.beta,0);assert.equal(calls,1);
 let tries=0;const retry=createCbbPrivateOutcomeArtifactLoader(packed.manifest,async()=>{if(++tries===1)throw Error("temporary failure");return packed.compressed;});await assert.rejects(retry(),/temporary/);assert.deepEqual((await retry()).calibration,binding);assert.equal(tries,2);
 console.log("PASS private outcome transport: exact model/calibration binding, clocks, convergence, bounded compression, corruption, immutable loader identity, shared download and retry; no network or activation");
})();
