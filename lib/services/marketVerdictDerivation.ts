/**
 * marketVerdictDerivation — per-market verdict for a single Daily Edge
 * pick (moneyline / total / first_inning).
 *
 * Distinct from the existing game-level `verdictDerivation.ts` which
 * computes ONE verdict for an entire game using headline-pick reasoning.
 * The v13.1 UI port (4.1.10/4.1.11) needs a verdict PER market so each
 * card shows the right chip even when the user clicks a non-headline
 * market.
 *
 * Rules (Phase 4.1.10 base + R-16I Phase 1 reviewer authority):
 *   1. sharp_conflict grade OR sharpDirection="push_against" → caution
 *   1a. (R-16I Phase 1) reviewerSignals.sharpConflict → caution
 *       This routes the reviewer's `ou_sharp_conflict` (and future ML
 *       equivalent) flag directly to Caution even when the route's
 *       deriveSharpDirection didn't independently detect push_against.
 *       The reviewer is authoritative — its conflict flag should not
 *       be silently dropped just because the route's sharp helper read
 *       the signal differently.
 *   2. best_signal grade AND confidence ≥ 0.62 → best_angle
 *   3. sharp_confirmed grade AND confidence ≥ 0.58 AND no push-against → best_angle
 *   4. confidence ≥ 0.58 AND sharpDirection="support" → lean
 *   5. confidence ≥ LEAN_CONFIDENCE_FLOOR (0.58 post-R-16I) → lean
 *   6. confidence ≥ 0.52 → watchlist
 *   7. otherwise → no_play
 *   8. marketDataLimited downgrade: best_angle → lean (ML/Total only)
 *   8a. (R-16I Phase 1) Reviewer warnings cap the verdict ladder at
 *       Watchlist (no Best Angle, no Lean) for the following:
 *         • grade === "public_smoke" — public_smoke is a warning, not
 *           a green light. High confidence alone shouldn't be enough.
 *         • reviewerSignals.publicSmokeAligned === true — equivalent
 *           signal from the reviewer flag.
 *         • reviewerSignals.hasFragilityFlag === true — at least one
 *           strong fragility flag fired (extreme_run_diff_with_coinflip,
 *           small_sample_starter_driver, raw_conf_extreme_fragile,
 *           huge_model_market_gap). The reviewer's STRONG_INTERVENTION_CAP
 *           only fires when ≥2 strong flags hit; this rule catches the
 *           single-flag case so a fragile pick doesn't display as a
 *           normal Lean.
 *       A Watchlist cap is a downgrade only — a pick that already
 *       resolves below Watchlist (no_play) stays no_play.
 *   9. first_inning: sharpDirection is forced to "none" (no sharp data in V1)
 *      AND marketDataLimited never downgrades the verdict (different rule —
 *      first_inning quality is judged by model/matchup data, not splits).
 *      Reviewer-signal rules (1a, 8a) DO apply if the caller supplies them.
 */

import type { Grade } from "../types/domain/Grade";
import type { Verdict } from "./verdictDerivation";
import { MARKET_VERDICT_THRESHOLDS as T } from "./marketVerdictDerivation.constants";

export type MarketVerdict = Verdict;

export type SharpDirection = "support" | "push_against" | "none";

/**
 * R-16I Phase 1 — reviewer-derived signals that the verdict layer
 * treats as authoritative. These come from `sport_specific.review_v1.flags`
 * and let the reviewer's intelligence shape the final user-facing verdict
 * directly (previously the reviewer could flag a conflict but the grade
 * layer wouldn't propagate it, so the conflict was silently lost).
 *
 * All fields default to false when omitted — callers that don't have
 * reviewer data (legacy tests, first_inning) get the pre-R-16I behavior.
 */
export type ReviewerSignals = {
  /**
   * Reviewer flagged a sharp conflict for THIS market.
   *   • total → `ou_sharp_conflict`
   *   • moneyline → reserved for a future ML equivalent (none in V1)
   * When true, verdict routes directly to Caution.
   */
  sharpConflict: boolean;
  /**
   * Reviewer flagged `public_smoke_aligned_with_pick` — heavy + flat
   * public split matched the model's pick. Treated as a warning that
   * caps the verdict at Watchlist (same rule as grade=public_smoke).
   */
  publicSmokeAligned: boolean;
  /**
   * Reviewer fired AT LEAST ONE strong fragility flag for this market.
   * Strong flags: extreme_run_diff_with_coinflip_market,
   * small_sample_starter_driver, raw_conf_extreme_fragile,
   * huge_model_market_gap. The reviewer's STRONG_INTERVENTION_CAP only
   * triggers when ≥2 fire — this signal catches the single-flag case
   * so a still-fragile pick doesn't display as a normal Lean.
   */
  hasFragilityFlag: boolean;
};

/**
 * Phase 6B.30E — market-context signals for the money-conflict /
 * line-movement / edge-strength policy. All inputs already exist in
 * snapshot_json + v2_2_audit + lines/line_history. The verdict layer
 * uses these to decide whether opposing-money conflict should attach
 * warning copy only, cap the chip at Watchlist, or downgrade to
 * Caution. Default (omitted) = no-op, identical to pre-6B.30E behavior.
 *
 * Core policy: one-source money split alone never downgrades the chip.
 * Downgrade only when (a) line/price movement confirms the opposing
 * market direction, OR (b) the underlying model edge is thin/negative,
 * OR (c) multi-source / RLM signals appear (inert today).
 *
 * The 10-rule table (Phase 6B.30E):
 *   Rule 0  no conflict                                  → stay
 *   Rule 1  conflict + line confirms market + edge ∈ {thin, normal, unknown}
 *                                                         → cap Watchlist + warning copy
 *   Rule 1b conflict + line confirms market + edge strong → stay + warning copy
 *           (strong-edge survives confirming line move; BA is already
 *            suppressed by Phase 6B.10 BA-block, so this rule just
 *            keeps the underlying Lean and attaches copy)
 *   Rule 1c conflict + line confirms market + edge negative
 *                                                         → caution + warning copy
 *   Rule 2  conflict + line confirms pick                 → stay + supportive copy
 *           ("model has line-movement support despite split")
 *   Rule 3  conflict + flat line + edge ∈ {thin, negative, unknown}
 *                                                         → cap Watchlist + warning copy
 *   Rule 4  conflict + flat line + edge ∈ {normal, strong} → stay + warning copy
 *   Rule 5  conflict + unknown line + edge negative       → caution + warning copy
 *   Rule 6  conflict + unknown line + edge thin           → cap Watchlist + warning copy
 *   Rule 7  conflict + unknown line + edge ∈ {normal, strong}
 *                                                         → stay + one-source caution copy
 *           (the one-source-only fallback the user explicitly approved)
 *   Rule 8  multi-source conflict (sourceCount ≥ 2)       → cap Watchlist + warning copy
 *                                                         (inert today)
 *   Rule 9  RLM against pick                              → caution + warning copy
 *                                                         (inert today)
 *
 * All rules add a warning code (`opposingMoneyConflictWarning` etc.)
 * that the route can map to user-facing copy. The verdict-layer surface
 * stays the same: { key, label }. The copy mapping lives in the route's
 * `generatePerMarketCopy` callers, which already attach narrative.
 *
 * Boundaries: this policy NEVER promotes a verdict, NEVER flips a
 * pick, NEVER changes V2.2 math / probabilities / projections /
 * prediction_records / grading / tracking / calibration / cron behavior.
 * Best Angle blocking (Phase 6B.10 conflict suppression) is untouched.
 */
export type LineMovementVsPick =
  | "confirms_pick"      // line moved with the model (e.g. Under 10.5 → 10)
  | "confirms_market"    // line moved against the model (e.g. Under 10.5 → 11)
  | "flat"               // movement within threshold
  | "unknown";           // no line_history snapshot to compare

export type EdgeStrengthBucket =
  | "strong"    // edge_pct >= +5.0pp
  | "normal"    // +2.0 .. +5.0pp
  | "thin"      // 0 .. +2.0pp (positive but small)
  | "negative"  // < 0 (model worse than market)
  | "unknown";  // edge_pct unavailable (e.g. OU no-vig null)

export type MarketContextSignals = {
  /** Opposing-side money≥60% AND money−bets≥15pp (existing helper). */
  moneyConflict: boolean;
  /** Direction of line/price move from opening → current for the pick. */
  lineMovementVsPick: LineMovementVsPick;
  /** Bucketed model edge percentage points. */
  edgeStrength: EdgeStrengthBucket;
  /**
   * Number of distinct splits providers reporting on this game/market.
   * Today always 1 (SharpAPI /splits is our only provider). Wired now
   * so Rule 8 activates without code changes when a second provider
   * lands.
   */
  sourceCount: number;
  /**
   * Reverse line movement detected against the picked side (or steam
   * against). Today always false in the data — wired now so Rule 9
   * activates when SharpAPI surfaces RLM signals.
   */
  rlmAgainstPick: boolean;
};

/**
 * Phase 6B.30E — warning code emitted alongside the verdict. The route
 * maps these to customer-facing copy in `generatePerMarketCopy`. Null
 * when no market-context rule fired.
 */
export type MarketContextWarning =
  | "money_conflict_line_confirms_market"   // Rule 1 / 1c
  | "money_conflict_strong_edge_survives"   // Rule 1b
  | "money_conflict_line_confirms_pick"     // Rule 2 (supportive, not a warning per se)
  | "money_conflict_flat_line_thin_edge"    // Rule 3
  | "money_conflict_flat_line_strong_edge"  // Rule 4
  | "money_conflict_unknown_line_negative"  // Rule 5
  | "money_conflict_unknown_line_thin"      // Rule 6
  | "money_conflict_one_source_only"        // Rule 7
  | "money_conflict_multi_source"           // Rule 8 (inert today)
  | "rlm_against_pick"                      // Rule 9 (inert today)
  | null;

export type MarketVerdictInput = {
  market: "moneyline" | "total" | "first_inning";
  /** 0-1. The route normalizes 0-100 storage into this scale upstream. */
  confidence: number;
  grade: Grade;
  /**
   * For moneyline/total: derived from sharp_signals (support vs the pick,
   * push_against the pick, or no signal at all).
   * For first_inning: ALWAYS treated as "none" inside this function
   * regardless of input — V1 has no first-inning sharp feed.
   */
  sharpDirection: SharpDirection;
  /**
   * True when this market has effectively zero quantitative market data
   * (no Pinnacle EV, no fair prob, no splits, no opening price).
   * Triggers a "best_angle → lean" downgrade for ML/Total only.
   * For first_inning, this input is IGNORED (rule 9 above).
   */
  marketDataLimited: boolean;
  /**
   * R-16I Phase 1 — optional reviewer-derived signals. Omitted by
   * callers that don't have reviewer data; defaults to all-false.
   */
  reviewerSignals?: ReviewerSignals;
  /**
   * Phase 6B.30E — optional market-context signals (money conflict,
   * line movement, edge strength, source count, RLM). When omitted,
   * behavior is identical to pre-6B.30E (no rule fires). For
   * `first_inning` the input is also IGNORED so FI verdicts stay
   * unchanged.
   */
  marketContext?: MarketContextSignals;
};

export const VERDICT_LABEL: Record<MarketVerdict, string> = {
  best_angle: "Best Angle",
  lean: "Lean",
  watchlist: "Watchlist",
  caution: "Caution",
  no_play: "No Play",
};

export type MarketVerdictResult = {
  key: MarketVerdict;
  label: string;
  /**
   * Phase 6B.30E — non-null when a market-context rule attached a
   * warning code (used by the route's copy generator to surface
   * "money + line lean opposite — strong-edge call" etc.). Null when
   * no rule fired or no marketContext was supplied.
   */
  warning: MarketContextWarning;
};

export function marketVerdictFor(
  input: MarketVerdictInput
): MarketVerdictResult {
  // Rule 9 (legacy numbering) — first_inning never has a sharp direction
  // in V1, never gets downgraded for "missing market data", and (Phase
  // 6B.30E) never consumes market-context signals either — FI verdicts
  // are judged by model/matchup data, not splits.
  const effectiveSharp: SharpDirection =
    input.market === "first_inning" ? "none" : input.sharpDirection;
  const effectiveLimited =
    input.market === "first_inning" ? false : input.marketDataLimited;
  const reviewer: ReviewerSignals = input.reviewerSignals ?? {
    sharpConflict: false,
    publicSmokeAligned: false,
    hasFragilityFlag: false,
  };
  const marketContext: MarketContextSignals | null =
    input.market === "first_inning" ? null : input.marketContext ?? null;

  // Phase 6B.30E — derive the market-context cap once, before the
  // verdict-ladder logic. The derived result carries:
  //   warningCode: the user-facing warning code (or null)
  //   capAtWatchlist: cap effective_best_angle / effective_lean → watchlist
  //   forceCaution: hard downgrade (Rule 1c / Rule 5 / Rule 9)
  // The function is pure — no side effects, no DB calls.
  const ctx = deriveMarketContextEffect(marketContext);

  // Rule 1 — sharp_conflict OR active push against → caution
  // Rule 1a (R-16I Phase 1) — reviewer's sharp-conflict flag is
  // authoritative regardless of what the route's sharp helper inferred
  // (e.g. ou_sharp_conflict fires because the reviewer compared model
  // pick to sharp +EV side directly).
  if (
    input.grade === "sharp_conflict" ||
    effectiveSharp === "push_against" ||
    reviewer.sharpConflict
  ) {
    return resolve("caution", ctx.warningCode);
  }

  // Phase 6B.30E — Rule 1c / Rule 5 / Rule 9: forced caution. Fires
  // BEFORE the verdict ladder so a negative-edge-with-confirming-line
  // or RLM-against-pick is honestly displayed as Caution.
  if (ctx.forceCaution) {
    return resolve("caution", ctx.warningCode);
  }

  // R-16I Phase 1 — Rule 8a: reviewer warnings cap the verdict ladder
  // at Watchlist. Computed once here so both best_angle and lean rules
  // route through the cap. A warning-capped pick that already resolves
  // below Watchlist stays where it is (no_play stays no_play).
  //
  // Phase 6B.30E — market-context caps stack with the reviewer cap.
  // Either one alone is sufficient to cap at Watchlist.
  const capAtWatchlist =
    input.grade === ("public_smoke" as Grade) ||
    reviewer.publicSmokeAligned ||
    reviewer.hasFragilityFlag ||
    ctx.capAtWatchlist;

  // Rules 2 + 3 — best_angle candidates
  if (
    input.grade === "best_signal" &&
    input.confidence >= T.BEST_ANGLE_CONFIDENCE_BEST_SIGNAL
  ) {
    return applyWarningCap(
      applyLimitedDowngrade("best_angle", effectiveLimited).key,
      capAtWatchlist,
      ctx.warningCode
    );
  }
  // effectiveSharp is "support" | "none" here — rule 1 already returned
  // when it was "push_against".
  if (
    input.grade === "sharp_confirmed" &&
    input.confidence >= T.BEST_ANGLE_CONFIDENCE_SHARP_CONFIRMED
  ) {
    return applyWarningCap(
      applyLimitedDowngrade("best_angle", effectiveLimited).key,
      capAtWatchlist,
      ctx.warningCode
    );
  }

  // Rules 4 + 5 — lean candidates
  if (
    input.confidence >= T.LEAN_CONFIDENCE_FLOOR_WITH_SHARP_SUPPORT &&
    effectiveSharp === "support"
  ) {
    return applyWarningCap("lean", capAtWatchlist, ctx.warningCode);
  }
  if (input.confidence >= T.LEAN_CONFIDENCE_FLOOR) {
    return applyWarningCap("lean", capAtWatchlist, ctx.warningCode);
  }

  // Rule 6 — watchlist
  if (input.confidence >= T.WATCHLIST_CONFIDENCE_FLOOR) {
    return resolve("watchlist", ctx.warningCode);
  }

  // Rule 7 — fall-through. capAtWatchlist intentionally NOT applied
  // here — a sub-floor pick should not be promoted to Watchlist just
  // because a warning fired; if confidence is too low to clear
  // Watchlist's own floor, no_play is the right answer. The market-
  // context warning code still rides along so the copy layer can
  // surface "thin edge + opposing money" honestly.
  return resolve("no_play", ctx.warningCode);
}

/**
 * Phase 6B.30E — pure rule chain for the market-context policy.
 * Returns the effect of the 10-rule table (see MarketContextSignals
 * doc above). Decoupled from the verdict ladder so callers can test
 * it in isolation and so the ladder code stays readable.
 *
 * Returns { warningCode, capAtWatchlist, forceCaution } where:
 *   - warningCode rides along to the copy layer (may be set even when
 *     no chip change applies — Rule 2 / Rule 4 / Rule 7 attach copy
 *     without changing the chip)
 *   - capAtWatchlist downgrades best_angle/lean → watchlist
 *   - forceCaution hard-downgrades to caution (used for Rule 1c
 *     negative-edge-with-confirming-line and Rule 9 RLM)
 */
export function deriveMarketContextEffect(
  context: MarketContextSignals | null,
): {
  warningCode: MarketContextWarning;
  capAtWatchlist: boolean;
  forceCaution: boolean;
} {
  if (context === null) {
    return { warningCode: null, capAtWatchlist: false, forceCaution: false };
  }
  // Rule 9 — RLM against pick is the strongest signal in the policy.
  // Fires even when moneyConflict is absent, because RLM is itself a
  // sharp signal.
  if (context.rlmAgainstPick) {
    return { warningCode: "rlm_against_pick", capAtWatchlist: false, forceCaution: true };
  }

  // Every remaining rule requires moneyConflict.
  if (!context.moneyConflict) {
    return { warningCode: null, capAtWatchlist: false, forceCaution: false };
  }

  // Rule 8 — multi-source conflict (sourceCount ≥ 2). Inert today since
  // SharpAPI /splits is our only splits provider, but the wiring is in
  // so a second provider activates this automatically.
  if (context.sourceCount >= 2) {
    return { warningCode: "money_conflict_multi_source", capAtWatchlist: true, forceCaution: false };
  }

  // Branch on line movement direction.
  if (context.lineMovementVsPick === "confirms_pick") {
    // Rule 2 — line confirms model. NEVER downgrade; supportive copy.
    return { warningCode: "money_conflict_line_confirms_pick", capAtWatchlist: false, forceCaution: false };
  }
  if (context.lineMovementVsPick === "confirms_market") {
    // Rule 1c — negative edge + confirming line = caution.
    if (context.edgeStrength === "negative") {
      return { warningCode: "money_conflict_line_confirms_market", capAtWatchlist: false, forceCaution: true };
    }
    // Rule 1b — strong edge + confirming line = stay, attach warning.
    if (context.edgeStrength === "strong") {
      return { warningCode: "money_conflict_strong_edge_survives", capAtWatchlist: false, forceCaution: false };
    }
    // Rule 1 — thin/normal/unknown edge + confirming line = cap.
    return { warningCode: "money_conflict_line_confirms_market", capAtWatchlist: true, forceCaution: false };
  }
  if (context.lineMovementVsPick === "flat") {
    // Rule 3 — flat line + thin/negative/unknown edge = cap.
    if (
      context.edgeStrength === "thin" ||
      context.edgeStrength === "negative" ||
      context.edgeStrength === "unknown"
    ) {
      return { warningCode: "money_conflict_flat_line_thin_edge", capAtWatchlist: true, forceCaution: false };
    }
    // Rule 4 — flat line + normal/strong edge = stay, attach warning.
    return { warningCode: "money_conflict_flat_line_strong_edge", capAtWatchlist: false, forceCaution: false };
  }

  // context.lineMovementVsPick === "unknown" branch below.
  // Rule 5 — unknown line + negative edge = caution.
  if (context.edgeStrength === "negative") {
    return { warningCode: "money_conflict_unknown_line_negative", capAtWatchlist: false, forceCaution: true };
  }
  // Rule 6 — unknown line + thin edge = cap.
  if (context.edgeStrength === "thin") {
    return { warningCode: "money_conflict_unknown_line_thin", capAtWatchlist: true, forceCaution: false };
  }
  // Rule 7 — unknown line + normal/strong/unknown edge = stay, one-
  // source caution copy. This is the explicit "one-source split alone
  // never downgrades the chip" carve-out the user approved.
  return { warningCode: "money_conflict_one_source_only", capAtWatchlist: false, forceCaution: false };
}

function resolve(
  key: MarketVerdict,
  warning: MarketContextWarning = null,
): MarketVerdictResult {
  return { key, label: VERDICT_LABEL[key], warning };
}

function applyLimitedDowngrade(
  candidate: MarketVerdict,
  limited: boolean
): MarketVerdictResult {
  // Legacy rule (8) — only the best_angle → lean transition. Other verdicts stay.
  // No warning attached — `marketDataLimited` is a separate signal from
  // the Phase 6B.30E market-context warnings.
  if (limited && candidate === "best_angle") return resolve("lean");
  return resolve(candidate);
}

/**
 * R-16I Phase 1 — Rule 8a. When reviewer warnings (public_smoke or any
 * single fragility flag) fire, the verdict ladder is capped at Watchlist.
 * Best Angle and Lean both downgrade to Watchlist; Watchlist and No Play
 * are unchanged.
 *
 * Phase 6B.30E — the market-context cap stacks here too; either reviewer
 * warning OR market-context cap forces the Watchlist downgrade. The
 * incoming `warning` rides along to the result so the route's copy
 * generator can surface the right text.
 */
function applyWarningCap(
  candidate: MarketVerdict,
  cap: boolean,
  warning: MarketContextWarning = null,
): MarketVerdictResult {
  if (!cap) return resolve(candidate, warning);
  if (candidate === "best_angle" || candidate === "lean") {
    return resolve("watchlist", warning);
  }
  return resolve(candidate, warning);
}

/**
 * Convenience for callers that have raw `ml/ou/nrfi` market keys (used by
 * the existing route's per-market loop). Normalizes legacy "nrfi" / "ou"
 * names to the canonical first_inning / total used by this helper.
 */
export function normalizeMarketKey(
  raw: "ml" | "moneyline" | "ou" | "total" | "nrfi" | "first_inning"
): "moneyline" | "total" | "first_inning" {
  if (raw === "ml" || raw === "moneyline") return "moneyline";
  if (raw === "ou" || raw === "total") return "total";
  return "first_inning";
}

// Re-export Verdict for callers that only import this module.
export type { Verdict };
