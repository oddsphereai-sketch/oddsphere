/**
 * Phase 4.1.8.A — Verdict derivation helper.
 *
 * Pure function mapping {headline grade, per-market confidences} → the
 * product verdict word shown to members on the Daily Edge card.
 *
 * Architecture: verdict is derived client-side at render time, NOT
 * persisted by pickBreakdownGenerator. Grades and confidences are
 * computed by marketSignalDerivationService + gradeDerivationService
 * AFTER the generator runs in the orchestrator (automodelService step 2d
 * precedes the downstream grade-derivation step). Persisting verdict at
 * generator time would always be stale relative to the freshest grade
 * state, especially across morning_draft → t60_locked re-runs. Matches
 * the Phase 4.1.8 D5 decision to derive Full Breakdown client-side.
 *
 * Verdict philosophy (locked Phase 4.1.8 spec):
 *   Best Angle = strongest overall actionable read
 *   Lean       = model likes it, not top-tier
 *   Watchlist  = interesting but not clean enough yet
 *   Caution    = model has a side, but conflict or risk exists
 *   No Play    = true product/model pass only
 *
 * Critical invariant: sharp_conflict ALWAYS maps to Caution whenever
 * the model has a side (i.e. headlineGrade is non-null). The
 * sharp_conflict check is intentionally evaluated BEFORE the confidence
 * floor — a low-confidence sharp_conflict still surfaces as Caution
 * rather than getting hidden as No Play. Daniel's product call:
 * overuse Caution, not No Play. The sharp disagreement is the meaningful
 * member signal ("model picked this, sharps push back") and that
 * signal should never be silenced by a confidence threshold.
 *
 * No Play is reserved for "no useful read at all":
 *   • null headline grade (all 3 markets held/null)
 *   • all non-null per-market confidences below the playable floor
 *     AND headline grade is not sharp_conflict (the conflict warning
 *     wins over the floor by design)
 *   • defensive: non-null grade but every per-market confidence is null
 */

import type { Grade } from "../types/domain/Grade";

export type Verdict =
  | "best_angle"
  | "lean"
  | "watchlist"
  | "caution"
  | "no_play";

/**
 * Confidence floor below which a market is considered "no useful edge."
 * When ALL non-null per-market confidences fall below this floor, the
 * verdict becomes No Play regardless of the headline grade. A single
 * market clearing the floor is enough to keep the row "playable."
 *
 * Locked at 0.53 per Phase 4.1.8.A Sub-D2. Scale is 0..1, matching
 * DailyEdgePredictionDto.confidence (server normalizes the 0..100
 * database column to 0..1 at the API boundary).
 */
export const PLAYABLE_CONFIDENCE_FLOOR = 0.53;

export type PerMarketConfidence = {
  /** Null when the model didn't pick that market. */
  ml: number | null;
  total: number | null;
  nrfi: number | null;
};

export type VerdictInput = {
  /**
   * Headline grade for the row — the strongest per-pick grade with
   * ML → OU → NRFI precedence. Null only when the model picked no
   * market at all (predicted_<market>_* IS NULL across all three).
   */
  headlineGrade: Grade | null;
  /** Per-market model confidences on 0..1 scale. */
  perMarketConfidence: PerMarketConfidence;
};

/**
 * Display labels paired with each verdict enum value. Member-facing
 * wording confirmed in Phase 4.1.8 spec.
 */
export const VERDICT_LABEL: Record<Verdict, string> = {
  best_angle: "Best Angle",
  lean: "Lean",
  watchlist: "Watchlist",
  caution: "Caution",
  no_play: "No Play",
};

export function deriveVerdict(input: VerdictInput): Verdict {
  const { headlineGrade, perMarketConfidence } = input;

  // 1. Null headline grade = all 3 markets are held/null = true No Play.
  if (headlineGrade === null) {
    return "no_play";
  }

  // 2. sharp_conflict ALWAYS maps to Caution when the model has a side.
  //    CRITICAL: this check MUST precede the confidence floor. A low-
  //    confidence sharp_conflict still surfaces as Caution rather than
  //    getting hidden as No Play. Daniel's product call: overuse Caution,
  //    not No Play. Confidence below the floor does NOT silence the
  //    sharp disagreement warning. Anti-regression test #verdict-invariant
  //    locks this ordering.
  if (headlineGrade === "sharp_conflict") {
    return "caution";
  }

  // 3. Confidence floor guardrail (skipped for sharp_conflict above).
  //    Pull non-null confidences only — a held market shouldn't drag down
  //    a non-held one. If every non-null market sits below the floor, no
  //    useful edge exists anywhere → No Play. A single market at-or-above
  //    the floor keeps the row playable; the headline grade then chooses
  //    the verdict word.
  const nonNullConfidences = [
    perMarketConfidence.ml,
    perMarketConfidence.total,
    perMarketConfidence.nrfi,
  ].filter((c): c is number => c !== null);

  if (nonNullConfidences.length === 0) {
    // Defensive: headline grade was non-null but every confidence is null.
    // Shouldn't happen given the framework's atomicity invariants, but
    // treat it as No Play rather than rendering a grade chip with no
    // backing pick.
    return "no_play";
  }

  const maxConfidence = Math.max(...nonNullConfidences);
  if (maxConfidence < PLAYABLE_CONFIDENCE_FLOOR) {
    return "no_play";
  }

  // 4. Grade → verdict mapping for the remaining 6 grades.
  switch (headlineGrade) {
    case "best_signal":
    case "sharp_confirmed":
      return "best_angle";
    case "market_led":
    case "model_only":
      return "lean";
    case "market_watch":
    case "public_smoke":
      return "watchlist";
  }
}
