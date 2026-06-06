/**
 * Push 3B — FI V2 market baseline (Layer 2).
 *
 * Reads the first-inning total market (NRFI/YRFI line) and converts
 * implied prices into no-vig NRFI/YRFI probabilities. NRFI market lines
 * are not always available; when absent, the baseline returns null and
 * the caller treats the projection as independent-only (Layer 3 trust
 * = 1.0) but caps play grade to Lean.
 *
 * Today's MLB pricing convention for the FI total:
 *   • If the book lists "First 5 / First-Inning Total = 0.5" (or 0/0.5):
 *       Over 0.5 = YRFI ; Under 0.5 = NRFI
 *
 * Pure / no DB / no network. Caller passes pre-filtered FI line rows.
 */

import { americanToImpliedProb, noVigPair } from "./marketPrior";

export type FiMarketBaseline = {
  /** Listed FI total (typically 0.5). null when no line. */
  listed_fi_total: number | null;
  /** Over (= YRFI) odds American. */
  yrfi_odds_american: number | null;
  /** Under (= NRFI) odds American. */
  nrfi_odds_american: number | null;
  /** No-vig P(YRFI). */
  yrfi_no_vig_prob: number | null;
  /** No-vig P(NRFI). */
  nrfi_no_vig_prob: number | null;
  /** Source quality: "ok" | "stale" | "missing". */
  data_quality: "ok" | "stale" | "missing";
  /** Most-recent line freshness, ISO timestamp or null. */
  freshness: string | null;
  /** Source / reason code. */
  reason: string;
};

export type FiLineRow = {
  market_type: string;        // "first_inning_total"
  sportsbook: string;
  side: string | null;        // "over" | "under"
  line_value: number | null;  // typically 0.5
  odds_american: number | null;
  fetched_at?: string | null;
};

const FI_BOOK_PRIORITY = ["pinnacle", "fanduel", "draftkings", "betmgm", "caesars"];

export function computeFiMarketBaseline(linesForGame: FiLineRow[]): FiMarketBaseline {
  const empty: FiMarketBaseline = {
    listed_fi_total: null,
    yrfi_odds_american: null,
    nrfi_odds_american: null,
    yrfi_no_vig_prob: null,
    nrfi_no_vig_prob: null,
    data_quality: "missing",
    freshness: null,
    reason: "fi_market_missing",
  };
  if (!linesForGame || linesForGame.length === 0) return empty;

  // Pick the highest-priority book that has BOTH over and under for the
  // first_inning_total market.
  const candidates = linesForGame.filter((l) => l.market_type === "first_inning_total");
  if (candidates.length === 0) return empty;

  let chosenBook: string | null = null;
  let overRow: FiLineRow | null = null;
  let underRow: FiLineRow | null = null;
  for (const book of FI_BOOK_PRIORITY) {
    const o = candidates.find((l) => l.sportsbook.toLowerCase() === book && (l.side ?? "").toLowerCase() === "over" && l.odds_american !== null);
    const u = candidates.find((l) => l.sportsbook.toLowerCase() === book && (l.side ?? "").toLowerCase() === "under" && l.odds_american !== null);
    if (o && u) { chosenBook = book; overRow = o; underRow = u; break; }
  }
  if (overRow === null || underRow === null) {
    // Fall through to any book that has both sides.
    const overAny = candidates.find((l) => (l.side ?? "").toLowerCase() === "over" && l.odds_american !== null);
    const underAny = candidates.find((l) => (l.side ?? "").toLowerCase() === "under" && l.odds_american !== null);
    if (overAny === undefined || underAny === undefined) {
      return {
        ...empty,
        reason: "fi_market_one_sided",
      };
    }
    chosenBook = overAny.sportsbook;
    overRow = overAny;
    underRow = underAny;
  }
  if (overRow.odds_american === null || underRow.odds_american === null) return empty;

  const pair = noVigPair(overRow.odds_american, underRow.odds_american);
  // pair.home is the first arg (over = YRFI), pair.away is the second (under = NRFI).
  const yrfiNoVig = pair.home;
  const nrfiNoVig = pair.away;

  const freshness = overRow.fetched_at ?? underRow.fetched_at ?? null;
  void americanToImpliedProb; // marker that helper module is wired

  return {
    listed_fi_total: overRow.line_value ?? 0.5,
    yrfi_odds_american: overRow.odds_american,
    nrfi_odds_american: underRow.odds_american,
    yrfi_no_vig_prob: yrfiNoVig,
    nrfi_no_vig_prob: nrfiNoVig,
    data_quality: "ok",
    freshness,
    reason: `fi_market_ok_${chosenBook}`,
  };
}
