/** One component-bound forecast: unchanged incumbent Margin and direct Total.
 * No source allocation, interpolation, fitting, persistence or activation occurs
 * in this assembler. Incumbent Margin's existing method remains explicit. */
import {createHash} from "node:crypto";
import {cbbOutcomeMethodSha256 as legacyMethodSha256,validateCbbOutcomeArtifact as validateLegacy,predictCbbLegacyMarginForecast,type CbbOutcomeArtifact as LegacyArtifact} from "./contextualOutcomeForecast";
import {cbbOutcomeMethodSha256 as directMethodSha256,validateCbbOutcomeArtifact as validateDirect,predictCbbDirectTotalForecast,type CbbOutcomeArtifact as DirectArtifact} from "./economicTotalForecast";
import type {CbbContextualFeatureInput} from "./contextualForecastFeatures";

export const CBB_CONTEXTUAL_COMPOSITE_OUTCOME_RELEASE="cbb_contextual_composite_2026_11_06_v2_economic_total_retained_margin" as const;
export const CBB_COMPOSITE_OUTCOME_METHOD={release:CBB_CONTEXTUAL_COMPOSITE_OUTCOME_RELEASE,margin:{methodSha256:legacyMethodSha256(),scope:"unchanged_V5_Margin_GP_and_required_factor_context_only;legacy_Total_GP_never_called"},total:{methodSha256:directMethodSha256(),scope:"economic_Total_residual_GP_with_observable_coordinate_origin_and_native_cross_market_context_only;Total_only_artifact_no_unused_Margin_head"},assembly:"two_scoped_latent_axes_then_one_new_exact_model_bound_joint_calibration;no_forecast_average_no_point_bump",provenance:"axis_specific_game_exclusion_and_normalization;full_dependency_union_is_not_a_claim_of_identical_component_training_sets",limitation:"retained_Margin_still_uses_incumbent_source_reference;Total_only_repair_not_completion_of_all_market_interpretation"} as const;
const sha=(x:unknown)=>createHash("sha256").update(JSON.stringify(x)).digest("hex"),clock=(x:string)=>Date.parse(x),isSha=(x:unknown)=>typeof x==="string"&&/^[a-f0-9]{64}$/.test(x);
export const cbbCompositeOutcomeMethodSha256=()=>sha(CBB_COMPOSITE_OUTCOME_METHOD);
export type CbbCompositeComponentHashes={legacyMarginModelObjectSha256:string;directTotalModelObjectSha256:string;legacyMarginHeadSha256:string;directTotalHeadSha256:string};
export type CbbCompositeOutcomeArtifact={release:typeof CBB_CONTEXTUAL_COMPOSITE_OUTCOME_RELEASE;authority:"offline_research_only";methodSha256:string;trainingRowsSha256:string;trainingGameIds:number[];trainingGames:number;createdAt:string;availableBy:string;trainingCutoff:string;legacyMarginModel:LegacyArtifact;directTotalModel:DirectArtifact;componentHashes:CbbCompositeComponentHashes};
const union=(m:LegacyArtifact,t:DirectArtifact)=>[...new Set([...m.trainingGameIds,...t.trainingGameIds])].sort((a,b)=>a-b);
function hashes(m:LegacyArtifact,t:DirectArtifact):CbbCompositeComponentHashes{return{legacyMarginModelObjectSha256:sha(m),directTotalModelObjectSha256:sha(t),legacyMarginHeadSha256:sha({axis:m.margin,factorArtifact:m.factorArtifact}),directTotalHeadSha256:sha({axis:t.total})};}
export function cbbCompositeOutcomeTrainingRowsSha256(m:LegacyArtifact,t:DirectArtifact){return sha({scope:"unchanged_per_axis_training_sources_not_a_new_forecast_fit",margin:{methodSha256:m.methodSha256,trainingRowsSha256:m.trainingRowsSha256,trainingGameIds:m.trainingGameIds},total:{methodSha256:t.methodSha256,trainingRowsSha256:t.trainingRowsSha256,trainingGameIds:t.trainingGameIds}});}
export function createCbbCompositeOutcomeArtifact(options:{legacyMarginModel:LegacyArtifact;directTotalModel:DirectArtifact;createdAt:string;availableBy?:string}):CbbCompositeOutcomeArtifact{
 const {legacyMarginModel:m,directTotalModel:t}=options,ids=union(m,t),createdAt=options.createdAt,availableBy=options.availableBy??createdAt;
 const artifact:CbbCompositeOutcomeArtifact={release:CBB_CONTEXTUAL_COMPOSITE_OUTCOME_RELEASE,authority:"offline_research_only",methodSha256:cbbCompositeOutcomeMethodSha256(),trainingRowsSha256:cbbCompositeOutcomeTrainingRowsSha256(m,t),trainingGameIds:ids,trainingGames:ids.length,createdAt,availableBy,trainingCutoff:new Date(Math.max(clock(m.trainingCutoff),clock(t.trainingCutoff))).toISOString(),legacyMarginModel:m,directTotalModel:t,componentHashes:hashes(m,t)};
 validateCbbCompositeOutcomeArtifact(artifact);return artifact;
}
const validatedFrozenArtifacts=new WeakSet<CbbCompositeOutcomeArtifact>();
/** A shallow freeze or accessor can still expose mutable nested parameters.
 * Only plain, recursively frozen data trees qualify for identity reuse. */
function deeplyFrozen(value:unknown,seen=new WeakSet<object>()):boolean{
 if(typeof value==="function")return false;if(!value||typeof value!=="object")return true;if(seen.has(value))return true;
 if(!Object.isFrozen(value)||![Object.prototype,Array.prototype,null].includes(Object.getPrototypeOf(value)))return false;seen.add(value);
 return Reflect.ownKeys(value).every(key=>{const d=Object.getOwnPropertyDescriptor(value,key);return d!==undefined&&"value"in d&&deeplyFrozen(d.value,seen);});
}
export function validateCbbCompositeOutcomeArtifact(a:CbbCompositeOutcomeArtifact){
 if(validatedFrozenArtifacts.has(a))return;
 if(!a||a.release!==CBB_CONTEXTUAL_COMPOSITE_OUTCOME_RELEASE||a.authority!=="offline_research_only"||a.methodSha256!==cbbCompositeOutcomeMethodSha256())throw Error("Composite outcome method identity invalid");const m=a.legacyMarginModel,t=a.directTotalModel;validateLegacy(m);validateDirect(t);
 if([m,t].some(model=>!Array.isArray(model.trainingGameIds)||!model.trainingGameIds.length||new Set(model.trainingGameIds).size!==model.trainingGameIds.length||model.trainingGameIds.some(id=>!Number.isSafeInteger(id)||id<=0)||model.trainingGames!==model.trainingGameIds.length||!isSha(model.trainingRowsSha256)))throw Error("Composite component training cohort invalid");
 if(m.methodSha256!==CBB_COMPOSITE_OUTCOME_METHOD.margin.methodSha256||t.methodSha256!==CBB_COMPOSITE_OUTCOME_METHOD.total.methodSha256||sha(a.trainingGameIds)!==sha(union(m,t))||a.trainingGames!==a.trainingGameIds.length||!a.trainingGames||a.trainingRowsSha256!==cbbCompositeOutcomeTrainingRowsSha256(m,t)||!isSha(a.trainingRowsSha256)||sha(a.componentHashes)!==sha(hashes(m,t)))throw Error("Composite component hash/cohort binding invalid");
 const times=[m.trainingCutoff,m.createdAt,m.availableBy,t.trainingCutoff,t.createdAt,t.availableBy,a.trainingCutoff,a.createdAt,a.availableBy].map(clock);
 if(!times.every(Number.isFinite)||times[0]>times[1]||times[1]>times[2]||times[3]>times[4]||times[4]>times[5]||times[6]!==Math.max(times[0],times[3])||times[7]<Math.max(times[2],times[5])||times[8]<times[7])throw Error("Composite component availability clocks invalid");
 if(deeplyFrozen(a))validatedFrozenArtifacts.add(a);
}
export function predictCbbCompositeOutcomeForecast(artifact:CbbCompositeOutcomeArtifact,input:{gameId:number;asOf:string;input:CbbContextualFeatureInput},mode:"future"|"retrospective_development"){
 validateCbbCompositeOutcomeArtifact(artifact);const at=clock(input.asOf);if(!Number.isSafeInteger(input.gameId)||input.gameId<=0||input.gameId!==input.input.independent.gameId||input.asOf!==input.input.asOf||artifact.trainingGameIds.includes(input.gameId)||!Number.isFinite(at)||!["future","retrospective_development"].includes(mode))throw Error("Composite outcome identity/training exclusion invalid");if(mode==="future"&&at<clock(artifact.availableBy))throw Error("Composite artifact unavailable at input");
 const margin=predictCbbLegacyMarginForecast(artifact.legacyMarginModel,input,mode),total=predictCbbDirectTotalForecast(artifact.directTotalModel,input,mode);if(sha(margin.receipt)!==sha(total.receipt))throw Error("Composite heads received different factual market receipts");
 const legacyMarginOnly=(rows:unknown[])=>rows.filter(row=>(row as {axis?:string}).axis==="margin").map(row=>({...row as Record<string,unknown>,componentScope:"retained_margin"}));
 // Direct Total normally reuses its native axis_margin feature traces. Its
 // filtered identity-conflict relation view uses axis_cross_margin instead.
 // Preserve both with component attribution: neither is a V9 Margin GP call.
 const directTotalSources=(rows:unknown[])=>rows.map(row=>({...row as Record<string,unknown>,componentScope:"direct_total"}));
 const outcomeInputs={gameId:input.gameId,asOf:input.asOf,startsAt:input.input.startsAt,margin:margin.outcomeInputs.margin,total:total.outcomeInputs.total,measurementInputs:total.outcomeInputs.measurementInputs,verificationTraces:[...legacyMarginOnly(margin.outcomeInputs.verificationTraces),...directTotalSources(total.outcomeInputs.verificationTraces)],pressureTraces:[...legacyMarginOnly(margin.outcomeInputs.pressureTraces),...directTotalSources(total.outcomeInputs.pressureTraces)],endpointTraces:[...legacyMarginOnly(margin.outcomeInputs.endpointTraces),...directTotalSources(total.outcomeInputs.endpointTraces)],contextTraces:[...directTotalSources(total.outcomeInputs.contextTraces),{source:"composite_axis_scope",marginMethod:artifact.legacyMarginModel.methodSha256,totalMethod:artifact.directTotalModel.methodSha256,componentHashes:artifact.componentHashes,meaning:"one_retained_Margin_and_one_direct_Total;inactive_GP_heads_not_executed;no_convex_forecast_blend"}]};
 return{release:artifact.release,authority:artifact.authority,mode,gameId:input.gameId,inputAsOf:input.asOf,artifactAvailableBy:artifact.availableBy,margin:margin.margin,total:total.total,correlation:0,covariance:0,receipt:total.receipt,outcomeInputs,headIdentity:artifact.componentHashes,probabilityClaim:"none_until_exact_composite_bound_joint_calibration" as const};
}
export type CbbCompositeOutcomePrediction=ReturnType<typeof predictCbbCompositeOutcomeForecast>;
