/** One pinned contextual law for the existing leased CBB writer. A private
 * training artifact is promoted by this exact release manifest; no refresh,
 * fallback model, provider collection or persistence is introduced here. */
import releaseManifest from "../../cbb/artifacts/contextual-outcome-r1-manifest.json";
import {forecastCbbOutcomeDecision} from "../../cbb/contextualOutcomeDecision";
import {buildCbbContextualOutcomeBoard,CBB_CONTEXTUAL_OUTCOME_BOARD_GRADE_RELEASE,type CbbOutcomeDecision} from "../../cbb/contextualOutcomeBoard";
import {freezeCbbContextualForecastArtifact,cbbContextualForecastObjectSha256,assertCbbContextualForecastCalibrationBinding} from "../../cbb/contextualForecastCalibrationBinding";
import {validateCbbOutcomeArtifact} from "../../cbb/contextualOutcomeForecast";
import {createCbbPrivateOutcomeArtifactLoader,type decodeCbbPrivateOutcomeArtifact,type CbbPrivateOutcomeManifest} from "./cbbOutcomeArtifactEnvelope";
import {createCbbOutcomeArtifactDownload} from "./cbbOutcomeArtifactStorage";
import {encodeCbbContextualEvidence,decodeCbbContextualEvidence,type CbbContextualEvidenceIdentity} from "./cbbContextualEvidenceCodec";
import type {CbbContextualAssembledInput,assembleCbbContextualReaderInput} from "./cbbContextualReaderInput";
import type {CbbForecast,CbbQuote} from "../../cbb/types";

export const CBB_CONTEXTUAL_OUTCOME_MODEL_RELEASE="cbb_contextual_outcome_2026_11_05_r1" as const;
export const CBB_CONTEXTUAL_OUTCOME_CALIBRATION_RELEASE="cbb_contextual_covariance_2026_11_05_r1" as const;
export const CBB_CONTEXTUAL_OUTCOME_EVIDENCE_RELEASE="cbb_contextual_outcome_evidence_2026_11_05_r1" as const;
export const CBB_CONTEXTUAL_OUTCOME_MANIFEST=Object.freeze(releaseManifest as CbbPrivateOutcomeManifest);
type Coverage=ReturnType<typeof assembleCbbContextualReaderInput>["coverage"];
type Evaluation={input:CbbContextualAssembledInput;independent:CbbForecast;targets:readonly (CbbQuote&{orientationVerified?:boolean})[];coverage?:Coverage};
type DecisionTrace=Omit<CbbOutcomeDecision,"interpretation"|"finalScore"|"marketDecisions">;
type StoredTrace={release:typeof CBB_CONTEXTUAL_OUTCOME_EVIDENCE_RELEASE;decision:DecisionTrace;independent:CbbForecast;coverage:Coverage|null};
type Loaded=ReturnType<typeof decodeCbbPrivateOutcomeArtifact>;
function same(a:unknown,b:unknown):boolean{if(a===b)return true;if(!a||!b||typeof a!=="object"||typeof b!=="object"||Array.isArray(a)!==Array.isArray(b))return false;
 const ka=Object.keys(a).sort(),kb=Object.keys(b).sort();return ka.length===kb.length&&ka.every((k,j)=>k===kb[j]&&same((a as Record<string,unknown>)[k],(b as Record<string,unknown>)[k]));}

/** Exported for reproducible offline integration tests. The actual writer uses
 * only loadCbbContextualOutcomeRuntime's immutable checked-in manifest. */
export function createCbbContextualOutcomeRuntime(args:{manifest:CbbPrivateOutcomeManifest;loaded:Loaded;mode?:"future"|"retrospective_development"}){
 const manifest=Object.freeze({...args.manifest}),{loaded}=args,mode=args.mode??"future",model=freezeCbbContextualForecastArtifact(loaded.model),calibration=structuredClone(loaded.calibration);
 validateCbbOutcomeArtifact(model);
 if(manifest.runtimeModelRelease!==CBB_CONTEXTUAL_OUTCOME_MODEL_RELEASE||model.release!==manifest.engineRelease||model.methodSha256!==manifest.methodSha256||
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
export type CbbReleasedOutcomeBoard=ReturnType<ReturnType<typeof createCbbContextualOutcomeRuntime>["evaluate"]>;
export type CbbContextualOutcomeRuntime=ReturnType<typeof createCbbContextualOutcomeRuntime>;
let defaultRuntime:Promise<CbbContextualOutcomeRuntime>|undefined;
export function loadCbbContextualOutcomeRuntime(){
 if(!defaultRuntime){
  const download=createCbbOutcomeArtifactDownload({supabaseURL:process.env.NEXT_PUBLIC_SUPABASE_URL??"",serviceRoleKey:process.env.SUPABASE_SERVICE_ROLE_KEY??""});
  const load=createCbbPrivateOutcomeArtifactLoader(CBB_CONTEXTUAL_OUTCOME_MANIFEST,download);
  const pending=load().then(loaded=>createCbbContextualOutcomeRuntime({manifest:CBB_CONTEXTUAL_OUTCOME_MANIFEST,loaded}));
  defaultRuntime=pending;pending.catch(()=>{if(defaultRuntime===pending)defaultRuntime=undefined;});
 }
 return defaultRuntime;
}

type StoredBoard={modelRelease?:string;gradeRelease?:string;gameId:number;asOf:string;score:unknown;gameForecast?:unknown;rows:readonly unknown[];
 marketContext:object};
/** Call only after locked DTO precedence. Legacy models are never decoded or
 * reconstructed. New receipts must match their stored exact law and grades. */
export function readCbbContextualOutcomeEvidence(board:StoredBoard){
 if(board.modelRelease!==CBB_CONTEXTUAL_OUTCOME_MODEL_RELEASE)return null;
 if(board.gradeRelease!==CBB_CONTEXTUAL_OUTCOME_BOARD_GRADE_RELEASE)throw Error("CBB contextual evidence grade release differs");
 const context=board.marketContext as {originalIndependent?:unknown;contextualOutcomeEvidence?:unknown};
 const original=context.originalIndependent as CbbForecast|undefined;
 if(!original)throw Error("CBB contextual evidence lacks original independent identity");
 const identity:CbbContextualEvidenceIdentity={gameId:board.gameId,asOf:board.asOf,modelRelease:CBB_CONTEXTUAL_OUTCOME_MODEL_RELEASE,gradeRelease:board.gradeRelease,
  independentRelease:original.release,artifactObjectSha256:CBB_CONTEXTUAL_OUTCOME_MANIFEST.modelObjectSha256};
 const decoded=decodeCbbContextualEvidence(context.contextualOutcomeEvidence,identity).evidence,trace=decoded.trace as StoredTrace;
 if(trace.release!==CBB_CONTEXTUAL_OUTCOME_EVIDENCE_RELEASE||!same(trace.independent,original)||!same(decoded.finalScore,board.score))throw Error("CBB contextual stored evidence differs from the public score or original input");
 const decision={...trace.decision,interpretation:decoded.interpretation,finalScore:decoded.finalScore,marketDecisions:decoded.marketDecisions} as CbbOutcomeDecision;
 if(decision.artifact.objectSha256!==identity.artifactObjectSha256||decision.artifact.release!==CBB_CONTEXTUAL_OUTCOME_MANIFEST.engineRelease||
  decision.artifact.methodSha256!==CBB_CONTEXTUAL_OUTCOME_MANIFEST.methodSha256||decision.calibration.forecastArtifactObjectSha256!==identity.artifactObjectSha256||
  decision.calibration.calibrationMethodSha256!==CBB_CONTEXTUAL_OUTCOME_MANIFEST.calibrationMethodSha256)throw Error("CBB contextual stored artifact or calibration differs from the release manifest");
 const mapped=buildCbbContextualOutcomeBoard({decision,independent:original});
 if(!same(board.rows,mapped.rows)||!same(board.gameForecast,mapped.gameForecast))throw Error("CBB contextual stored market or game outcome differs from its exact decision");
 return {input:decoded.input as CbbContextualAssembledInput,decision,independent:trace.independent,coverage:trace.coverage};
}
