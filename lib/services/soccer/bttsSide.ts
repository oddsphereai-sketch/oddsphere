/**
 * BTTS side helpers + slate auditor (2026-06-16).
 *
 * The live model computes BTTS from the RAW score distribution (same λ as
 * match_result / total): P(yes) = 1 − P(h=0) − P(a=0) + P(0,0). The side is the
 * higher-probability outcome (argmax), consistent with how totals / match_result
 * pick their sides; model-vs-market edge flows to the GRADE, not the side.
 *
 * HISTORY: an earlier "underdog-λ decompression" attempted to lift two-sided
 * games to YES by pulling each team's λ toward the mean. It was reverted as
 * anti-predictive — the pull is GAP-proportional, so it lifted the LOWEST-scoring
 * underdogs the MOST, perversely pushing the biggest blowouts toward YES while
 * moderate games stayed NO. The raw model is monotonic (BTTS-yes rises with the
 * weaker team's λ) and roughly calibrated at the level (slate mean ≈ WC norm); a
 * proper per-market calibration is sample-blocked (see the WC calibration
 * roadmap) and must come from data, not a λ hack.
 *
 * Pure: no DB, no Next.
 */

/** The BTTS side = higher probability (argmax). Yes/No only — never toss-up. */
export function resolveBttsSide(pYes: number, pNo: number): "yes" | "no" {
  return pYes >= pNo ? "yes" : "no";
}

/**
 * Regress a raw model BTTS P(yes) toward the competition base rate — the
 * data-driven calibration the header note anticipated.
 *
 * Evidence (2026-06-17, 16 settled WC BTTS): the raw model centered P(yes) at
 * 0.46 — ~6pp BELOW the 0.52 WC group-stage base rate — because it
 * under-projects the weaker team's goals (low λ → low P(both score)). The
 * betting market was even more No-biased (mean 0.39) and scored a WORSE Brier
 * (0.32 vs the model's 0.26), so leaning to the market would hurt; we regress
 * toward our OWN established base rate instead.
 *
 * Conservative partial shrink toward `baseRate`: yes' = raw + shrink·(baseRate −
 * raw). shrink=0 is a no-op (raw model); shrink=1 collapses to the base rate.
 * At shrink=0.5 the model center moves 0.46 → ~0.49 (still below 0.52) and only
 * genuine coin-flips (raw P(yes) ~0.48–0.50) flip No→Yes. Pure; output clamped
 * to [0,1] with no = 1 − yes so the pair stays a valid distribution.
 */
export function regressBttsYesTowardBaseRate(
  raw: { yes: number; no: number },
  baseRate: number,
  shrink: number,
): { yes: number; no: number } {
  const adjusted = raw.yes + shrink * (baseRate - raw.yes);
  const yes = Math.min(1, Math.max(0, adjusted));
  return { yes, no: 1 - yes };
}

/**
 * Slate-distribution sanity (auditor): is the published BTTS side dangerously
 * skewed across a slate? Returns a warning string or null — it WARNS only and
 * never forces output. Catches a regression where the model collapses to
 * all-No / all-Yes. (A genuinely lopsided WC slate can legitimately lean No, so
 * this is a heads-up to investigate, not an auto-fix.)
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
    return `BTTS skew: ${no}/${sides.length} sides NO (${Math.round(noShare * 100)}%) — verify it reflects a genuinely lopsided slate, not a model/calibration regression.`;
  }
  if (1 - noShare >= skewThreshold) {
    return `BTTS skew: ${sides.length - no}/${sides.length} sides YES (${Math.round((1 - noShare) * 100)}%) — verify the model is not over-predicting both-teams-score.`;
  }
  return null;
}
