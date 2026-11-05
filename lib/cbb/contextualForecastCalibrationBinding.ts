/** Exact identity/availability contract for an offline composite forecast.
 * It does not fit, activate, fetch or persist a model. */
import {createHash} from "node:crypto";
import {cbbScoreCalibrationMethodSha256,type CbbJointCovarianceParameters} from "./contextualScoreCalibrationResearch";
export type CbbContextualForecastIdentity={trainingGameIds:readonly number[];availableBy:string;methodSha256:string};
const immutableHashes=new WeakMap<CbbContextualForecastIdentity,string>();
export const cbbContextualForecastObjectSha256=(artifact:CbbContextualForecastIdentity)=>immutableHashes.get(artifact)??createHash("sha256").update(JSON.stringify(artifact)).digest("hex");
/** Register only after recursive freezing. A shallow-frozen object is never
 * trusted for identity reuse; ordinary mutable audit objects are rehashed. */
export function freezeCbbContextualForecastArtifact<T extends CbbContextualForecastIdentity>(artifact:T):T{
 const seen=new WeakSet<object>();const freeze=(v:unknown)=>{if(v&&typeof v==="object"&&!seen.has(v)){seen.add(v);Object.values(v).forEach(freeze);Object.freeze(v);}};
 freeze(artifact);immutableHashes.set(artifact,createHash("sha256").update(JSON.stringify(artifact)).digest("hex"));return artifact;
}
export type CbbContextualForecastCalibrationBinding={authority:"offline_development_only";forecastArtifactObjectSha256:string;forecastMethodSha256:string;
 calibrationMethodSha256:string;availableBy:string;status:"converged";parameters:CbbJointCovarianceParameters;
 crossfit:{everyTrainingGameExactlyOnce:true;ownGameExcluded:true;trainingGameIdsSha256:string;rowsSha256:string}};
export function assertCbbContextualForecastCalibrationBinding(args:{artifact:CbbContextualForecastIdentity;calibration:CbbContextualForecastCalibrationBinding;
 asOf:string;mode:"future"|"retrospective_development"}){
 const {artifact:a,calibration:c}=args,hex=/^[a-f0-9]{64}$/;
 const ids=createHash("sha256").update(JSON.stringify([...a.trainingGameIds].sort((x,y)=>x-y))).digest("hex");
 if(!a.trainingGameIds.length||new Set(a.trainingGameIds).size!==a.trainingGameIds.length||a.trainingGameIds.some(id=>!Number.isSafeInteger(id)||id<=0)||
  c.authority!=="offline_development_only"||c.status!=="converged"||c.forecastArtifactObjectSha256!==cbbContextualForecastObjectSha256(a)||
  c.forecastMethodSha256!==a.methodSha256||c.calibrationMethodSha256!==cbbScoreCalibrationMethodSha256()||c.crossfit?.everyTrainingGameExactlyOnce!==true||
  c.crossfit.ownGameExcluded!==true||c.crossfit.trainingGameIdsSha256!==ids||!hex.test(c.crossfit.rowsSha256)||
  !c.parameters||![c.parameters.logMarginScale,c.parameters.logTotalScale,c.parameters.beta].every(Number.isFinite))
  throw Error("CBB contextual forecast requires exact model-bound own-game-excluded calibration");
 const available=Date.parse(c.availableBy),model=Date.parse(a.availableBy),at=Date.parse(args.asOf);
 if(![available,model,at].every(Number.isFinite)||available<model||!["future","retrospective_development"].includes(args.mode)||
  args.mode==="future"&&available>at)throw Error("CBB contextual calibration unavailable at decision cutoff");
 return true;
}
