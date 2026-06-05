/**
 * Phase 4.2.C.1.R-16F-D — pure helper for market-implied probability.
 *
 * Extracted from `app/api/lab/daily-edge/route.ts` so the no-vig math
 * can be unit-tested without setting up the full DTO build path. The
 * route imports from here; no behavior change beyond R-16F-D's removal
 * of the early-exit for `market === "first_inning"`.
 *
 * R-16E established `splits_consensus` as the lowest-priority synthetic
 * book — used only when no real sportsbook has both sides of a market.
 * R-16F-D extends the no-vig math to first_inning markets (NRFI/YRFI).
 *
 * Pure / no DB / no React.
 */

/**
 * No-vig book search order. Real sportsbooks first; `splits_consensus`
 * last so it only fires when no real book has both sides. When it does
 * fire, the route flags `marketDataQuality: "splits_consensus"` rather
 * than `"two_sided_consensus"` so the reader can label the read
 * honestly.
 *
 * R-16G-A — `kalshi` is intentionally EXCLUDED here as a safety guard.
 * Audit on 2026-06-04 found kalshi rows have home/away inverted on at
 * least 3 of 4 games where kalshi was present (TOR@ATL, LAD@ARI,
 * PIT@HOU). Likely cause: SharpAPI's normalization of kalshi's
 * prediction-market YES/NO format into traditional home/away semantics
 * is mis-mapping sides. Until SharpAPI fixes the upstream or we add a
 * per-book sanity check that proves kalshi is safe, we do not use
 * kalshi for no-vig market context. The provider also rejects kalshi
 * ML/spread rows at ingest (see SharpAPIOddsProvider.ts) so they
 * normally won't reach the lines table either — this exclusion is
 * belt-and-suspenders for any historical kalshi row that lingers.
 */
export const NO_VIG_BOOK_PRIORITY = [
  "pinnacle",
  "draftkings",
  "fanduel",
  "betmgm",
  "caesars",
  "bet365 us",
  "bookmaker",
  "ballybet",
  "onexbet",
  "saba",
  "fliff",
  // kalshi — intentionally excluded (R-16G-A side-flip safety)
  "splits_consensus",
];

export const SPLITS_CONSENSUS_BOOK_NAME = "splits_consensus";

/**
 * Convert an American moneyline number to an implied probability.
 *   +100 → 0.500
 *   +200 → 0.333
 *   -200 → 0.667
 */
export function americanToImplied(american: number): number {
  if (american > 0) return 100 / (american + 100);
  return -american / (-american + 100);
}

/**
 * Structural subset of a `lines` row that the no-vig math needs. The
 * route's full LineRow type is structurally assignable to this — keeps
 * the helper independent of any specific DTO shape.
 */
export type MarketImpliedLineRow = {
  market_type: string;
  sportsbook: string;
  side: string | null;
  odds_american: number | null;
};

export type MarketImpliedQuality =
  | "two_sided_consensus"
  | "splits_consensus"
  | "single_book"
  | "pinnacle_only"
  | "unavailable";

export type MarketImpliedResult = {
  pickPct: number | null;
  source: string | null;
  quality: MarketImpliedQuality;
};

/**
 * Compute no-vig market-implied probability for the model's picked
 * side. Walks the book priority list; first book that has BOTH sides
 * wins. Falls back to `pinnacle_fair_probability` from sharp_signals
 * (pre-de-vigged by SharpAPI) when no two-sided book is available.
 *
 *   • { pickPct, source, quality: "two_sided_consensus" } when both
 *     sides exist at a real book
 *   • { pickPct, source: SPLITS_CONSENSUS_BOOK_NAME, quality:
 *     "splits_consensus" } when only the R-16E synthetic pair exists
 *   • { pickPct, source: null, quality: "pinnacle_only" } when only
 *     the sharp-signal Pinnacle fair is available
 *   • { pickPct: null, ..., quality: "single_book" | "unavailable" }
 *     otherwise — the strip renders "Market: unavailable"
 *
 * R-16F-D — first_inning is no longer special-cased here. As long as
 * `dbMarket === "first_inning_total"` is passed in and the lines table
 * has two-sided over/under rows for it (e.g. ballybet's NRFI/YRFI
 * pricing at line 0.5), the same no-vig math runs that ML and Total
 * use. The `modelSide === null` guard stays — a held / toss-up pick
 * has no side to compute against, so the honest answer remains
 * "unavailable".
 */
export function computeMarketImplied(
  market: "moneyline" | "total" | "first_inning",
  dbMarket: "moneyline" | "total" | "first_inning_total",
  linesCurrent: ReadonlyArray<MarketImpliedLineRow>,
  modelSide: string | null,
  signalPinnacleFairForPick: number | null
): MarketImpliedResult {
  void market;
  // Held / toss-up / no-pick games can't be compared to a market price
  // because there's no side to evaluate. Honest empty.
  if (modelSide === null) {
    return { pickPct: null, source: null, quality: "unavailable" };
  }
  const lines = linesCurrent.filter((l) => l.market_type === dbMarket);
  if (lines.length === 0) {
    return signalPinnacleFairForPick !== null
      ? {
          pickPct: signalPinnacleFairForPick * 100,
          source: null,
          quality: "pinnacle_only",
        }
      : { pickPct: null, source: null, quality: "unavailable" };
  }
  // Two-sided book search. R-16E: priority list ends with
  // "splits_consensus" — when that book wins, return the
  // `splits_consensus` quality flag so the reader can honestly label
  // the read as splits-derived rather than a real-book pair.
  for (const book of NO_VIG_BOOK_PRIORITY) {
    const home = lines.find(
      (l) =>
        l.sportsbook === book &&
        (l.side === "home" || l.side === "over") &&
        l.odds_american !== null
    );
    const away = lines.find(
      (l) =>
        l.sportsbook === book &&
        (l.side === "away" || l.side === "under") &&
        l.odds_american !== null
    );
    if (
      home &&
      away &&
      home.odds_american !== null &&
      away.odds_american !== null
    ) {
      const hImp = americanToImplied(home.odds_american);
      const aImp = americanToImplied(away.odds_american);
      const sum = hImp + aImp;
      const homeNoVig = hImp / sum;
      const awayNoVig = aImp / sum;
      const pickNoVig =
        modelSide === "home" || modelSide === "over" ? homeNoVig : awayNoVig;
      const isSplits = book === SPLITS_CONSENSUS_BOOK_NAME;
      return {
        pickPct: pickNoVig * 100,
        source: book,
        quality: isSplits ? "splits_consensus" : "two_sided_consensus",
      };
    }
  }
  // Pinnacle fair fallback when no two-sided book exists
  if (signalPinnacleFairForPick !== null) {
    return {
      pickPct: signalPinnacleFairForPick * 100,
      source: null,
      quality: "pinnacle_only",
    };
  }
  // We have at least one side but no two-sided pair
  return { pickPct: null, source: null, quality: "single_book" };
}
