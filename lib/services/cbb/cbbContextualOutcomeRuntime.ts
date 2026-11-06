/** One pinned contextual law for the existing leased CBB writer. A private
 * training artifact is promoted by this exact release manifest; no refresh,
 * fallback model, provider collection or persistence is introduced here. */
import legacyReleaseManifest from "../../cbb/artifacts/contextual-outcome-r1-manifest.json";
import releaseManifest from "../../cbb/artifacts/contextual-outcome-r6-manifest.json";
import {CBB_CONTEXTUAL_COMPOSITE_OUTCOME_RELEASE as CBB_COMPOSITE_OUTCOME_RELEASE,validateCbbCompositeOutcomeArtifact,type CbbCompositeOutcomeArtifact} from "../../cbb/contextualCompositeOutcomeForecast";
import {CBB_OUTCOME_DECISION_RELEASE,forecastCbbOutcomeDecision} from "../../cbb/contextualOutcomeDecision";
import {buildCbbContextualOutcomeBoard,CBB_CONTEXTUAL_OUTCOME_BOARD_GRADE_RELEASE,CBB_CONTEXTUAL_OUTCOME_LEGACY_RISK_GRADE_RELEASE,CBB_CONTEXTUAL_OUTCOME_LEGACY_GRADE_RELEASE,CBB_CONTEXTUAL_OUTCOME_LEGACY_RISK_DECISION_RELEASE,CBB_CONTEXTUAL_OUTCOME_LEGACY_DECISION_RELEASE,type CbbOutcomeDecision} from "../../cbb/contextualOutcomeBoard";
import {freezeCbbContextualForecastArtifact,cbbContextualForecastObjectSha256,assertCbbContextualForecastCalibrationBinding} from "../../cbb/contextualForecastCalibrationBinding";
import {CBB_PRIVATE_OUTCOME_ARTIFACT_RELEASE,createCbbPrivateOutcomeArtifactLoader,type decodeCbbPrivateOutcomeArtifact,type CbbPrivateOutcomeManifest} from "./cbbOutcomeArtifactEnvelope";
import {createCbbOutcomeArtifactDownload} from "./cbbOutcomeArtifactStorage";
import {encodeCbbContextualEvidence,decodeCbbContextualEvidence,type CbbContextualEvidenceIdentity} from "./cbbContextualEvidenceCodec";
import type {CbbContextualAssembledInput,assembleCbbContextualReaderInput} from "./cbbContextualReaderInput";
import type {CbbForecast,CbbQuote} from "../../cbb/types";

export const CBB_CONTEXTUAL_OUTCOME_MODEL_RELEASE="cbb_contextual_outcome_2026_11_06_r6_direct_total_retained_margin" as const;
export const CBB_CONTEXTUAL_OUTCOME_CALIBRATION_RELEASE="cbb_contextual_covariance_2026_11_06_r6_direct_total_retained_margin" as const;
export const CBB_CONTEXTUAL_OUTCOME_EVIDENCE_RELEASE="cbb_contextual_outcome_evidence_2026_11_06_r6_direct_total_retained_margin" as const;
/** Genuine component-bound artifact and new joint calibration, pinned exactly. */
export const CBB_CONTEXTUAL_OUTCOME_MANIFEST=Object.freeze(releaseManifest as CbbPrivateOutcomeManifest);
function activeManifest():CbbPrivateOutcomeManifest|null{return CBB_CONTEXTUAL_OUTCOME_MANIFEST;}
export function cbbContextualOutcomeReadinessMetadata(){
 const manifest=activeManifest();
 return manifest?{status:"pinned" as const,model:CBB_CONTEXTUAL_OUTCOME_MODEL_RELEASE,calibration:CBB_CONTEXTUAL_OUTCOME_CALIBRATION_RELEASE,
  engine:manifest.engineRelease,objectSha256:manifest.modelObjectSha256,availableBy:manifest.availableBy}:
 {status:"pending" as const,model:CBB_CONTEXTUAL_OUTCOME_MODEL_RELEASE,calibration:CBB_CONTEXTUAL_OUTCOME_CALIBRATION_RELEASE,
  engine:CBB_COMPOSITE_OUTCOME_RELEASE,objectSha256:null,availableBy:null};
}
export const CBB_CONTEXTUAL_OUTCOME_LEGACY_MODEL_RELEASE="cbb_contextual_outcome_2026_11_05_r1" as const;
/** One immutable authority for current and historical contextual identities.
 * Legacy entries decode stored decisions only; they never load or run a model. */
type ContextualRelease={
 readonly modelRelease:typeof CBB_CONTEXTUAL_OUTCOME_MODEL_RELEASE|typeof CBB_CONTEXTUAL_OUTCOME_LEGACY_MODEL_RELEASE;
 readonly calibrationRelease:typeof CBB_CONTEXTUAL_OUTCOME_CALIBRATION_RELEASE|"cbb_contextual_covariance_2026_11_05_r1";
 readonly evidenceRelease:typeof CBB_CONTEXTUAL_OUTCOME_EVIDENCE_RELEASE|"cbb_contextual_outcome_evidence_2026_11_05_r1";
 readonly modelUsed:"cbb_contextual_outcome_r1"|"cbb_contextual_outcome_r6";readonly manifest:CbbPrivateOutcomeManifest;
};
const candidateManifest=activeManifest();
const contextualReleases:readonly ContextualRelease[]=Object.freeze([
 Object.freeze({modelRelease:CBB_CONTEXTUAL_OUTCOME_LEGACY_MODEL_RELEASE,
  calibrationRelease:"cbb_contextual_covariance_2026_11_05_r1" as const,
  evidenceRelease:"cbb_contextual_outcome_evidence_2026_11_05_r1" as const,
  modelUsed:"cbb_contextual_outcome_r1" as const,manifest:Object.freeze(legacyReleaseManifest as CbbPrivateOutcomeManifest)}),
 ...(candidateManifest?[Object.freeze({modelRelease:CBB_CONTEXTUAL_OUTCOME_MODEL_RELEASE,
  calibrationRelease:CBB_CONTEXTUAL_OUTCOME_CALIBRATION_RELEASE,evidenceRelease:CBB_CONTEXTUAL_OUTCOME_EVIDENCE_RELEASE,
  modelUsed:"cbb_contextual_outcome_r6" as const,manifest:candidateManifest})]:[]),
]);
export function resolveCbbContextualOutcomeRelease(modelRelease:string|undefined){
 return contextualReleases.find(release=>release.modelRelease===modelRelease)??null;
}

type Coverage=ReturnType<typeof assembleCbbContextualReaderInput>["coverage"];
type Evaluation={input:CbbContextualAssembledInput;independent:CbbForecast;targets:readonly (CbbQuote&{orientationVerified?:boolean})[];coverage?:Coverage};
type DecisionTrace=Omit<CbbOutcomeDecision,"interpretation"|"finalScore"|"marketDecisions">;
type StoredTrace={release:ContextualRelease["evidenceRelease"];decision:DecisionTrace;independent:CbbForecast;coverage:Coverage|null};
type Loaded=ReturnType<typeof decodeCbbPrivateOutcomeArtifact>;
function same(a:unknown,b:unknown):boolean{if(a===b)return true;if(!a||!b||typeof a!=="object"||typeof b!=="object"||Array.isArray(a)!==Array.isArray(b))return false;
 const ka=Object.keys(a).sort(),kb=Object.keys(b).sort();return ka.length===kb.length&&ka.every((k,j)=>k===kb[j]&&same((a as Record<string,unknown>)[k],(b as Record<string,unknown>)[k]));}

/** Exported for reproducible offline integration tests. The actual writer uses
 * only loadCbbContextualOutcomeRuntime's immutable checked-in manifest. */
export function createCbbContextualOutcomeRuntime(args:{manifest:CbbPrivateOutcomeManifest;loaded:Loaded;mode?:"future"|"retrospective_development"}){
 const manifest=Object.freeze({...args.manifest}),{loaded}=args,mode=args.mode??"future";
 if(!("legacyMarginModel" in loaded.model))throw Error("CBB active runtime requires the retained-Margin/direct-Total composite artifact");
 const model=freezeCbbContextualForecastArtifact(loaded.model as CbbCompositeOutcomeArtifact),calibration=structuredClone(loaded.calibration);
 validateCbbCompositeOutcomeArtifact(model);
 if(manifest.envelopeRelease!==CBB_PRIVATE_OUTCOME_ARTIFACT_RELEASE||manifest.runtimeModelRelease!==CBB_CONTEXTUAL_OUTCOME_MODEL_RELEASE||model.release!==manifest.engineRelease||model.methodSha256!==manifest.methodSha256||
  cbbContextualForecastObjectSha256(model)!==manifest.modelObjectSha256||calibration.calibrationMethodSha256!==manifest.calibrationMethodSha256||
  loaded.modelJSONSha256!==manifest.modelJSONSha256||loaded.calibrationJSONSha256!==manifest.calibrationJSONSha256||loaded.availableBy!==manifest.availableBy)
  throw Error("CBB released contextual model differs from the pinned manifest");
 assertCbbContextualForecastCalibrationBinding({artifact:model,calibration,asOf:manifest.availableBy,mode:"future"});
 const evaluate=({input,independent,targets,coverage}:Evaluation)=>{
  const decision=forecastCbbOutcomeDecision({artifact:model,input,calibration,targets,mode,fixtureIdentity:{homeId:independent.homeId,awayId:independent.awayId}});
  const board=buildCbbContextualOutcomeBoard({decision,independent}),{contextualOutcomeDecision:stored,...marketContext}=board.marketContext;
  const {interpretation,finalScore,marketDecisions,...trace}=stored;
  const identity:CbbContextualEvidenceIdentity={gameId:board.gameId,asOf:board.asOf,modelRelease:CBB_CONTEXTUAL_OUTCOME_MODEL_RELEASE,
   gradeRelease:board.gradeRelease,independentRelease:independent.release,artifactObjectSha256:manifest.modelObjectSha256};
  const contextualOutcomeEvidence=encodeCbbContextualEvidence({identity,input,interpretation,finalScore,marketDecisions,
   trace:{release:CBB_CONTEXTUAL_OUTCOME_EVIDENCE_RELEASE,decision:trace,independent,coverage:coverage??null} satisfies StoredTrace});
  return {...board,authority:"released_contextual_outcome" as const,modelRelease:CBB_CONTEXTUAL_OUTCOME_MODEL_RELEASE,
   calibrationRelease:CBB_CONTEXTUAL_OUTCOME_CALIBRATION_RELEASE,
   marketContext:{...marketContext,contextualOutcomeEvidence,contextualOutcomeSummary:{release:CBB_CONTEXTUAL_OUTCOME_EVIDENCE_RELEASE,
    interpretationRelease:interpretation.release,decisionRelease:decision.release,artifact:decision.artifact,fixtureIdentity:decision.fixtureIdentity,
    independentInputSha256:decision.independentInputSha256,calibrationRelease:CBB_CONTEXTUAL_OUTCOME_CALIBRATION_RELEASE,
    calibrationMethodSha256:manifest.calibrationMethodSha256,workingForecast:decision.workingForecast,gradePolicy:decision.gradePolicy,
    evidenceBytes:{raw:contextualOutcomeEvidence.uncompressedBytes,gzip:contextualOutcomeEvidence.compressedBytes}}}};
 };
 return {release:CBB_CONTEXTUAL_OUTCOME_MODEL_RELEASE,availableBy:manifest.availableBy,artifactObjectSha256:manifest.modelObjectSha256,evaluate};
}
/** Stored family boards retain their own immutable released identities. */
type ActiveOutcomeBoard=ReturnType<ReturnType<typeof createCbbContextualOutcomeRuntime>["evaluate"]>;
type StoredOutcomeSummary=Omit<ActiveOutcomeBoard["marketContext"]["contextualOutcomeSummary"],"release"|"calibrationRelease"|"decisionRelease">&{
 release:ContextualRelease["evidenceRelease"];calibrationRelease:ContextualRelease["calibrationRelease"];decisionRelease:CbbOutcomeDecision["release"]};
export type CbbReleasedOutcomeBoard=Omit<ActiveOutcomeBoard,"modelRelease"|"calibrationRelease"|"marketContext">&{
 modelRelease:ContextualRelease["modelRelease"];calibrationRelease:ContextualRelease["calibrationRelease"];
 marketContext:Omit<ActiveOutcomeBoard["marketContext"],"contextualOutcomeSummary">&{contextualOutcomeSummary:StoredOutcomeSummary}};
export type CbbContextualOutcomeRuntime=Omit<ReturnType<typeof createCbbContextualOutcomeRuntime>,"evaluate">&{evaluate:(args:Evaluation)=>CbbReleasedOutcomeBoard};
let defaultRuntime:Promise<CbbContextualOutcomeRuntime>|undefined;
export function loadCbbContextualOutcomeRuntime(){
 const manifest=activeManifest();
 if(!manifest)return Promise.reject(new Error("CBB direct contextual candidate manifest pending"));
 if(!defaultRuntime){
  const download=createCbbOutcomeArtifactDownload({supabaseURL:process.env.NEXT_PUBLIC_SUPABASE_URL??"",serviceRoleKey:process.env.SUPABASE_SERVICE_ROLE_KEY??""});
  const load=createCbbPrivateOutcomeArtifactLoader(manifest,download);
  const pending=load().then(loaded=>createCbbContextualOutcomeRuntime({manifest,loaded}));
  defaultRuntime=pending;pending.catch(()=>{if(defaultRuntime===pending)defaultRuntime=undefined;});
 }
 return defaultRuntime;
}

type StoredBoard={modelRelease?:string;calibrationRelease?:string;gradeRelease?:string;gameId:number;asOf:string;score:unknown;gameForecast?:unknown;rows:readonly unknown[];
 marketContext:object};
/** Call only after locked DTO precedence. Every contextual receipt is checked
 * against its own immutable manifest; no current model is run on legacy data. */
export function readCbbContextualOutcomeEvidence(board:StoredBoard){
 const release=resolveCbbContextualOutcomeRelease(board.modelRelease);if(!release)return null;
 const manifest=release.manifest;
 if(board.calibrationRelease!==release.calibrationRelease)throw Error("CBB contextual evidence calibration release differs");
 const storedGrade=board.gradeRelease;
 if(!storedGrade||![CBB_CONTEXTUAL_OUTCOME_BOARD_GRADE_RELEASE,CBB_CONTEXTUAL_OUTCOME_LEGACY_RISK_GRADE_RELEASE,CBB_CONTEXTUAL_OUTCOME_LEGACY_GRADE_RELEASE].includes(storedGrade as typeof CBB_CONTEXTUAL_OUTCOME_BOARD_GRADE_RELEASE))throw Error("CBB contextual evidence grade release differs");
 const context=board.marketContext as {originalIndependent?:unknown;contextualOutcomeEvidence?:unknown};
 const original=context.originalIndependent as CbbForecast|undefined;
 if(!original)throw Error("CBB contextual evidence lacks original independent identity");
 const identity:CbbContextualEvidenceIdentity={gameId:board.gameId,asOf:board.asOf,modelRelease:release.modelRelease,gradeRelease:storedGrade,
  independentRelease:original.release,artifactObjectSha256:manifest.modelObjectSha256};
 const decoded=decodeCbbContextualEvidence(context.contextualOutcomeEvidence,identity).evidence,trace=decoded.trace as StoredTrace;
 if(trace.release!==release.evidenceRelease||!same(trace.independent,original)||!same(decoded.finalScore,board.score))throw Error("CBB contextual stored evidence differs from the public score or original input");
 const decision={...trace.decision,interpretation:decoded.interpretation,finalScore:decoded.finalScore,marketDecisions:decoded.marketDecisions} as CbbOutcomeDecision;
 const allowedDecisions:readonly string[]=release.modelRelease===CBB_CONTEXTUAL_OUTCOME_LEGACY_MODEL_RELEASE?
  [CBB_CONTEXTUAL_OUTCOME_LEGACY_RISK_DECISION_RELEASE,CBB_CONTEXTUAL_OUTCOME_LEGACY_DECISION_RELEASE]:[CBB_OUTCOME_DECISION_RELEASE];
 if(!allowedDecisions.includes(decision.release))throw Error("CBB contextual stored decision does not belong to its model release");
 if(decision.artifact.objectSha256!==identity.artifactObjectSha256||decision.artifact.release!==manifest.engineRelease||
  decision.artifact.methodSha256!==manifest.methodSha256||decision.calibration.forecastArtifactObjectSha256!==identity.artifactObjectSha256||
  decision.calibration.calibrationMethodSha256!==manifest.calibrationMethodSha256)throw Error("CBB contextual stored artifact or calibration differs from the release manifest");
 const mapped=buildCbbContextualOutcomeBoard({decision,independent:original});
 if(board.gradeRelease!==mapped.gradeRelease||!same(board.rows,mapped.rows)||!same(board.gameForecast,mapped.gameForecast))throw Error("CBB contextual stored market or game outcome differs from its exact decision");
 return {input:decoded.input as CbbContextualAssembledInput,decision,independent:trace.independent,coverage:trace.coverage};
}
