/**
 * Pure CLV (closing line value) math for the streaming/research layer
 * (2026-06-16). Worker-safe: no DB, no Next.
 *
 * CLV is measured in probability points (pp) on the PICKED side: how much the
 * market's implied probability for our side moved between the price we bet
 * (posted/lock) and the closing price. Positive = the market moved toward our
 * side after we posted = we "beat the close".
 *
 * NOTE (vendor limitation): SharpAPI does not expose a true closing-line flag,
 * so callers approximate "closing" as the last accepted pre-start tick for the
 * picked side. This module does not know about that approximation — it just
 * does the arithmetic on whatever two prices it is handed.
 */

import { americanToImpliedProb } from "./lineDirection";

export { americanToImpliedProb };

export type ClvResult = {
  /** Implied prob (with vig) at the bet price, 0..1, or null. */
  betProb: number | null;
  /** Implied prob (with vig) at the closing price, 0..1, or null. */
  closeProb: number | null;
  /** Closing minus bet implied prob, in percentage points; null if either missing. */
  clvPct: number | null;
  /** True when clvPct > 0 (we beat the close); null when not computable. */
  beatClosing: boolean | null;
};

/**
 * Compute CLV for a picked side given the bet price and the closing price,
 * both as American odds for THAT side.
 */
export function computeClv(
  betAmerican: number | null | undefined,
  closeAmerican: number | null | undefined,
): ClvResult {
  const betProb = americanToImpliedProb(betAmerican ?? null);
  const closeProb = americanToImpliedProb(closeAmerican ?? null);
  if (betProb === null || closeProb === null) {
    return { betProb, closeProb, clvPct: null, beatClosing: null };
  }
  const clvPct = (closeProb - betProb) * 100;
  return { betProb, closeProb, clvPct, beatClosing: clvPct > 0 };
}

/** Convenience: just the signed CLV in pp, or null. */
export function computeClvPct(
  betAmerican: number | null | undefined,
  closeAmerican: number | null | undefined,
): number | null {
  return computeClv(betAmerican, closeAmerican).clvPct;
}

/** Convenience: did the picked side beat the close? null when not computable. */
export function beatClosing(
  betAmerican: number | null | undefined,
  closeAmerican: number | null | undefined,
): boolean | null {
  return computeClv(betAmerican, closeAmerican).beatClosing;
}
