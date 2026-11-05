/** Contextual forecast -> calibrated joint score law -> exact-price grades.
 * No second projection adjustment or independent probability writer. */
import {createHash} from "node:crypto";
import {predictCbbContextualOutcomeForecast,type CbbOutcomeArtifact} from "./contextualOutcomeForecast";
import {applyCbbJointCovarianceCalibration} from "./contextualScoreCalibrationResearch";
import {assertCbbContextualForecastCalibrationBinding,cbbContextualForecastObjectSha256,type CbbContextualForecastCalibrationBinding} from "./contextualForecastCalibrationBinding";
import {buildCbbInterpretedDecision} from "./contextualInterpretedDecision";
import type {CbbContextualFeatureInput} from "./contextualForecastFeatures";
import type {CbbScoreLawNumerics} from "./contextualScoreLawResearch";
import type {CbbQuote} from "./types";
export const CBB_OUTCOME_DECISION_RELEASE="cbb_outcome_decision_2026_11_05_r6_confidence_price_tiers" as const;
function canonical(v:unknown):unknown{if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==="object")return Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)]));return v;}
export function cbbOutcomeIndependentInputSha256(independent:CbbContextualFeatureInput["independent"]){
 return createHash("sha256").update(JSON.stringify(canonical({gameId:independent.gameId,asOf:independent.asOf,release:independent.release,inputStatus:independent.inputStatus,
  margin:independent.margin,total:independent.total,homeWinProbability:independent.homeWinProbability??null,uncertainty:independent.uncertainty??null}))).digest("hex");
}
export function forecastCbbOutcomeDecision(args:{artifact:CbbOutcomeArtifact;input:CbbContextualFeatureInput;calibration:CbbContextualForecastCalibrationBinding;
 targets:readonly (CbbQuote&{orientationVerified?:boolean})[];mode:"future"|"retrospective_development";numerics?:CbbScoreLawNumerics;fixtureIdentity?:{homeId:number;awayId:number}}){
 const fixture=args.fixtureIdentity;
 if(args.mode==="future"&&!fixture||fixture&&(!Number.isSafeInteger(fixture.homeId)||!Number.isSafeInteger(fixture.awayId)||fixture.homeId<=0||fixture.awayId<=0||fixture.homeId===fixture.awayId))throw Error("CBB contextual decision requires original oriented fixture identity for publication");
 const {artifact,input,calibration}=args;assertCbbContextualForecastCalibrationBinding({...args,asOf:input.asOf});
 const forecast=predictCbbContextualOutcomeForecast(artifact,{gameId:input.independent.gameId,asOf:input.asOf,input},args.mode);
 const workingLatentLocations={marginMean:forecast.margin.mean,totalMean:forecast.total.mean,marginSd:forecast.margin.sd,totalSd:forecast.total.sd};
 const latent=applyCbbJointCovarianceCalibration(workingLatentLocations,calibration.parameters),decision=buildCbbInterpretedDecision({input,interpretation:forecast.receipt,latent,targets:args.targets,numerics:args.numerics});
 return{release:CBB_OUTCOME_DECISION_RELEASE,authority:"offline_research_only" as const,mode:args.mode,gameId:decision.gameId,asOf:decision.asOf,
  artifact:{release:artifact.release,methodSha256:artifact.methodSha256,trainingRowsSha256:artifact.trainingRowsSha256,availableBy:artifact.availableBy,
   objectSha256:cbbContextualForecastObjectSha256(artifact),factorObjectSha256:artifact.baseFactorObjectSha256},
  fixtureIdentity:fixture?{...fixture}:null,independentInputSha256:cbbOutcomeIndependentInputSha256(input.independent),interpretation:forecast.receipt,workingForecast:{margin:forecast.margin,total:forecast.total},calibration,
  finalScore:decision.finalScore,finalUncertainty:decision.finalUncertainty,
  gameOutcome:{selection:decision.finalScore.homeWinProbability>=.5?"first" as const:"second" as const,
   probability:Math.max(decision.finalScore.homeWinProbability,1-decision.finalScore.homeWinProbability)},
  marketDecisions:decision.marketDecisions,gradePolicy:decision.policy,
  numericalTrace:{workingLatentLocations,finalLatentDistribution:latent,law:decision.lawNumerics,reference:decision.sourceReferenceNumerics},
  interpretationMeaning:"One learned common outcome-discrepancy function can identify error shared by observed forecasts; explicit native shape information can affect predictive dispersion. No preset forecast ratios, manual point bonuses or grade reforecast.",
  limits:"Working probabilistic inference conditional on empirical parameters. It does not identify bettor identities, guarantee accuracy, certify all possible signals, or turn unavailable quotes into verified current offers."};
}
