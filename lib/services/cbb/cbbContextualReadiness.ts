/** Read-only deployment proof. Authorization precedes even the lazy artifact
 * module import. This handler has no predictor, provider, DB writer or cron. */
import {createHash,timingSafeEqual} from "node:crypto";
import type {AdminAuthResult} from "../../auth/admin";

export const CBB_CONTEXTUAL_READINESS_RELEASE="cbb_contextual_readiness_2026_11_05_r1" as const;
type Environment={NEXT_PUBLIC_SUPABASE_URL?:string;VERCEL_ENV?:string;VERCEL_GIT_COMMIT_SHA?:string;GIT_COMMIT_SHA?:string};
type Metadata={model:string;calibration:string;engine:string;objectSha256:string;availableBy:string};
type ReadyRuntime={release:string;artifactObjectSha256:string;availableBy:string};
export type CbbReadinessDependencies={adminAuth:(request:Request)=>AdminAuthResult;machineSecret:()=>string|undefined;
 environment:()=>Environment;loadModule:()=>Promise<{metadata:Metadata;load:()=>Promise<ReadyRuntime>}>};
const sha=(value:string)=>createHash("sha256").update(value).digest();
/** Hash only the normalized HTTP(S) origin, never credentials/path/query. */
export function cbbReadinessDatabaseOriginSha256(value:string|undefined){
 try{const url=new URL(value??"");return ["https:","http:"].includes(url.protocol)?sha(url.origin).toString("hex"):null;}catch{return null;}
}
function machineAuthorized(request:Request,secret:string|undefined){
 const bearer=request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/i)?.[1];
 return !!secret&&!!bearer&&timingSafeEqual(sha(secret),sha(bearer));
}
function json(body:unknown,status:number){return Response.json(body,{status,headers:{"Cache-Control":"private, no-store, max-age=0","Pragma":"no-cache"}});}
export function createCbbContextualReadinessHandler(deps:CbbReadinessDependencies){
 return async(request:Request):Promise<Response>=>{
  const admin=deps.adminAuth(request);
  if(!admin.ok&&!machineAuthorized(request,deps.machineSecret()))return json({ready:false,release:CBB_CONTEXTUAL_READINESS_RELEASE},admin.response.status===403?403:401);
  const env=deps.environment(),databaseOriginSha256=cbbReadinessDatabaseOriginSha256(env.NEXT_PUBLIC_SUPABASE_URL),candidateCommit=env.VERCEL_GIT_COMMIT_SHA??env.GIT_COMMIT_SHA;
  const deployment={environment:["production","preview","development"].includes(env.VERCEL_ENV??"")?env.VERCEL_ENV:null,
   commit:candidateCommit&&/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(candidateCommit)?candidateCommit:null};
  let pinned:Partial<Metadata>={};
  try{
   if(databaseOriginSha256===null)throw Error("Database binding unavailable");
   const loadedModule=await deps.loadModule(),m=loadedModule.metadata;
   // An explicit allowlist prevents accidental runtime/training fields from
   // leaking if a dependency's shape later expands.
   pinned={model:m.model,calibration:m.calibration,engine:m.engine,objectSha256:m.objectSha256,availableBy:m.availableBy};
   const runtime=await loadedModule.load();
   if(runtime.release!==m.model||runtime.artifactObjectSha256!==m.objectSha256||runtime.availableBy!==m.availableBy)throw Error("Pinned runtime identity differs");
   return json({ready:true,release:CBB_CONTEXTUAL_READINESS_RELEASE,...pinned,deployment,databaseOriginSha256},200);
  }catch{
   // Do not expose exception text, signed URLs, credentials, storage responses
   // or model vectors. This is readiness, not a writer error/log endpoint.
   return json({ready:false,release:CBB_CONTEXTUAL_READINESS_RELEASE,...pinned,deployment,databaseOriginSha256},503);
  }
 };
}
