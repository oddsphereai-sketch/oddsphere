/** Better execution for an existing wager. No forecast, line or grade selection. */
import {cbbContextualExecutionProof} from "./contextualInterpretedDecision";
import {cbbPathBookFamily} from "./marketBehaviorPath";
import type {CbbContextualFeatureInput} from "./contextualForecastFeatures";
import type {CbbContextualMarketInterpretation} from "./contextualMarketInterpretation";
import type {createCbbContextualScoreLaw} from "./contextualScoreLawResearch";
import type {CbbQuote} from "./types";

export const CBB_SAME_CONTRACT_EXECUTION_RELEASE="cbb_same_contract_execution_2026_11_16_r1" as const;
const BOOKS=["draftkings","fanduel","betmgm","caesars"] as const;
type Quote=CbbQuote&{orientationVerified?:boolean};

export function selectCbbSameContractExecution(args:{input:CbbContextualFeatureInput;
 interpretation:CbbContextualMarketInterpretation;law:ReturnType<typeof createCbbContextualScoreLaw>;
 targets:readonly Quote[];candidates:readonly Quote[]}){
 const changes:{market:CbbQuote["market"];selection:"first"|"second";oldBook:string;newBook:string;oldPrice:number;newPrice:number;line:number|null}[]=[];
 const targets=args.targets.map(base=>{
  if(cbbContextualExecutionProof(base,args.input,args.interpretation).problem)return base;
  const p=args.law.probabilitiesFast(base.market,base.line),selection=p.first>=p.second?"first":"second";
  const price=(q:Quote)=>selection==="first"?q.firstPrice:q.secondPrice;
  const payout=(q:Quote)=>price(q)>0?price(q)/100:100/-price(q);
  let best=base;
  // Fixed book order breaks equal alternative prices; an equal baseline price
  // always retains its original observation and pair. No grade enters ranking.
  for(const book of BOOKS){
   const own=args.candidates.filter(q=>cbbPathBookFamily(q.sportsbook)===book&&q.gameId===base.gameId&&q.market===base.market&&q.line===base.line&&payout(q)>payout(best))
    .sort((a,b)=>payout(b)-payout(a)||JSON.stringify(a).localeCompare(JSON.stringify(b)));
   const candidate=own.find(q=>!cbbContextualExecutionProof(q,args.input,args.interpretation).problem);
   if(candidate)best=candidate;
  }
  if(best!==base)changes.push({market:base.market,selection,oldBook:base.sportsbook,newBook:best.sportsbook,
   oldPrice:price(base),newPrice:price(best),line:base.line});
  return best;
 });
 return{release:CBB_SAME_CONTRACT_EXECUTION_RELEASE,targets,changes};
}
