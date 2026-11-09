import { assessConfidenceLeanPrice } from "../services/dailyEdge/confidenceLeanPrice";
import type { AcceptedPlayerLaw } from "./law";
import { lawForecast } from "./law";
import { PROPS_AI_GRADE_RELEASE } from "./releases";
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
export function priceAiLaw(args: { law: AcceptedPlayerLaw; market: string; quotes: AiExecutionQuote[]; now: string;
  maxAgeMs: number; confidence: number; exception: string | null; milestone?: boolean }) {
  const now = Date.parse(args.now); invariant(Number.isFinite(now) && Number.isFinite(args.maxAgeMs) && args.maxAgeMs >= 0, "Invalid pricing clock");
  invariant([0, 1, 2].includes(args.confidence), "Invalid estimated evidence confidence");
  const latest=new Map<string,AiExecutionQuote>(),ambiguous=new Set<string>();
  for(const q of args.quotes){
    if(!q.current||q.confirmedAt===null||!Number.isFinite(Date.parse(q.confirmedAt))||Date.parse(q.confirmedAt)>now||Date.parse(q.availableAt)>now)continue;
    const key=JSON.stringify([q.provider,q.book.toLowerCase().replace(/[^a-z0-9]/g,""),q.line,q.side]),old=latest.get(key);
    const rank=old?Date.parse(q.confirmedAt)-Date.parse(old.confirmedAt!)||Date.parse(q.availableAt)-Date.parse(old.availableAt):1;
    if(rank>0){latest.set(key,q);ambiguous.delete(key);}else if(rank===0&&old&&old.american!==q.american)ambiguous.add(key);
  }
  const eligible = [...latest].flatMap(([key,q])=>ambiguous.has(key)?[]:[q]).filter(q => q.current && q.confirmedAt !== null && Number.isFinite(Date.parse(q.confirmedAt)) && Date.parse(q.confirmedAt) <= now && now - Date.parse(q.confirmedAt) <= args.maxAgeMs && Date.parse(q.availableAt) <= now && q.actionRule === "qualifying_participation" && Number.isFinite(q.line) && Number.isInteger(q.american) && Math.abs(q.american) >= 100);
  const candidates = eligible.flatMap(q => {
    const forecast = lawForecast(args.law, args.market, q.line, args.milestone || q.side === "yes");
    const side = q.side === "yes" ? "yes" : forecast.preferredSide;
    if (q.side !== side) return [];
    const win = side === "under" ? forecast.under : forecast.over, loss = side === "under" ? forecast.over : forecast.under;
    const opposing = eligible.find(o => o.book === q.book && o.provider === q.provider && o.line === q.line && o.side !== q.side && o.side !== "yes" && Math.abs(Date.parse(o.confirmedAt!)-Date.parse(q.confirmedAt!))<=5*60000);
    const {grade,ev,confidenceLean}=gradeAiEvent({win,loss,american:q.american,opposingAmerican:opposing?.american??null,confidence:args.confidence,exception:args.exception});
    return [{ gradeRelease: PROPS_AI_GRADE_RELEASE, grade, forecast, quote: q, side, probability: win, loss, push: forecast.push,
      expectedValue: ev, fairAmerican: win > 0 && loss > 0 ? win >= loss ? -100 * win / loss : 100 * loss / win : null,
      confidence: args.confidence, confidenceMeaning: "AI-estimated evidence strength; not empirical calibration" as const,
      recommendationBasis: ev > 0 ? "estimated_value" as const : confidenceLean?.qualified ? "outcome_confidence_with_paired_margin" as const : "monitor" as const,
      confidenceLean, exception: args.exception, lawHash: args.law.hash }];
  });
  return candidates.sort((a, b) => b.expectedValue - a.expectedValue || a.quote.book.localeCompare(b.quote.book))[0] ?? null;
}
