/**
 * BTTS side fix: underdog-lambda decompression + market anchor + auditor
 * (2026-06-16).
 *
 * Audit finding: the WC card showed a confident "No" on nearly every match.
 * The joint-distribution math is correct (P(BTTS yes) = Σ_{h≥1,a≥1} joint[h][a]
 * = 1 − P(h=0) − P(a=0) + P(0,0); standard Dixon-Coles tau). The real bug is
 * MODEL-INTEGRITY: the weaker side's attacking lambda is over-compressed (the
 * dominant-favorite mismatch boost only lifts the FAVORITE), so genuinely
 * two-sided matches sit just under 50% BTTS-yes and the argmax tips them all to
 * "No". Confirmed on the live slate: only 1/12 cleared 0.5 raw.
 *
 * Fix (BTTS-ONLY, NO toss-up — toss-up is first-inning only; Yes/No stays the
 * BTTS side): for the BTTS calculation ONLY, decompress the λ gap — pull each
 * team's λ a modest fraction toward their mean. This lifts the underdog's
 * scoring chance for two-sided games (→ genuine YES) while leaving real
 * blowouts as NO. λ for match_result / total / scores is UNCHANGED. Tuned on
 * the live slate: 0.15 → 3/12 YES (the credible two-sided games), blowouts NO;
 * 0.25 over-forces (lifts blowout underdogs → fake YES). It does NOT hard-force
 * a YES quota — a game only flips when its decompressed P(yes) genuinely ≥ 0.5.
 *
 * Market role: the de-vigged WC BTTS market prices yes ~12–15pp BELOW the model
 * and below the ~50% base rate (thin/unreliable BTTS pricing), so it is NOT
 * blended into the SIDE (that would re-suppress genuine YES). It anchors the
 * GRADE via the existing model-vs-market edge/cap, and is logged for
 * transparency. `calibrateBttsYes` remains a pure, tested market-anchor helper
 * for when BTTS market data is trustworthy.
 *
 * Pure: no DB, no Next.
 */

/** Fraction of the home/away λ gap pulled toward the mean, for BTTS only. */
export const BTTS_LAMBDA_DECOMPRESS = 0.15;

/** Model weight for the (optional) market-anchor blend; rest = market. */
export const BTTS_MODEL_WEIGHT = 0.7;

/**
 * Decompress the λ gap toward the mean for the BTTS calculation ONLY. Lifts the
 * weaker side and slightly lowers the favorite (whose scoring is already near
 * saturation, so net BTTS-yes rises). Returns [homeλ, awayλ] for BTTS.
 */
export function decompressLambdasForBtts(
  lambdaHome: number,
  lambdaAway: number,
  decompress: number = BTTS_LAMBDA_DECOMPRESS,
): [number, number] {
  const mean = (lambdaHome + lambdaAway) / 2;
  const k = 1 - Math.max(0, Math.min(1, decompress));
  return [mean + (lambdaHome - mean) * k, mean + (lambdaAway - mean) * k];
}

/**
 * Optional market-anchor calibration for BTTS-yes (market-INFORMED, not
 * mirroring; model-dominant weight). Returns the model value unchanged when
 * the market is unpriced. Pure; used where the BTTS market is trustworthy.
 */
export function calibrateBttsYes(
  modelYes: number,
  marketYes: number | null,
  modelWeight: number = BTTS_MODEL_WEIGHT,
): number {
  if (marketYes === null || !Number.isFinite(marketYes)) return clamp01(modelYes);
  const w = Math.max(0, Math.min(1, modelWeight));
  return clamp01(w * modelYes + (1 - w) * marketYes);
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** The BTTS side = higher probability (argmax). Yes/No only — never toss-up. */
export function resolveBttsSide(pYes: number, pNo: number): "yes" | "no" {
  return pYes >= pNo ? "yes" : "no";
}

/**
 * Slate-distribution sanity (auditor): is the published BTTS side dangerously
 * skewed across a slate? Returns a warning string or null — it WARNS only and
 * never forces output. Catches a regression where the model collapses to
 * all-No / all-Yes.
 */
export function bttsDistributionWarning(
  sides: ReadonlyArray<"yes" | "no">,
  opts: { minSlate?: number; skewThreshold?: number } = {},
): string | null {
  const minSlate = opts.minSlate ?? 5;
  const skewThreshold = opts.skewThreshold ?? 0.85;
  if (sides.length < minSlate) return null;
  const no = sides.filter((s) => s === "no").length;
  const noShare = no / sides.length;
  if (noShare >= skewThreshold) {
    return `BTTS skew: ${no}/${sides.length} sides NO (${Math.round(noShare * 100)}%) — check underdog λ decompression / BTTS calibration.`;
  }
  if (1 - noShare >= skewThreshold) {
    return `BTTS skew: ${sides.length - no}/${sides.length} sides YES (${Math.round((1 - noShare) * 100)}%) — possible over-decompression.`;
  }
  return null;
}
