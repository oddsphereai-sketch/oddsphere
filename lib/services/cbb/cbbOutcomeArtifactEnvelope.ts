/** Private transport only. Packaging never authorizes activation or writes a prediction.
 * The fitted GP contains training evidence and must not enter the public repository. */
import {createHash} from "node:crypto";
import {gzipSync,gunzipSync} from "node:zlib";
import {validateCbbOutcomeArtifact,type CbbOutcomeArtifact} from "../../cbb/contextualOutcomeForecast";
import {validateCbbCompositeOutcomeArtifact,type CbbCompositeOutcomeArtifact} from "../../cbb/contextualCompositeOutcomeForecast";
import type {CbbOutcomeArtifact as CbbDirectOutcomeArtifact} from "../../cbb/contextualDirectOutcomeForecast";
type TransportModel=CbbOutcomeArtifact|CbbCompositeOutcomeArtifact;
function isComposite(model:TransportModel):model is CbbCompositeOutcomeArtifact{return "legacyMarginModel" in model;}
import {assertCbbContextualForecastCalibrationBinding,freezeCbbContextualForecastArtifact,type CbbContextualForecastCalibrationBinding} from "../../cbb/contextualForecastCalibrationBinding";

export const CBB_PRIVATE_OUTCOME_ARTIFACT_LEGACY_RELEASE="cbb_private_outcome_artifact_2026_11_05_r1" as const;
export const CBB_PRIVATE_OUTCOME_ARTIFACT_RELEASE="cbb_private_outcome_artifact_2026_11_06_r2_schema_dictionary" as const;
export const CBB_PRIVATE_OUTCOME_ARTIFACT_LIMITS={compressedBytes:2_000_000,uncompressedBytes:16_000_000} as const;
/** Logical JSON is reconstructed transiently, then repeated schemas share
 * frozen arrays. These are separate from the unchanged wire byte budgets. */
export const CBB_PRIVATE_OUTCOME_LOGICAL_LIMITS={modelJSONBytes:64_000_000,trainingRows:512,schemas:64,vectorWidth:4096,chunks:30_000} as const;
const sha=(v:string|Uint8Array)=>createHash("sha256").update(v).digest("hex");
const hash=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v);
function need(v:unknown,message:string):asserts v{if(!v)throw Error("CBB private outcome artifact: "+message);}
function freeze<T>(value:T):T{if(value&&typeof value==="object"&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
export type CbbPrivateOutcomeManifest={
 envelopeRelease:typeof CBB_PRIVATE_OUTCOME_ARTIFACT_RELEASE|typeof CBB_PRIVATE_OUTCOME_ARTIFACT_LEGACY_RELEASE;logicalModelJSONBytes?:number;runtimeModelRelease:string;engineRelease:string;methodSha256:string;
 modelJSONSha256:string;modelObjectSha256:string;calibrationJSONSha256:string;calibrationMethodSha256:string;
 compressedSha256:string;uncompressedSha256:string;compressedBytes:number;uncompressedBytes:number;availableBy:string;
};
type SchemaDictionary={codec:"exact_json_schema_dictionary_v1";dictionary:string[];chunks:(string|number)[];logicalBytes:number};
function stringEnd(text:string,start:number){let i=start+1;for(;i<text.length;i++){if(text[i]==="\\"){i++;continue;}if(text[i]==='"')return i+1;}throw Error("CBB private outcome artifact: unterminated JSON string");}
function arrayEnd(text:string,start:number){let depth=0;for(let i=start;i<text.length;i++){if(text[i]==='"'){i=stringEnd(text,i)-1;continue;}if(text[i]==="[")depth++;if(text[i]==="]"&&!--depth)return i+1;}throw Error("CBB private outcome artifact: unterminated schema array");}
/** Scan JSON tokens, never regex inside escaped strings. Original array
 * lexemes preserve arbitrary whitespace and exact original file identity. */
export function encodeCbbOutcomeSchemaDictionary(text:string):SchemaDictionary{
 const logicalBytes=Buffer.byteLength(text);need(logicalBytes>0&&logicalBytes<=CBB_PRIVATE_OUTCOME_LOGICAL_LIMITS.modelJSONBytes,"logical model expansion exceeds budget");
 const dictionary:string[]=[],chunks:(string|number)[]=[],ids=new Map<string,number>();let last=0;
 for(let i=0;i<text.length;i++){if(text[i]!=='"')continue;const end=stringEnd(text,i),key=JSON.parse(text.slice(i,end));let colon=end;while(/\s/.test(text[colon]??"x"))colon++;if((key!=="names"&&key!=="parity")||text[colon]!==":"){i=end-1;continue;}let begin=colon+1;while(/\s/.test(text[begin]??"x"))begin++;if(text[begin]!=="["){i=end-1;continue;}const stop=arrayEnd(text,begin),literal=text.slice(begin,stop),values=JSON.parse(literal);need(Array.isArray(values)&&values.length<=CBB_PRIVATE_OUTCOME_LOGICAL_LIMITS.vectorWidth&&values.every(v=>key==="names"?typeof v==="string":v===1||v===-1),"invalid vector schema width or values");let id=ids.get(literal);if(id===undefined){id=dictionary.length;need(id<CBB_PRIVATE_OUTCOME_LOGICAL_LIMITS.schemas,"schema dictionary count exceeds budget");ids.set(literal,id);dictionary.push(literal);}chunks.push(text.slice(last,begin),id);last=stop;i=stop-1;}
 chunks.push(text.slice(last));need(chunks.length<=CBB_PRIVATE_OUTCOME_LOGICAL_LIMITS.chunks,"schema reference count exceeds budget");return{codec:"exact_json_schema_dictionary_v1",dictionary,chunks,logicalBytes};
}
export function decodeCbbOutcomeSchemaDictionary(value:unknown):string{
 const v=value as SchemaDictionary;need(v?.codec==="exact_json_schema_dictionary_v1"&&Array.isArray(v.dictionary)&&v.dictionary.length<=CBB_PRIVATE_OUTCOME_LOGICAL_LIMITS.schemas&&Array.isArray(v.chunks)&&v.chunks.length<=CBB_PRIVATE_OUTCOME_LOGICAL_LIMITS.chunks&&Number.isSafeInteger(v.logicalBytes)&&v.logicalBytes>0&&v.logicalBytes<=CBB_PRIVATE_OUTCOME_LOGICAL_LIMITS.modelJSONBytes,"invalid bounded schema dictionary");
 for(const literal of v.dictionary){need(typeof literal==="string","invalid schema literal");const a=JSON.parse(literal);need(Array.isArray(a)&&a.length<=CBB_PRIVATE_OUTCOME_LOGICAL_LIMITS.vectorWidth&&a.every(x=>typeof x==="string"||x===1||x===-1),"invalid vector schema width or values");}
 let bytes=0;for(const chunk of v.chunks){need(typeof chunk==="string"||Number.isSafeInteger(chunk)&&chunk>=0&&chunk<v.dictionary.length,"invalid schema reference");bytes+=Buffer.byteLength(typeof chunk==="string"?chunk:v.dictionary[chunk]);need(bytes<=CBB_PRIVATE_OUTCOME_LOGICAL_LIMITS.modelJSONBytes&&bytes<=v.logicalBytes,"logical model expansion exceeds declared budget");}
 need(bytes===v.logicalBytes,"logical model byte size differs");return v.chunks.map(x=>typeof x==="string"?x:v.dictionary[x]).join("");
}
function internSchemas(model:CbbOutcomeArtifact|CbbDirectOutcomeArtifact){
 need(model.trainingGames<=CBB_PRIVATE_OUTCOME_LOGICAL_LIMITS.trainingRows,"logical training row budget exceeded");const arrays=new Map<string,readonly unknown[]>();
 const intern=(values:unknown[])=>{const key=JSON.stringify(values),known=arrays.get(key);if(known)return known;const shared=Object.freeze(values);arrays.set(key,shared);return shared;};
 for(const axis of ["margin","total"] as const){const head=model[axis];need(Array.isArray(head?.inputs)&&head.inputs.length<=CBB_PRIVATE_OUTCOME_LOGICAL_LIMITS.trainingRows,"logical input row budget exceeded");for(const input of head.inputs)for(const block of Object.values(input.blocks)){need(Array.isArray(block.names)&&Array.isArray(block.parity)&&block.names.length<=CBB_PRIVATE_OUTCOME_LOGICAL_LIMITS.vectorWidth&&block.values.length===block.names.length&&block.known.length===block.names.length&&block.parity.length===block.names.length,"logical vector schema width mismatch");block.names=intern(block.names) as string[];block.parity=intern(block.parity) as (1|-1)[];}}
}
type CalibrationFile={schema:string;availableBy:string;fullModel:{fileSha256:string;objectSha256:string};
 calibration:{status:string;parameters:unknown};binding:CbbContextualForecastCalibrationBinding|null};
function components(modelJSON:string,calibrationJSON:string){
 const model=JSON.parse(modelJSON) as TransportModel,calibration=JSON.parse(calibrationJSON) as CalibrationFile;
 if(isComposite(model)){internSchemas(model.legacyMarginModel);internSchemas(model.directTotalModel);validateCbbCompositeOutcomeArtifact(model);}
 else{internSchemas(model);validateCbbOutcomeArtifact(model);}
 const modelJSONSha256=sha(modelJSON),modelObjectSha256=sha(JSON.stringify(model));
 need(isComposite(model)?model.legacyMarginModel.margin.optimizer.converged&&model.directTotalModel.total.optimizer.converged:
  model.margin.optimizer.converged&&model.total.optimizer.converged&&model.factorArtifact.margin.optimizer.converged&&model.factorArtifact.total.optimizer.converged,"unresolved fit");
 need(calibration.schema==="cbb_outcome_joint_calibration_v1"&&calibration.binding&&calibration.calibration?.status==="converged"&&
  calibration.fullModel?.fileSha256===modelJSONSha256&&calibration.fullModel.objectSha256===modelObjectSha256&&
  calibration.availableBy===calibration.binding.availableBy&&JSON.stringify(calibration.calibration.parameters)===JSON.stringify(calibration.binding.parameters),"model/calibration binding differs");
 assertCbbContextualForecastCalibrationBinding({artifact:model,calibration:calibration.binding,asOf:calibration.availableBy,mode:"future"});
 return {model,calibration:calibration.binding,modelJSONSha256,modelObjectSha256,calibrationJSONSha256:sha(calibrationJSON),availableBy:new Date(calibration.availableBy).toISOString()};
}
function validateManifest(m:CbbPrivateOutcomeManifest){
 need([CBB_PRIVATE_OUTCOME_ARTIFACT_RELEASE,CBB_PRIVATE_OUTCOME_ARTIFACT_LEGACY_RELEASE].includes(m.envelopeRelease)&&
  (m.envelopeRelease!==CBB_PRIVATE_OUTCOME_ARTIFACT_RELEASE||Number.isSafeInteger(m.logicalModelJSONBytes)&&m.logicalModelJSONBytes!>0&&m.logicalModelJSONBytes!<=CBB_PRIVATE_OUTCOME_LOGICAL_LIMITS.modelJSONBytes)&&typeof m.runtimeModelRelease==="string"&&m.runtimeModelRelease.trim()&&
  typeof m.engineRelease==="string"&&m.engineRelease.trim()&&[m.methodSha256,m.modelJSONSha256,m.modelObjectSha256,m.calibrationJSONSha256,m.calibrationMethodSha256,m.compressedSha256,m.uncompressedSha256].every(hash)&&
  Number.isSafeInteger(m.compressedBytes)&&m.compressedBytes>0&&m.compressedBytes<=CBB_PRIVATE_OUTCOME_ARTIFACT_LIMITS.compressedBytes&&
  Number.isSafeInteger(m.uncompressedBytes)&&m.uncompressedBytes>0&&m.uncompressedBytes<=CBB_PRIVATE_OUTCOME_ARTIFACT_LIMITS.uncompressedBytes&&
  Number.isFinite(Date.parse(m.availableBy)),"invalid manifest");
}
export function packageCbbPrivateOutcomeArtifact(args:{runtimeModelRelease:string;modelJSON:string;calibrationJSON:string}){
 need(typeof args.runtimeModelRelease==="string"&&args.runtimeModelRelease.trim(),"runtime release missing");
 need(Buffer.byteLength(args.calibrationJSON)<=CBB_PRIVATE_OUTCOME_ARTIFACT_LIMITS.uncompressedBytes,"calibration exceeds storage budget");
 const packedModel=encodeCbbOutcomeSchemaDictionary(args.modelJSON);need(decodeCbbOutcomeSchemaDictionary(packedModel)===args.modelJSON,"schema codec changed exact model JSON bytes");
 const c=components(args.modelJSON,args.calibrationJSON),raw=Buffer.from(JSON.stringify({release:CBB_PRIVATE_OUTCOME_ARTIFACT_RELEASE,runtimeModelRelease:args.runtimeModelRelease,modelJSON:packedModel,calibrationJSON:args.calibrationJSON}));
 need(raw.length<=CBB_PRIVATE_OUTCOME_ARTIFACT_LIMITS.uncompressedBytes,"envelope exceeds storage budget");
 const compressed=gzipSync(raw,{level:9});need(compressed.length<=CBB_PRIVATE_OUTCOME_ARTIFACT_LIMITS.compressedBytes,"compressed storage budget exceeded");
 const manifest:CbbPrivateOutcomeManifest={envelopeRelease:CBB_PRIVATE_OUTCOME_ARTIFACT_RELEASE,logicalModelJSONBytes:packedModel.logicalBytes,runtimeModelRelease:args.runtimeModelRelease,engineRelease:c.model.release,methodSha256:c.model.methodSha256,
  modelJSONSha256:c.modelJSONSha256,modelObjectSha256:c.modelObjectSha256,calibrationJSONSha256:c.calibrationJSONSha256,calibrationMethodSha256:c.calibration.calibrationMethodSha256,
  compressedSha256:sha(compressed),uncompressedSha256:sha(raw),compressedBytes:compressed.length,uncompressedBytes:raw.length,availableBy:c.availableBy};
 return{manifest,compressed};
}
export function decodeCbbPrivateOutcomeArtifact(bytes:Uint8Array,manifest:CbbPrivateOutcomeManifest){
 validateManifest(manifest);need(bytes.byteLength===manifest.compressedBytes&&sha(bytes)===manifest.compressedSha256,"transport hash or size differs");
 const raw=gunzipSync(bytes,{maxOutputLength:CBB_PRIVATE_OUTCOME_ARTIFACT_LIMITS.uncompressedBytes});
 need(raw.length===manifest.uncompressedBytes&&sha(raw)===manifest.uncompressedSha256,"decompressed hash or size differs");
 const value=JSON.parse(raw.toString("utf8"));need(value.release===manifest.envelopeRelease&&value.runtimeModelRelease===manifest.runtimeModelRelease&&typeof value.calibrationJSON==="string","envelope identity differs");
 const modelJSON=manifest.envelopeRelease===CBB_PRIVATE_OUTCOME_ARTIFACT_RELEASE?decodeCbbOutcomeSchemaDictionary(value.modelJSON):value.modelJSON;
 need(typeof modelJSON==="string"&&(manifest.envelopeRelease!==CBB_PRIVATE_OUTCOME_ARTIFACT_RELEASE||Buffer.byteLength(modelJSON)===manifest.logicalModelJSONBytes),"logical model identity differs");
 const c=components(modelJSON,value.calibrationJSON);
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
