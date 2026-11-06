import {validateAdminAuth} from "@/lib/auth/admin";
import {createCbbContextualReadinessHandler} from "@/lib/services/cbb/cbbContextualReadiness";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const handle=createCbbContextualReadinessHandler({adminAuth:validateAdminAuth,machineSecret:()=>process.env.CRON_SECRET,
 environment:()=>({NEXT_PUBLIC_SUPABASE_URL:process.env.NEXT_PUBLIC_SUPABASE_URL,VERCEL_ENV:process.env.VERCEL_ENV,
  VERCEL_GIT_COMMIT_SHA:process.env.VERCEL_GIT_COMMIT_SHA,GIT_COMMIT_SHA:process.env.GIT_COMMIT_SHA}),
 loadModule:async()=>{
  const m=await import("@/lib/services/cbb/cbbContextualOutcomeRuntime");
  return{metadata:m.cbbContextualOutcomeReadinessMetadata(),load:m.loadCbbContextualOutcomeRuntime};
 }});
/** Authenticated asset/DB-binding check only. It never evaluates a game. */
export async function GET(request:Request){return handle(request);}
