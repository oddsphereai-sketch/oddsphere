/** Private transport only. Packaging never authorizes activation or writes a prediction.
 * The fitted GP contains training evidence and must not enter the public repository. */
import {createHash} from "node:crypto";
import {gzipSync,gunzipSync} from "node:zlib";
import {validateCbbOutcomeArtifact,type CbbOutcomeArtifact} from "../../cbb/contextualOutcomeForecast";
import {assertCbbContextualForecastCalibrationBinding,freezeCbbContextualForecastArtifact,type CbbContextualForecastCalibrationBinding} from "../../cbb/contextualForecastCalibrationBinding";

export const CBB_PRIVATE_OUTCOME_ARTIFACT_RELEASE="cbb_private_outcome_artifact_2026_11_05_r1" as const;
export const CBB_PRIVATE_OUTCOME_ARTIFACT_LIMITS={compressedBytes:2_000_000,uncompressedBytes:16_000_000} as const;
const sha=(v:string|Uint8Array)=>createHash("sha256").update(v).digest("hex");
const hash=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v);
function need(v:unknown,message:string):asserts v{if(!v)throw Error("CBB private outcome artifact: "+message);}
function freeze<T>(value:T):T{if(value&&typeof value==="object"&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
export type CbbPrivateOutcomeManifest={
 envelopeRelease:typeof CBB_PRIVATE_OUTCOME_ARTIFACT_RELEASE;runtimeModelRelease:string;engineRelease:string;methodSha256:string;
 modelJSONSha256:string;modelObjectSha256:string;calibrationJSONSha256:string;calibrationMethodSha256:string;
 compressedSha256:string;uncompressedSha256:string;compressedBytes:number;uncompressedBytes:number;availableBy:string;
};
type CalibrationFile={schema:string;availableBy:string;fullModel:{fileSha256:string;objectSha256:string};
 calibration:{status:string;parameters:unknown};binding:CbbContextualForecastCalibrationBinding|null};
function components(modelJSON:string,calibrationJSON:string){
 const model=JSON.parse(modelJSON) as CbbOutcomeArtifact,calibration=JSON.parse(calibrationJSON) as CalibrationFile;
 validateCbbOutcomeArtifact(model);
 const modelJSONSha256=sha(modelJSON),modelObjectSha256=sha(JSON.stringify(model));
 need(model.margin.optimizer.converged&&model.total.optimizer.converged&&model.factorArtifact.margin.optimizer.converged&&model.factorArtifact.total.optimizer.converged,"unresolved fit");
 need(calibration.schema==="cbb_outcome_joint_calibration_v1"&&calibration.binding&&calibration.calibration?.status==="converged"&&
  calibration.fullModel?.fileSha256===modelJSONSha256&&calibration.fullModel.objectSha256===modelObjectSha256&&
  calibration.availableBy===calibration.binding.availableBy&&JSON.stringify(calibration.calibration.parameters)===JSON.stringify(calibration.binding.parameters),"model/calibration binding differs");
 assertCbbContextualForecastCalibrationBinding({artifact:model,calibration:calibration.binding,asOf:calibration.availableBy,mode:"future"});
 return {model,calibration:calibration.binding,modelJSONSha256,modelObjectSha256,calibrationJSONSha256:sha(calibrationJSON),availableBy:new Date(calibration.availableBy).toISOString()};
}
function validateManifest(m:CbbPrivateOutcomeManifest){
 need(m.envelopeRelease===CBB_PRIVATE_OUTCOME_ARTIFACT_RELEASE&&typeof m.runtimeModelRelease==="string"&&m.runtimeModelRelease.trim()&&
  typeof m.engineRelease==="string"&&m.engineRelease.trim()&&[m.methodSha256,m.modelJSONSha256,m.modelObjectSha256,m.calibrationJSONSha256,m.calibrationMethodSha256,m.compressedSha256,m.uncompressedSha256].every(hash)&&
  Number.isSafeInteger(m.compressedBytes)&&m.compressedBytes>0&&m.compressedBytes<=CBB_PRIVATE_OUTCOME_ARTIFACT_LIMITS.compressedBytes&&
  Number.isSafeInteger(m.uncompressedBytes)&&m.uncompressedBytes>0&&m.uncompressedBytes<=CBB_PRIVATE_OUTCOME_ARTIFACT_LIMITS.uncompressedBytes&&
  Number.isFinite(Date.parse(m.availableBy)),"invalid manifest");
}
export function packageCbbPrivateOutcomeArtifact(args:{runtimeModelRelease:string;modelJSON:string;calibrationJSON:string}){
 need(typeof args.runtimeModelRelease==="string"&&args.runtimeModelRelease.trim(),"runtime release missing");
 need(Buffer.byteLength(args.modelJSON)+Buffer.byteLength(args.calibrationJSON)<=CBB_PRIVATE_OUTCOME_ARTIFACT_LIMITS.uncompressedBytes,"components exceed storage budget");
 const c=components(args.modelJSON,args.calibrationJSON),raw=Buffer.from(JSON.stringify({release:CBB_PRIVATE_OUTCOME_ARTIFACT_RELEASE,runtimeModelRelease:args.runtimeModelRelease,modelJSON:args.modelJSON,calibrationJSON:args.calibrationJSON}));
 need(raw.length<=CBB_PRIVATE_OUTCOME_ARTIFACT_LIMITS.uncompressedBytes,"envelope exceeds storage budget");
 const compressed=gzipSync(raw,{level:9});need(compressed.length<=CBB_PRIVATE_OUTCOME_ARTIFACT_LIMITS.compressedBytes,"compressed storage budget exceeded");
 const manifest:CbbPrivateOutcomeManifest={envelopeRelease:CBB_PRIVATE_OUTCOME_ARTIFACT_RELEASE,runtimeModelRelease:args.runtimeModelRelease,engineRelease:c.model.release,methodSha256:c.model.methodSha256,
  modelJSONSha256:c.modelJSONSha256,modelObjectSha256:c.modelObjectSha256,calibrationJSONSha256:c.calibrationJSONSha256,calibrationMethodSha256:c.calibration.calibrationMethodSha256,
  compressedSha256:sha(compressed),uncompressedSha256:sha(raw),compressedBytes:compressed.length,uncompressedBytes:raw.length,availableBy:c.availableBy};
 return{manifest,compressed};
}
export function decodeCbbPrivateOutcomeArtifact(bytes:Uint8Array,manifest:CbbPrivateOutcomeManifest){
 validateManifest(manifest);need(bytes.byteLength===manifest.compressedBytes&&sha(bytes)===manifest.compressedSha256,"transport hash or size differs");
 const raw=gunzipSync(bytes,{maxOutputLength:CBB_PRIVATE_OUTCOME_ARTIFACT_LIMITS.uncompressedBytes});
 need(raw.length===manifest.uncompressedBytes&&sha(raw)===manifest.uncompressedSha256,"decompressed hash or size differs");
 const value=JSON.parse(raw.toString("utf8"));need(value.release===manifest.envelopeRelease&&value.runtimeModelRelease===manifest.runtimeModelRelease&&typeof value.modelJSON==="string"&&typeof value.calibrationJSON==="string","envelope identity differs");
 const c=components(value.modelJSON,value.calibrationJSON);
 need(c.model.release===manifest.engineRelease&&c.model.methodSha256===manifest.methodSha256&&c.modelJSONSha256===manifest.modelJSONSha256&&c.modelObjectSha256===manifest.modelObjectSha256&&
  c.calibrationJSONSha256===manifest.calibrationJSONSha256&&c.calibration.calibrationMethodSha256===manifest.calibrationMethodSha256&&c.availableBy===manifest.availableBy,"component identity differs");
 freezeCbbContextualForecastArtifact(c.model);return freeze(c);
}
/** One immutable release per loader. Concurrent calls share the same bounded
 * download; failure is retryable and never selects a different model. */
export function createCbbPrivateOutcomeArtifactLoader(manifest:CbbPrivateOutcomeManifest,download:(key:string,maxBytes:number)=>Promise<Uint8Array>){
 validateManifest(manifest);const expected=Object.freeze({...manifest});let pending:Promise<ReturnType<typeof decodeCbbPrivateOutcomeArtifact>>|undefined;
 return()=>{if(!pending){const request=Promise.resolve().then(()=>download(expected.compressedSha256+".json.gz",expected.compressedBytes)).then(bytes=>decodeCbbPrivateOutcomeArtifact(bytes,expected));pending=request;request.catch(()=>{if(pending===request)pending=undefined;});}return pending;};
}
