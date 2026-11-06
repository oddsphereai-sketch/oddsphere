import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createCbbContextualScoreLaw} from "../lib/cbb/contextualScoreLawResearch";
import {applyCbbJointCovarianceCalibration,cbbScoreCalibrationMethodSha256,cbbScoreCalibrationTrainingIdsSha256,
 evaluateCbbJointCovarianceCalibration,fitCbbJointCovarianceCalibration,validateCbbCrossfitScoreRows,type CbbCrossfitScoreRow,type CbbCrossfitAxisFitManifest} from "../lib/cbb/contextualScoreCalibrationResearch";

// Entirely synthetic final scores and GP locations. No actual game, cached
// outcome file, provider or database is consumed by this method test/benchmark.
const rows:CbbCrossfitScoreRow[]=[
 [101,1,11,7,4],[102,-1,12,4,8],[103,2,13,9,5],[104,-2,12,4,7],
].map(([gameId,marginMean,totalMean,actualHome,actualAway])=>{
 const fitTrainingGameIds=[201,202,203],ids=cbbScoreCalibrationTrainingIdsSha256(fitTrainingGameIds);
 return {gameId,latentLocationsAndSds:{marginMean,totalMean,marginSd:2,totalSd:3},actualHome,actualAway,excludedFromTraining:true,
  scaleSemantics:"predictive_sd_including_observation_noise",
  fitTrainingGameIds,fitManifest:{artifactSha256:"a".repeat(64),featureSchemaSha256:"b".repeat(64),foldId:`synthetic-${gameId}`,
   predictionMode:"retrospective_development",trainingGameIdsSha256:ids,normalizerTrainingGameIdsSha256:ids}};
});
const before=JSON.stringify(rows),parameters={logMarginScale:.1,logTotalScale:-.2,beta:.25};
const objective=evaluateCbbJointCovarianceCalibration(rows,parameters);
let manual=0;
for(const row of rows){
 const latent=applyCbbJointCovarianceCalibration(row.latentLocationsAndSds,parameters),law=createCbbContextualScoreLaw(latent);
 assert.equal(latent.marginMean,row.latentLocationsAndSds.marginMean);assert.equal(latent.totalMean,row.latentLocationsAndSds.totalMean);
 assert.equal(latent.marginSd,Math.exp(parameters.logMarginScale)*row.latentLocationsAndSds.marginSd);
 assert.equal(latent.totalSd,Math.exp(parameters.logTotalScale)*row.latentLocationsAndSds.totalSd);
 assert.equal(latent.correlation,Math.tanh(parameters.beta*row.latentLocationsAndSds.marginMean/row.latentLocationsAndSds.marginSd));
 manual+=law.cellNll(row.actualHome,row.actualAway);
 const summary=law.summary();
 assert.equal(summary.totalMean,summary.homeMean+summary.awayMean);
 assert.equal(summary.marginMean,summary.homeMean-summary.awayMean);
}
assert.equal(objective.negativeLogLikelihood,manual,"optimizer objective is the same exact integer-cell joint law used at prediction");
assert.equal(objective.lawEvaluations,rows.length);
assert.equal(cbbScoreCalibrationMethodSha256(),"c27ab973cb5d3a870940960c25c367060f16b73da6a8e904c5943255bf672d75","Optional provenance validation cannot relabel the unchanged legacy mathematical calibration method");
const hash=(x:unknown)=>createHash("sha256").update(JSON.stringify(x)).digest("hex");
const compositeRows=rows.map(row=>{const inputSha256="f".repeat(64),component=(axis:"margin"|"total",ids:number[]):CbbCrossfitAxisFitManifest=>({axis,artifactSha256:(axis==="margin"?"1":"2").repeat(64),artifactObjectSha256:(axis==="margin"?"3":"4").repeat(64),methodSha256:(axis==="margin"?"5":"6").repeat(64),trainingRowsSha256:"7".repeat(64),trainingGameIds:ids,normalizerTrainingGameIds:ids,trainingGameIdsSha256:cbbScoreCalibrationTrainingIdsSha256(ids),normalizerTrainingGameIdsSha256:cbbScoreCalibrationTrainingIdsSha256(ids),inputSha256,foldId:axis==="margin"?"old-fold":"different-new-fold",predictionMode:"retrospective_development",ownGameExcluded:true,source:axis==="margin"?"frozen_full_never_trained_game_prediction":"saved_game_excluded_prediction"}),perAxisFitManifests={margin:component("margin",[201,202]),total:component("total",[202,203])};return{...row,inputSha256,perAxisFitManifests,fitManifest:{...row.fitManifest,artifactSha256:hash({marginArtifactSha256:perAxisFitManifests.margin.artifactSha256,totalArtifactSha256:perAxisFitManifests.total.artifactSha256}),provenanceScope:"per_axis_union_no_shared_fit_or_normalizer" as const}};});
assert.equal(validateCbbCrossfitScoreRows(compositeRows),true);
assert.equal(evaluateCbbJointCovarianceCalibration(compositeRows,parameters).negativeLogLikelihood,objective.negativeLogLikelihood,"Per-axis provenance changes no location, likelihood or covariance math");
const badComposite=(mutate:(r:CbbCrossfitScoreRow[])=>void,pattern:RegExp)=>{const candidate=structuredClone(compositeRows);mutate(candidate);assert.throws(()=>validateCbbCrossfitScoreRows(candidate),pattern);};
badComposite(r=>{delete r[0].fitManifest.provenanceScope;},/explicit union/);
badComposite(r=>{r[0].perAxisFitManifests!.margin.trainingGameIds=[r[0].gameId,201];},/per-axis fit/);
badComposite(r=>{r[0].perAxisFitManifests!.total.normalizerTrainingGameIds=[r[0].gameId,202];},/per-axis fit/);
badComposite(r=>{r[0].perAxisFitManifests!.margin.inputSha256="e".repeat(64);},/per-axis fit/);
badComposite(r=>{const x=r[0];x.fitTrainingGameIds=[201,202];x.fitManifest.trainingGameIdsSha256=x.fitManifest.normalizerTrainingGameIdsSha256=cbbScoreCalibrationTrainingIdsSha256(x.fitTrainingGameIds);},/union or component/);
badComposite(r=>{r[0].fitManifest.artifactSha256="9".repeat(64);},/union or component/);
badComposite(r=>{r[1].perAxisFitManifests!.total.methodSha256="8".repeat(64);},/mixed component methods/);
assert.throws(()=>validateCbbCrossfitScoreRows([compositeRows[0],rows[1]]),/mixed legacy and per-axis/);

const mirrored=rows.map(row=>({...row,latentLocationsAndSds:{...row.latentLocationsAndSds,marginMean:-row.latentLocationsAndSds.marginMean},
 actualHome:row.actualAway,actualAway:row.actualHome}));
assert.ok(Math.abs(evaluateCbbJointCovarianceCalibration(mirrored,parameters).negativeLogLikelihood-objective.negativeLogLikelihood)<1e-8);
assert.throws(()=>evaluateCbbJointCovarianceCalibration([rows[0],rows[0]],parameters),/duplicate/);
assert.throws(()=>evaluateCbbJointCovarianceCalibration([{...rows[0],fitTrainingGameIds:[rows[0].gameId,201]}],parameters),/excluded/);
assert.throws(()=>evaluateCbbJointCovarianceCalibration([{...rows[0],excludedFromTraining:false as unknown as true}],parameters),/excluded/);
assert.throws(()=>evaluateCbbJointCovarianceCalibration([{...rows[0],scaleSemantics:"noise_free_function_sd" as unknown as CbbCrossfitScoreRow["scaleSemantics"]}],parameters),/observation noise/);
assert.throws(()=>evaluateCbbJointCovarianceCalibration([{...rows[0],fitManifest:{...rows[0].fitManifest,normalizerTrainingGameIdsSha256:"c".repeat(64)}}],parameters),/provenance/);
assert.throws(()=>evaluateCbbJointCovarianceCalibration([{...rows[0],fitManifest:{...rows[0].fitManifest,artifactSha256:"unattested"}}],parameters),/provenance/);
assert.throws(()=>evaluateCbbJointCovarianceCalibration([rows[0],{...rows[1],fitManifest:{...rows[1].fitManifest,featureSchemaSha256:"c".repeat(64)}}],parameters),/schemas/);
assert.throws(()=>evaluateCbbJointCovarianceCalibration([{...rows[0],actualAway:rows[0].actualHome}],parameters),/non-tied/);
assert.throws(()=>applyCbbJointCovarianceCalibration(rows[0].latentLocationsAndSds,{...parameters,beta:1e308}),/clipping/);
assert.throws(()=>applyCbbJointCovarianceCalibration(rows[0].latentLocationsAndSds,{...parameters,logMarginScale:1000}),/clipping/);
assert.throws(()=>evaluateCbbJointCovarianceCalibration(rows,parameters,{maxEvaluations:1}),/budget/);

// Tiny, explicit computation budget reports unfinished status; it cannot be
// mislabeled a converged calibration or substituted for a probability floor.
const limited=fitCbbJointCovarianceCalibration(rows,{maxIterations:10,maxLawEvaluations:rows.length});
assert.equal(limited.status,"evaluation_budget");assert.equal(limited.acceptedSteps,0);
assert.equal(limited.negativeLogLikelihood,limited.initialNegativeLogLikelihood);
assert.throws(()=>fitCbbJointCovarianceCalibration(rows,{maxLawEvaluations:1}),/initial candidate/);

const start=Date.now();
const fit=fitCbbJointCovarianceCalibration(rows,{maxIterations:12,maxLawEvaluations:3000});
const elapsedMs=Date.now()-start;
assert.ok(fit.negativeLogLikelihood<=fit.initialNegativeLogLikelihood);
assert.equal(fit.methodSha256,cbbScoreCalibrationMethodSha256());
assert.deepEqual(fit.gameIds,rows.map(row=>row.gameId));
assert.equal(fit.authority,"offline_development_only");
assert.ok(["converged","iteration_limit","line_search_failed","evaluation_budget","gradient_unavailable"].includes(fit.status));
assert.ok(fit.lawEvaluations<=3000);
const mirrorFit=fitCbbJointCovarianceCalibration(mirrored,{maxIterations:12,maxLawEvaluations:3000});
assert.ok(Math.abs(mirrorFit.negativeLogLikelihood-fit.negativeLogLikelihood)<1e-7);
for(const key of ["logMarginScale","logTotalScale","beta"] as const)
 assert.ok(Math.abs(mirrorFit.parameters[key]-fit.parameters[key])<1e-4,"coordinate reversal cannot fit a different covariance policy");
assert.equal(JSON.stringify(rows),before,"calibration does not rewrite fixed OOF predictions, manifests or labels");
const realisticScaleRows=rows.map((row,i)=>({...row,latentLocationsAndSds:{marginMean:i%2? -3:3,totalMean:150,marginSd:12,totalSd:17},
 actualHome:i%2?70:80,actualAway:i%2?80:70}));
const realStart=Date.now();
const realisticObjective=evaluateCbbJointCovarianceCalibration(realisticScaleRows,{logMarginScale:0,logTotalScale:0,beta:0});
const realisticElapsedMs=Date.now()-realStart;
console.log(JSON.stringify({result:"PASS research-only covariance calibration: exact joint NLL, orientation, fixed latent semantics, provenance and explicit budgets",
 syntheticBenchmark:{games:rows.length,elapsedMs,status:fit.status,acceptedSteps:fit.acceptedSteps,lawEvaluations:fit.lawEvaluations,
  quadratureEvaluations:fit.quadratureEvaluations,objectiveEvaluations:fit.objectiveEvaluations,
  initialNll:fit.initialNegativeLogLikelihood,finalNll:fit.negativeLogLikelihood,parameters:fit.parameters},
 realisticScoreSyntheticObjective:{games:realisticScaleRows.length,elapsedMs:realisticElapsedMs,
  lawEvaluations:realisticObjective.lawEvaluations,quadratureEvaluations:realisticObjective.quadratureEvaluations,
  note:"single fixed-parameter synthetic objective, not actual-data fitting or a performance claim"}}));
