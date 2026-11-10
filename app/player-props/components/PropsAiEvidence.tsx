"use client";
import type {PropsAiMemberEvidence} from "@/lib/playerPropsAi/publicationContract";
import {propsAiOperationalException} from "@/lib/playerPropsAi/publicationContract";
import {LocalTime} from "@/app/lab/components/UserTimeZone";
const names:Record<string,string>={recent_form:"Recent form",opportunity_role:"Workload and role",matchup:"Matchup",head_to_head:"Matchup history",availability:"Injuries and availability",game_environment:"Game environment",market:"Market and prices",independent_model:"Independent forecast"};
export function PropsAiEvidence({evidence}:{evidence:PropsAiMemberEvidence}){
 const exception=propsAiOperationalException(evidence);
 return <div className="space-y-3" data-props-ai-evidence="source-review">
  <p className="text-xs leading-5 text-gray-400">Evidence strength: <strong className="text-gray-200">{["Limited","Moderate","Strong"][evidence.confidence]}</strong>. {evidence.stage==="final"?"Final":"Early"} review · <LocalTime value={evidence.reviewedAt} />. Model estimate from the supplied evidence.</p>
  {exception?<p className="text-xs leading-5 text-amber-200">{exception}</p>:null}
  <div className="grid gap-3 sm:grid-cols-2">{Object.entries(evidence.coverage).map(([area,value])=><section key={area} className="min-w-0 rounded-lg border border-gray-800 bg-black/20 p-3">
   <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-xs font-bold text-gray-200">{names[area]??area}</h4><span className="text-[10px] capitalize text-gray-500">{value.status}</span></div>
   <p className="mt-2 text-xs leading-5 text-gray-300">{value.observation}</p>
   {value.facts.length?<details className="mt-2 text-[10px] text-gray-500"><summary className="cursor-pointer text-violet-200">Reviewed sources ({value.facts.length})</summary><ul className="mt-2 space-y-2">{value.facts.map(f=><li key={f.id}>{f.label} · <LocalTime value={f.availableAt} /></li>)}</ul></details>:<p className="mt-2 text-[10px] text-gray-500">No verified source supplied.</p>}
  </section>)}</div>
 </div>;
}
