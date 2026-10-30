import { CBB_SCORE_RESEARCH_RELEASE, type CbbScoreFeatureRow } from "./scoreResearch";
import { assertCbbR2ResearchCohort } from "./researchCohort";
import { CBB_MARKET_READER_FEATURES, fitCbbMarketHead, type CbbMarketHead } from "./marketReaderResearch";
import { predictCbbScoreTrees, type CbbScoreTrees } from "./scoreTrees";
import type { CbbForecast, CbbQuote } from "./types";

export const CBB_TOTAL_ONLY_MARKET_RESEARCH_RELEASE = "cbb_candidate_2026_10_29_r17_total_only_opening_reader" as const;
export type CbbTotalOnlyMarketHead = CbbMarketHead & {
  release: typeof CBB_TOTAL_ONLY_MARKET_RESEARCH_RELEASE; mode: "trees"; trees: CbbScoreTrees;
  independentRelease: typeof CBB_SCORE_RESEARCH_RELEASE;
};

/** One exact executable book; the other books may inform but cannot grade themselves. */
export function chooseCbbCompleteTargetBook(quotes: CbbQuote[]): string | null {
  if (!quotes.length || new Set(quotes.map(quote => quote.gameId)).size !== 1) return null;
  const order = ["draftkings", "fanduel", "betmgm", "caesars"];
  const candidates = [...new Set(quotes.map(quote => quote.sportsbook))].filter(book => {
    const own = quotes.filter(quote => quote.sportsbook === book);
    return own.length === 3 && new Set(own.map(quote => quote.market)).size === 3;
  });
  candidates.sort((a, b) => { const rank = (book: string) => { const i = order.indexOf(book); return i < 0 ? order.length : i; };
    return rank(a) - rank(b) || a.localeCompare(b); });
  return candidates[0] ?? null;
}

/** Only for a private next-season preview; no production reader imports this head. */
export function fitCbbTotalOnlyMarketHead(rows: CbbScoreFeatureRow[]): CbbTotalOnlyMarketHead {
  assertCbbR2ResearchCohort(rows);
  const fitted = fitCbbMarketHead(rows, { rounds: 40 });
  if (!fitted.trees || fitted.mode !== "trees") throw new Error("CBB r17 tree fit missing");
  return { ...fitted, release: CBB_TOTAL_ONLY_MARKET_RESEARCH_RELEASE, mode: "trees",
    trees: fitted.trees, independentRelease: CBB_SCORE_RESEARCH_RELEASE };
}

export function applyCbbTotalOnlyMarketHead(forecast: CbbForecast, features: number[], head: CbbTotalOnlyMarketHead) {
  if (head.release !== CBB_TOTAL_ONLY_MARKET_RESEARCH_RELEASE || head.mode !== "trees" || !head.trees ||
    head.independentRelease !== CBB_SCORE_RESEARCH_RELEASE || forecast.release !== CBB_SCORE_RESEARCH_RELEASE ||
    !Number.isFinite(Date.parse(head.trainedThrough)) || !Number.isFinite(Date.parse(forecast.asOf)) ||
    Date.parse(forecast.asOf) < Date.parse(head.trainedThrough) || head.trainingGameIds.includes(forecast.gameId)) {
    throw new Error("CBB r17 release/chronology mismatch");
  }
  if (features.length !== CBB_MARKET_READER_FEATURES.length || !features.every(Number.isFinite)) {
    throw new Error("CBB r17 feature mismatch");
  }
  const referenceIndex = CBB_MARKET_READER_FEATURES.indexOf("reference_book_count");
  if (features[referenceIndex] === 0) return { forecast, applied: false, reason: "no_target_excluded_reference" as const };
  const total = predictCbbScoreTrees(forecast, features, head.trees).total;
  const homeScore = (total + forecast.margin) / 2, awayScore = (total - forecast.margin) / 2;
  if (![total, homeScore, awayScore].every(Number.isFinite) || homeScore <= 0 || awayScore <= 0) {
    throw new Error("CBB r17 incoherent score");
  }
  return { forecast: { ...forecast, release: CBB_TOTAL_ONLY_MARKET_RESEARCH_RELEASE,
    total, homeScore, awayScore }, applied: true, reason: "total_only_opening_price_context" as const };
}
