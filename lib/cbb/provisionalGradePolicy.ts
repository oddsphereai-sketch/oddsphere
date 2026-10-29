import { cbbImpliedProbability, reviewCbbQuote } from "./marketEvidence";
import { cbbExactMarketCenter } from "./marketReaderResearch";
import type { CbbForecast, CbbMarket, CbbQuote } from "./types";

/** Candidate only: not imported by a member reader or prediction writer. */
export const CBB_PROVISIONAL_GRADE_RELEASE = "cbb_candidate_2026_10_29_r4_observed_quote_freshness" as const;

export type CbbProvisionalGrade = "Best Angle" | "Lean" | "Watchlist" | "No Play" | "Held";
export type CbbGradeEvidence = {
  target: CbbQuote;
  references: CbbQuote[];
  forecast: CbbForecast;
  asOf: string;
};

const professionalBooks = new Set(["pinnacle", "ps3838", "circa", "bookmaker"]);
const targetPriceFloor = { moneyline: -250, spread: -500, total: -500 } satisfies Record<CbbMarket, number>;

/** An exact two-sided target can be offered; a reference cannot price its own pick. */
function validQuote(quote: CbbQuote, forecast: CbbForecast, asOfMs: number): boolean {
  const observed = Date.parse(quote.providerObservedAt);
  const fetched = Date.parse(quote.fetchedAt);
  if (quote.gameId !== forecast.gameId || quote.phase !== "current" ||
    !Number.isFinite(observed) || !Number.isFinite(fetched) ||
    observed > fetched || fetched > asOfMs || asOfMs - fetched > 60 * 60_000 ||
    asOfMs - observed > 60 * 60_000 ||
    quote.market !== "moneyline" && (quote.line === null || !Number.isFinite(quote.line))) return false;
  try {
    const hold = cbbImpliedProbability(quote.firstPrice) + cbbImpliedProbability(quote.secondPrice);
    return hold >= 0.98 && hold <= 1.3;
  } catch { return false; }
}

function family(book: string): string {
  return ["pinnacle", "ps3838"].includes(book.toLowerCase()) ? "pinnacle" : book.toLowerCase();
}

/**
 * This is a transparent provisional triage, not a validated betting system.
 * Every market is evaluated; an absent quote is Held, not a model No Play.
 * The reserves below are predeclared economic margins, not optimized win-rate claims.
 */
export function gradeCbbProvisional(input: CbbGradeEvidence) {
  const { target, forecast } = input;
  const asOfMs = Date.parse(input.asOf);
  if (!Number.isFinite(asOfMs) || forecast.asOf !== input.asOf ||
    target.gameId !== forecast.gameId) throw new Error("CBB provisional grade identity/cutoff mismatch");
  if (forecast.inputStatus !== "complete" || !validQuote(target, forecast, asOfMs)) {
    return { release: CBB_PROVISIONAL_GRADE_RELEASE, market: target.market,
      grade: "Held" as const, reason: "incomplete_forecast_or_executable_quote",
      selection: null, price: null, expectedValue: null, referenceState: "unavailable" as const,
      professionalReferences: 0, stake: 0 };
  }
  const review = reviewCbbQuote(forecast, target);
  const price = review.selection === "first" ? target.firstPrice : target.secondPrice;
  const eligible = input.references.filter(row => row.market === target.market &&
    family(row.sportsbook) !== family(target.sportsbook) && validQuote(row, forecast, asOfMs));
  const byFamily = new Map<string, CbbQuote[]>();
  for (const row of eligible) byFamily.set(family(row.sportsbook), [...(byFamily.get(family(row.sportsbook)) ?? []), row]);
  const distinct = new Map<string, CbbQuote>();
  for (const [bookFamily, rows] of byFamily) {
    rows.sort((a, b) => b.providerObservedAt.localeCompare(a.providerObservedAt));
    const latest = rows.filter(row => row.providerObservedAt === rows[0].providerObservedAt);
    if (new Set(latest.map(row => JSON.stringify([row.line, row.firstPrice, row.secondPrice]))).size !== 1) continue;
    distinct.set(bookFamily, latest[0]);
  }
  const sharp = [...distinct.values()].filter(row => professionalBooks.has(family(row.sportsbook)));
  const sharpSide = sharp.map(row => {
    const fair = cbbImpliedProbability(row.firstPrice) /
      (cbbImpliedProbability(row.firstPrice) + cbbImpliedProbability(row.secondPrice));
    const center = cbbExactMarketCenter(forecast, row, fair);
    const threshold = target.market === "moneyline" ? 0 : target.market === "spread" ? -target.line! : target.line!;
    const referenceFirst = center > threshold;
    return referenceFirst === (review.selection === "first") ? 1 : -1;
  });
  const referenceState = sharpSide.length === 0 ? "unavailable" as const :
    sharpSide.every(side => side === 1) ? "agrees" as const :
    sharpSide.every(side => side === -1) ? "opposes" as const : "mixed" as const;
  const value = review.expectedValue;
  const priceEligible = price >= targetPriceFloor[target.market];
  const best = value >= 0.08 && priceEligible && referenceState === "agrees";
  const lean = value >= 0.03 && priceEligible &&
    (referenceState === "agrees" || referenceState === "unavailable");
  const grade: CbbProvisionalGrade = best ? "Best Angle" : lean ? "Lean" :
    value >= 0 || referenceState === "mixed" ? "Watchlist" : "No Play";
  return { release: CBB_PROVISIONAL_GRADE_RELEASE, market: target.market, grade,
    reason: best ? "material_edge_with_professional_corroboration" :
      lean && referenceState === "agrees" ? "positive_edge_with_professional_corroboration" :
      lean ? "model_only_positive_edge_professional_unavailable" :
      referenceState === "opposes" ? "professional_opposition" :
      !priceEligible ? "price_too_steep_for_actionable" :
      value >= 0 ? "edge_below_actionable_reserve" : "non_positive_exact_price_value",
    selection: review.selection, price, expectedValue: value, referenceState,
    professionalReferences: sharp.length, stake: 0 };
}
