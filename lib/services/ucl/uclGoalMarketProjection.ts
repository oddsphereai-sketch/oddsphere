import type {EplForwardBookVector} from "@/lib/services/epl/eplForwardEvidenceCapture";
import type {SoccerFixtureEventIdentity} from "@/lib/providers/real_api/SharpApiEplMarketProvider";
import {soccerStoredPriceMaxAgeMs} from "@/lib/providers/real_api/CurrentSoccerMarketProvider";
import type {ScoreDistribution} from "@/lib/services/soccer/dixonColes";

export type UclGoalConstraint={identity:string;feature:(home:number,away:number)=>number;target:number};

/** Fraction of stake that wins/loses on an Over contract. A quarter line
 * splits equally between the adjacent whole/half lines; pushes earn/lose0. */
export function uclTotalStakeFractions(goals:number,line:number):{win:number;loss:number}{
 if(!Number.isInteger(goals)||goals<0||!Number.isFinite(line)||line<0||!Number.isInteger(line*4))throw Error("Invalid regulation goals contract");
 const legs=Number.isInteger(line*2)?[line]:[line-.25,line+.25];
 return{win:legs.reduce((sum,leg)=>sum+(goals>leg?1:0),0)/legs.length,
  loss:legs.reduce((sum,leg)=>sum+(goals<leg?1:0),0)/legs.length};
}

export function uclNativeTotalConstraint(identity:string,line:number,fairOver:number):UclGoalConstraint{
 if(!Number.isFinite(fairOver)||fairOver<=0||fairOver>=1)throw Error("Invalid paired total probability");
 // q is a fair stake-settlement share, not unconditional P(N>line).
 return{identity,target:0,feature:(home,away)=>{const s=uclTotalStakeFractions(home+away,line);return(1-fairOver)*s.win-fairOver*s.loss;}};
}

export function uclBttsConstraint(identity:string,fairYes:number):UclGoalConstraint{
 if(!Number.isFinite(fairYes)||fairYes<=0||fairYes>=1)throw Error("Invalid paired BTTS probability");
 return{identity,target:fairYes,feature:(home,away)=>home>0&&away>0?1:0};
}

/** Minimum-information projection. Each exact paired market supplies a linear
 * settlement constraint on ONE joint law. No independent mean or binary-goals
 * probability is frozen; every resulting market and expected score can move.
 * Numerical tolerances/iteration bounds control convergence, never play grades. */
export function projectUclGoalMarkets(base:ScoreDistribution,constraints:readonly UclGoalConstraint[]):{
 joint:ScoreDistribution;converged:boolean;residual:number;iterations:number;
}{
 if(!constraints.length)return{joint:base.map(row=>[...row]),converged:true,residual:0,iterations:0};
 const cells=base.flatMap((row,home)=>row.map((p,away)=>({home,away,p})));
 if(!cells.length||cells.some(c=>!Number.isFinite(c.p)||c.p<0)||!(cells.reduce((s,c)=>s+c.p,0)>0))throw Error("Invalid prior score law");
 const mass=cells.reduce((sum,c)=>sum+c.p,0);let probabilities=cells.map(c=>c.p/mass);
 const features=constraints.map(c=>cells.map(cell=>c.feature(cell.home,cell.away)));
 if(features.some(row=>row.some(v=>!Number.isFinite(v))))throw Error("Invalid goal-market feature");
 const residual=()=>Math.max(0,...constraints.map((c,i)=>Math.abs(probabilities.reduce((sum,p,k)=>sum+p*features[i]![k]!,0)-c.target)));
 let error=residual(),iterations=0;
 for(;iterations<256&&error>1e-9;iterations++){
  for(let i=0;i<constraints.length;i++){
   const c=constraints[i]!,feature=features[i]!;
   const meanAt=(theta:number)=>{
    let z=0,sum=0;const shift=Math.max(...feature.map((f,k)=>probabilities[k]!>0?theta*f:-Infinity));
    for(let k=0;k<probabilities.length;k++){const w=probabilities[k]!*Math.exp(theta*feature[k]!-shift);z+=w;sum+=w*feature[k]!;}
    return{mean:sum/z,shift};
   };
   let low=-1,high=1;
   while(low>-256&&meanAt(low).mean>c.target)low*=2;
   while(high<256&&meanAt(high).mean<c.target)high*=2;
   if(meanAt(low).mean>c.target+1e-9||meanAt(high).mean<c.target-1e-9)return{joint:base.map(row=>[...row]),converged:false,residual:error,iterations};
   for(let step=0;step<64;step++){const theta=(low+high)/2;if(meanAt(theta).mean<c.target)low=theta;else high=theta;}
   const theta=(low+high)/2,shift=meanAt(theta).shift;
   const updated=probabilities.map((p,k)=>p*Math.exp(theta*feature[k]!-shift));const z=updated.reduce((s,p)=>s+p,0);
   if(!Number.isFinite(z)||z<=0)return{joint:base.map(row=>[...row]),converged:false,residual:error,iterations};
   probabilities=updated.map(p=>p/z);
  }
  error=residual();
 }
 const joint=base.map(row=>row.map(()=>0));cells.forEach((cell,i)=>{joint[cell.home]![cell.away]=probabilities[i]!;});
 return{joint: error<=1e-7?joint:base.map(row=>[...row]),converged:error<=1e-7,residual:error,iterations};
}


export type UclNativeGoalSource={
 identity:string;book:string;provider:string;providerEventId:string;market:"total"|"btts";
 line:number|null;fairPositive:number;originalQuoteAtMin:string;originalQuoteAtMax:string;
 role:"target_excluded_reference";
};
export type UclNativeGoalRead={
 total:UclNativeGoalSource|null;btts:UclNativeGoalSource|null;
 availableTotalBooks:string[];availableBttsBooks:string[];
 inactive:Array<{identity:string;reason:string}>;
 totalApplied:boolean;bttsApplied:boolean;converged:boolean;residual:number;
 reason:string;before:{home:number;away:number};after:{home:number;away:number};
};
type GoalInput={totalVectors:EplForwardBookVector[];bttsVectors:EplForwardBookVector[];
 evaluatedTotalCanonicalBook:string|null;evaluatedBttsCanonicalBook:string|null;
 providerEventId:string|null;fixtureEventIdentities?:SoccerFixtureEventIdentity[];
 decisionAt:number;kickoff:number;};
const GOAL_BOOK_PRIORITY=["pinnacle","circa","novig","draftkings","fanduel","betmgm","caesars"];
function originalSource(vector:EplForwardBookVector,positive:number):UclNativeGoalSource{
 const clocks=vector.outcomes.map(o=>Date.parse(o.fetchedAt??""));
 return{identity:vector.identity,book:vector.canonicalBook,provider:vector.provider,
  providerEventId:vector.providerEventId!,market:vector.market as "total"|"btts",line:vector.line,
  fairPositive:positive,originalQuoteAtMin:new Date(Math.min(...clocks)).toISOString(),
  originalQuoteAtMax:new Date(Math.max(...clocks)).toISOString(),role:"target_excluded_reference"};
}
function goalSources(input:GoalInput,market:"total"|"btts",inactive:UclNativeGoalRead["inactive"]):UclNativeGoalSource[]{
 const excluded=market==="total"?input.evaluatedTotalCanonicalBook:input.evaluatedBttsCanonicalBook;
 const candidates:UclNativeGoalSource[]=[];
 for(const vector of market==="total"?input.totalVectors:input.bttsVectors){
  let reason:string|null=null;const positive=market==="total"?"over":"yes",negative=market==="total"?"under":"no";
  const sides=[positive,negative].map(side=>vector.outcomes.filter(o=>o.side===side));
  if(!Number.isFinite(input.decisionAt)||!Number.isFinite(input.kickoff)||input.decisionAt>=input.kickoff)reason="decision_not_before_kickoff";
  else if(vector.market!==market)reason="wrong_goal_market";
  else if(!vector.canonicalBook||vector.canonicalBook===excluded)reason="evaluated_canonical_book_excluded";
  else if(["kalshi","polymarket"].includes(vector.canonicalBook)||!["named_originator","named_retail","named_other"].includes(vector.sourceClass))reason="source_not_named_book";
  else if(!vector.providerEventId || (input.fixtureEventIdentities!==undefined
   ? !input.fixtureEventIdentities.some(row=>row.provider===vector.provider&&row.providerEventId===vector.providerEventId&&row.sportsbook===vector.canonicalBook&&row.market===market)
   : input.providerEventId===null||vector.providerEventId!==input.providerEventId))reason="provider_event_identity_mismatch";
  else if(market==="total"&&(vector.line===null||!Number.isFinite(vector.line)||vector.line<0||!Number.isInteger(vector.line*4)))reason="invalid_native_total_contract";
  else if(market==="btts"&&vector.line!==null)reason="invalid_btts_contract";
  else if(vector.outcomes.length!==2||sides.some(rows=>rows.length!==1)||sides.some(rows=>!Number.isFinite(rows[0]!.american)||Math.abs(rows[0]!.american)<100))reason="incomplete_or_invalid_paired_price";
  const clocks=vector.outcomes.map(o=>Date.parse(o.fetchedAt??""));
  const maxAgeMs=Number.isFinite(input.kickoff)&&Number.isFinite(input.decisionAt)
   ?soccerStoredPriceMaxAgeMs(new Date(input.kickoff).toISOString(),input.decisionAt):0;
  if(!reason&&(clocks.some(at=>!Number.isFinite(at)||at>input.decisionAt||at>=input.kickoff||input.decisionAt-at>maxAgeMs)||Math.max(...clocks)-Math.min(...clocks)>60_000))reason="original_quote_stale_future_or_skewed";
  if(reason){inactive.push({identity:vector.identity,reason});continue;}
  const raw=sides.map(rows=>{const a=rows[0]!.american;return a>0?100/(a+100):-a/(-a+100);});
  const hold=raw[0]!+raw[1]!;
  if(hold<.98||hold>1.25){inactive.push({identity:vector.identity,reason:"native_pair_hold_out_of_range"});continue;}
  candidates.push(originalSource(vector,raw[0]!/hold));
 }
 // Multiple providers of the same physical book never create extra authority.
 // At an identical source clock/contract, conflicting pairs are ambiguous.
 const conflicts=new Set<string>();const byPair=new Map<string,UclNativeGoalSource>();
 for(const source of candidates){const key=[source.book,source.line,source.originalQuoteAtMin,source.originalQuoteAtMax].join("|");
  const prior=byPair.get(key);if(prior&&Math.abs(prior.fairPositive-source.fairPositive)>1e-12)conflicts.add(key);else byPair.set(key,source);}
 const valid=candidates.filter(source=>{const conflict=conflicts.has([source.book,source.line,source.originalQuoteAtMin,source.originalQuoteAtMax].join("|"));
  if(conflict)inactive.push({identity:source.identity,reason:"conflicting_same_book_contract_capture"});return !conflict;});
 valid.sort((a,b)=>Date.parse(b.originalQuoteAtMax)-Date.parse(a.originalQuoteAtMax)
  ||Math.abs(a.fairPositive-.5)-Math.abs(b.fairPositive-.5)||(a.line??0)-(b.line??0)||a.identity.localeCompare(b.identity));
 const books=new Map<string,UclNativeGoalSource>();for(const source of valid)if(!books.has(source.book))books.set(source.book,source);
 const rank=(book:string)=>{const i=GOAL_BOOK_PRIORITY.indexOf(book);return i<0?GOAL_BOOK_PRIORITY.length:i;};
 return [...books.values()].sort((a,b)=>rank(a.book)-rank(b.book)||a.book.localeCompare(b.book));
}
function means(joint:ScoreDistribution){let home=0,away=0;for(let h=0;h<joint.length;h++)for(let a=0;a<joint[h]!.length;a++){home+=h*joint[h]![a]!;away+=a*joint[h]![a]!;}return{home,away};}

/** Strongest actual target-free physical reference supplies each axis. We do
 * not average prices across different contracts or pretend a sparse source is
 * a consensus. The independent/result score law supplies the remaining shape. */
export function deriveUclNativeGoalProjection(base:ScoreDistribution,input:GoalInput):{joint:ScoreDistribution;receipt:UclNativeGoalRead}{
 const inactive:UclNativeGoalRead["inactive"]=[],totals=goalSources(input,"total",inactive),btts=goalSources(input,"btts",inactive);
 const total=totals[0]??null,yes=btts[0]??null;
 for(const other of [...totals.slice(1),...btts.slice(1)])inactive.push({identity:other.identity,reason:"qualified_reference_context_not_selected_for_constraint"});
 const totalConstraint=total?uclNativeTotalConstraint(total.identity,total.line!,total.fairPositive):null;
 const bttsConstraint=yes?uclBttsConstraint(yes.identity,yes.fairPositive):null;
 let totalApplied=false,bttsApplied=false,joint=base,converged=true,residual=0,reason="no_target_excluded_goal_reference";
 if(totalConstraint){const result=projectUclGoalMarkets(base,[totalConstraint]);residual=result.residual;converged=result.converged;
  if(result.converged){joint=result.joint;totalApplied=true;reason="native_total_settlement_constraint_applied";}else{reason="native_total_projection_unavailable";inactive.push({identity:total!.identity,reason});}}
 if(bttsConstraint){const result=projectUclGoalMarkets(base,[...(totalApplied?[totalConstraint!]:[]),bttsConstraint]);
  if(result.converged){joint=result.joint;bttsApplied=true;converged=true;residual=result.residual;reason=totalApplied?"native_total_and_btts_joint_constraints_applied":"native_btts_constraint_applied";}
  else{inactive.push({identity:yes!.identity,reason:"btts_constraint_incompatible_or_projection_unavailable"});if(!totalApplied){converged=false;residual=result.residual;reason="native_btts_projection_unavailable";}}}
 return{joint,receipt:{total,btts:yes,availableTotalBooks:totals.map(s=>s.book),availableBttsBooks:btts.map(s=>s.book),inactive,
  totalApplied,bttsApplied,converged,residual,reason,before:means(base),after:means(joint)}};
}
