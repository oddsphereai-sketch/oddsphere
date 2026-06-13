/**
 * NBA-P0 — Multi-book market consensus with outlier + contradiction rejection.
 *
 * Root cause this fixes (Game 5 2026-06-13): the NBA market baseline trusted a
 * SINGLE book's moneyline. `fliff` had its ML home/away flipped (SA +385 while
 * its own spread had SA -5.5 favored), poisoning the baseline so the grounded
 * projection would anchor to a corrupted line. Same failure class as the soccer
 * BTTS single-book de-vig outlier.
 *
 * This module forms a CLEAN baseline from ALL books:
 *   • De-vig each book's ML pair independently (no single-book trust).
 *   • Cross-check each book's ML against the spread-implied favorite; reject
 *     books whose ML contradicts a decisive spread (the fliff case).
 *   • Reject extreme outliers vs the consensus median.
 *   • Median-consensus the spread + total too; reject obvious outliers.
 *   • Record which books were accepted/rejected and WHY (audit).
 *
 * Safety (never silent): if ML is corrupted but the spread is clean, fall back
 * to a spread-implied ML and FLAG it. If the whole market is too corrupted to
 * form a baseline, return clean=false with a reason so the caller can HOLD.
 *
 * Pure module. No I/O. De-vig reuses the sport-agnostic helpers in marketPrior.
 */

import { americanToImpliedProb, noVigPair } from "../marketPrior";

export interface NbaBookLine {
  sportsbook: string;
  market_type: "moneyline" | "spread" | "total";
  side: string; // home/away/over/under
  line_value: number | null;
  odds_american: number | null;
}

export interface BookDecision {
  book: string;
  homeNoVig?: number;
  reason: string;
}

export interface NbaMarketConsensus {
  // Moneyline (home no-vig win prob) — clean consensus.
  mlHomeNoVig: number | null;
  mlAwayNoVig: number | null;
  mlSource: "book_consensus" | "spread_implied_fallback" | null;
  mlAcceptedBooks: string[];
  mlRejectedBooks: BookDecision[];
  /**
   * Honest strength label — drives confidence/grade caps downstream:
   *   "multi_book"             — ≥2 accepted ML books agree (real consensus)
   *   "limited_spread_confirmed" — exactly 1 ML book survived but the spread
   *                                confirms its favorite (G5 case — cap it)
   *   "spread_implied_fallback"  — no ML book survived; ML derived from spread
   *   "insufficient"             — no usable ML baseline
   */
  consensusStrength: "multi_book" | "limited_spread_confirmed" | "spread_implied_fallback" | "insufficient";
  /** True when the accepted/derived ML favorite matches the spread-implied favorite. */
  spreadConfirmation: boolean;
  // Spread (home perspective; negative = home favored).
  spreadHome: number | null;
  spreadAcceptedBooks: string[];
  spreadRejectedBooks: BookDecision[];
  spreadImpliedFavorite: "home" | "away" | "pickem" | null;
  // Total.
  totalLine: number | null;
  totalAcceptedBooks: string[];
  totalRejectedBooks: BookDecision[];
  // Overall.
  clean: boolean;
  holdReason: string | null;
  notes: string[];
}

const MARGIN_SD_FOR_SPREAD_IMPLIED = 12.0; // NBA margin SD → spread→winprob
const ML_OUTLIER_PP = 0.18; // reject ML book > 18pp from accepted median
const TOTAL_OUTLIER_PTS = 6.0; // reject total book > 6 pts from median
const SPREAD_DECISIVE_PTS = 1.0; // spread must be ≥1pt to be "decisive" for the ML cross-check

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Standard normal CDF (Abramowitz-Stegun 7.1.26). */
function normCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-(z * z) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

/** Spread (home perspective, negative = home favored) → home win probability. */
export function spreadToHomeWinProb(spreadHome: number): number {
  // home margin ≈ -spreadHome; P(margin > 0) = Phi(-spreadHome / sd)
  return normCdf(-spreadHome / MARGIN_SD_FOR_SPREAD_IMPLIED);
}

export function buildNbaMarketConsensus(lines: ReadonlyArray<NbaBookLine>): NbaMarketConsensus {
  const notes: string[] = [];

  // ── Spread consensus (do first — it referees the ML cross-check) ──────
  const spreadByBook = new Map<string, number>();
  for (const l of lines) {
    if (l.market_type === "spread" && l.side === "home" && l.line_value !== null) {
      spreadByBook.set(l.sportsbook, l.line_value);
    }
  }
  const spreadAccepted: string[] = [];
  const spreadRejected: BookDecision[] = [];
  let spreadHome: number | null = null;
  let spreadImpliedFavorite: NbaMarketConsensus["spreadImpliedFavorite"] = null;
  if (spreadByBook.size > 0) {
    const med = median([...spreadByBook.values()]);
    for (const [book, v] of spreadByBook) {
      if (Math.abs(v - med) > 4.0) spreadRejected.push({ book, reason: `spread ${v} >4pt from median ${med}` });
      else spreadAccepted.push(book);
    }
    const acceptedVals = [...spreadByBook].filter(([b]) => spreadAccepted.includes(b)).map(([, v]) => v);
    spreadHome = acceptedVals.length ? median(acceptedVals) : med;
    spreadImpliedFavorite =
      spreadHome < -SPREAD_DECISIVE_PTS ? "home" : spreadHome > SPREAD_DECISIVE_PTS ? "away" : "pickem";
  }

  // ── Moneyline consensus — de-vig each book, cross-check vs spread ─────
  const mlByBook = new Map<string, { home: number | null; away: number | null }>();
  for (const l of lines) {
    if (l.market_type === "moneyline" && l.odds_american !== null) {
      const cur = mlByBook.get(l.sportsbook) ?? { home: null, away: null };
      if (l.side === "home") cur.home = l.odds_american;
      if (l.side === "away") cur.away = l.odds_american;
      mlByBook.set(l.sportsbook, cur);
    }
  }
  const mlCandidates: { book: string; homeNoVig: number }[] = [];
  const mlRejected: BookDecision[] = [];
  for (const [book, odds] of mlByBook) {
    if (odds.home === null || odds.away === null) {
      mlRejected.push({ book, reason: "incomplete ML pair" });
      continue;
    }
    let homeNoVig: number;
    try {
      homeNoVig = noVigPair(odds.home, odds.away).home;
    } catch {
      mlRejected.push({ book, reason: "de-vig failed (bad odds)" });
      continue;
    }
    // Contradiction check vs a decisive spread.
    if (spreadImpliedFavorite === "home" && homeNoVig < 0.5) {
      mlRejected.push({ book, homeNoVig, reason: `ML home ${(homeNoVig * 100).toFixed(0)}% contradicts spread (home favored ${spreadHome})` });
      continue;
    }
    if (spreadImpliedFavorite === "away" && homeNoVig > 0.5) {
      mlRejected.push({ book, homeNoVig, reason: `ML home ${(homeNoVig * 100).toFixed(0)}% contradicts spread (away favored ${spreadHome})` });
      continue;
    }
    mlCandidates.push({ book, homeNoVig });
  }

  // Outlier rejection among surviving ML candidates (vs their median).
  let mlAccepted: { book: string; homeNoVig: number }[] = [];
  if (mlCandidates.length > 0) {
    const med = median(mlCandidates.map((c) => c.homeNoVig));
    for (const c of mlCandidates) {
      if (Math.abs(c.homeNoVig - med) > ML_OUTLIER_PP) {
        mlRejected.push({ book: c.book, homeNoVig: c.homeNoVig, reason: `ML ${(c.homeNoVig * 100).toFixed(0)}% >${ML_OUTLIER_PP * 100}pp from median ${(med * 100).toFixed(0)}%` });
      } else {
        mlAccepted.push(c);
      }
    }
  }

  let mlHomeNoVig: number | null = null;
  let mlSource: NbaMarketConsensus["mlSource"] = null;
  if (mlAccepted.length > 0) {
    mlHomeNoVig = median(mlAccepted.map((c) => c.homeNoVig));
    mlSource = "book_consensus";
  } else if (spreadHome !== null) {
    // Safety: ML corrupted but spread clean → spread-implied ML, FLAGGED.
    mlHomeNoVig = spreadToHomeWinProb(spreadHome);
    mlSource = "spread_implied_fallback";
    notes.push(
      `ML baseline from SPREAD-IMPLIED fallback (${(mlHomeNoVig * 100).toFixed(0)}% home) — all book MLs rejected as corrupted/contradictory`,
    );
  }
  const mlAwayNoVig = mlHomeNoVig === null ? null : 1 - mlHomeNoVig;

  // ── Total consensus ──────────────────────────────────────────────────
  const totalByBook = new Map<string, number>();
  for (const l of lines) {
    if (l.market_type === "total" && l.line_value !== null) {
      // over/under rows carry the same line; record once per book.
      if (!totalByBook.has(l.sportsbook)) totalByBook.set(l.sportsbook, l.line_value);
    }
  }
  const totalAccepted: string[] = [];
  const totalRejected: BookDecision[] = [];
  let totalLine: number | null = null;
  if (totalByBook.size > 0) {
    const med = median([...totalByBook.values()]);
    for (const [book, v] of totalByBook) {
      if (Math.abs(v - med) > TOTAL_OUTLIER_PTS) totalRejected.push({ book, reason: `total ${v} >${TOTAL_OUTLIER_PTS}pt from median ${med}` });
      else totalAccepted.push(book);
    }
    const acceptedVals = [...totalByBook].filter(([b]) => totalAccepted.includes(b)).map(([, v]) => v);
    const rawTotal = acceptedVals.length ? median(acceptedVals) : med;
    // Snap to the nearest 0.5 — books quote half/whole-point totals, so a median
    // across split books (e.g. 216.5 & 217) can land on a non-bettable 216.75.
    // Display + grade against a real line.
    totalLine = Math.round(rawTotal * 2) / 2;
  }

  // ── Honest strength + spread confirmation ────────────────────────────
  const favFromMl: "home" | "away" | null =
    mlHomeNoVig === null ? null : mlHomeNoVig > 0.5 ? "home" : "away";
  const spreadConfirmation =
    favFromMl !== null && spreadImpliedFavorite !== null && spreadImpliedFavorite !== "pickem"
      ? favFromMl === spreadImpliedFavorite
      : false;
  let consensusStrength: NbaMarketConsensus["consensusStrength"];
  if (mlSource === "book_consensus" && mlAccepted.length >= 2) consensusStrength = "multi_book";
  else if (mlSource === "book_consensus" && mlAccepted.length === 1)
    consensusStrength = "limited_spread_confirmed";
  else if (mlSource === "spread_implied_fallback") consensusStrength = "spread_implied_fallback";
  else consensusStrength = "insufficient";
  if (consensusStrength === "limited_spread_confirmed") {
    notes.push(
      `LIMITED ML consensus — only 1 book (${mlAccepted[0]?.book}) survived; spread ${spreadConfirmation ? "CONFIRMS" : "does NOT confirm"} the favorite. Confidence + grade capped.`,
    );
  }

  // ── Cleanliness verdict ──────────────────────────────────────────────
  let clean = true;
  let holdReason: string | null = null;
  if (mlHomeNoVig === null && spreadHome === null && totalLine === null) {
    clean = false;
    holdReason = "no usable ML / spread / total across any book";
  } else if (mlHomeNoVig === null) {
    clean = false;
    holdReason = "no clean ML baseline (all books rejected, no spread to imply from)";
  } else if (consensusStrength === "limited_spread_confirmed" && !spreadConfirmation) {
    // 1 ML book AND the spread does not back it → not safe to trust.
    clean = false;
    holdReason = "single ML book not confirmed by spread — baseline unsafe";
  } else if (consensusStrength === "spread_implied_fallback" && spreadHome === null) {
    clean = false;
    holdReason = "ML fully corrupted and no spread to imply from";
  }

  return {
    consensusStrength,
    spreadConfirmation,
    mlHomeNoVig,
    mlAwayNoVig,
    mlSource,
    mlAcceptedBooks: mlAccepted.map((c) => c.book),
    mlRejectedBooks: mlRejected,
    spreadHome,
    spreadAcceptedBooks: spreadAccepted,
    spreadRejectedBooks: spreadRejected,
    spreadImpliedFavorite,
    totalLine,
    totalAcceptedBooks: totalAccepted,
    totalRejectedBooks: totalRejected,
    clean,
    holdReason,
    notes,
  };
}
