/** Authenticated, bounded private model read. No bucket creation/upload,
 * provider request, prediction write, or automatic model selection. */
export const CBB_OUTCOME_ARTIFACT_BUCKET="model-artifacts" as const;
const PREFIX="cbb/contextual-outcome/";
export function createCbbOutcomeArtifactDownload(args:{supabaseURL:string;serviceRoleKey:string;fetcher?:typeof fetch;timeoutMs?:number}){
 const origin=new URL(args.supabaseURL),timeoutMs=args.timeoutMs??8_000;
 if(origin.protocol!=="https:"||origin.username||origin.password||origin.search||origin.hash||origin.pathname!=="/"||!args.serviceRoleKey||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30_000)throw Error("CBB private artifact storage configuration invalid");
 return async(key:string,maxBytes:number)=>{
  if(!/^[a-f0-9]{64}\.json\.gz$/.test(key)||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>2_000_000)throw Error("CBB private artifact download identity/budget invalid");
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   const url=new URL("/storage/v1/object/"+CBB_OUTCOME_ARTIFACT_BUCKET+"/"+PREFIX+key,origin);
   const response=await(args.fetcher??fetch)(url,{method:"GET",headers:{Authorization:"Bearer "+args.serviceRoleKey,apikey:args.serviceRoleKey},signal:controller.signal,cache:"no-store",redirect:"error"});
   if(!response.ok){await response.body?.cancel();throw Error("CBB private artifact download failed (HTTP "+response.status+")");}
   const length=response.headers.get("content-length");if(length!==null&&(!/^\d+$/.test(length)||Number(length)!==maxBytes)){await response.body?.cancel();throw Error("CBB private artifact declared size differs");}
   if(!response.body)throw Error("CBB private artifact download has no body");
   const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
   try{for(;;){const{done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw Error("CBB private artifact download exceeds budget");}chunks.push(value);}}finally{reader.releaseLock();}
   if(size!==maxBytes)throw Error("CBB private artifact downloaded size differs");
   const bytes=new Uint8Array(size);let at=0;for(const part of chunks){bytes.set(part,at);at+=part.byteLength;}return bytes;
  }finally{clearTimeout(timer);}
 };
}
