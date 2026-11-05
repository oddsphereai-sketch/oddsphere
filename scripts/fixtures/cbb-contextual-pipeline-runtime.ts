/** Synthetic upstream law for writer-contract tests only. No fit, learned
 * artifact claim, provider/database/network call or deployment authority. */
import {buildCbbInterpretedDecision} from "../../lib/cbb/contextualInterpretedDecision";
import {buildCbbContextualMarketInterpretation} from "../../lib/cbb/contextualMarketInterpretation";
import {buildCbbContextualOutcomeBoard,type CbbOutcomeDecision} from "../../lib/cbb/contextualOutcomeBoard";
import {CBB_OUTCOME_DECISION_RELEASE,cbbOutcomeIndependentInputSha256} from "../../lib/cbb/contextualOutcomeDecision";
import {encodeCbbContextualEvidence} from "../../lib/services/cbb/cbbContextualEvidenceCodec";
import {CBB_CONTEXTUAL_OUTCOME_MODEL_RELEASE,CBB_CONTEXTUAL_OUTCOME_CALIBRATION_RELEASE,CBB_CONTEXTUAL_OUTCOME_EVIDENCE_RELEASE,CBB_CONTEXTUAL_OUTCOME_MANIFEST,type CbbContextualOutcomeRuntime} from "../../lib/services/cbb/cbbContextualOutcomeRuntime";
export function makeCbbPipelineTestRuntime(){
 const evaluations:Array<{input:Parameters<CbbContextualOutcomeRuntime["evaluate"]>[0];board:ReturnType<CbbContextualOutcomeRuntime["evaluate"]>}>=[];
 const evaluate:CbbContextualOutcomeRuntime["evaluate"]=args=>{
  const {input,independent,targets,coverage}=args,u=independent.uncertainty;
  const latent={marginMean:independent.margin,totalMean:independent.total,marginSd:u.marginSd,totalSd:u.totalSd,correlation:u.marginTotalCorrelation};
  const d=buildCbbInterpretedDecision({input,interpretation:buildCbbContextualMarketInterpretation(input),targets,latent});
  const working={margin:{mean:independent.margin,sd:u.marginSd},total:{mean:independent.total,sd:u.totalSd}};
  const decision={release:CBB_OUTCOME_DECISION_RELEASE,authority:"offline_research_only",mode:"retrospective_development",gameId:independent.gameId,asOf:input.asOf,
   fixtureIdentity:{homeId:independent.homeId,awayId:independent.awayId},independentInputSha256:cbbOutcomeIndependentInputSha256(independent),
   artifact:{release:CBB_CONTEXTUAL_OUTCOME_MANIFEST.engineRelease,methodSha256:CBB_CONTEXTUAL_OUTCOME_MANIFEST.methodSha256,trainingRowsSha256:"a".repeat(64),availableBy:input.asOf,
    objectSha256:CBB_CONTEXTUAL_OUTCOME_MANIFEST.modelObjectSha256,factorObjectSha256:"b".repeat(64)},
   interpretation:d.interpretation,finalScore:d.finalScore,finalUncertainty:d.finalUncertainty,marketDecisions:d.marketDecisions,gradePolicy:d.policy,
   gameOutcome:{selection:d.finalScore.homeWinProbability>=.5?"first":"second",probability:Math.max(d.finalScore.homeWinProbability,1-d.finalScore.homeWinProbability)},
   numericalTrace:{workingLatentLocations:latent,finalLatentDistribution:latent,law:d.lawNumerics,reference:d.sourceReferenceNumerics},workingForecast:working,calibration:{forecastArtifactObjectSha256:CBB_CONTEXTUAL_OUTCOME_MANIFEST.modelObjectSha256,calibrationMethodSha256:CBB_CONTEXTUAL_OUTCOME_MANIFEST.calibrationMethodSha256},
   interpretationMeaning:"Synthetic exact-law upstream writer fixture, not a learned-model assertion",limits:"Unit test only; no fitted artifact authority"} as unknown as CbbOutcomeDecision;
  const copied=buildCbbContextualOutcomeBoard({decision,independent}),{contextualOutcomeDecision:stored,...marketContext}=copied.marketContext;
  const {interpretation,finalScore,marketDecisions,...trace}=stored;
  const evidence=encodeCbbContextualEvidence({identity:{gameId:copied.gameId,asOf:copied.asOf,modelRelease:CBB_CONTEXTUAL_OUTCOME_MODEL_RELEASE,
   gradeRelease:copied.gradeRelease,independentRelease:independent.release,artifactObjectSha256:CBB_CONTEXTUAL_OUTCOME_MANIFEST.modelObjectSha256},
   input,interpretation,finalScore,marketDecisions,trace:{release:CBB_CONTEXTUAL_OUTCOME_EVIDENCE_RELEASE,decision:trace,independent,coverage:coverage??null}});
  const board={...copied,authority:"released_contextual_outcome" as const,modelRelease:CBB_CONTEXTUAL_OUTCOME_MODEL_RELEASE,calibrationRelease:CBB_CONTEXTUAL_OUTCOME_CALIBRATION_RELEASE,
   marketContext:{...marketContext,contextualOutcomeEvidence:evidence,contextualOutcomeSummary:{release:CBB_CONTEXTUAL_OUTCOME_EVIDENCE_RELEASE,
    interpretationRelease:interpretation.release,decisionRelease:decision.release,artifact:decision.artifact,fixtureIdentity:decision.fixtureIdentity,
    independentInputSha256:decision.independentInputSha256,calibrationRelease:CBB_CONTEXTUAL_OUTCOME_CALIBRATION_RELEASE,
    calibrationMethodSha256:CBB_CONTEXTUAL_OUTCOME_MANIFEST.calibrationMethodSha256,workingForecast:decision.workingForecast,gradePolicy:decision.gradePolicy,
    evidenceBytes:{raw:evidence.uncompressedBytes,gzip:evidence.compressedBytes}}}};
  evaluations.push({input:structuredClone(args),board:structuredClone(board)});return board;
 };
 return{runtime:{evaluate},evaluations};
}
