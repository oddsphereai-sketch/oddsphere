import { cbbImpliedProbability, reviewCbbQuote } from "./marketEvidence";
import { gradeCbbProvisional } from "./provisionalGradePolicy";
import { chooseCbbCompleteTargetBook } from "./totalOnlyMarketResearch";
import type { CbbForecast, CbbMarket, CbbQuote } from "./types";

export const CBB_PROVISIONAL_BOARD_RELEASE = "cbb_candidate_2026_11_02_r4_supported_market_coverage" as const;
const MARKETS: CbbMarket[] = ["moneyline", "spread", "total"];

/** Preserve every existing complete-book choice. A missing Moneyline must not
 * hide a verified Spread/Total; unsupported markets remain explicitly held. */
export function chooseCbbSupportedTargetBook(quotes:CbbQuote[]):string|null {
  const complete=chooseCbbCompleteTargetBook(quotes);if(complete)return complete;
  if(!quotes.length||new Set(quotes.map(q=>q.gameId)).size!==1)return null;
  const priority=["draftkings","fanduel","betmgm","caesars"];
  const books=[...new Set(quotes.map(q=>q.sportsbook))].filter(book=>{
    const own=quotes.filter(q=>q.sportsbook===book);
    return own.length>0&&own.length<3&&new Set(own.map(q=>q.market)).size===own.length;
  });
  return books.sort((a,b)=>quotes.filter(q=>q.sportsbook===b).length-quotes.filter(q=>q.sportsbook===a).length||
    (priority.includes(a)?priority.indexOf(a):priority.length)-(priority.includes(b)?priority.indexOf(b):priority.length)||a.localeCompare(b))[0]??null;
}

/** Pure single-game projection. The leased writer owns persistence and locks. */
export function buildCbbProvisionalBoard(forecast: CbbForecast, quotes: CbbQuote[]) {
  if (![forecast.homeScore, forecast.awayScore, forecast.margin, forecast.total,
    forecast.homeWinProbability].every(Number.isFinite) ||
    forecast.homeScore <= 0 || forecast.awayScore <= 0 ||
    Math.abs(forecast.homeScore - forecast.awayScore - forecast.margin) > 1e-8 ||
    Math.abs(forecast.homeScore + forecast.awayScore - forecast.total) > 1e-8) {
    throw new Error("CBB board requires one coherent score projection");
  }
  if (quotes.some(quote => quote.gameId !== forecast.gameId)) throw new Error("CBB board cross-game quote");
  const boardTargetBook = chooseCbbSupportedTargetBook(quotes);
  const rows = MARKETS.map(market => {
    const targetBook=quotes.some(q=>q.sportsbook===boardTargetBook&&q.market===market)?boardTargetBook:
      chooseCbbSupportedTargetBook(quotes.filter(q=>q.market===market));
    const target = quotes.find(quote => quote.sportsbook === targetBook && quote.market === market);
    if (!target) return { market, targetBook, grade: "Held" as const,
      reason: targetBook?"no_verified_target_quote_for_market":"no_complete_three_market_target_book", selection: null, line: null,
      price: null, probability: null, marketFairProbability: null, quoteObservedAt: null,
      pushProbability: null, expectedValue: null,
      observedQuote:null,quoteProvider:null, professionalReferences: 0, referenceState: "unavailable" as const };
    const review = reviewCbbQuote(forecast, target);
    const grade = gradeCbbProvisional({ target, references: quotes.filter(quote => quote !== target),
      forecast, asOf: forecast.asOf });
    if (grade.selection !== null && grade.selection !== review.selection) {
      throw new Error("CBB grade and score side disagree");
    }
    const firstImplied=cbbImpliedProbability(target.firstPrice),secondImplied=cbbImpliedProbability(target.secondPrice);
    const marketFairProbability=grade.selection===null?null:
      (grade.selection==="first"?firstImplied:secondImplied)/(firstImplied+secondImplied);
    return { market, targetBook, grade: grade.grade, reason: grade.reason,
      selection: grade.selection, line: target.line, price: grade.price,
      observedQuote:{firstPrice:target.firstPrice,secondPrice:target.secondPrice,line:target.line},marketFairProbability,quoteObservedAt:target.providerObservedAt,quoteProvider:target.provider??"owls",
      probability: grade.selection === null ? null : review.probability,
      pushProbability: grade.selection === null ? null : review.pushProbability,
      expectedValue: grade.expectedValue, professionalReferences: grade.professionalReferences,
      referenceState: grade.referenceState };
  });
  return { release: CBB_PROVISIONAL_BOARD_RELEASE, gameId: forecast.gameId,
    asOf: forecast.asOf, targetBook:boardTargetBook, score: { home: forecast.homeScore, away: forecast.awayScore,
      margin: forecast.margin, total: forecast.total, homeWinProbability: forecast.homeWinProbability },
    marketContext: { predictionReader: "unqualified" as const,
      professionalPriceReferences: rows.reduce((count, row) => count + row.professionalReferences, 0),
      missing: ["qualified_movement_history", "qualified_splits", "observed_book_leadership"] },
    rows };
}
