/** Financial maintenance only. This command has no inference or provider-collection mode. */
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { PropsAiStore, usageMicroUsd } from "../../lib/playerPropsAi/budget";
import { makePropsWalletPlan } from "../../lib/playerPropsAi/walletPlan";
import { invariant } from "../../lib/playerPropsAi/evidence";
const arg=(key:string)=>process.argv.find(a=>a.startsWith(`--${key}=`))?.slice(key.length+3);
async function main(){
  const mode=arg("mode"),out=arg("out"),month=arg("month");
  invariant(["plan","status"].includes(mode??"")&&out?.startsWith("/private/tmp/")&&/^\d{4}-(0[1-9]|1[0-2])$/.test(month??""),"Explicit plan/status mode, UTC month and NEW private output required");
  let report:unknown;
  const connect=()=>{invariant(process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY,"Configured server database required");return new PropsAiStore(createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}}));};
  if(mode==="plan"){
    const input=arg("input");invariant(input?.startsWith("/private/tmp/"),"Private full canonical calendar/envelope file required");
    const source=JSON.parse(readFileSync(input!,"utf8"));
    const plan=makePropsWalletPlan({...source,month:month!,now:new Date().toISOString()});
    const standard=(j:typeof plan.jobs[number])=>j.requests.reduce((n,r)=>n+usageMicroUsd("gpt-6-luna",{input_tokens:r.input_tokens+2048,output_tokens:r.max_output_tokens}),0);
    const core=plan.jobs.reduce((n,j)=>n+j.requests.reduce((s,r)=>s+usageMicroUsd("gpt-6-luna",{input_tokens:r.input_tokens+2048,output_tokens:r.max_output_tokens},j.stage==="early"?"flex":"default"),0),0);
    const early=plan.jobs.filter(j=>j.stage==="early"),fallback=early.map(standard).sort((a,b)=>b-a).slice(0,Math.ceil(early.length*.1)).reduce((a,b)=>a+b,0);
    const initialPreflight={coreMicro:core,fallbackMicro:fallback,recoveryMicro:3_000_000,totalMicro:core+fallback+3_000_000};
    // Server RPC includes all prior spending/unknowns. This local quote is an initial-plan diagnostic only.
    report={plan,initialPreflight,applied:arg("apply")==="true",result:arg("apply")==="true"?await connect().plan(plan):null,inferenceCalls:0,providerCalls:0};
  }else report={month,budget:await connect().budget(month!),inferenceCalls:0,providerCalls:0};
  writeFileSync(out!,JSON.stringify(report,null,2),{mode:0o600,flag:"wx"});console.log(JSON.stringify({out,inferenceCalls:0,providerCalls:0}));
}
void main().catch(error=>{console.error((error as Error).message.replace(/sk-[\w-]+/g,"redacted"));process.exitCode=1;});
