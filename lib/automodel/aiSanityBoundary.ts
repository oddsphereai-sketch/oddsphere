/**
 * Phase 3A — AI sanity boundary.
 *
 * Two responsibilities:
 *   1. `applyDeterministicGuards` — production-blocking, ALWAYS-run
 *      deterministic invariants. Cannot be bypassed by AI verdict.
 *      Phase 3A defines and enforces these guards entirely.
 *   2. `reviewAutoModelOutput` — the reserved function boundary for
 *      future AI review. Phase 3A V1 is a stub that returns
 *      `action: "approve"` with no adjustments. Real AI review is a
 *      Pre-launch V1.1 candidate (per Daniel's launch-deferral
 *      framing).
 *
 * Pure code: no DB, no network, no service imports.
 *
 * V1 NOTE — AI sanity is NOT a "blind approve":
 *   The deterministic guards run on EVERY model output regardless of
 *   AI verdict. They catch:
 *     - predicted_total ≠ home + away   → recompute total
 *     - ML winner doesn't match higher score → null the ML pick
 *     - O/U pick present without market line → null the OU pick
 *     - confidence < 51 → null the pick
 *     - missing/scratched starter at T-60 → null official picks
 *   The stub returns "approve" for the AI portion only. The guards
 *   protect production correctness.
 */

import type {
  AutoModelOutput,
  GameSnapshot,
  ModelStage,
  AiSanityRecord,
} from "./types";
import { HARD_CONFIDENCE_FLOOR } from "./types";

// ─────────────────────────────────────────────────────────────
// AI sanity boundary contract (V1 stub)
// ─────────────────────────────────────────────────────────────

/**
 * Inputs the future AI reviewer will consume. Phase 3A defines the
 * contract; Phase 3B service builds and passes the input; the V1.1
 * AI implementation reads it.
 */
export type AiSanityInput = {
  game_external_id: number;
  prediction: AutoModelOutput;
  snapshot: GameSnapshot;
  stage: ModelStage;
};

/**
 * Verdict shape. V1 stub returns "approve" only. Real AI may return
 * any of the four actions:
 *   approve — apply adjustments (within bounded clamps) and write
 *   warn    — same as approve but logs a warning
 *   hold    — set held=true, hold_reason=reasoning, do not publish
 *   rerun   — skip writing, retry next cron cycle
 *
 * Hard guards enforced at the call site (Phase 3B service):
 *   - confidence_delta clamped to ±AI_CONFIDENCE_DELTA_BOUND (10)
 *   - score_delta clamped to ±AI_SCORE_DELTA_BOUND (0.3)
 *   - NEVER flip pick winner/side based on adjustments
 *   - NEVER publish confidence < 51 after adjustments
 *   - NEVER modify prediction_source
 */
export type AiSanityVerdict = {
  action: "approve" | "warn" | "hold" | "rerun";
  reasoning: string;
  adjustments: {
    confidence_delta: number;
    score_delta_home: number;
    score_delta_away: number;
  } | null;
  warnings: string[];
};

/**
 * V1 stub. Always returns approve with no adjustments.
 *
 * The deterministic guards (see `applyDeterministicGuards`) run
 * independently and unconditionally — production correctness does not
 * depend on this function doing anything in V1.
 */
export async function reviewAutoModelOutput(
  _input: AiSanityInput
): Promise<AiSanityVerdict> {
  return {
    action: "approve",
    reasoning:
      "V1: AI sanity layer disabled — Phase 3A stub returns approve. Real AI review is a Pre-launch V1.1 candidate.",
    adjustments: null,
    warnings: [],
  };
}

// ─────────────────────────────────────────────────────────────
// Deterministic guards — ALWAYS run, never bypassed
// ─────────────────────────────────────────────────────────────

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Apply the 5 production-blocking deterministic guards to a model
 * output. Returns the guarded output plus a list of human-readable
 * corrections applied. The corrections are also written into
 * `sport_specific.ai_sanity.deterministic_corrections` so the audit
 * trail is preserved end-to-end.
 *
 * Guards (in order):
 *   1. predicted_total = predicted_home_score + predicted_away_score
 *      (tolerance ±0.01). Recompute or clear when home/away null.
 *   2. predicted_ml_winner matches the side with the higher projected
 *      score. Mismatch → null the ML pick (no auto-flip; conservative).
 *      ML pick with one or both scores null → null the ML pick.
 *   3. predicted_ou_side requires market_line_available=true. Without
 *      a market line we cannot validate the O/U comparison — null it.
 *   4. Each confidence value < HARD_CONFIDENCE_FLOOR (51) → null the
 *      corresponding pick and its confidence.
 *   5. stage=t60_locked AND any starter missing/scratched → null the
 *      official ML and OU picks. Morning Card allows preliminary picks
 *      with reduced confidence (already enforced by the model itself).
 *
 * The guards are deterministic, idempotent, and side-effect free. They
 * NEVER write to the DB or call any external system.
 */
export function applyDeterministicGuards(
  output: AutoModelOutput,
  snapshot: GameSnapshot,
  stage: ModelStage
): { guarded: AutoModelOutput; corrections: string[] } {
  const corrections: string[] = [];

  let predicted_home_score = output.predicted_home_score;
  let predicted_away_score = output.predicted_away_score;
  let predicted_total = output.predicted_total;
  let predicted_ml_winner = output.predicted_ml_winner;
  let ml_confidence = output.ml_confidence;
  let predicted_ou_side = output.predicted_ou_side;
  let ou_confidence = output.ou_confidence;
  let predicted_nrfi = output.predicted_nrfi;
  let nrfi_confidence = output.nrfi_confidence;

  // ── Guard 1 — predicted_total = home + away ─────────────────────
  if (predicted_home_score !== null && predicted_away_score !== null) {
    const recomputed = round1(predicted_home_score + predicted_away_score);
    if (predicted_total === null || Math.abs(predicted_total - recomputed) > 0.01) {
      corrections.push(
        `Guard 1: predicted_total recomputed from ${predicted_total ?? "null"} to ${recomputed}`
      );
      predicted_total = recomputed;
    }
  } else if (predicted_total !== null) {
    corrections.push(
      "Guard 1: predicted_total cleared (predicted_home_score or predicted_away_score is null)"
    );
    predicted_total = null;
  }

  // ── Guard 2 — ML winner matches higher score ────────────────────
  if (predicted_ml_winner !== null) {
    if (predicted_home_score === null || predicted_away_score === null) {
      corrections.push(
        "Guard 2: predicted_ml_winner present but score is null — ML pick nulled"
      );
      predicted_ml_winner = null;
      ml_confidence = null;
    } else if (predicted_home_score === predicted_away_score) {
      // Tie at the score level — model should not pick. Conservative null.
      corrections.push(
        "Guard 2: projected scores are equal — ML pick nulled (no clear winner)"
      );
      predicted_ml_winner = null;
      ml_confidence = null;
    } else {
      const trueWinner = predicted_home_score > predicted_away_score ? "home" : "away";
      if (predicted_ml_winner !== trueWinner) {
        corrections.push(
          `Guard 2: ML winner '${predicted_ml_winner}' does not match higher projected score (true winner='${trueWinner}') — ML pick nulled`
        );
        predicted_ml_winner = null;
        ml_confidence = null;
      }
    }
  }

  // ── Guard 3 — O/U requires market line ──────────────────────────
  if (predicted_ou_side !== null && !output.sport_specific.market_line_available) {
    corrections.push(
      "Guard 3: predicted_ou_side present but market_line_available=false — O/U pick nulled"
    );
    predicted_ou_side = null;
    ou_confidence = null;
  }
  if (predicted_ou_side !== null && output.sport_specific.listed_line === null) {
    // Defense-in-depth: even if the flag says available, the listed_line
    // value itself must be present.
    corrections.push(
      "Guard 3: predicted_ou_side present but listed_line is null — O/U pick nulled"
    );
    predicted_ou_side = null;
    ou_confidence = null;
  }

  // ── Guard 4 — confidence floor ──────────────────────────────────
  if (ml_confidence !== null && ml_confidence < HARD_CONFIDENCE_FLOOR) {
    corrections.push(
      `Guard 4: ml_confidence ${ml_confidence} below floor ${HARD_CONFIDENCE_FLOOR} — ML pick nulled`
    );
    predicted_ml_winner = null;
    ml_confidence = null;
  }
  if (ou_confidence !== null && ou_confidence < HARD_CONFIDENCE_FLOOR) {
    corrections.push(
      `Guard 4: ou_confidence ${ou_confidence} below floor ${HARD_CONFIDENCE_FLOOR} — O/U pick nulled`
    );
    predicted_ou_side = null;
    ou_confidence = null;
  }
  if (nrfi_confidence !== null && nrfi_confidence < HARD_CONFIDENCE_FLOOR) {
    corrections.push(
      `Guard 4: nrfi_confidence ${nrfi_confidence} below floor ${HARD_CONFIDENCE_FLOOR} — NRFI pick nulled`
    );
    predicted_nrfi = null;
    nrfi_confidence = null;
  }

  // ── Guard 5 — missing/scratched starter at T-60 ─────────────────
  const hasMissingStarter =
    snapshot.home_starter === null ||
    snapshot.away_starter === null ||
    (snapshot.home_starter !== null && snapshot.home_starter.is_scratched) ||
    (snapshot.away_starter !== null && snapshot.away_starter.is_scratched);

  if (hasMissingStarter && stage === "t60_locked") {
    if (predicted_ml_winner !== null) {
      corrections.push(
        "Guard 5: stage=t60_locked but starter missing/scratched — ML pick nulled (publish-quality requires confirmed starters)"
      );
      predicted_ml_winner = null;
      ml_confidence = null;
    }
    if (predicted_ou_side !== null) {
      corrections.push(
        "Guard 5: stage=t60_locked but starter missing/scratched — O/U pick nulled (publish-quality requires confirmed starters)"
      );
      predicted_ou_side = null;
      ou_confidence = null;
    }
  }

  // ── Reassemble + record corrections in audit trail ──────────────
  const aiSanity: AiSanityRecord = {
    ...output.sport_specific.ai_sanity,
    deterministic_corrections: corrections,
  };

  // Recompute held flag in case all picks were nulled by guards.
  const allHeldAfterGuards =
    predicted_ml_winner === null &&
    predicted_ou_side === null &&
    predicted_nrfi === null;
  const heldAfterGuards = allHeldAfterGuards;

  const guarded: AutoModelOutput = {
    ...output,
    predicted_home_score,
    predicted_away_score,
    predicted_total,
    predicted_ml_winner,
    ml_confidence,
    predicted_ou_side,
    ou_confidence,
    predicted_nrfi,
    nrfi_confidence,
    sport_specific: {
      ...output.sport_specific,
      held: output.sport_specific.held || heldAfterGuards,
      hold_reason:
        output.sport_specific.hold_reason ??
        (heldAfterGuards && corrections.length > 0
          ? `guards_nulled_all_picks: ${corrections[0]}`
          : null),
      predicted_nrfi,
      nrfi_confidence,
      ai_sanity: aiSanity,
    },
  };

  return { guarded, corrections };
}
