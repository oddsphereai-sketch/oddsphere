import {invariant} from './evidence';

/** Future props-only arithmetic; the shared Daily Edge R1 helper stays exact. */
export const PROPS_AI_EXACT_CONFIDENCE_PRICE_RELEASE='player_props_ai_confidence_price_2026_11_14_r1_exact_paired_mass' as const;

export function assessExactPropsConfidencePrice(args:{win:number;loss:number;push:number;total:number;american:number;opposingAmerican:number}){
  invariant([args.win,args.loss,args.push,args.total].every(n=>Number.isSafeInteger(n)&&n>=0)&&args.total>0&&args.total<=160000&&args.win+args.loss+args.push===args.total,'Invalid exact paired event mass');
  invariant([args.american,args.opposingAmerican].every(n=>Number.isSafeInteger(n)&&Math.abs(n)>=100),'Invalid exact paired price');
  const implied=(price:number)=>price>0?{n:BigInt(100),d:BigInt(100)+BigInt(price)}:{n:BigInt(-price),d:BigInt(100)-BigInt(price)};
  const a=implied(args.american),b=implied(args.opposingAmerican),holdNumerator=a.n*b.d+b.n*a.d,denominator=a.d*b.d;
  const excess=holdNumerator-denominator,allowanceNumerator=excess>BigInt(0)?excess:BigInt(0);
  const requiredNumerator=a.n*b.d-allowanceNumerator,win=BigInt(args.win),nonpush=win+BigInt(args.loss),total=BigInt(args.total);
  const coherent=nonpush>BigInt(0)&&holdNumerator*BigInt(100)>=BigInt(98)*denominator&&holdNumerator*BigInt(10)<=BigInt(13)*denominator;
  const confidenceQualified=nonpush>BigInt(0)&&win*BigInt(20)>=BigInt(11)*total;
  const withinPairedMargin=coherent&&win*denominator>=requiredNumerator*nonpush;
  // Decimal fields are descriptive only. Every admission comparison above
  // uses the original integers, including pushes and inclusive boundaries.
  return{release:PROPS_AI_EXACT_CONFIDENCE_PRICE_RELEASE,coherentPair:coherent,confidenceQualified,withinPairedMargin,qualified:confidenceQualified&&withinPairedMargin,minimumWinProbability:.55,
    pairedImpliedSum:nonpush>BigInt(0)?Number(holdNumerator)/Number(denominator):null,
    breakEvenProbability:coherent?Number(a.n)/Number(a.d):null,
    observedMarginAllowance:coherent?Number(allowanceNumerator)/Number(denominator):null,
    requiredUnconditionalWinProbability:coherent?Number(requiredNumerator*nonpush)/Number(denominator*total):null,
    meaning:'outcome_confidence_with_observed_paired_price_margin;not_a_positive_value_claim' as const};
}
