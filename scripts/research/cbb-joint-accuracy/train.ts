/** One preregistered pair of fits and one separate exact-law calibration. */
import {readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {fit,predict,RELEASE} from "./regression";
import {fitCbbJointCovarianceCalibration,type CbbCrossfitScoreRow} from "../../../lib/cbb/contextualScoreCalibrationResearch";

const [dataPath,cohortPath,outputPath]=process.argv.slice(2);
if (!dataPath || !cohortPath || !outputPath) throw Error("Usage: train <coordinates> <original-qualified-cohorts> <new-output>");
const hash=(v:unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const data=JSON.parse(readFileSync(dataPath,"utf8")), prior=JSON.parse(readFileSync(cohortPath,"utf8"));
if (data.failures.length) throw Error("Cannot fit incomplete source census");
if (prior.cohorts.training.length!==274 || prior.cohorts.calibration.length!==110 || prior.cohorts.evaluation.length!==111)
  throw Error("Cohorts differ from the preregistered single trial");
const select=(ids:number[]) => ids.map(id => {
  const r=data.rows.find((x:{gameId:number}) => x.gameId===id);
  if (!r || !Number.isSafeInteger(r.actualHome) || !Number.isSafeInteger(r.actualAway) || r.actualHome===r.actualAway) throw Error("Missing exact training/calibration label");
  return r;
});
const training=select(prior.cohorts.training), calibration=select(prior.cohorts.calibration);
if (new Set([...prior.cohorts.training,...prior.cohorts.calibration,...prior.cohorts.evaluation]).size!==
    prior.cohorts.training.length+prior.cohorts.calibration.length+prior.cohorts.evaluation.length) throw Error("Overlapping cohorts");
const models=Object.fromEntries((["margin","total"] as const).map(axis => {
  console.log(JSON.stringify({stage:"fit_start",axis,games:training.length}));
  const m=fit(training.map(r => ({...r[axis],target:axis==="margin" ? r.actualHome-r.actualAway : r.actualHome+r.actualAway})));
  console.log(JSON.stringify({stage:"fit_complete",axis,status:m.status,iterations:m.iterations,active:m.active.length,
    noiseSd:Math.sqrt(m.noiseVariance),precisions:m.fittedPrecisions,gradient:m.maxGradientPerGame}));
  if (m.status!=="converged") throw Error("Declared single fit did not converge; no retry");
  return [axis,m];
}));
// The unchanged calibration mathematics accepts attested excluded-game latent
// predictions. These manifests attest Bayesian regressions, never a GP fit.
const trainIds=training.map(r => r.gameId).sort((a:number,b:number) => a-b), idHash=hash(trainIds), artifactHash=hash(models);
const calRows: CbbCrossfitScoreRow[]=calibration.map(r => {
  const margin=predict(models.margin,r.margin), total=predict(models.total,r.total);
  return {gameId:r.gameId,actualHome:r.actualHome,actualAway:r.actualAway,excludedFromTraining:true,
    scaleSemantics:"predictive_sd_including_observation_noise",fitTrainingGameIds:trainIds,
    latentLocationsAndSds:{marginMean:margin.mean,marginSd:margin.sd,totalMean:total.mean,totalSd:total.sd},
    fitManifest:{artifactSha256:artifactHash,trainingGameIdsSha256:idHash,normalizerTrainingGameIdsSha256:idHash,
      featureSchemaSha256:hash({margin:models.margin.names,total:models.total.names}),foldId:"separate_Nov13_14_calibration_never_in_mean_fit",
      predictionMode:"retrospective_development"}};
});
console.log(JSON.stringify({stage:"calibration_start",games:calRows.length}));
const calibrated=fitCbbJointCovarianceCalibration(calRows);
const out={at:new Date().toISOString(),release:RELEASE,authority:"offline_only_no_live_activation",models,
  calibration:{...calibrated,workingMeanMethod:"grouped_Bayesian_residual_regression_not_GP"},calibrationRows:calRows,
  cohorts:prior.cohorts,excludedLabelClockGames:prior.excluded,dataSha256:hash(data),modelsSha256:artifactHash,
  cohortDeclarationSha256:createHash("sha256").update(readFileSync(cohortPath)).digest("hex")};
writeFileSync(outputPath,JSON.stringify(out),{flag:"wx",mode:0o600});
console.log(JSON.stringify({stage:"calibration_complete",status:calibrated.status,parameters:calibrated.parameters,
  iterations:calibrated.iterations,lawEvaluations:calibrated.lawEvaluations}));
if (calibrated.status!=="converged") throw Error("Declared calibration failed; no retry");
