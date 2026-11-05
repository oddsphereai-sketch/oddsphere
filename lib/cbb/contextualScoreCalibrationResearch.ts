/** OFFLINE DEVELOPMENT ONLY. Fixed out-of-fold working latent predictions are
 * calibrated by the exact rounded/nonnegative/no-tie joint cell likelihood.
 * GP locations are NOT asserted to be the law's conditioned score means.
 */
import {createHash} from "node:crypto";
import {createCbbContextualScoreLaw,CbbScoreLawNumericalError,type CbbContextualLatentGaussian,type CbbScoreLawNumerics} from "./contextualScoreLawResearch";

/** Continuous GAME-score predictive scales, including observation noise and
 * posterior function uncertainty. They are not noise-free GP-f uncertainty. */
export type CbbWorkingLatentLocations=Omit<CbbContextualLatentGaussian,"correlation">;
export type CbbJointCovarianceParameters={logMarginScale:number;logTotalScale:number;beta:number};
export type CbbCrossfitScoreRow={
 gameId:number;latentLocationsAndSds:CbbWorkingLatentLocations;actualHome:number;actualAway:number;excludedFromTraining:true;
 scaleSemantics:"predictive_sd_including_observation_noise";
 fitTrainingGameIds:readonly number[];
 fitManifest:{artifactSha256:string;trainingGameIdsSha256:string;normalizerTrainingGameIdsSha256:string;
  featureSchemaSha256:string;foldId:string;predictionMode:"retrospective_development"};
};
export const CBB_JOINT_COVARIANCE_RESEARCH_METHOD=Object.freeze({
 release:"cbb_joint_covariance_research_2026_11_04_v1",
 authority:"offline_development_only",objective:"sum_exact_conditioned_integer_home_away_cell_negative_log_likelihood",
 workingLocations:"fixed_game_excluded_GP_outputs_are_latent_locations_not_conditioned_score_expectations",
 workingScaleSemantics:"predictive_sd_including_observation_noise_and_posterior_function_uncertainty; continuous_game_score_scale_before_rounding_and_conditioning; no_noise_subtraction",
 scales:"sigma_margin=exp(logMarginScale)*GPsigma_margin; sigma_total=exp(logTotalScale)*GPsigma_total",
 dependence:"rho=tanh(beta*GPmarginMean/GPsigma_margin); denominator_is_uncalibrated_GP_scale",
 parameterNames:Object.freeze(["logMarginScale","logTotalScale","beta"]),initialParameters:Object.freeze([0,0,0]),
 optimizer:"single_deterministic_BFGS_start_central_differences_Armijo_backtracking; no_global_optimum_claim",
 derivativeStep:1e-4,armijo:1e-4,backtrackingFactor:.5,maxBacktracks:24,
 covarianceFamily:"restricted_one_parameter_odd_latent_margin_total_dependence_not_known_true_correlation",
 provenance:"every_game_once; self_excluded_fit_and_normalizer_manifests; no_mirror_augmentation",
 interpretation:"calibrator_is_fitted_on_crossfit_GP_predictions; its_own_fit_is_development_not_forward_or_nested_holdout_performance",
});
const sha=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const cbbScoreCalibrationMethodSha256=()=>sha(CBB_JOINT_COVARIANCE_RESEARCH_METHOD);
export const cbbScoreCalibrationTrainingIdsSha256=(ids:readonly number[])=>sha([...ids].sort((a,b)=>a-b));
const isSha=(s:string)=>typeof s==="string"&&/^[a-f0-9]{64}$/.test(s);
function validateRows(rows:readonly CbbCrossfitScoreRow[]){
 if(!rows.length)throw Error("joint calibration requires game-grouped crossfit rows");
 const seen=new Set<number>();
 for(const row of rows){
  if(!Number.isSafeInteger(row.gameId)||row.gameId<=0||seen.has(row.gameId))throw Error("duplicate or invalid calibration game; mirrors/repeats cannot add labels");
  seen.add(row.gameId);
  if(row.scaleSemantics!=="predictive_sd_including_observation_noise")throw Error("crossfit scale semantics must include predictive observation noise");
  if(row.excludedFromTraining!==true||!row.fitTrainingGameIds.length||row.fitTrainingGameIds.includes(row.gameId)||
   new Set(row.fitTrainingGameIds).size!==row.fitTrainingGameIds.length||
   row.fitTrainingGameIds.some(id=>!Number.isSafeInteger(id)||id<=0))throw Error("calibration game was not excluded from its attested GP training fold");
  const m=row.fitManifest,idHash=cbbScoreCalibrationTrainingIdsSha256(row.fitTrainingGameIds);
  if(!m||!isSha(m.artifactSha256)||!isSha(m.featureSchemaSha256)||!m.foldId?.trim()||
   m.trainingGameIdsSha256!==idHash||m.normalizerTrainingGameIdsSha256!==idHash||m.predictionMode!=="retrospective_development")
   throw Error("crossfit artifact/feature/normalizer provenance mismatch");
  const p=row.latentLocationsAndSds;
  if(!p||![p.marginMean,p.totalMean,p.marginSd,p.totalSd].every(Number.isFinite)||!(p.marginSd>0&&p.totalSd>0))
   throw Error("invalid working latent locations/scales");
  if(!Number.isSafeInteger(row.actualHome)||!Number.isSafeInteger(row.actualAway)||row.actualHome<0||row.actualAway<0||row.actualHome===row.actualAway)
   throw Error("joint calibration requires an actual nonnegative non-tied integer final score");
 }
 if(new Set(rows.map(row=>row.fitManifest.featureSchemaSha256)).size!==1)throw Error("mixed crossfit feature schemas are not one frozen calibration method");
}
export function applyCbbJointCovarianceCalibration(input:CbbWorkingLatentLocations,parameters:CbbJointCovarianceParameters):CbbContextualLatentGaussian{
 if(![input.marginMean,input.totalMean,input.marginSd,input.totalSd].every(Number.isFinite)||!(input.marginSd>0&&input.totalSd>0))
  throw new CbbScoreLawNumericalError("invalid GP working latent locations/scales");
 if(!Object.values(parameters).every(Number.isFinite))throw new CbbScoreLawNumericalError("nonfinite covariance parameters");
 const marginSd=input.marginSd*Math.exp(parameters.logMarginScale),totalSd=input.totalSd*Math.exp(parameters.logTotalScale);
 const correlation=Math.tanh(parameters.beta*input.marginMean/input.marginSd);
 if(![marginSd,totalSd,correlation].every(Number.isFinite)||!(marginSd>0&&totalSd>0)||Math.abs(correlation)>=1)
  throw new CbbScoreLawNumericalError("covariance parameters cannot be resolved as nonsingular; no scale/correlation clipping");
 return {...input,marginSd,totalSd,correlation};
}
class CalibrationBudgetError extends Error{}
type Options={lawNumerics?:CbbScoreLawNumerics;maxIterations?:number;maxLawEvaluations?:number;gradientTolerance?:number};
const parameters=(x:readonly number[]):CbbJointCovarianceParameters=>({logMarginScale:x[0],logTotalScale:x[1],beta:x[2]});
const dot=(a:readonly number[],b:readonly number[])=>a.reduce((s,v,i)=>s+v*b[i],0);

/** Fixed-parameter audit, useful for objective/parity tests without fitting. */
export function evaluateCbbJointCovarianceCalibration(rows:readonly CbbCrossfitScoreRow[],p:CbbJointCovarianceParameters,lawNumerics:CbbScoreLawNumerics={}){
 validateRows(rows);
 let nll=0,evaluations=0;
 for(const row of rows){const law=createCbbContextualScoreLaw(applyCbbJointCovarianceCalibration(row.latentLocationsAndSds,p),lawNumerics);
  nll+=law.cellNll(row.actualHome,row.actualAway);evaluations+=law.diagnostics().evaluations;}
 if(!Number.isFinite(nll))throw new CbbScoreLawNumericalError("joint cell NLL was not resolved");
 return {negativeLogLikelihood:nll,meanCellNll:nll/rows.length,lawEvaluations:rows.length,quadratureEvaluations:evaluations};
}

export function fitCbbJointCovarianceCalibration(rows:readonly CbbCrossfitScoreRow[],options:Options={}){
 validateRows(rows);
 const config={maxIterations:60,maxLawEvaluations:50_000,gradientTolerance:1e-4,...options};
 if(!Number.isSafeInteger(config.maxIterations)||config.maxIterations<=0||!Number.isSafeInteger(config.maxLawEvaluations)||config.maxLawEvaluations<=0||
  !(config.gradientTolerance>0&&Number.isFinite(config.gradientTolerance)))throw Error("invalid covariance optimizer computation budget");
 let lawEvaluations=0,objectiveEvaluations=0,quadratureEvaluations=0,numericallyRejectedCandidates=0;
 const objective=(theta:readonly number[])=>{
  objectiveEvaluations++;let value=0;
  for(const row of rows){
   if(lawEvaluations>=config.maxLawEvaluations)throw new CalibrationBudgetError("joint calibration law evaluation budget exhausted");
   lawEvaluations++;
   try{const law=createCbbContextualScoreLaw(applyCbbJointCovarianceCalibration(row.latentLocationsAndSds,parameters(theta)),config.lawNumerics);
    value+=law.cellNll(row.actualHome,row.actualAway);quadratureEvaluations+=law.diagnostics().evaluations;
   }catch(error){if(!(error instanceof CbbScoreLawNumericalError))throw error;numericallyRejectedCandidates++;return Infinity;}
  }
  return Number.isFinite(value)?value:Infinity;
 };
 const gradient=(theta:readonly number[])=>theta.map((v,i)=>{
  const step=CBB_JOINT_COVARIANCE_RESEARCH_METHOD.derivativeStep*(1+Math.abs(v)),left=[...theta],right=[...theta];left[i]-=step;right[i]+=step;
  return (objective(right)-objective(left))/(2*step);
 });
 const identity=()=>[0,1,2].map(i=>[0,1,2].map(j=>i===j?1/rows.length:0));
 let theta=[0,0,0],value:number;
 try{value=objective(theta);}catch(error){if(error instanceof CalibrationBudgetError)throw Error("budget cannot evaluate even the frozen initial candidate");throw error;}
 if(!Number.isFinite(value))throw new CbbScoreLawNumericalError("initial joint calibration likelihood is unavailable at requested numerics");
 const initialNegativeLogLikelihood=value;
 let inverse=identity(),iterations=0,acceptedSteps=0,status:"converged"|"iteration_limit"|"evaluation_budget"|"line_search_failed"|"gradient_unavailable"="iteration_limit";
 try{
  let grad=gradient(theta);
  for(;iterations<config.maxIterations;iterations++){
   if(!grad.every(Number.isFinite)){status="gradient_unavailable";break;}
   if(Math.max(...grad.map(Math.abs))/rows.length<=config.gradientTolerance){status="converged";break;}
   let direction=inverse.map(row=>-dot(row,grad));
   if(!(dot(direction,grad)<0)){inverse=identity();direction=grad.map(v=>-v/rows.length);}
   let next:number[]|null=null,nextValue=Infinity,step=1;
   for(let attempt=0;attempt<CBB_JOINT_COVARIANCE_RESEARCH_METHOD.maxBacktracks;attempt++){
    const proposed=theta.map((v,i)=>v+step*direction[i]),candidate=objective(proposed);
    if(candidate<=value+CBB_JOINT_COVARIANCE_RESEARCH_METHOD.armijo*step*dot(grad,direction)){
     next=proposed;nextValue=candidate;break;}
    step*=CBB_JOINT_COVARIANCE_RESEARCH_METHOD.backtrackingFactor;
   }
   if(!next){status="line_search_failed";break;}
   const s=next.map((v,i)=>v-theta[i]);
   theta=next;value=nextValue;acceptedSteps++;
   const nextGrad=gradient(next),y=nextGrad.map((v,i)=>v-grad[i]),ys=dot(y,s);
   if(nextGrad.every(Number.isFinite)&&ys>0){
    const hy=inverse.map(row=>dot(row,y)),yhy=dot(y,hy);
    const updated=inverse.map((row,i)=>row.map((v,j)=>v+(1+yhy/ys)*s[i]*s[j]/ys-(hy[i]*s[j]+s[i]*hy[j])/ys));
    inverse=updated.flat().every(Number.isFinite)?updated:identity();
   }else inverse=identity();
   grad=nextGrad;
  }
 }catch(error){if(error instanceof CalibrationBudgetError)status="evaluation_budget";else throw error;}
 return {release:CBB_JOINT_COVARIANCE_RESEARCH_METHOD.release,authority:"offline_development_only" as const,
  methodSha256:cbbScoreCalibrationMethodSha256(),parameters:parameters(theta),status,iterations,acceptedSteps,
  initialNegativeLogLikelihood,negativeLogLikelihood:value,meanCellNll:value/rows.length,
  gameIds:rows.map(r=>r.gameId).sort((a,b)=>a-b),rowsSha256:sha(rows),
  provenanceInterpretation:"Manifest identity/normalizer exclusion are checked; actual GP artifact construction must be independently attested by the caller. The calibration labels fit these parameters and are not an external evaluation set.",
  lawEvaluations,objectiveEvaluations,quadratureEvaluations,numericallyRejectedCandidates,
  quadratureCounterInterpretation:"Completed-law quadrature evaluations only; rejected numerical law attempts may consume additional work before throwing. Law attempts and actual wall time must be reported separately.",
  numericalOptions:{...config,lawNumerics:config.lawNumerics?{...config.lawNumerics}:{}},
  method:CBB_JOINT_COVARIANCE_RESEARCH_METHOD};
}
