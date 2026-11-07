import { assessConfidenceLeanPrice } from "../services/dailyEdge/confidenceLeanPrice";
import type { AcceptedPlayerLaw } from "./law";
import { lawForecast } from "./law";
import { PROPS_AI_GRADE_RELEASE } from "./releases";
import { invariant } from "./evidence";
export type PropsAiGrade = "Best Angle" | "Lean" | "Watchlist" | "No Play";
export type AiExecutionQuote = { id: string; book: string; provider: string; line: number; side: "over" | "under" | "yes";
  american: number; availableAt: string; confirmedAt: string | null; current: boolean; actionRule: "qualifying_participation" | "unknown" };
export function priceAiLaw(args: { law: AcceptedPlayerLaw; market: string; quotes: AiExecutionQuote[]; now: string;
  maxAgeMs: number; confidence: number; exception: string | null; milestone?: boolean }) {
  const now = Date.parse(args.now); invariant(Number.isFinite(now) && Number.isFinite(args.maxAgeMs) && args.maxAgeMs >= 0, "Invalid pricing clock");
  invariant([0, 1, 2].includes(args.confidence), "Invalid estimated evidence confidence");
  const eligible = args.quotes.filter(q => q.current && q.confirmedAt !== null && Number.isFinite(Date.parse(q.confirmedAt)) && Date.parse(q.confirmedAt) <= now && now - Date.parse(q.confirmedAt) <= args.maxAgeMs && Date.parse(q.availableAt) <= now && q.actionRule === "qualifying_participation" && Number.isFinite(q.line) && Number.isInteger(q.american) && Math.abs(q.american) >= 100);
  const candidates = eligible.flatMap(q => {
    const forecast = lawForecast(args.law, args.market, q.line, args.milestone || q.side === "yes");
    const side = q.side === "yes" ? "yes" : forecast.preferredSide;
    if (q.side !== side) return [];
    const win = side === "under" ? forecast.under : forecast.over, loss = side === "under" ? forecast.over : forecast.under;
    const profit = q.american > 0 ? q.american / 100 : 100 / -q.american, ev = win * profit - loss;
    const opposing = eligible.find(o => o.book === q.book && o.provider === q.provider && o.line === q.line && o.side !== q.side && o.side !== "yes");
    const confidenceLean = opposing ? assessConfidenceLeanPrice({ winProbability: win, loseProbability: loss, price: q.american, opposingPrice: opposing.american, minimumWinProbability: .55 }) : null;
    let grade: PropsAiGrade = "Watchlist";
    if (args.exception) grade = "No Play";
    else if (args.confidence === 2 && ev > 0) grade = "Best Angle";
    else if (args.confidence >= 1 && ev > 0 || args.confidence === 2 && confidenceLean?.qualified) grade = "Lean";
    return [{ gradeRelease: PROPS_AI_GRADE_RELEASE, grade, forecast, quote: q, side, probability: win, loss, push: forecast.push,
      expectedValue: ev, fairAmerican: win > 0 && loss > 0 ? win >= loss ? -100 * win / loss : 100 * loss / win : null,
      confidence: args.confidence, confidenceMeaning: "AI-estimated evidence strength; not empirical calibration" as const,
      recommendationBasis: ev > 0 ? "estimated_value" as const : confidenceLean?.qualified ? "outcome_confidence_with_paired_margin" as const : "monitor" as const,
      confidenceLean, exception: args.exception, lawHash: args.law.hash }];
  });
  return candidates.sort((a, b) => b.expectedValue - a.expectedValue || a.quote.book.localeCompare(b.quote.book))[0] ?? null;
}
