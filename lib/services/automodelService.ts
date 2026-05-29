/**
 * Phase 3B — automodelService dry-run orchestration.
 *
 * Single entry point `generatePredictionsForSlate` that wires together
 * the feature snapshot pipeline (Phase 3B), the pure rule-seeded model
 * (Phase 3A), and the AI sanity boundary (Phase 3A). Returns predictions
 * + diagnostic counts.
 *
 * Phase 3B DISCIPLINE: strictly DRY-RUN.
 *   • `opts.writeToDb` defaults to false.
 *   • Setting `opts.writeToDb=true` THROWS immediately with a clear
 *     "Phase 3C scope" error message. The write branch is intentionally
 *     not implemented in this phase.
 *   • No ingestScoresModel call.
 *   • No scores_model_runs audit write — strict no-write posture
 *     applies to audit tables too in Phase 3B.
 *   • No updateMarketSignalsForSlate or updateGradesForSlate call.
 *   • No slatePublishService call.
 *
 * Manual workflow stays the override path:
 *   • Phase 3B does not invoke ingestScoresModel — manual upload via
 *     /api/admin/upload-scores-model is unaffected.
 *   • When Phase 3C eventually adds the write branch behind an operator
 *     env flag, the manual UPSERT + is_override + original_auto_prediction
 *     semantics in ingestScoresModel handle the auto/manual coexistence.
 */

import type { Sport } from "../types/domain/Sport";
import { buildFeatureSnapshots } from "../automodel/featureSnapshot";
import { runMlbAutoModelV1 } from "../automodel/mlbAutoModelV1";
import { reviewAutoModelOutput } from "../automodel/aiSanityBoundary";
import type {
  AutoModelOutput,
  GameSnapshot,
  ModelStage,
} from "../automodel/types";

// ─────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────

export type AutoModelRunOpts = {
  /**
   * Phase 3B: defaults false. Setting true THROWS "Phase 3C scope".
   * The write branch (ingestScoresModel + scores_model_runs audit)
   * is intentionally not implemented in this phase.
   */
  writeToDb?: boolean;
};

export type AutoModelRunResult = {
  sport: Sport;
  slate_date: string;
  stage: ModelStage;
  game_count: number;
  predictions: AutoModelOutput[];
  /** Predictions where ALL three picks are held (sport_specific.held=true). */
  held_count: number;
  /** Per-pick null counts — useful for cron-status visibility. */
  pick_null_counts: {
    ml: number;
    ou: number;
    nrfi: number;
  };
  /** AI sanity verdict tallies. V1 stub always returns 'approve'. */
  ai_sanity_actions: {
    approve: number;
    warn: number;
    hold: number;
    rerun: number;
  };
  /** Total count of deterministic guard corrections applied across all
   *  predictions (each prediction contributes
   *  sport_specific.ai_sanity.deterministic_corrections.length). */
  total_deterministic_corrections: number;
  /** Per-game errors (snapshot or model failures); other games still
   *  produce predictions. Empty array on clean runs. */
  errors: Array<{
    game_external_id: number | null;
    error: string;
  }>;
  duration_ms: number;
};

// ─────────────────────────────────────────────────────────────
// Service implementation
// ─────────────────────────────────────────────────────────────

/**
 * Generate auto-model predictions for a slate. Phase 3B: dry-run only.
 *
 * Steps:
 *   1. Build feature snapshots (Phase 3B DB read pipeline).
 *   2. For each snapshot:
 *        a. Run pure model (Phase 3A runMlbAutoModelV1).
 *        b. Run AI sanity boundary (Phase 3A reviewAutoModelOutput stub).
 *        c. Tally diagnostic counts.
 *      Per-game exceptions are caught and recorded in `errors`; other
 *      games continue processing.
 *   3. If opts.writeToDb === true: throw immediately.
 *   4. Return AutoModelRunResult.
 *
 * No DB writes occur in Phase 3B.
 */
export async function generatePredictionsForSlate(
  sport: Sport,
  slate_date: string,
  stage: ModelStage,
  opts: AutoModelRunOpts = {}
): Promise<AutoModelRunResult> {
  const t0 = Date.now();

  // Hard guard — Phase 3B is strictly dry-run.
  if (opts.writeToDb === true) {
    throw new Error(
      "automodelService.generatePredictionsForSlate: writeToDb=true is " +
        "Phase 3C scope and is NOT implemented in Phase 3B. Set writeToDb=false " +
        "(or omit) to run dry-run."
    );
  }

  // V1: MLB only. Other sports return an empty result without DB reads.
  if (sport !== "mlb") {
    return {
      sport,
      slate_date,
      stage,
      game_count: 0,
      predictions: [],
      held_count: 0,
      pick_null_counts: { ml: 0, ou: 0, nrfi: 0 },
      ai_sanity_actions: { approve: 0, warn: 0, hold: 0, rerun: 0 },
      total_deterministic_corrections: 0,
      errors: [],
      duration_ms: Date.now() - t0,
    };
  }

  // Step 1 — build feature snapshots
  let snapshots: GameSnapshot[];
  try {
    snapshots = await buildFeatureSnapshots(sport, slate_date);
  } catch (e) {
    throw new Error(
      `automodelService.generatePredictionsForSlate: featureSnapshot build ` +
        `failed for ${sport}/${slate_date}: ${
          e instanceof Error ? e.message : String(e)
        }`
    );
  }

  // Step 2 — per-game pipeline
  const predictions: AutoModelOutput[] = [];
  const errors: AutoModelRunResult["errors"] = [];
  const ai_sanity_actions = { approve: 0, warn: 0, hold: 0, rerun: 0 };
  let held_count = 0;
  let total_deterministic_corrections = 0;
  const pick_null_counts = { ml: 0, ou: 0, nrfi: 0 };

  for (const snap of snapshots) {
    try {
      // 2a — run the pure model
      const rawPrediction = runMlbAutoModelV1(snap, stage);

      // 2b — run the AI sanity boundary (V1 stub returns 'approve')
      //
      // Phase 3B intentionally does NOT apply AI adjustments to the
      // output — the stub returns null adjustments and the call-site
      // enforcer is Phase 3C scope. The model's output (already
      // protected by the 5 deterministic guards inside Phase 3A's
      // runMlbAutoModelV1) is what we record.
      const verdict = await reviewAutoModelOutput({
        game_external_id: snap.game_external_id,
        prediction: rawPrediction,
        snapshot: snap,
        stage,
      });
      ai_sanity_actions[verdict.action]++;

      // 2c — tally
      predictions.push(rawPrediction);
      if (rawPrediction.sport_specific.held) held_count++;
      if (rawPrediction.predicted_ml_winner === null) pick_null_counts.ml++;
      if (rawPrediction.predicted_ou_side === null) pick_null_counts.ou++;
      if (rawPrediction.predicted_nrfi === null) pick_null_counts.nrfi++;
      total_deterministic_corrections +=
        rawPrediction.sport_specific.ai_sanity.deterministic_corrections.length;
    } catch (e) {
      errors.push({
        game_external_id: snap.game_external_id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return {
    sport,
    slate_date,
    stage,
    game_count: snapshots.length,
    predictions,
    held_count,
    pick_null_counts,
    ai_sanity_actions,
    total_deterministic_corrections,
    errors,
    duration_ms: Date.now() - t0,
  };
}
