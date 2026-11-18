/** Package the owner-approved exact frozen trial. Never fit or write a pick. */
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {createHash} from "node:crypto";
import {CBB_GROUPED_OUTCOME_RELEASE,cbbGroupedOutcomeMethodSha256,validateCbbGroupedOutcomeArtifact,type CbbGroupedOutcomeArtifact} from "../../lib/cbb/groupedOutcomeForecast";
import {cbbContextualForecastObjectSha256,type CbbContextualForecastCalibrationBinding} from "../../lib/cbb/contextualForecastCalibrationBinding";
import {packageCbbPrivateOutcomeArtifact} from "../../lib/services/cbb/cbbOutcomeArtifactEnvelope";
const PIN="c574257f60635d81d93d1d0833725d3f843a6e098e9671189a882ba558b914fa";
const hash=(v:string|Buffer)=>createHash("sha256").update(v).digest("hex");
export function buildCbbGroupedRelease(bytes:Buffer,availableBy:string){
  if(hash(bytes)!==PIN)throw Error("Owner-approved frozen candidate differs; no refit/reselection allowed");
  const trial=JSON.parse(bytes.toString());
  if(trial.calibration.status!=="converged"||trial.models.margin.status!=="converged"||trial.models.total.status!=="converged")throw Error("Unresolved candidate");
  const model:CbbGroupedOutcomeArtifact={release:CBB_GROUPED_OUTCOME_RELEASE,authority:"offline_research_only",methodSha256:cbbGroupedOutcomeMethodSha256(),
    trainingRowsSha256:trial.dataSha256,trainingGameIds:trial.models.margin.trainingIds,trainingGames:trial.models.margin.trainingIds.length,
    calibrationGameIds:trial.calibration.gameIds,createdAt:availableBy,availableBy,trainingCutoff:"2026-11-15T12:00:00.000Z",models:trial.models,
    frozenResearchArtifactSha256:PIN};
  validateCbbGroupedOutcomeArtifact(model);
  const binding:CbbContextualForecastCalibrationBinding={authority:"offline_development_only",forecastArtifactObjectSha256:cbbContextualForecastObjectSha256(model),
    forecastMethodSha256:model.methodSha256,calibrationMethodSha256:trial.calibration.methodSha256,availableBy,status:"converged",parameters:trial.calibration.parameters,
    crossfit:{scope:"disjoint_later_calibration",ownGameExcluded:true,
      trainingGameIdsSha256:hash(JSON.stringify([...model.trainingGameIds].sort((a,b)=>a-b))),
      calibrationGameIdsSha256:hash(JSON.stringify([...model.calibrationGameIds].sort((a,b)=>a-b))),rowsSha256:trial.calibration.rowsSha256}};
  const modelJSON=JSON.stringify(model),calibrationJSON=JSON.stringify({schema:"cbb_outcome_joint_calibration_v1",availableBy,
    fullModel:{fileSha256:hash(modelJSON),objectSha256:cbbContextualForecastObjectSha256(model)},
    calibration:trial.calibration,binding});
  return{model,modelJSON,calibrationJSON,...packageCbbPrivateOutcomeArtifact({runtimeModelRelease:"cbb_contextual_outcome_2026_11_18_r8_grouped_native_residual",modelJSON,calibrationJSON})};
}
if(process.argv[1]?.endsWith("build-cbb-grouped-outcome-release.ts")){
  const [input,out]=process.argv.slice(2);if(!input||!out)throw Error("Usage: build-cbb-grouped-outcome-release <frozen-trial> <new-private-directory>");
  const result=buildCbbGroupedRelease(readFileSync(input),new Date().toISOString());mkdirSync(out,{mode:0o700});
  for(const[name,value]of [["model.json",result.modelJSON],["calibration.json",result.calibrationJSON],["manifest.json",JSON.stringify(result.manifest,null,2)]]as const)
    writeFileSync(out+"/"+name,value,{flag:"wx",mode:0o600});
  writeFileSync(out+"/"+result.manifest.compressedSha256+".json.gz",result.compressed,{flag:"wx",mode:0o600});
  console.log(JSON.stringify({manifest:result.manifest,output:out}));
}
