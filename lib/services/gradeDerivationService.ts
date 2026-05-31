/**
 * gradeDerivationService — synthesize V2.1's 7-category final grade for each
 * prediction in a slate.
 *
 * The grade is the user-facing verdict. It blends Layer 1 (model edge),
 * Layer 3 (market signal — already populated by marketSignalDerivationService),
 * and the pick kind (game vs prop, which sets the edge threshold per V2.1 6.2)
 * into one of seven labels:
 *
 *   best_signal     🔥  Both layers strong + meets best-signal edge threshold
 *   sharp_confirmed ✅  Market confirms model, edge present but below best
 *   market_led      ⚡  Market signal present, no model edge
 *   model_only      📊  Model edge present, market neutral
 *   market_watch    👀  Neither layer convincing
 *   public_smoke    💨  Market sees public chase, no Pinnacle EV
 *   sharp_conflict  ⚠️  Market resistance against model pick
 *
 * Alongside the grade we record a `signal_type` attribution (5 values) so
 * tracking can pivot W/L by signal source without re-deriving from layers.
 *
 * SOURCE OF MODEL EDGE
 *   • Props: prop_predictions.edge_pct (computed by the prop model).
 *   • Games: NO explicit edge column on game_predictions. Pinnacle EV
 *     from sharp_signals.ev_pct serves as the per-market edge proxy.
 *     Looked up per-pick by (game_id, market_type, side) — see V2.1.1
 *     refactor note below.
 *
 * V2.1.1 PER-PICK REFACTOR (Phase 6.3.5b)
 *   Pre-6.3.5b derived a single grade per game_predictions row via ML →
 *   OU → NRFI primary-pick precedence. The refactor:
 *
 *     • For each game_predictions row, derive grade + signal_type
 *       INDEPENDENTLY for each of the 3 markets (ml / ou / nrfi) where
 *       the row has a non-null predicted_<market>_* column. Reads the
 *       per-pick market_signal columns (ml_market_signal, ou_market_signal,
 *       nrfi_market_signal) — populated upstream by
 *       marketSignalDerivationService in the same cron cycle. Markets
 *       with no model pick stay NULL on their per-pick grade columns.
 *     • Writes the 6 per-pick columns added by schema-migration-v13.sql:
 *       ml_grade / ml_signal_type / ou_grade / ou_signal_type /
 *       nrfi_grade / nrfi_signal_type.
 *     • DUAL-WRITE: also populates the legacy `grade` + `signal_type`
 *       columns from the precedence-1 per-pick value (first non-null in
 *       ML → OU → NRFI order). Preserves existing UI behavior bit-for-
 *       bit during the 6.3.5b → 6.3.5f transition; legacy columns are
 *       dropped in a future V14 cleanup commit.
 *     • prop_predictions UNCHANGED — props are per-pick by table shape.
 *
 * BEST-SIGNAL MONITOR (V2.1 6.2 + 6.3.5b pick-count refactor)
 *   After writing a slate, if best_signal share of total derived PICKS
 *   exceeds GRADE_THRESHOLDS.BEST_SIGNAL_SLATE_MONITOR_PCT, we emit a
 *   console.warn. Counts picks across all derivations (ml + ou + nrfi +
 *   props), not games — a stricter bar now that the denominator grew
 *   ~3× post-refactor. No throw; cron keeps running.
 */

import { supabase } from "../db/supabase";
import {
  GRADE_THRESHOLDS,
  SHARP_SIGNAL_THRESHOLDS,
} from "../config/constants";
import type { Sport } from "../types/domain/Sport";
import type { Side } from "../types/domain/Lines";
import type { Grade, MarketSignal, SignalType } from "../types/domain/Grade";
import {
  classifyEvidence,
  tierAtLeast,
  type SignalEvidence,
  type SignalTier,
} from "./signalEvidenceClassifier";
import type { MarketSignalSource } from "./marketSignalDerivationService";

// ─── Public types ─────────────────────────────────────────────────────────

export type GradeKind = "game" | "prop";

export type GradeInput = {
  kind: GradeKind;
  /**
   * Model edge as a percentage. For props this is prop_predictions.edge_pct
   * (model probability vs fair). For games this is the per-market Pinnacle
   * EV from sharp_signals.ev_pct. NULL when the layer doesn't apply.
   */
  modelEdgePct: number | null;
  /**
   * Layer 3 market read, already classified by marketSignalDerivationService.
   * NULL when derivation hasn't run yet — defensive default falls to
   * market_watch (the "neither convincing" verdict).
   */
  marketSignal: MarketSignal | null;
  /**
   * Fix 2.1 (Gap-9): tier-aware per-signal evidence record. The grade engine
   * consumes this to enforce framework rules — most notably the Sharp
   * Conflict bar (§"Sharp Conflict": strong-tier opposing primary signal
   * PLUS confirming opposing secondary).
   *
   * Game picks SHOULD pass evidence; null falls back to the pre-2.1
   * permissive "any market_resistance → sharp_conflict" behavior.
   *
   * Props pass evidence=null per Flag D1 (prop-side tier infrastructure is
   * Gap-12.5 follow-up). Props rarely hit market_resistance in practice —
   * the deferred carve-out is bounded.
   */
  evidence: SignalEvidence | null;
  // ───────────────────────────────────────────────────────────────────────
  // Phase 2 (Daniel-approved Adjustments A + B). All four are OPTIONAL and
  // default to "guardrail fails" semantics. The EV-axis-only paths to
  // best_signal and market_led only fire when callers explicitly supply
  // these fields.
  //
  // V1 NOTE — confidence-edge proxy, NOT final model edge:
  //   `modelConfidence` is the per-pick confidence value already on
  //   game_predictions (ml_confidence / ou_confidence / nrfi_confidence,
  //   each on 0-100 scale). Phase 2 uses (modelConfidence - 50) as a
  //   TEMPORARY proxy for "model edge" because the Phase 3 rule-seeded
  //   auto-model does not yet exist. When Phase 3 lands and supplies a
  //   true per-pick edge metric, these helpers should be revisited.
  // ───────────────────────────────────────────────────────────────────────
  /**
   * Per-pick prediction confidence on a 0-100 scale. When present, the
   * Phase 2 EV-axis helpers compute confidenceEdgeProxy = modelConfidence
   * - 50. NULL/undefined → Adjustment A and B cannot fire.
   */
  modelConfidence?: number | null;
  /**
   * Adjustment A guardrail 4: the probable starter for this pick is
   * confirmed (e.g., BDL `/lineups.is_probable_pitcher` + `is_confirmed`
   * or an explicit operator override). Default false → Adjustment A
   * cannot fire. Phase 3 (auto-model) is expected to populate this from
   * BDL data; in Phase 2 the field stays false for all production
   * callers, keeping Adjustment A structurally inactive until then.
   */
  starterConfirmed?: boolean;
  /**
   * Adjustment A guardrail 3 + Adjustment B guardrail 3: a deterministic
   * upstream warning that OPPOSES the model's pick (e.g., wind-out
   * forecast opposing an Under, scratched probable starter, top-3 hitter
   * scratched). When true, neither EV-axis grade can fire. Default false
   * → guardrail passes by absence; must be explicitly set true when
   * upstream supplies the data.
   */
  opposingDeterministicWarning?: boolean;
  /**
   * Adjustment A guardrail 5: a sportsbook market line is available for
   * the pick (V1 best-effort: sport_specific.listed_line is not null,
   * OR a lines.line_value lookup yields a value). Default false →
   * Adjustment A cannot fire. Phase 3/4 may strengthen this check.
   */
  marketLineAvailable?: boolean;
};

export type GradeOutput = {
  grade: Grade;
  signal_type: SignalType;
};

// ─── Pure derivation ──────────────────────────────────────────────────────

function bestSignalThreshold(kind: GradeKind): number {
  return kind === "game"
    ? GRADE_THRESHOLDS.BEST_SIGNAL_GAME_EDGE
    : GRADE_THRESHOLDS.BEST_SIGNAL_PROP_EDGE;
}

function minEdgeThreshold(kind: GradeKind): number {
  return kind === "game"
    ? GRADE_THRESHOLDS.MIN_GAME_EDGE
    : GRADE_THRESHOLDS.MIN_PROP_EDGE;
}

/**
 * Helper: are there opposing strong-tier signals (any of EV / steam / RLM /
 * sharp_div) that would disqualify an aligned grade? Used by Best Signal,
 * Sharp Confirmed, and Market-Led bars.
 *
 * Fix 3.1 Flag D1: EV at strong+ opposing IS a disqualifier here. This is
 * asymmetric vs the Sharp Conflict bar — and principled: Sharp Conflict
 * requires EV alone to be paired with confirming sharp action (avoid
 * over-flagging); Best Signal / Sharp Confirmed / Market-Led require NO
 * opposing strong signal of ANY kind (avoid over-confidence).
 */
function hasNoOpposingStrongSignals(evidence: SignalEvidence): boolean {
  if (
    evidence.ev !== null &&
    !evidence.ev.aligned &&
    tierAtLeast(evidence.ev.tier, "strong")
  ) {
    return false;
  }
  if (
    evidence.steam !== null &&
    !evidence.steam.aligned &&
    tierAtLeast(evidence.steam.tier, "strong")
  ) {
    return false;
  }
  if (
    evidence.rlm !== null &&
    !evidence.rlm.aligned &&
    tierAtLeast(evidence.rlm.tier, "strong")
  ) {
    return false;
  }
  if (
    evidence.sharpDivergence !== null &&
    !evidence.sharpDivergence.aligned &&
    tierAtLeast(evidence.sharpDivergence.tier, "strong")
  ) {
    return false;
  }
  return true;
}

/**
 * Best Signal bar (Fix 3.1 — Gap-13).
 *
 * Framework reference: SHARP_SIGNAL_FRAMEWORK.md §"Best Signal":
 *   Required (ALL must hold):
 *     • Model edge ≥ +3% (already gated by caller via bestSignalThreshold)
 *     • AT LEAST TWO of: strong/very-strong aligned EV, strong steam,
 *       strong RLM, strong sharp money divergence
 *     • No opposing signals of strong tier (includes EV per Flag D1)
 *
 * Returns true when the evidence meets the framework bar. Conservatism
 * lives in the tier-counting + opposing exclusion. Framework "Should be
 * rare. Member-facing intuition: 'this is the strongest read on the slate.'"
 */
function meetsBestSignalBar(evidence: SignalEvidence): boolean {
  let strongAlignedCount = 0;
  if (
    evidence.ev !== null &&
    evidence.ev.aligned &&
    tierAtLeast(evidence.ev.tier, "strong")
  ) {
    strongAlignedCount++;
  }
  if (
    evidence.steam !== null &&
    evidence.steam.aligned &&
    tierAtLeast(evidence.steam.tier, "strong")
  ) {
    strongAlignedCount++;
  }
  if (
    evidence.rlm !== null &&
    evidence.rlm.aligned &&
    tierAtLeast(evidence.rlm.tier, "strong")
  ) {
    strongAlignedCount++;
  }
  if (
    evidence.sharpDivergence !== null &&
    evidence.sharpDivergence.aligned &&
    tierAtLeast(evidence.sharpDivergence.tier, "strong")
  ) {
    strongAlignedCount++;
  }
  if (strongAlignedCount < 2) return false;
  return hasNoOpposingStrongSignals(evidence);
}

/**
 * Phase 2 Adjustment A — Daniel-approved EV-axis-only path to best_signal.
 *
 * V1 confidence-edge proxy note:
 *   "Model edge" in this helper is a TEMPORARY proxy defined as
 *   (modelConfidence - 50) because the Phase 3 rule-seeded auto-model
 *   does not yet exist. Once Phase 3 supplies a true per-pick edge metric
 *   this helper should be revisited.
 *
 * Bar (ALL six guardrails must hold AND no opposing strong signals):
 *   1. Pinnacle EV aligned at very_strong tier (≥ 5%)
 *   2. confidenceEdgeProxy (modelConfidence - 50) ≥ 3 points
 *   3. No opposing deterministic warning
 *   4. Probable starter confirmed
 *   5. Market line available
 *   6. Model confidence ≥ 60%
 *
 * Defaults are intentionally safe-fail: when callers omit the Phase 2
 * optional fields, the helper returns false and the existing chain
 * (sharp_confirmed → market_led → market_watch) runs as before. This
 * keeps Adjustment A WIRED in V1 but ACTIVE only when upstream supplies
 * the data (Phase 3+ auto-model).
 *
 * Caller order: this helper runs AFTER the primary multi-axis
 * meetsBestSignalBar check in deriveGrade. If both bars pass on the same
 * input, the primary multi-axis bar wins (it fires first).
 */
function meetsBestSignalEvAlone(
  input: GradeInput,
  evidence: SignalEvidence
): boolean {
  // Guardrail 1: EV must be aligned at very_strong tier (≥ 5%).
  if (evidence.ev === null) return false;
  if (!evidence.ev.aligned) return false;
  if (evidence.ev.tier !== "very_strong") return false;

  // Guardrail 2: confidence-edge proxy ≥ 3 points above neutral.
  // Phase 2 V1 proxy — NOT final model edge.
  if (input.modelConfidence === null || input.modelConfidence === undefined) {
    return false;
  }
  const confidenceEdgeProxy = input.modelConfidence - 50;
  if (
    confidenceEdgeProxy <
    GRADE_THRESHOLDS.BEST_SIGNAL_EV_ALONE_CONFIDENCE_EDGE_PROXY_POINTS
  ) {
    return false;
  }

  // Guardrail 3: no opposing deterministic warning.
  if (input.opposingDeterministicWarning === true) return false;

  // Guardrail 4: probable starter confirmed (explicit true required;
  // default false makes the bar fail until upstream supplies the data).
  if (input.starterConfirmed !== true) return false;

  // Guardrail 5: market line available.
  if (input.marketLineAvailable !== true) return false;

  // Guardrail 6: confidence ≥ floor.
  if (
    input.modelConfidence <
    GRADE_THRESHOLDS.BEST_SIGNAL_EV_ALONE_CONFIDENCE_FLOOR_PCT
  ) {
    return false;
  }

  // Defense in depth: reuse the existing opposing-strong-signal check.
  if (!hasNoOpposingStrongSignals(evidence)) return false;

  return true;
}

/**
 * Phase 2 Adjustment B — Daniel-approved EV-axis-only path to market_led.
 *
 * V1 confidence-edge proxy note: same as meetsBestSignalEvAlone above.
 *
 * Bar (ALL four guardrails must hold):
 *   1. Pinnacle EV aligned at strong tier or higher (≥ 3%)
 *   2. confidenceEdgeProxy is "weak/neutral": (modelConfidence - 50) < 3
 *      → fires when the market is moving but the model has no meaningful
 *      conviction. Required so this doesn't double up with sharp_confirmed.
 *   3. No opposing deterministic warning (reuses guardrail field from A)
 *   4. No opposing strong signals (defense in depth)
 *
 * Critical: caller MUST run this BEFORE meetsSharpConfirmedBar in the
 * deriveGrade switch — otherwise a strong aligned EV + weak confidence
 * proxy would route to sharp_confirmed instead of market_led. The
 * `confidenceEdgeProxy < threshold` guardrail makes sure this helper
 * does NOT poach cases that legitimately belong to sharp_confirmed
 * (model has conviction → sharp_confirmed; model is neutral → market_led).
 *
 * Defaults are intentionally safe-fail: when modelConfidence is null,
 * the helper returns false and the existing chain runs as before.
 */
function meetsMarketLedEvAlone(
  input: GradeInput,
  evidence: SignalEvidence
): boolean {
  // Guardrail 1: EV must be aligned at strong tier or higher (≥ 3%).
  if (evidence.ev === null) return false;
  if (!evidence.ev.aligned) return false;
  if (!tierAtLeast(evidence.ev.tier, "strong")) return false;

  // Guardrail 2: confidence-edge proxy is weak/neutral.
  if (input.modelConfidence === null || input.modelConfidence === undefined) {
    return false;
  }
  const confidenceEdgeProxy = input.modelConfidence - 50;
  if (
    confidenceEdgeProxy >=
    GRADE_THRESHOLDS.MARKET_LED_EV_ALONE_CONFIDENCE_EDGE_PROXY_POINTS
  ) {
    return false;
  }

  // Guardrail 3: no opposing deterministic warning.
  if (input.opposingDeterministicWarning === true) return false;

  // Guardrail 4: defense in depth.
  if (!hasNoOpposingStrongSignals(evidence)) return false;

  return true;
}

/**
 * Sharp Confirmed bar (Fix 3.1 — Gap-14).
 *
 * Framework reference: SHARP_SIGNAL_FRAMEWORK.md §"Sharp Confirmed":
 *   Required:
 *     • Model picks the side (gated by caller via hasModelEdge per Flag C1
 *       — keeps the existing ≥1% edge floor; framework's "positive
 *       confidence" wording is more permissive but C1 preserves the
 *       current conservative posture; tracked as Gap-14.5 follow-up)
 *     • AT LEAST ONE strong-tier aligned signal OR AT LEAST TWO
 *       moderate-tier aligned signals
 *     • No opposing strong signals
 */
function meetsSharpConfirmedBar(evidence: SignalEvidence): boolean {
  let strongAlignedCount = 0;
  let moderateAlignedCount = 0;
  const tally = (slot: { tier: SignalTier; aligned: boolean } | null) => {
    if (slot === null || !slot.aligned) return;
    if (tierAtLeast(slot.tier, "strong")) strongAlignedCount++;
    if (tierAtLeast(slot.tier, "moderate")) moderateAlignedCount++;
  };
  tally(evidence.ev);
  tally(evidence.steam);
  tally(evidence.rlm);
  tally(evidence.sharpDivergence);

  const meetsCount = strongAlignedCount >= 1 || moderateAlignedCount >= 2;
  if (!meetsCount) return false;
  return hasNoOpposingStrongSignals(evidence);
}

/**
 * Market-Led bar (Fix 3.1 — Gap-15, v1.1 tightening).
 *
 * Framework reference: SHARP_SIGNAL_FRAMEWORK.md §"Market-Led" v1.1:
 *   "Market-Led should NOT fire on weak or mixed movement. If the market
 *    signal is unclear, conflicting, or below strong tier, use Market
 *    Watch instead."
 *
 * Required:
 *   • AT LEAST ONE strong-tier aligned signal (any of EV / steam / RLM /
 *     sharp_div)
 *   • No opposing strong signals
 *
 * Caller enters this branch only when there's no model edge (hasModelEdge
 * is false) — Market-Led is "market alone." A strong-tier aligned signal
 * is what makes the market "loud and decisive."
 */
function meetsMarketLedBar(evidence: SignalEvidence): boolean {
  const hasStrongAligned =
    (evidence.ev !== null &&
      evidence.ev.aligned &&
      tierAtLeast(evidence.ev.tier, "strong")) ||
    (evidence.steam !== null &&
      evidence.steam.aligned &&
      tierAtLeast(evidence.steam.tier, "strong")) ||
    (evidence.rlm !== null &&
      evidence.rlm.aligned &&
      tierAtLeast(evidence.rlm.tier, "strong")) ||
    (evidence.sharpDivergence !== null &&
      evidence.sharpDivergence.aligned &&
      tierAtLeast(evidence.sharpDivergence.tier, "strong"));
  if (!hasStrongAligned) return false;
  return hasNoOpposingStrongSignals(evidence);
}

/**
 * Model Only bar (Fix 3.1 — Gap-16).
 *
 * Framework reference: SHARP_SIGNAL_FRAMEWORK.md §"Model Only":
 *   Required:
 *     • Model edge ≥ +2% or model confidence ≥ 58% (caller-gated via
 *       hasModelEdge; current MIN_GAME_EDGE=1 retained per Flag H1,
 *       tracked as Gap-16.5 follow-up)
 *     • No signal at moderate or stronger tier in any of the five inputs
 *     • Market is silent; model speaks alone
 *
 * The bar checks BOTH aligned and opposing for moderate+ signals — "any
 * direction" per framework. publicSmoke fires at moderate-equivalent
 * intensity and also disqualifies (the model is "alone" only when the
 * market is fully silent).
 */
function meetsModelOnlyBar(evidence: SignalEvidence): boolean {
  if (evidence.ev !== null && tierAtLeast(evidence.ev.tier, "moderate")) {
    return false;
  }
  if (evidence.steam !== null && tierAtLeast(evidence.steam.tier, "moderate")) {
    return false;
  }
  if (evidence.rlm !== null && tierAtLeast(evidence.rlm.tier, "moderate")) {
    return false;
  }
  if (
    evidence.sharpDivergence !== null &&
    tierAtLeast(evidence.sharpDivergence.tier, "moderate")
  ) {
    return false;
  }
  if (evidence.publicSmoke !== null) return false;
  return true;
}

/**
 * Public Smoke bar (Fix 3.1 — Gap-17).
 *
 * Framework reference: SHARP_SIGNAL_FRAMEWORK.md §"Public Smoke":
 *   Required:
 *     • All public smoke detection criteria met (Signal 5)
 *     • Model picks the public side (otherwise this signal is supportive,
 *       not cautionary)
 *
 * Returns true when publicSmoke fires AND model aligns with the public
 * side. When model fades public, the underlying public_smoke detection is
 * actually a positive signal for our pick — framework routes to
 * market_watch, not public_smoke grade.
 */
function meetsPublicSmokeBar(evidence: SignalEvidence): boolean {
  return evidence.publicSmoke !== null && evidence.publicSmoke.aligned;
}

/**
 * Sharp Conflict bar (Fix 2.1 — Gap-12).
 *
 * Framework reference: SHARP_SIGNAL_FRAMEWORK.md §"Sharp Conflict":
 *   Required conditions (ALL must hold):
 *     • Model picks one side
 *     • OPPOSING signal at strong tier from AT LEAST ONE of:
 *         - Steam ≥ 3 books opposing
 *         - RLM clearly opposing
 *         - Sharp money divergence ≥ 15pp opposing
 *     • PLUS at least one confirming opposing indicator (typically EV
 *       opposing at moderate+ tier)
 *
 *   Critical carve-out: "Pinnacle EV opposing alone does NOT trigger
 *   Sharp Conflict. It triggers Market Watch."
 *
 *   Edge case (§"Edge Case Handling — Single signal at 'very strong' tier"):
 *     A single very-strong opposing primary signal (steam 5+, RLM ≥70%
 *     public, sharp_div ≥25pp) suffices alone. EV at very_strong does NOT
 *     trigger alone — the EV-alone carve-out wins over the very-strong-
 *     alone allowance.
 *
 * Returns true when the evidence meets the framework bar for Sharp Conflict.
 * Caller routes market_resistance → sharp_conflict on true, → market_watch
 * on false. Evidence=null bypasses the bar (legacy / prop-side behavior).
 */
function meetsSharpConflictBar(evidence: SignalEvidence | null): boolean {
  if (evidence === null) return false;

  // Opposing signals (signal exists and is on the side opposite to the model)
  const evOpposing = evidence.ev !== null && !evidence.ev.aligned;
  const steamOpposing = evidence.steam !== null && !evidence.steam.aligned;
  const rlmOpposing = evidence.rlm !== null && !evidence.rlm.aligned;
  const sdOpposing =
    evidence.sharpDivergence !== null && !evidence.sharpDivergence.aligned;

  // Very-strong opposing PRIMARY (steam / RLM / sharp_div, NOT EV) suffices
  // alone per framework §"Edge Case Handling". EV at very_strong is excluded
  // by the explicit "EV alone" carve-out.
  if (steamOpposing && evidence.steam!.tier === "very_strong") return true;
  if (rlmOpposing && evidence.rlm!.tier === "very_strong") return true;
  if (sdOpposing && evidence.sharpDivergence!.tier === "very_strong") return true;

  // Strong-tier opposing primary (one of steam/RLM/sharp_div at strong+).
  // EV is never primary per framework — it's the typical secondary.
  const hasStrongPrimary =
    (steamOpposing && tierAtLeast(evidence.steam!.tier, "strong")) ||
    (rlmOpposing && tierAtLeast(evidence.rlm!.tier, "strong")) ||
    (sdOpposing && tierAtLeast(evidence.sharpDivergence!.tier, "strong"));

  if (!hasStrongPrimary) return false;

  // Confirming secondary: AT LEAST ONE OTHER opposing signal at moderate+
  // tier. Count distinct opposing moderate+ signals; need ≥2 to satisfy
  // "primary + secondary". (A single strong opposing primary alone counts
  // as 1; we need a different signal type at moderate+ for the +1.)
  let opposingModeratePlusCount = 0;
  if (evOpposing && tierAtLeast(evidence.ev!.tier, "moderate")) {
    opposingModeratePlusCount++;
  }
  if (steamOpposing && tierAtLeast(evidence.steam!.tier, "moderate")) {
    opposingModeratePlusCount++;
  }
  if (rlmOpposing && tierAtLeast(evidence.rlm!.tier, "moderate")) {
    opposingModeratePlusCount++;
  }
  if (sdOpposing && tierAtLeast(evidence.sharpDivergence!.tier, "moderate")) {
    opposingModeratePlusCount++;
  }
  return opposingModeratePlusCount >= 2;
}

/**
 * Classify ONE pick into a final grade + signal_type attribution. Pure
 * function — no I/O. Single-pass decision tree, priority by branch order.
 *
 * Fix 2.1 (Gap-12): `market_resistance` branch now consults the Sharp
 * Conflict bar via `meetsSharpConflictBar(evidence)`. Pre-fix any
 * market_resistance escalated to sharp_conflict; post-fix, only the
 * framework-confirmed shape (strong-tier opposing primary + confirming
 * secondary, OR single very-strong opposing primary) earns sharp_conflict.
 * Unconfirmed market_resistance (e.g., EV-only opposing) routes to
 * market_watch per framework §"Sharp Conflict" carve-out.
 */
export function deriveGrade(input: GradeInput): GradeOutput {
  const { kind, modelEdgePct, marketSignal, evidence } = input;
  const hasModelEdge =
    modelEdgePct !== null && modelEdgePct >= minEdgeThreshold(kind);
  const bestThreshold = bestSignalThreshold(kind);

  // Defensive fallback for NULL marketSignal — grade engine ran before
  // marketSignalDerivationService had a chance, or signal was never derived.
  if (marketSignal === null) {
    return { grade: "market_watch", signal_type: "balanced" };
  }

  switch (marketSignal) {
    case "steam_alert":
    case "market_confirmed": {
      // Fix 3.1 (Gap-13/14/15): tier-aware bars decide between Best Signal,
      // Sharp Confirmed, Market-Led, and the conservative Market Watch
      // fallback. Evidence-null bypass keeps legacy permissive behavior
      // for props (Flag D1 carry-over from Fix 2.1).
      if (evidence === null) {
        if (hasModelEdge && (modelEdgePct as number) >= bestThreshold) {
          return { grade: "best_signal", signal_type: "balanced" };
        }
        if (hasModelEdge) {
          return { grade: "sharp_confirmed", signal_type: "balanced" };
        }
        return { grade: "market_led", signal_type: "market_only" };
      }
      // Primary best_signal bar — multi-axis ≥ 2 strong-tier aligned.
      if (
        hasModelEdge &&
        (modelEdgePct as number) >= bestThreshold &&
        meetsBestSignalBar(evidence)
      ) {
        return { grade: "best_signal", signal_type: "balanced" };
      }
      // Phase 2 Adjustment A — Daniel-approved EV-axis-only secondary
      // path to best_signal. Safe-by-default: all 6 guardrails must
      // pass (incl. starterConfirmed + marketLineAvailable, which
      // default false until Phase 3+ supplies upstream data).
      if (meetsBestSignalEvAlone(input, evidence)) {
        return { grade: "best_signal", signal_type: "balanced" };
      }
      // Phase 2 Adjustment B — Daniel-approved EV-axis-only path to
      // market_led. MUST run BEFORE meetsSharpConfirmedBar so a strong
      // aligned EV + weak confidence-edge proxy routes to market_led
      // instead of being absorbed by sharp_confirmed. The "weak/neutral"
      // guardrail (confidenceEdgeProxy < 3) protects cases that
      // legitimately belong to sharp_confirmed (model has conviction).
      if (meetsMarketLedEvAlone(input, evidence)) {
        return { grade: "market_led", signal_type: "market_only" };
      }
      if (hasModelEdge && meetsSharpConfirmedBar(evidence)) {
        return { grade: "sharp_confirmed", signal_type: "balanced" };
      }
      if (meetsMarketLedBar(evidence)) {
        return { grade: "market_led", signal_type: "market_only" };
      }
      // None of the bars passed — framework's conservative default.
      return { grade: "market_watch", signal_type: "balanced" };
    }

    case "market_resistance": {
      // Fix 2.1 (Gap-12): tier-aware Sharp Conflict bar. Evidence-null
      // path (props per Flag D1, or pre-2.1 callers) bypasses the bar
      // and keeps the legacy permissive behavior.
      if (evidence === null || meetsSharpConflictBar(evidence)) {
        return {
          grade: "sharp_conflict",
          signal_type: hasModelEdge ? "balanced" : "market_only",
        };
      }
      // Opposing signal exists but doesn't meet the strong-primary +
      // confirming-secondary bar — framework routes to Market Watch.
      // signal_type "balanced" matches the existing market_watch case
      // per Flag H1 (no new SignalType union value).
      return { grade: "market_watch", signal_type: "balanced" };
    }

    case "public_smoke": {
      // Fix 3.1 (Gap-17): public_smoke grade fires only when the model picks
      // the public side. Model fading public → publicSmoke not aligned →
      // bar fails → market_watch (the underlying public_smoke read is
      // actually supportive of our pick, not cautionary, per framework).
      // Evidence-null bypass for props.
      if (evidence === null || meetsPublicSmokeBar(evidence)) {
        return { grade: "public_smoke", signal_type: "market_only" };
      }
      return { grade: "market_watch", signal_type: "balanced" };
    }

    case "market_neutral": {
      // Fix 3.1 (Gap-16): Model Only requires the market to be silent —
      // no moderate+ signals in any direction. Evidence-null bypass keeps
      // legacy permissive behavior for props.
      if (evidence === null) {
        if (hasModelEdge) {
          return { grade: "model_only", signal_type: "model_only" };
        }
        return { grade: "market_watch", signal_type: "balanced" };
      }
      if (hasModelEdge && meetsModelOnlyBar(evidence)) {
        return { grade: "model_only", signal_type: "model_only" };
      }
      return { grade: "market_watch", signal_type: "balanced" };
    }

    default: {
      // Type-system safety net — should be unreachable given the union.
      return { grade: "market_watch", signal_type: "balanced" };
    }
  }
}

// ─── Batch derivation over a slate ────────────────────────────────────────

type GamePredRow = {
  id: number;
  game_id: number | null;
  predicted_ml_winner: "home" | "away" | null;
  predicted_ou_side: "over" | "under" | null;
  predicted_nrfi: boolean | null;
  /**
   * V13 per-pick market_signal columns — populated upstream by
   * marketSignalDerivationService in the same cron cycle. gradeDerivation
   * reads these directly (NOT the legacy market_signal column) so each
   * market's grade derives against its own market read.
   */
  ml_market_signal: MarketSignal | null;
  ou_market_signal: MarketSignal | null;
  nrfi_market_signal: MarketSignal | null;
  // Phase 2: per-pick confidence values from the prediction. Used by the
  // EV-axis-only paths to best_signal / market_led as a TEMPORARY proxy
  // for "model edge" (confidenceEdgeProxy = confidence - 50). V1-only;
  // Phase 3 auto-model will eventually supply a true per-pick edge.
  ml_confidence: number | null;
  ou_confidence: number | null;
  nrfi_confidence: number | null;
  // Phase 2: sport_specific JSONB holds operator-supplied extras including
  // (MLB) listed_line — the best-effort source for `marketLineAvailable`
  // until Phase 4 wires a proper lines-table lookup.
  sport_specific: Record<string, unknown> | null;
};

type PropPredRow = {
  id: number;
  game_id: number | null;
  prop_market: string;
  edge_pct: number | null;
  market_signal: MarketSignal | null;
};

/**
 * Sharp signal row shape needed by the grade engine. Fix 2.1 (Gap-9)
 * widens this from just (side, ev_pct) to the full evidence-bearing field
 * set so classifyEvidence can tier every signal axis (EV, steam, RLM,
 * sharp money divergence, public smoke).
 */
type SharpSignalEvRow = {
  game_id: number;
  market_type: string;
  side: string;
  is_plus_ev: boolean | null;
  ev_pct: number | null;
  has_steam_move: boolean | null;
  steam_books_count: number | null;
  has_reverse_line_movement: boolean | null;
  rlm_direction: string | null;
  public_betting_pct: number | null;
  public_money_pct: number | null;
};

/**
 * Project a sharp_signals row into the MarketSignalSource shape consumed
 * by classifyEvidence. Mirrors the normalizer in marketSignalDerivation
 * service — boolean DEFAULTs FALSE, nullable numerics stay nullable.
 */
function toEvidenceSource(row: SharpSignalEvRow): MarketSignalSource {
  return {
    side: row.side as Side,
    is_plus_ev: row.is_plus_ev ?? false,
    ev_pct: row.ev_pct,
    has_steam_move: row.has_steam_move ?? false,
    steam_books_count: row.steam_books_count,
    has_reverse_line_movement: row.has_reverse_line_movement ?? false,
    rlm_direction: row.rlm_direction,
    public_betting_pct: row.public_betting_pct,
    public_money_pct: row.public_money_pct,
  };
}

/** The three game markets that get per-pick derivation. */
type GameMarketKey = "ml" | "ou" | "nrfi";
const GAME_MARKET_KEYS: readonly GameMarketKey[] = ["ml", "ou", "nrfi"];

/**
 * For a game_predictions row, project each per-market pick info needed for
 * grade derivation (the side to look up ev_pct for, plus the per-pick
 * market_signal already on the row). Returns null for markets where the
 * model didn't pick — those stay NULL across all per-pick columns.
 */
function picksFromRow(row: GamePredRow): Record<
  GameMarketKey,
  { market: string; side: Side; marketSignal: MarketSignal | null } | null
> {
  return {
    // Triplet-atomicity gate (per pre-existing per-pick invariant test):
    //   Grade derivation requires BOTH a model pick (predicted_<market>)
    //   AND the market-signal column populated. When market_signal is
    //   null — whether legitimately (no sharp data exists for that game)
    //   or transiently (race during morning-card ingest/derive sequence
    //   where the new pick's market_signal hasn't been written yet) —
    //   produce no grade entry. That keeps the on-disk (grade,
    //   signal_type, market_signal) triplet atomic: either all three
    //   columns null together, or all three populated together. The
    //   alternative — letting deriveGrade fall through to "market_watch"
    //   on null marketSignal — produces a partial triplet that violates
    //   the invariant the daily-edge route's atomicity test enforces.
    ml:
      row.predicted_ml_winner !== null && row.ml_market_signal !== null
        ? {
            market: "moneyline",
            side: row.predicted_ml_winner,
            marketSignal: row.ml_market_signal,
          }
        : null,
    ou:
      row.predicted_ou_side !== null && row.ou_market_signal !== null
        ? {
            market: "total",
            side: row.predicted_ou_side,
            marketSignal: row.ou_market_signal,
          }
        : null,
    nrfi:
      row.predicted_nrfi !== null && row.nrfi_market_signal !== null
        ? {
            market: "first_inning_total",
            side: row.predicted_nrfi ? "under" : "over",
            marketSignal: row.nrfi_market_signal,
          }
        : null,
  };
}

/**
 * Lookup key for sharp_signals.ev_pct — V2.1.1 fix (Phase 6.3.5e-fix):
 * keyed by (game_id, market) only. The pure function and the
 * edgeForModelSide helper compare signal.side vs modelSide internally.
 */
function evKey(game_id: number, market: string): string {
  return `${game_id}:${market}`;
}

/**
 * Return the model's edge from a sharp_signals row. When the signal's side
 * matches the model's pick, return ev_pct (Pinnacle agrees with our pick).
 * When the signal's side opposes, return null — Pinnacle's EV is on the
 * OTHER side, which means our pick has negative implied edge, but we
 * conservatively decline to extrapolate inverse EV and treat it as "no
 * edge data on our side." The grade engine's null-edge branch handles it.
 */
function edgeForModelSide(
  signal: SharpSignalEvRow | undefined,
  modelSide: Side
): number | null {
  if (!signal) return null;
  if (signal.side !== modelSide) return null;
  return signal.ev_pct;
}

export type SlateGrades = {
  /**
   * Per-pick grades indexed by game_prediction.id. Rows where the model
   * didn't pick a side for a market are ABSENT from that market's inner Map.
   *
   * V2.1.1 (Phase 6.3.5e): the previous `gamesLegacy` Map was removed
   * along with dual-write to the legacy game_predictions.grade /
   * signal_type columns. Consumers that need a row-level "headline"
   * grade derive it client-side (perPickHeadline.ts).
   */
  games: {
    ml: Map<number, GradeOutput>;
    ou: Map<number, GradeOutput>;
    nrfi: Map<number, GradeOutput>;
  };
  props: Map<number, GradeOutput>;
};

/**
 * Read the slate's predictions + sharp signals from the DB and derive
 * grade + signal_type for every (row × market) combination that has a
 * model pick. Pure-ish (only DB reads); does not write.
 */
export async function deriveGradesForSlate(
  sport: Sport,
  slate_date: string
): Promise<SlateGrades> {
  const { data: games } = await supabase
    .from("games")
    .select("id")
    .eq("sport", sport)
    .eq("slate_date", slate_date);
  const gameIds = ((games ?? []) as Array<{ id: number }>).map((g) => g.id);
  const empty: SlateGrades = {
    games: { ml: new Map(), ou: new Map(), nrfi: new Map() },
    props: new Map(),
  };
  if (gameIds.length === 0) return empty;

  // Reads PER-PICK ml_market_signal / ou_market_signal / nrfi_market_signal
  // columns. The legacy market_signal column is NOT read — gradeDerivation
  // pairs each market's grade with its OWN market read.
  //
  // Phase 2 additions: per-pick confidence values + sport_specific JSONB
  // are now selected so the EV-axis-only grade helpers can compute the
  // confidence-edge proxy and check listed_line availability.
  const { data: gamePredsRaw } = await supabase
    .from("game_predictions")
    .select(
      "id, game_id, predicted_ml_winner, predicted_ou_side, predicted_nrfi, ml_market_signal, ou_market_signal, nrfi_market_signal, ml_confidence, ou_confidence, nrfi_confidence, sport_specific"
    )
    .in("game_id", gameIds);
  const gamePreds = (gamePredsRaw ?? []) as unknown as GamePredRow[];

  const { data: propsRaw } = await supabase
    .from("prop_predictions")
    .select("id, game_id, prop_market, edge_pct, market_signal")
    .in("game_id", gameIds);
  const propPreds = (propsRaw ?? []) as PropPredRow[];

  // Index sharp_signals by (game_id, market). Fix 2.1 (Gap-9) widens the
  // SELECT to include every evidence field — classifyEvidence needs them
  // to tier each signal axis for the Sharp Conflict bar.
  const { data: signalsRaw } = await supabase
    .from("sharp_signals")
    .select(
      "game_id, market_type, side, is_plus_ev, ev_pct, has_steam_move, steam_books_count, has_reverse_line_movement, rlm_direction, public_betting_pct, public_money_pct"
    )
    .in("game_id", gameIds);
  const evByKey = new Map<string, SharpSignalEvRow>();
  for (const row of (signalsRaw ?? []) as SharpSignalEvRow[]) {
    evByKey.set(evKey(row.game_id, row.market_type), row);
  }

  const result: SlateGrades = {
    games: { ml: new Map(), ou: new Map(), nrfi: new Map() },
    props: new Map(),
  };

  for (const row of gamePreds) {
    if (row.game_id === null) continue;
    const picks = picksFromRow(row);

    // Phase 2: best-effort listed_line check from sport_specific JSONB.
    // V1 only — Phase 3/4 may strengthen with a lines table lookup.
    const sportSpecific = row.sport_specific as {
      listed_line?: unknown;
      starter_confirmed?: unknown;
      opposing_deterministic_warning?: unknown;
    } | null;

    const listedLineRaw = sportSpecific?.listed_line;
    const marketLineAvailable = typeof listedLineRaw === "number";

    // Phase 3B framework patch — read the new Phase 3 hint fields
    // defensively. Manual rows (which do not write these keys) keep
    // the previous Phase 2 behavior because both default to `false`.
    // Auto-model rows from Phase 3C+ will populate these explicitly.
    const starterConfirmed = sportSpecific?.starter_confirmed === true;
    const opposingDeterministicWarning =
      sportSpecific?.opposing_deterministic_warning === true;

    for (const key of GAME_MARKET_KEYS) {
      const pick = picks[key];
      if (pick === null) continue;
      // 6.3.5e-fix: look up by (game_id, market); edgeForModelSide attributes
      // EV only when signal.side matches modelSide, returning null when
      // opposing (Pinnacle's EV is on the other side from our pick).
      const sig = evByKey.get(evKey(row.game_id, pick.market));
      const modelEdgePct = edgeForModelSide(sig, pick.side);
      // Fix 2.1 (Gap-9): build tier-aware evidence for the grade engine's
      // Sharp Conflict bar. classifyEvidence handles null signals cleanly.
      const evidence = classifyEvidence(
        pick.side,
        sig ? toEvidenceSource(sig) : null
      );
      // Phase 2: per-pick confidence routed to the EV-axis helpers as a
      // confidence-edge proxy. Phase 3B: starterConfirmed +
      // opposingDeterministicWarning are now sourced from
      // sport_specific (defaults preserve manual-row Phase 2 behavior).
      // Adjustment A's `starterConfirmed=true` guardrail can fire once
      // an auto-model writes the field; manual rows continue to behave
      // exactly as in Phase 2.
      const modelConfidence =
        key === "ml"
          ? row.ml_confidence
          : key === "ou"
            ? row.ou_confidence
            : row.nrfi_confidence;
      result.games[key].set(
        row.id,
        deriveGrade({
          kind: "game",
          modelEdgePct,
          marketSignal: pick.marketSignal,
          evidence,
          modelConfidence,
          starterConfirmed,
          opposingDeterministicWarning,
          marketLineAvailable,
        })
      );
    }
  }

  for (const row of propPreds) {
    if (row.game_id === null) continue;
    // Props pass evidence=null per Fix 2.1 Flag D1 — prop-side tier
    // infrastructure is Gap-12.5 follow-up. The market_resistance branch
    // in deriveGrade bypasses the Sharp Conflict bar when evidence is null
    // and keeps legacy permissive behavior on props.
    result.props.set(
      row.id,
      deriveGrade({
        kind: "prop",
        modelEdgePct: row.edge_pct,
        marketSignal: row.market_signal,
        evidence: null,
      })
    );
  }

  return result;
}

// ─── Best-signal slate monitor ────────────────────────────────────────────

export type BestSignalMonitor = {
  /**
   * Total derived picks across ml + ou + nrfi (skipping NULLs where the
   * model had no pick) plus props. Replaces the pre-6.3.5b "total games"
   * count; denominator grew ~3× post-refactor.
   */
  totalDerivedPicks: number;
  /** Count of picks classified as best_signal across all 4 buckets. */
  bestSignalPicks: number;
  bestSignalPct: number;
  exceededThreshold: boolean;
  /**
   * Per-market sub-counts on games (props are folded into totals but not
   * split here — props are already per-pick by shape and don't have a
   * three-way market breakdown like games do).
   */
  perMarket: {
    ml: { derived: number; bestSignals: number };
    ou: { derived: number; bestSignals: number };
    nrfi: { derived: number; bestSignals: number };
  };
};

/**
 * Inspect a graded slate for the V2.1 6.2 "Best Signal" sanity check.
 * Emits a console.warn when best_signal share of derived PICKS exceeds
 * GRADE_THRESHOLDS.BEST_SIGNAL_SLATE_MONITOR_PCT. Caller decides whether
 * to escalate further (V1: log only).
 */
export function monitorBestSignalShare(
  grades: SlateGrades,
  context: string
): BestSignalMonitor {
  function countMarket(map: Map<number, GradeOutput>): {
    derived: number;
    bestSignals: number;
  } {
    let bestSignals = 0;
    for (const out of map.values()) {
      if (out.grade === "best_signal") bestSignals++;
    }
    return { derived: map.size, bestSignals };
  }

  const ml = countMarket(grades.games.ml);
  const ou = countMarket(grades.games.ou);
  const nrfi = countMarket(grades.games.nrfi);
  const props = countMarket(grades.props);

  const totalDerivedPicks = ml.derived + ou.derived + nrfi.derived + props.derived;
  const bestSignalPicks =
    ml.bestSignals + ou.bestSignals + nrfi.bestSignals + props.bestSignals;
  const bestSignalPct =
    totalDerivedPicks === 0 ? 0 : (bestSignalPicks / totalDerivedPicks) * 100;
  const exceededThreshold =
    bestSignalPct > GRADE_THRESHOLDS.BEST_SIGNAL_SLATE_MONITOR_PCT;

  if (exceededThreshold) {
    console.warn(
      `[gradeDerivationService] Best Signal: ${bestSignalPicks}/${totalDerivedPicks} picks (${bestSignalPct.toFixed(
        1
      )}%) on ${context} — review thresholds if persistent. ` +
        `perMarket: ml=${ml.bestSignals}/${ml.derived} · ou=${ou.bestSignals}/${ou.derived} · nrfi=${nrfi.bestSignals}/${nrfi.derived}`
    );
  }

  return {
    totalDerivedPicks,
    bestSignalPicks,
    bestSignalPct,
    exceededThreshold,
    perMarket: { ml, ou, nrfi },
  };
}

// ─── DB write — per-row dual-write ────────────────────────────────────────

export type UpdateGradesResult = {
  /** Distinct game_predictions rows updated. Each row may carry up to 8
   * column writes (3 per-pick grade + 3 per-pick signal_type + legacy
   * grade + legacy signal_type). */
  gamePredictionsUpdated: number;
  propPredictionsUpdated: number;
  monitor: BestSignalMonitor;
  /** Per-market write counts for cron-status visibility. */
  perMarket: {
    ml: { derived: number; written: number };
    ou: { derived: number; written: number };
    nrfi: { derived: number; written: number };
  };
};

/**
 * Apply derived grades + signal_types to game_predictions + prop_predictions.
 * game_predictions uses per-row UPDATEs (one statement per row touching up
 * to 6 columns — 3 per-pick grade + 3 per-pick signal_type). prop_predictions
 * retains bucketed UPDATEs grouped by (grade, signal_type).
 *
 * V2.1.1 (Phase 6.3.5e): the legacy game_predictions.grade + signal_type
 * columns are no longer written. Headline derivation moved to the client
 * (perPickHeadline.ts). Legacy DB columns are orphaned post-6.3.5e —
 * V14 cleanup migration drops them.
 */
export async function updateGradesForSlate(
  sport: Sport,
  slate_date: string
): Promise<UpdateGradesResult> {
  const slate = await deriveGradesForSlate(sport, slate_date);
  const monitor = monitorBestSignalShare(slate, `${sport}/${slate_date}`);

  const perMarket = {
    ml: { derived: slate.games.ml.size, written: 0 },
    ou: { derived: slate.games.ou.size, written: 0 },
    nrfi: { derived: slate.games.nrfi.size, written: 0 },
  };

  // Build the universe of game_prediction.ids that received ANY per-pick
  // derivation. Rows in this set get one UPDATE setting up to 6 per-pick
  // columns; absent rows stay NULL everywhere.
  const allIds = new Set<number>([
    ...slate.games.ml.keys(),
    ...slate.games.ou.keys(),
    ...slate.games.nrfi.keys(),
  ]);

  let gamesUpdated = 0;
  for (const id of allIds) {
    const ml = slate.games.ml.get(id) ?? null;
    const ou = slate.games.ou.get(id) ?? null;
    const nrfi = slate.games.nrfi.get(id) ?? null;

    const { error } = await supabase
      .from("game_predictions")
      .update({
        ml_grade: ml?.grade ?? null,
        ml_signal_type: ml?.signal_type ?? null,
        ou_grade: ou?.grade ?? null,
        ou_signal_type: ou?.signal_type ?? null,
        nrfi_grade: nrfi?.grade ?? null,
        nrfi_signal_type: nrfi?.signal_type ?? null,
      })
      .eq("id", id);
    if (error) {
      throw new Error(
        `gradeDerivationService: game_predictions update failed for id=${id}: ${error.message}`
      );
    }
    gamesUpdated++;
    if (ml !== null) perMarket.ml.written++;
    if (ou !== null) perMarket.ou.written++;
    if (nrfi !== null) perMarket.nrfi.written++;
  }

  // Props — bucket by (grade, signal_type) tuple as before.
  type Bucket = { grade: Grade; signal_type: SignalType; ids: number[] };
  const propBuckets = new Map<string, Bucket>();
  for (const [id, out] of slate.props.entries()) {
    const key = `${out.grade}::${out.signal_type}`;
    const existing = propBuckets.get(key);
    if (existing) {
      existing.ids.push(id);
    } else {
      propBuckets.set(key, {
        grade: out.grade,
        signal_type: out.signal_type,
        ids: [id],
      });
    }
  }

  let propsUpdated = 0;
  for (const bucket of propBuckets.values()) {
    const { error } = await supabase
      .from("prop_predictions")
      .update({ grade: bucket.grade, signal_type: bucket.signal_type })
      .in("id", bucket.ids);
    if (error) {
      throw new Error(
        `gradeDerivationService: prop_predictions update failed for ${bucket.grade}/${bucket.signal_type}: ${error.message}`
      );
    }
    propsUpdated += bucket.ids.length;
  }

  return {
    gamePredictionsUpdated: gamesUpdated,
    propPredictionsUpdated: propsUpdated,
    monitor,
    perMarket,
  };
}

// Re-export the constants the service uses so tests can read thresholds
// from one place instead of importing config separately.
export { GRADE_THRESHOLDS, SHARP_SIGNAL_THRESHOLDS };
