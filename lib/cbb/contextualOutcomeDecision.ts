/** Contextual forecast -> calibrated joint score law -> exact-price grades.
 * No second projection adjustment or independent probability writer. */
import {createHash} from "node:crypto";
import {predictCbbCompositeOutcomeForecast,type CbbCompositeOutcomeArtifact} from "./contextualCompositeOutcomeForecast";
import {predictCbbGroupedOutcomeForecast,type CbbGroupedOutcomeArtifact} from "./groupedOutcomeForecast";
import {stableDownside} from "./workingNormalDownside";
import {applyCbbJointCovarianceCalibration} from "./contextualScoreCalibrationResearch";
import {assertCbbContextualForecastCalibrationBinding,cbbContextualForecastObjectSha256,type CbbContextualForecastCalibrationBinding} from "./contextualForecastCalibrationBinding";
import {buildCbbInterpretedDecision} from "./contextualInterpretedDecision";
import type {CbbContextualFeatureInput} from "./contextualForecastFeatures";
import type {CbbScoreLawNumerics} from "./contextualScoreLawResearch";
import {createCbbContextualScoreLaw} from "./contextualScoreLawResearch";
import {selectCbbSameContractExecution,recoverCbbVerifiedExecutionTargets} from "./sameContractExecution";
import type {CbbQuote} from "./types";
export const CBB_OUTCOME_DECISION_RELEASE="cbb_outcome_decision_2026_11_18_r16_grouped_native_outcome" as const;
function canonical(v:unknown):unknown{if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==="object")return Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)]));return v;}
export function cbbOutcomeIndependentInputSha256(independent:CbbContextualFeatureInput["independent"]){
 return createHash("sha256").update(JSON.stringify(canonical({gameId:independent.gameId,asOf:independent.asOf,release:independent.release,inputStatus:independent.inputStatus,
  margin:independent.margin,total:independent.total,homeWinProbability:independent.homeWinProbability??null,uncertainty:independent.uncertainty??null}))).digest("hex");
}
export function forecastCbbOutcomeDecision(args:{artifact:CbbCompositeOutcomeArtifact|CbbGroupedOutcomeArtifact;input:CbbContextualFeatureInput;calibration:CbbContextualForecastCalibrationBinding;
 targets:readonly (CbbQuote&{orientationVerified?:boolean})[];executionCandidates?:readonly (CbbQuote&{orientationVerified?:boolean})[];mode:"future"|"retrospective_development";numerics?:CbbScoreLawNumerics;fixtureIdentity?:{homeId:number;awayId:number}}){
 const fixture=args.fixtureIdentity;
 if(args.mode==="future"&&!fixture||fixture&&(!Number.isSafeInteger(fixture.homeId)||!Number.isSafeInteger(fixture.awayId)||fixture.homeId<=0||fixture.awayId<=0||fixture.homeId===fixture.awayId))throw Error("CBB contextual decision requires original oriented fixture identity for publication");
 const {artifact,input,calibration}=args;assertCbbContextualForecastCalibrationBinding({...args,asOf:input.asOf});
 const forecast="models"in artifact?predictCbbGroupedOutcomeForecast(artifact,{gameId:input.independent.gameId,asOf:input.asOf,input},args.mode):
  predictCbbCompositeOutcomeForecast(artifact,{gameId:input.independent.gameId,asOf:input.asOf,input},args.mode);
 const workingLatentLocations={marginMean:forecast.margin.mean,totalMean:forecast.total.mean,marginSd:forecast.margin.sd,totalSd:forecast.total.sd};
 const latent=applyCbbJointCovarianceCalibration(workingLatentLocations,calibration.parameters);
 const recommendationRisk={calibrationGames:"models"in artifact?artifact.calibrationGameIds.length:artifact.trainingGameIds.length,
  marginLocationSd:Math.sqrt(forecast.margin.varianceComponents.sourceLocation+forecast.margin.varianceComponents.functionPosterior)*Math.exp(calibration.parameters.logMarginScale),
  totalLocationSd:Math.sqrt(forecast.total.varianceComponents.trendPosterior+forecast.total.varianceComponents.functionPosterior)*Math.exp(calibration.parameters.logTotalScale)};
 const recovery=recoverCbbVerifiedExecutionTargets({input,interpretation:forecast.receipt,targets:args.targets,candidates:args.executionCandidates??[]});
 const execution=selectCbbSameContractExecution({input,interpretation:forecast.receipt,law:createCbbContextualScoreLaw(latent,args.numerics),
  targets:recovery.targets,candidates:args.executionCandidates??args.targets});
 const decision=buildCbbInterpretedDecision({input,interpretation:forecast.receipt,latent,targets:execution.targets,numerics:args.numerics,recommendationRisk,
  workingDownside:"models"in artifact?stableDownside:undefined});
 return{release:CBB_OUTCOME_DECISION_RELEASE,authority:"offline_research_only" as const,mode:args.mode,gameId:decision.gameId,asOf:decision.asOf,
  artifact:{release:artifact.release,methodSha256:artifact.methodSha256,trainingRowsSha256:artifact.trainingRowsSha256,availableBy:artifact.availableBy,
   objectSha256:cbbContextualForecastObjectSha256(artifact),...("models"in artifact?{groupedMarginObjectSha256:createHash("sha256").update(JSON.stringify(artifact.models.margin)).digest("hex"),
    groupedTotalObjectSha256:createHash("sha256").update(JSON.stringify(artifact.models.total)).digest("hex")}:
    {legacyMarginObjectSha256:artifact.componentHashes.legacyMarginModelObjectSha256,directTotalObjectSha256:artifact.componentHashes.directTotalModelObjectSha256})},
  fixtureIdentity:fixture?{...fixture}:null,independentInputSha256:cbbOutcomeIndependentInputSha256(input.independent),interpretation:forecast.receipt,workingForecast:{margin:forecast.margin,total:forecast.total},calibration,
  finalScore:decision.finalScore,finalUncertainty:decision.finalUncertainty,
  gameOutcome:{selection:decision.finalScore.homeWinProbability>=.5?"first" as const:"second" as const,
   probability:Math.max(decision.finalScore.homeWinProbability,1-decision.finalScore.homeWinProbability)},
  marketDecisions:decision.marketDecisions,gradePolicy:decision.policy,
  numericalTrace:{workingLatentLocations,finalLatentDistribution:latent,law:decision.lawNumerics,reference:decision.sourceReferenceNumerics,
   executionSelection:{release:execution.release,recovery:{release:recovery.release,changes:recovery.changes},originalTargets:structuredClone(args.targets),changes:execution.changes},
   ...(forecast.outcomeInputs.contextTraces.length?{wholeMarketContext:forecast.outcomeInputs.contextTraces}:{})},
  interpretationMeaning:"models"in artifact?"Grouped Bayesian native Margin and Total residuals supply one disjoint-calibrated joint score law; no fixed forecast shares, point bumps or play quotas. Exact-price probabilities and grades follow the same law.":"Retained R1 raw Margin and an economic Total residual learner supply one freshly calibrated joint score law. Total uses an explicit observed economic coordinate plus an unbounded learned residual, with original independent evidence and no forecast source allocation. Exact-price probabilities and grades follow the same law.",
  limits:"Working probabilistic inference conditional on empirical parameters. It does not identify bettor identities, guarantee accuracy, certify all possible signals, or turn unavailable quotes into verified current offers."};
}
