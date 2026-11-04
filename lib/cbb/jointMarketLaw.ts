import {cbbImpliedProbability} from "./marketEvidence";
import {cbbThresholdProbabilities,normalCdf} from "./model";
import {cbbExactMarketCenter} from "./marketReaderResearch";
import type {CbbForecast,CbbQuote} from "./types";

export type CbbJointMarginLaw = {
  status:"identified"|"underidentified"|"inconsistent"|"unavailable";
  reason:string;
  margin:number|null;
  marginSd:number|null;
  homeWinProbability:number|null;
};
const probabilityTolerance=1e-8;
const family=(book:string)=>["pinnacle","ps3838"].includes(book.trim().toLowerCase())?"pinnacle":book.trim().toLowerCase();
const empty=(status:"inconsistent"|"unavailable",reason:string):CbbJointMarginLaw=>
  ({status,reason,margin:null,marginSd:null,homeWinProbability:null});

/** Invert two native contracts through the existing discrete/no-tie margin
 * law. Source selection and response interpretation belong to the caller.
 * A search budget is numerical only: no boundary is accepted as a fitted SD,
 * and no independent/market average or accepted dispersion cap is introduced.
 */
export function invertCbbJointMarginLaw(base:CbbForecast,moneyline:CbbQuote,spread:CbbQuote):CbbJointMarginLaw{
  if(moneyline.gameId!==base.gameId||spread.gameId!==base.gameId||
    !moneyline.sportsbook?.trim()||!spread.sportsbook?.trim()||family(moneyline.sportsbook)!==family(spread.sportsbook)||
    moneyline.market!=="moneyline"||moneyline.line!==null||spread.market!=="spread"||
    moneyline.phase!=="current"||spread.phase!=="current"||spread.line===null||
    !Number.isFinite(spread.line)||!Number.isInteger(spread.line*2))
    return empty("unavailable","joint_contract_identity_unavailable");
  if(!(base.uncertainty.marginSd>0)||!Number.isFinite(base.uncertainty.marginSd)||!(base.total>0)||!Number.isFinite(base.total))
    return empty("unavailable","independent_law_unavailable");
  let mlFair:number,spreadFair:number;
  try{
    const fair=(q:CbbQuote)=>{
      const first=cbbImpliedProbability(q.firstPrice),second=cbbImpliedProbability(q.secondPrice),hold=first+second;
      if(!(hold>=.98&&hold<=1.3))throw new Error("invalid hold");
      const p=first/hold;
      if(!(p>0&&p<1))throw new Error("invalid fair probability");
      return p;
    };
    mlFair=fair(moneyline);spreadFair=fair(spread);
  }catch{return empty("unavailable","joint_prices_unavailable");}

  type State={logSd:number;margin:number;marginSd:number;homeWinProbability:number;spreadFair:number;residual:number};
  const evaluate=(logSd:number,retainedSd?:number):State|null=>{
    const marginSd=retainedSd??Math.exp(logSd);
    if(!(marginSd>0)||!Number.isFinite(marginSd))return null;
    try{
      const shaped={...base,uncertainty:{...base.uncertainty,marginSd}};
      const margin=cbbExactMarketCenter(shaped,moneyline,mlFair);
      const zero=normalCdf((.5-margin)/marginSd)-normalCdf((-.5-margin)/marginSd);
      const homeWinProbability=(1-normalCdf((.5-margin)/marginSd))/(1-zero);
      const forecast={...shaped,margin,homeWinProbability};
      const p=cbbThresholdProbabilities(forecast,"spread",spread.line),conditional=p.first/(p.first+p.second);
      if(!Number.isFinite(margin)||!Number.isFinite(homeWinProbability)||Math.abs(homeWinProbability-mlFair)>probabilityTolerance||
        !Number.isFinite(conditional)||!(conditional>=0&&conditional<=1))return null;
      return {logSd,margin,marginSd,homeWinProbability,spreadFair:conditional,residual:conditional-spreadFair};
    }catch{return null;}
  };
  const finish=(state:State,status:"identified"|"underidentified",reason:string):CbbJointMarginLaw=>{
    if(Math.abs(state.margin)>=base.total)return empty("inconsistent","joint_margin_exceeds_score_total");
    if(Math.abs(state.residual)>probabilityTolerance)return empty("unavailable","joint_probability_round_trip_failed");
    return {status,reason,margin:state.margin,marginSd:state.marginSd,homeWinProbability:state.homeWinProbability};
  };

  // With the zero-margin atom removed, -0.5, 0 and +0.5 all name exactly
  // the ML win event. They do not identify dispersion, even at integer zero.
  if(Math.abs(spread.line)<=.5){
    if(Math.abs(mlFair-spreadFair)>probabilityTolerance)return empty("inconsistent","redundant_contract_probabilities_disagree");
    const state=evaluate(Math.log(base.uncertainty.marginSd),base.uncertainty.marginSd);
    return state?finish(state,"underidentified","redundant_win_contract_retains_independent_dispersion"):
      empty("unavailable","redundant_contract_inversion_unavailable");
  }
  // For a positive threshold, cover conditional on no push must be below
  // the win probability; a negative threshold must be above it. Equality
  // requires infinite dispersion, not an accepted large finite substitute.
  const positiveThreshold=spread.line<0;
  if(positiveThreshold?spreadFair>=mlFair:spreadFair<=mlFair)
    return empty("inconsistent","native_contract_probability_ordering_conflict");
  const initial=evaluate(Math.log(base.uncertainty.marginSd),base.uncertainty.marginSd);
  if(!initial)return empty("unavailable","joint_initial_inversion_unavailable");
  if(initial.residual===0)return finish(initial,"identified","native_joint_margin_and_dispersion");
  const increase=positiveThreshold?initial.residual<0:initial.residual>0;
  let previous=initial,bracket:[State,State]|null=null;
  for(let step=0;step<128;step++){
    const next=evaluate(previous.logSd+(increase?Math.LN2:-Math.LN2));
    if(!next)return empty("unavailable","joint_finite_dispersion_bracket_unavailable");
    if(next.residual===0)return finish(next,"identified","native_joint_margin_and_dispersion");
    if(next.residual*previous.residual<0){bracket=previous.logSd<next.logSd?[previous,next]:[next,previous];break;}
    previous=next;
  }
  if(!bracket)return empty("unavailable","joint_finite_dispersion_not_bracketed");
  let [low,high]=bracket;
  for(let iteration=0;iteration<80;iteration++){
    const middle=evaluate((low.logSd+high.logSd)/2);
    if(!middle)return empty("unavailable","joint_interior_inversion_unavailable");
    if(middle.residual===0)return finish(middle,"identified","native_joint_margin_and_dispersion");
    if(middle.residual*low.residual>0)low=middle;else high=middle;
  }
  const solved=evaluate((low.logSd+high.logSd)/2);
  return solved?finish(solved,"identified","native_joint_margin_and_dispersion"):
    empty("unavailable","joint_final_inversion_unavailable");
}
