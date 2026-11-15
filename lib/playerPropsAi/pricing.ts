import { assessConfidenceLeanPrice } from "../services/dailyEdge/confidenceLeanPrice";
import type { AcceptedPlayerLaw } from "./law";
import { lawForecast,lawEventMass } from "./law";
import { PROPS_AI_LAW_RELEASE,propsAiLawHasExactMass,propsAiLawGradeRelease } from "./releases";
import {assessExactPropsConfidencePrice} from './exactConfidencePrice';
import { invariant } from "./evidence";
export type PropsAiGrade = "Best Angle" | "Lean" | "Watchlist" | "No Play";
export type AiExecutionQuote = { id: string; book: string; provider: string; line: number; side: "over" | "under" | "yes";
  american: number; availableAt: string; confirmedAt: string | null; current: boolean; actionRule: "qualifying_participation" | "unknown" };
/** Price, EV and grade share the same exact currently executable side/pair. */
export function gradeAiEvent(args:{win:number;loss:number;american:number;opposingAmerican:number|null;confidence:number;exception:string|null}){
  const ev=args.win*(args.american>0?args.american/100:100/-args.american)-args.loss;
  const confidenceLean=args.opposingAmerican===null?null:assessConfidenceLeanPrice({winProbability:args.win,loseProbability:args.loss,price:args.american,opposingPrice:args.opposingAmerican,minimumWinProbability:.55});
  let grade:PropsAiGrade="Watchlist";
  if(args.exception)grade="No Play";
  else if(args.confidence===2&&ev>0)grade="Best Angle";
  else if(args.confidence>=1&&ev>0||args.confidence===2&&confidenceLean?.qualified)grade="Lean";
  return {grade,ev,confidenceLean};
}
export type ExactEventGradeArgs={win:number;loss:number;push:number;total:number;american:number;opposingAmerican:number|null;confidence:number;exception:string|null};
function exactEventEconomics(args:ExactEventGradeArgs){
  invariant([args.win,args.loss,args.push,args.total].every(n=>Number.isSafeInteger(n)&&n>=0)&&args.total>0&&args.total<=160000&&args.win+args.loss+args.push===args.total,"Invalid exact event mass");
  invariant(Number.isSafeInteger(args.american)&&Math.abs(args.american)>=100,"Invalid exact event price");
  invariant(args.opposingAmerican===null||Number.isSafeInteger(args.opposingAmerican)&&Math.abs(args.opposingAmerican)>=100,"Invalid exact opposing price");
  invariant([0,1,2].includes(args.confidence),"Invalid estimated evidence confidence");
  const win=BigInt(args.win),loss=BigInt(args.loss),price=BigInt(Math.abs(args.american));
  const numerator=args.american>0?win*price-loss*BigInt(100):win*BigInt(100)-loss*price;
  const denominator=BigInt(args.total)*(args.american>0?BigInt(100):price);
  let a=numerator<BigInt(0)?-numerator:numerator,b=denominator;
  while(b!==BigInt(0)){const remainder=a%b;a=b;b=remainder;}
  // Canonical rational conversion also keeps scale-equivalent integer laws
  // bit-identical when valid large American prices exceed floating products.
  return{numerator,denominator,ev:Number(numerator/a)/Number(denominator/a)};
}
/** Ascending exact EV comparison for prospective admitted event masses. The
 * decimal display value cannot break an exact ordering at member selection. */
export function compareAiEventValuesFromMass(a:Pick<ExactEventGradeArgs,"win"|"loss"|"push"|"total"|"american">,b:Pick<ExactEventGradeArgs,"win"|"loss"|"push"|"total"|"american">){
  const fraction=(value:typeof a)=>exactEventEconomics({...value,opposingAmerican:null,confidence:0,exception:null});
  const left=fraction(a),right=fraction(b),difference=left.numerator*right.denominator-right.numerator*left.denominator;
  return difference===BigInt(0)?0:difference>BigInt(0)?1:-1;
}
/** Only source-derived bounded integer masses enter the prospective grade path;
 * this API never accepts an untrusted precomputed EV or a scalar value override. */
export function gradeAiEventFromMass(args:ExactEventGradeArgs){
  const economics=exactEventEconomics(args);
  const confidenceLean=args.opposingAmerican===null?null:assessConfidenceLeanPrice({winProbability:args.win/args.total,loseProbability:args.loss/args.total,price:args.american,opposingPrice:args.opposingAmerican,minimumWinProbability:.55});
  let grade:PropsAiGrade="Watchlist";
  if(args.exception)grade="No Play";
  else if(args.confidence===2&&economics.numerator>BigInt(0))grade="Best Angle";
  else if(args.confidence>=1&&economics.numerator>BigInt(0)||args.confidence===2&&confidenceLean?.qualified)grade="Lean";
  return{grade,ev:economics.ev,confidenceLean};
}
/** R3 only. R2's accepted paired-confidence arithmetic above remains unchanged. */
export function gradeAiEventFromExactPairedMass(args:ExactEventGradeArgs){
  const economics=exactEventEconomics(args);
  const confidenceLean=args.opposingAmerican===null?null:assessExactPropsConfidencePrice({...args,opposingAmerican:args.opposingAmerican});
  let grade:PropsAiGrade="Watchlist";
  if(args.exception)grade="No Play";
  else if(args.confidence===2&&economics.numerator>BigInt(0))grade="Best Angle";
  else if(args.confidence>=1&&economics.numerator>BigInt(0)||args.confidence===2&&confidenceLean?.qualified)grade="Lean";
  return{grade,ev:economics.ev,confidenceLean};
}
export function priceAiLaw(args: { law: AcceptedPlayerLaw; market: string; quotes: AiExecutionQuote[]; now: string;
  maxAgeMs: number; confidence: number; exception: string | null; milestone?: boolean }) {
  const exact=propsAiLawHasExactMass(args.law.release),gradeRelease=propsAiLawGradeRelease(args.law.release);
  const now = Date.parse(args.now); invariant(Number.isFinite(now) && Number.isFinite(args.maxAgeMs) && args.maxAgeMs >= 0, "Invalid pricing clock");
  invariant([0, 1, 2].includes(args.confidence), "Invalid estimated evidence confidence");
  const latest=new Map<string,AiExecutionQuote>(),ambiguous=new Set<string>();
  for(const q of args.quotes){
    if(!q.current||q.confirmedAt===null||!Number.isFinite(Date.parse(q.confirmedAt))||Date.parse(q.confirmedAt)>now||Date.parse(q.availableAt)>now)continue;
    const key=JSON.stringify([q.provider,q.book.toLowerCase().replace(/[^a-z0-9]/g,""),q.line,q.side]),old=latest.get(key);
    const rank=old?Date.parse(q.confirmedAt)-Date.parse(old.confirmedAt!)||Date.parse(q.availableAt)-Date.parse(old.availableAt):1;
    if(rank>0){latest.set(key,q);ambiguous.delete(key);}else if(rank===0&&old&&old.american!==q.american)ambiguous.add(key);
  }
  const eligible = [...latest].flatMap(([key,q])=>ambiguous.has(key)?[]:[q]).filter(q => q.current && q.confirmedAt !== null && Number.isFinite(Date.parse(q.confirmedAt)) && Date.parse(q.confirmedAt) <= now && now - Date.parse(q.confirmedAt) <= args.maxAgeMs && Date.parse(q.availableAt) <= now && q.actionRule === "qualifying_participation" && Number.isFinite(q.line) && (exact?Number.isSafeInteger(q.american):Number.isInteger(q.american)) && Math.abs(q.american) >= 100);
  const candidates = eligible.flatMap(q => {
    const forecast = lawForecast(args.law, args.market, q.line, args.milestone || q.side === "yes");
    const side = q.side === "yes" ? "yes" : forecast.preferredSide;
    if (q.side !== side) return [];
    const win = side === "under" ? forecast.under : forecast.over, loss = side === "under" ? forecast.over : forecast.under;
    const opposing = eligible.find(o => o.book === q.book && o.provider === q.provider && o.line === q.line && o.side !== q.side && o.side !== "yes" && Math.abs(Date.parse(o.confirmedAt!)-Date.parse(q.confirmedAt!))<=5*60000);
    const mass=exact?lawEventMass(args.law,args.market,q.line,args.milestone||q.side==="yes"):null;
    const exactArgs=mass?{win:side==="under"?mass.under:mass.over,loss:side==="under"?mass.over:mass.under,push:mass.push,total:mass.total,american:q.american,opposingAmerican:opposing?.american??null,confidence:args.confidence,exception:args.exception}:null;
    const {grade,ev,confidenceLean}=exactArgs?(args.law.release===PROPS_AI_LAW_RELEASE?gradeAiEventFromExactPairedMass(exactArgs):gradeAiEventFromMass(exactArgs)):gradeAiEvent({win,loss,american:q.american,opposingAmerican:opposing?.american??null,confidence:args.confidence,exception:args.exception});
    const fairWin=exactArgs?.win??win,fairLoss=exactArgs?.loss??loss;
    const decision={ gradeRelease, grade, forecast, quote: q, side, probability: win, loss, push: forecast.push,
      expectedValue: ev, fairAmerican: fairWin > 0 && fairLoss > 0 ? fairWin >= fairLoss ? -100 * fairWin / fairLoss : 100 * fairLoss / fairWin : null,
      confidence: args.confidence, confidenceMeaning: "AI-estimated evidence strength; not empirical calibration" as const,
      recommendationBasis: ev > 0 ? "estimated_value" as const : confidenceLean?.qualified ? "outcome_confidence_with_paired_margin" as const : "monitor" as const,
      confidenceLean, exception: args.exception, lawHash: args.law.hash,
      ...(mass?{exactEventMass:{over:mass.over,under:mass.under,push:mass.push,total:mass.total}}:{}) };
    return [{decision,fraction:exactArgs?exactEventEconomics(exactArgs):null}];
  });
  return candidates.sort((a,b)=>{
    if(a.fraction&&b.fraction){const difference=b.fraction.numerator*a.fraction.denominator-a.fraction.numerator*b.fraction.denominator;if(difference!==BigInt(0))return difference>BigInt(0)?1:-1;}
    else{const difference=b.decision.expectedValue-a.decision.expectedValue;if(difference)return difference;}
    return a.decision.quote.book.localeCompare(b.decision.quote.book);
  })[0]?.decision??null;
}
