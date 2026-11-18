/** Frozen R2 fits, one admitted native receipt, one later joint calibration.
 * No training, source allocation, writer or provider calls occur at inference.
 */
import {createHash} from "node:crypto";
import {coordinates} from "./groupedOutcomeCoordinates";
import {predict,type ResidualModel} from "./groupedResidualPrediction";
import {buildCbbContextualMarketInterpretation} from "./contextualMarketInterpretation";
import type {CbbContextualFeatureInput} from "./contextualForecastFeatures";
export const CBB_GROUPED_OUTCOME_RELEASE="cbb_grouped_outcome_2026_11_18_r1_native_innovation_residual" as const;
const hash=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
export const CBB_GROUPED_OUTCOME_METHOD={release:CBB_GROUPED_OUTCOME_RELEASE,fitRelease:"cbb_joint_residual_research_2026_11_18_r2_grouped_native_innovations",
  coordinate:"native_physical_book_economic_location_origin_plus_unrestricted_grouped_Bayesian_residual",
  features:"one_relative_independent_point_and_one_relative_physical_book_center;odd_Margin_even_Total_native_innovations",
  normalization:"frozen_training_only_RMS;unknown_coordinates_remain_unknown_and_zero_in_design",
  uncertainty:"frozen_observation_noise_plus_coefficient_location_posterior;empirical_hyperparameter_uncertainty_not_fully_integrated",
  calibration:"disjoint_later110_exact_joint_cell_likelihood;not_in_sample_or_fabricated_crossfit",
  downside:"positive_tail_Normal_continued_fraction;legacy_readers_keep_original_arithmetic",
  approval:"owner_provisional_Nov18_known_development_results_not_forward_performance"} as const;
export const cbbGroupedOutcomeMethodSha256=()=>hash(CBB_GROUPED_OUTCOME_METHOD);
export type CbbGroupedOutcomeArtifact={release:typeof CBB_GROUPED_OUTCOME_RELEASE;authority:"offline_research_only";methodSha256:string;
  trainingRowsSha256:string;trainingGameIds:number[];trainingGames:number;calibrationGameIds:number[];
  createdAt:string;availableBy:string;trainingCutoff:string;models:{margin:ResidualModel;total:ResidualModel};
  frozenResearchArtifactSha256:string};
const validated=new WeakSet<CbbGroupedOutcomeArtifact>();
function deeplyFrozen(v:unknown,seen=new WeakSet<object>()):boolean{
  if(typeof v==="function")return false;if(!v||typeof v!=="object")return true;
  if(seen.has(v))return true;if(!Object.isFrozen(v)||![Object.prototype,Array.prototype,null].includes(Object.getPrototypeOf(v)))return false;
  seen.add(v);return Reflect.ownKeys(v).every(k=>{const d=Object.getOwnPropertyDescriptor(v,k)!;return "value"in d&&deeplyFrozen(d.value,seen);});
}
export function validateCbbGroupedOutcomeArtifact(a:CbbGroupedOutcomeArtifact){
  if(validated.has(a))return;
  const ids=(xs:number[])=>Array.isArray(xs)&&xs.length>0&&new Set(xs).size===xs.length&&xs.every(id=>Number.isSafeInteger(id)&&id>0);
  if(a?.release!==CBB_GROUPED_OUTCOME_RELEASE||a.authority!=="offline_research_only"||a.methodSha256!==cbbGroupedOutcomeMethodSha256()||
     !ids(a.trainingGameIds)||!ids(a.calibrationGameIds)||a.trainingGameIds.some(id=>a.calibrationGameIds.includes(id))||a.trainingGames!==a.trainingGameIds.length||
     !/^[a-f0-9]{64}$/.test(a.trainingRowsSha256)||!/^[a-f0-9]{64}$/.test(a.frozenResearchArtifactSha256))throw Error("Grouped outcome artifact identity/cohort invalid");
  for(const axis of ["margin","total"] as const){
    const m=a.models?.[axis],p=m?.active?.length;
    if(!m||m.axis!==axis||m.status!=="converged"||m.release!==CBB_GROUPED_OUTCOME_METHOD.fitRelease||
       hash(m.trainingIds)!==hash(a.trainingGameIds)||!p||p>4096||m.coefficients.length!==p||m.covariance.length!==p||
       m.covariance.some(row=>row.length!==p||!row.every(Number.isFinite))||!m.coefficients.every(Number.isFinite)||
       !Number.isFinite(m.noiseVariance)||m.noiseVariance<=0||m.active.some(j=>!Number.isSafeInteger(j)||j<0||j>=m.names.length||!(m.scales[j]>0))||
       [m.groups,m.scales].some(xs=>xs.length!==m.names.length))throw Error("Grouped outcome frozen head invalid");
  }
  const clocks=[a.trainingCutoff,a.createdAt,a.availableBy].map(Date.parse);
  if(!clocks.every(Number.isFinite)||clocks[0]>clocks[1]||clocks[1]>clocks[2])throw Error("Grouped outcome availability invalid");
  // Loader recursively freezes before shared publication; mutable test objects
  // are always revalidated rather than trusted after a shallow freeze.
  if(deeplyFrozen(a))validated.add(a);
}
export function predictCbbGroupedOutcomeForecast(a:CbbGroupedOutcomeArtifact,input:{gameId:number;asOf:string;input:CbbContextualFeatureInput},mode:"future"|"retrospective_development"){
  validateCbbGroupedOutcomeArtifact(a);
  if(input.gameId!==input.input.independent.gameId||input.asOf!==input.input.asOf||a.calibrationGameIds.includes(input.gameId)||
     !["future","retrospective_development"].includes(mode)||!Number.isFinite(Date.parse(input.asOf))||mode==="future"&&Date.parse(input.asOf)<Date.parse(a.availableBy))
    throw Error("Grouped outcome identity/exclusion/availability invalid");
  const c=coordinates(input.input),margin=predict(a.models.margin,c.margin),total=predict(a.models.total,c.total);
  const contributions=(axis:"margin"|"total")=>Object.fromEntries([...new Set(a.models[axis].groups)].map(g=>[g,a.models[axis].active.reduce((s,j,k)=>s+(a.models[axis].groups[j]===g?c[axis].values[j]/a.models[axis].scales[j]*a.models[axis].coefficients[k]:0),0)]));
  return{release:a.release,authority:a.authority,margin:{...margin,referenceMean:c.margin.origin,biasMean:margin.residual,
    varianceComponents:{sourceLocation:0,remainingGameNoise:a.models.margin.noiseVariance,functionPosterior:margin.locationVariance},semanticBiasContributions:contributions("margin")},
    total:{...total,coordinateOrigin:{value:c.total.origin},residualMean:total.residual,
      varianceComponents:{trendPosterior:0,remainingGameNoise:a.models.total.noiseVariance,functionPosterior:total.locationVariance},semanticContributions:contributions("total")},
    receipt:buildCbbContextualMarketInterpretation(input.input),outcomeInputs:{contextTraces:[{source:"grouped_native_innovation_residual",methodSha256:a.methodSha256,
      trainingGames:a.trainingGames,calibrationGames:a.calibrationGameIds.length,hyperparameterUncertaintyFullyIntegrated:false}]}};
}
