/**
 * Phase 3B + 3C — automodelService orchestration.
 *
 * Single entry point `generatePredictionsForSlate` that wires together
 * the feature snapshot pipeline (Phase 3B), the pure rule-seeded model
 * (Phase 3A), the AI sanity boundary (Phase 3A), and — when explicitly
 * opted into — controlled DB writes via the existing ingestScoresModel
 * pipeline plus downstream market-signal + grade derivation.
 *
 * Phase 3B DISCIPLINE (dry-run path) — defaults:
 *   • `opts.writeToDb` defaults to false → dry-run; no DB writes.
 *   • No ingestScoresModel call.
 *   • No downstream service calls.
 *   • No slatePublishService call.
 *
 * Phase 3C WRITE PATH (two-key opt-in):
 *   • Caller passes `opts.writeToDb === true` AND
 *     `process.env.AUTOMODEL_DB_WRITES_ENABLED === "true"` is set.
 *   • Either missing → throws BEFORE any DB read/write.
 *   • Reuses existing ingestScoresModel:
 *       - UPSERTs game_predictions on game_id (preserves manual override
 *         semantics: a later manual upload with `is_override=true` will
 *         overwrite the auto row and snapshot the original).
 *       - Writes scores_model_runs audit row internally via UPSERT on
 *         (sport, source, run_date) — no separate audit write here.
 *   • prediction_source="auto_v1_mlb_rules" → inferSourceType maps to
 *     source_type="real_api" → passes production filter.
 *   • validationMode="auto_model" — allows nulls on pick fields when
 *     justified by sport_specific.held/hold_picks. Manual upload stays
 *     strict (its callers pass validationMode="manual" or omit it).
 *   • After successful ingest: triggers updateMarketSignalsForSlate and
 *     updateGradesForSlate (same chain manual upload route uses post-
 *     ingest). Partial-failure tolerant — each downstream call's error
 *     is captured in the result, ingest is NOT rolled back.
 *   • slate_status STAYS `draft` — no auto-publish. Phase 5 will add the
 *     operator publish workflow.
 *
 * Manual workflow stays the override path:
 *   • Phase 3C does not call /api/admin/upload-scores-model.
 *   • Manual UPSERT + is_override=true + original_auto_prediction snapshot
 *     semantics in ingestScoresModel handle the auto-then-manual flow.
 */

import type { Sport } from "../types/domain/Sport";
import { buildFeatureSnapshots } from "../automodel/featureSnapshot";
import { runMlbAutoModelV1 } from "../automodel/mlbAutoModelV1";
import { runMlbAutoModelV2 } from "../automodel/mlbAutoModelV2";
import { runMlbAutoModelV2_1 } from "../automodel/mlbAutoModelV2_1";
import { reviewAutoModelOutput } from "../automodel/aiSanityBoundary";
import {
  resolveEffectiveVersion,
  type AutomodelVersion,
} from "../automodel/modelVersion";
import {
  MODEL_VERSION_V2,
  MODEL_VERSION_V2_1,
} from "../automodel/types";
import type {
  AutoModelOutput,
  AutoModelSportSpecific,
  EnrichmentHook,
  GameSnapshot,
  ModelStage,
} from "../automodel/types";
import { supabase } from "../db/supabase";
import {
  ingestScoresModel,
  type IngestionResult,
  type ScoresModelInputRow,
} from "../scoresModel/ingester";
import { loadGameIdMap } from "./_idMaps";
import { updateMarketSignalsForSlate } from "./marketSignalDerivationService";
import { updateGradesForSlate } from "./gradeDerivationService";
import { generatePickBreakdown } from "./pickBreakdownGenerator";
import {
  applyReviewerIfEnabled,
  fetchReviewerSlateContext,
  type ReviewerSlateContext,
} from "./aiReviewerWiring";

// ─────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────

export type AutoModelRunOpts = {
  /**
   * Phase 3C: explicit caller opt-in for DB writes. Defaults false.
   *
   * Two-key gate: writeToDb=true AND env AUTOMODEL_DB_WRITES_ENABLED="true"
   * BOTH required. Either missing throws BEFORE any DB read/write.
   *
   * When false (or omitted), runs pure dry-run (Phase 3B behavior — no
   * DB writes anywhere).
   */
  writeToDb?: boolean;
  /**
   * Phase 4C: optional filter to restrict snapshot building (and thus
   * ingest) to a subset of slate games by `external_id`. Passed through
   * to `buildFeatureSnapshots`.
   *
   * • `undefined` → whole slate (Phase 3B/3C behavior — unchanged)
   * • `[]` → explicit "no games" — short-circuit; returns empty result
   * • `[id, id, …]` → restrict snapshot + ingest to those games
   *
   * Used by the Phase 4C orchestrator write paths to write only T-60 /
   * single-game / held-only subsets and to exclude manual-override
   * rows from morning writes.
   */
  gameExternalIdsFilter?: number[];
  /**
   * Phase 4C: optional hook called per-game after the model + AI sanity
   * boundary, BEFORE the prediction is added to the result array and
   * (if writeToDb=true) ingested. Returns a partial `sport_specific`
   * that is merged into the prediction's sport_specific.
   *
   * Used by the Phase 4C orchestrator to inject audit fields
   * (snapshot_stash, previous_run_at, previous_stage, movement_deltas,
   * stale, stale_reason, run_kind) computed from data the orchestrator
   * owns. Hook errors are caught per-game; the un-enriched prediction
   * proceeds.
   */
  enrichmentHook?: EnrichmentHook;
  /**
   * Phase 4.2.C.1.R-19 Phase 5c — operator-supplied per-game exclusion
   * list. Games whose `external_id` appears here are union'd with the
   * Layer 2 lock-filter set and never enter the snapshot build / model
   * run.
   *
   * Used by the cron-safe slate-cycle orchestrator to skip
   * already-started games (lock_miss pattern) on a per-game basis,
   * replacing the prior slate-wide lock_miss block. Each excluded game
   * is surfaced on the AutomationRunReport as
   * `slate_lock_snapshot.per_game[i].lock_state = "already_started"`
   * and listed in M2 step details.
   *
   * `undefined` → no exclusions (Phase 4.2.B behavior unchanged)
   * `[]` → empty list, same as undefined
   * `[id, id, …]` → exclude these external_ids
   */
  excludeGameExternalIds?: number[];
  /**
   * Phase 4.2.B — Layer 2 lock guard.
   *
   * When `true` (default), the service pre-filters out games whose
   * existing game_predictions row has `locked_at IS NOT NULL`. Saves the
   * snapshot-build + model-run work for games that the Layer 1 ingester
   * guard would reject anyway.
   *
   * When `false`, the filter is skipped — locked games are included in
   * the snapshot build and pass to ingestScoresModel. Layer 1 still
   * catches them (defense in depth). The opt-out exists for explicit
   * operator re-runs / debugging where we want the full pipeline to
   * execute even on locked rows so we can compare model output without
   * actually writing.
   */
  respectLocks?: boolean;
  /**
   * Phase 6B.1 — explicit auto-model version override.
   *   "v1"     — V1 writes predictions (default).
   *   "v2"     — V2 market-prior writes predictions.
   *              V1 still runs first to produce the residual signal.
   *              V2 errors → fall back to V1 with a logged warning.
   *   "shadow" — V1 writes predictions; V2 also runs and its audit is
   *              attached to sport_specific.v2_audit for comparison.
   * When undefined, reads AUTOMODEL_VERSION env (default "v1").
   */
  modelVersion?: AutomodelVersion;
};

/**
 * Phase 3C — DB write outcomes. Structured partial-success: a successful
 * ingest may be followed by a failed market_signals or grades step; this
 * object surfaces every step's result independently so the caller can
 * tell exactly what landed and what didn't.
 */
export type AutoModelDbWriteOutcome = {
  attempted: true;
  ingest: {
    inserted: number;
    updated: number;
    failed: number;
    run_id: number | null;
    errors: Array<{ game_external_id: number; errors: string[] }>;
  };
  /** null when ingest produced 0 successful rows (downstream skipped). */
  market_signals:
    | {
        game_predictions_updated: number;
        prop_predictions_updated: number;
        per_market: {
          ml: { derived: number; written: number };
          ou: { derived: number; written: number };
          nrfi: { derived: number; written: number };
        };
        error: null;
      }
    | { error: string; game_predictions_updated: 0 }
    | null;
  /** null when ingest produced 0 successful rows (downstream skipped). */
  grades:
    | {
        game_predictions_updated: number;
        prop_predictions_updated: number;
        per_market: {
          ml: { derived: number; written: number };
          ou: { derived: number; written: number };
          nrfi: { derived: number; written: number };
        };
        error: null;
      }
    | { error: string; game_predictions_updated: 0 }
    | null;
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
  /**
   * Phase 3C: DB write outcome. `null` when writeToDb=false (dry-run).
   * `{ attempted: true, ... }` when writeToDb=true succeeded the gate
   * check. Each inner step (ingest / market_signals / grades) carries
   * its own success-or-error shape — partial failure is surfaced, never
   * thrown.
   */
  db_writes: AutoModelDbWriteOutcome | null;
};

// ─────────────────────────────────────────────────────────────
// Internal — map AutoModelOutput → ingester input row
// ─────────────────────────────────────────────────────────────

/**
 * Adapt one AutoModelOutput into the shape ingestScoresModel expects.
 *
 * Field-by-field rules:
 *   • Top-level pick fields (predicted_ml_winner, ml_confidence,
 *     predicted_ou_side, ou_confidence, predicted_nrfi, nrfi_confidence)
 *     are OMITTED from the row when null. The auto_model validation mode
 *     accepts the omission only when sport_specific.held=true OR the
 *     market is in sport_specific.hold_picks (which Phase 3A populates
 *     automatically for held picks).
 *   • Scores + total are required by every sport schema. Phase 3A always
 *     produces them, so they're never null here. We assert non-null with
 *     the `!` operator and rely on the validator to surface a clear
 *     error if a bug ever produces a null score.
 *   • sport_specific carries the full Phase 3A audit record (model_version,
 *     stage, starter_confirmed, lineup_confirmed, market_line_available,
 *     opposing_deterministic_warning, listed_line, held, hold_reason,
 *     hold_picks, stale flags, auto_factors, ai_sanity). All flow through
 *     to game_predictions.sport_specific JSONB.
 *   • model_version is hoisted from sport_specific.model_version onto the
 *     top-level metadata field the ingester writes to game_predictions.
 *   • computed_at is set at adapt-time (one ISO timestamp per slate run).
 */
/**
 * Phase 4.2.B — read external_ids of games on this slate whose
 * game_predictions row already has locked_at set. Used by the Layer 2
 * filter to pre-exclude locked games from the snapshot build.
 *
 * Returns a Set of external_ids for O(1) lookup. Empty set when no
 * locked rows exist (typical morning state).
 */
async function fetchLockedExternalIds(
  sport: Sport,
  slate_date: string
): Promise<Set<number>> {
  const { data, error } = await supabase
    .from("game_predictions")
    .select("games!inner ( external_id, sport, slate_date ), locked_at")
    .not("locked_at", "is", null)
    .eq("games.sport", sport)
    .eq("games.slate_date", slate_date);
  if (error) {
    throw new Error(
      `automodelService.fetchLockedExternalIds failed for ${sport}/${slate_date}: ${error.message}`
    );
  }
  const rows = (data ?? []) as unknown as Array<{
    games: { external_id: number };
    locked_at: string;
  }>;
  return new Set(rows.map((r) => r.games.external_id));
}

/**
 * Phase 4.2.B — read all external_ids for the slate. Used by the Layer 2
 * filter when the caller did NOT pass an explicit gameExternalIdsFilter
 * but locked games exist: we need to build a "whole slate minus locked"
 * filter, which requires knowing the whole slate first.
 */
async function fetchSlateExternalIds(
  sport: Sport,
  slate_date: string
): Promise<number[]> {
  const { data, error } = await supabase
    .from("games")
    .select("external_id")
    .eq("sport", sport)
    .eq("slate_date", slate_date);
  if (error) {
    throw new Error(
      `automodelService.fetchSlateExternalIds failed for ${sport}/${slate_date}: ${error.message}`
    );
  }
  return ((data ?? []) as Array<{ external_id: number }>).map(
    (r) => r.external_id
  );
}

function autoModelOutputToScoresRow(
  output: AutoModelOutput,
  computed_at: string
): ScoresModelInputRow {
  const row: ScoresModelInputRow = {
    game_external_id: output.game_external_id,
    model_version: output.sport_specific.model_version,
    computed_at,
    sport_specific: output.sport_specific as unknown as Record<string, unknown>,
  };
  if (output.predicted_home_score !== null) {
    row.predicted_home_score = output.predicted_home_score;
  }
  if (output.predicted_away_score !== null) {
    row.predicted_away_score = output.predicted_away_score;
  }
  if (output.predicted_total !== null) {
    row.predicted_total = output.predicted_total;
  }
  if (output.predicted_ml_winner !== null) {
    row.predicted_ml_winner = output.predicted_ml_winner;
  }
  if (output.ml_confidence !== null) {
    row.ml_confidence = output.ml_confidence;
  }
  if (output.predicted_ou_side !== null) {
    row.predicted_ou_side = output.predicted_ou_side;
  }
  if (output.ou_confidence !== null) {
    row.ou_confidence = output.ou_confidence;
  }
  if (output.predicted_nrfi !== null) {
    row.predicted_nrfi = output.predicted_nrfi;
  }
  if (output.nrfi_confidence !== null) {
    row.nrfi_confidence = output.nrfi_confidence;
  }
  return row;
}

// ─────────────────────────────────────────────────────────────
// Service implementation
// ─────────────────────────────────────────────────────────────

/**
 * Generate auto-model predictions for a slate.
 *
 * Dry-run (writeToDb=false / omitted):
 *   1. Build feature snapshots (Phase 3B DB read pipeline).
 *   2. Per snapshot: pure model → AI sanity stub → tally.
 *   3. Return result with db_writes=null.
 *
 * Write path (writeToDb=true + AUTOMODEL_DB_WRITES_ENABLED="true"):
 *   1. Verify two-key gate (throws BEFORE any DB I/O if either missing).
 *   2. Steps 1-2 of dry-run.
 *   3. Build gameIdByExternal map for the slate.
 *   4. Adapt predictions → ScoresModelInputRow[].
 *   5. ingestScoresModel(... { source: "auto_v1_mlb_rules", runDate,
 *      validationMode: "auto_model" }) — UPSERTs game_predictions, writes
 *      scores_model_runs audit row internally.
 *   6. If ingest produced ≥1 successful row: updateMarketSignalsForSlate
 *      then updateGradesForSlate. Each is partial-fail tolerant — errors
 *      are captured in db_writes.{market_signals,grades}.error and do not
 *      throw.
 *   7. Return result with db_writes populated.
 *
 * Per-game model exceptions are recorded in `errors` (dry-run or write
 * path); other games continue processing.
 */
export async function generatePredictionsForSlate(
  sport: Sport,
  slate_date: string,
  stage: ModelStage,
  opts: AutoModelRunOpts = {}
): Promise<AutoModelRunResult> {
  const t0 = Date.now();
  const wantWrite = opts.writeToDb === true;
  const envEnabled = process.env.AUTOMODEL_DB_WRITES_ENABLED === "true";

  // Phase 6B.1 — resolve effective auto-model version (override > env > v1).
  const effectiveVersion = resolveEffectiveVersion(opts.modelVersion);

  // Two-key gate (Phase 3C): EITHER missing while caller asked for a
  // write → throw immediately, BEFORE any DB read or model work. This is
  // defense-in-depth — the env flag alone never writes; the caller flag
  // alone never writes.
  if (wantWrite && !envEnabled) {
    throw new Error(
      "automodelService.generatePredictionsForSlate: writeToDb=true " +
        "requires AUTOMODEL_DB_WRITES_ENABLED=true in the environment. " +
        "Both opt-ins must be present (defense in depth) before any DB write."
    );
  }
  if (!wantWrite && envEnabled) {
    // Informational only — operator may have left the env flag set after
    // a smoke test. Proceeding with dry-run is the safe choice.
    console.warn(
      "[automodelService] AUTOMODEL_DB_WRITES_ENABLED is set but " +
        "writeToDb=false on this call — proceeding with dry-run."
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
      db_writes: null,
    };
  }

  // Phase 4.2.B — Layer 2 lock filter.
  //
  // Pre-filter out games whose game_predictions row is already locked, so
  // we don't waste API calls / CPU building snapshots and running the
  // model on rows that the Layer 1 ingester guard would reject anyway.
  //
  // Default: respectLocks=true. Operator escape hatch passes false to
  // run the full pipeline even on locked games (Layer 1 still catches
  // any actual write).
  //
  // R-19 Phase 5c — caller-supplied `excludeGameExternalIds` union'd
  // with the locked set. Used by the cron-safe slate-cycle orchestrator
  // to skip games that fall into the lock_miss pattern (already_started
  // with locked_at=null) without blocking the model run for the
  // remaining eligible games.
  const respectLocks = opts.respectLocks !== false;
  const callerExclusions = new Set<number>(opts.excludeGameExternalIds ?? []);
  let effectiveFilter: number[] | undefined = opts.gameExternalIdsFilter;
  if (respectLocks || callerExclusions.size > 0) {
    const lockedExternalIds = respectLocks
      ? await fetchLockedExternalIds(sport, slate_date)
      : new Set<number>();
    // Combined exclusion set: Layer 2 (locked rows) ∪ caller-supplied
    // (lock_miss / already_started). Same filtering pipeline either way.
    const combinedExclusions = new Set<number>([
      ...lockedExternalIds,
      ...callerExclusions,
    ]);
    if (combinedExclusions.size > 0) {
      if (effectiveFilter === undefined) {
        // No prior filter — build one that excludes locked + caller games.
        const allExternalIds = await fetchSlateExternalIds(sport, slate_date);
        effectiveFilter = allExternalIds.filter(
          (id) => !combinedExclusions.has(id)
        );
      } else {
        effectiveFilter = effectiveFilter.filter(
          (id) => !combinedExclusions.has(id)
        );
      }
    }
  }

  // Step 1 — build feature snapshots (Phase 4C: filter optional;
  // Phase 4.2.B: locked games already excluded above).
  let snapshots: GameSnapshot[];
  try {
    snapshots = await buildFeatureSnapshots(
      sport,
      slate_date,
      effectiveFilter
    );
  } catch (e) {
    throw new Error(
      `automodelService.generatePredictionsForSlate: featureSnapshot build ` +
        `failed for ${sport}/${slate_date}: ${
          e instanceof Error ? e.message : String(e)
        }`
    );
  }

  // R-16 — fetch slate-scoped market context once per slate (no-vig ML
  // probabilities) for the AI reviewer. Single DB query. Empty map is
  // fine — reviewer handles missing data gracefully.
  let reviewerContext: ReviewerSlateContext;
  try {
    reviewerContext = await fetchReviewerSlateContext(
      supabase,
      "mlb",
      slate_date
    );
  } catch (e) {
    // Don't fail the run if the context fetch fails — proceed with an
    // empty map. Reviewer will simply lack no-vig data on every game.
    console.warn(
      `[automodelService] reviewer slate-context fetch failed: ${
        e instanceof Error ? e.message : String(e)
      }. Proceeding with empty context.`
    );
    reviewerContext = { noVigByExternalId: new Map() };
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

      // 2b.5 — R-16 AI reviewer (deterministic V1). No-op unless
      // `REVIEWER_V1_ENABLED=true` is set in the operator env. When
      // enabled, the reviewer may cap confidence, hold a market, adjust
      // projected scores toward market, and emit a compact audit record.
      // On logic_audit failure it fails closed by holding all markets
      // with hold_reason="reviewer_logic_audit_failed". When disabled
      // this returns `rawPrediction` unchanged → existing behavior.
      const reviewedPrediction = applyReviewerIfEnabled(
        snap,
        rawPrediction,
        stage,
        reviewerContext
      );

      // 2c — Phase 4C: enrich sport_specific via the optional hook.
      // Hook errors do NOT fail the game — log + proceed with the
      // un-enriched prediction so a single buggy hook can't sink the
      // whole slate. When hook is undefined (Phase 3B/3C callers),
      // this branch is skipped entirely → existing behavior preserved.
      let enrichedSportSpecific: AutoModelSportSpecific =
        reviewedPrediction.sport_specific;
      if (opts.enrichmentHook !== undefined) {
        try {
          // Hook receives the reviewed prediction so any reviewer-driven
          // changes (score adjustment, confidence cap, held markets) are
          // visible to enrichment logic.
          const extra = opts.enrichmentHook(snap, reviewedPrediction);
          enrichedSportSpecific = {
            ...reviewedPrediction.sport_specific,
            ...extra,
          };
        } catch (hookErr) {
          console.warn(
            `[automodelService] enrichmentHook threw for game_external_id=` +
              `${snap.game_external_id}: ${
                hookErr instanceof Error ? hookErr.message : String(hookErr)
              }. Proceeding with un-enriched sport_specific.`
          );
        }
      }
      // 2d — Phase 4.1.8.B: optional deterministic pick-breakdown generation.
      // Two-key gate: env flag + MLB-only (V1 scope). Wrapped in try/catch
      // so generator failure NEVER blocks the prediction write — we log
      // and proceed with no breakdown.
      //
      // Writes new shape: sport_specific.breakdown_v2.model_breakdown +
      // operator_detail + breakdown_version="v2.0" + breakdown_generated_at.
      // Per Phase 4.1.8.B Sub-D1, explicitly destructures out any legacy
      // `member_summary` carried in enrichedSportSpecific so v1 and v2
      // copy never live side-by-side after a regen. The API reader
      // (route.ts) still falls back to legacy member_summary for rows
      // that haven't been regenerated yet; this writer ensures NEW rows
      // are clean.
      let withBreakdown: AutoModelSportSpecific = enrichedSportSpecific;
      if (
        sport === "mlb" &&
        process.env.PICK_BREAKDOWN_GEN_ENABLED === "true"
      ) {
        try {
          // Breakdown reads the REVIEWED prediction so the member-facing
          // copy reflects any reviewer adjustments (capped confidence,
          // halved score differential, held markets).
          const breakdown = generatePickBreakdown(
            { ...reviewedPrediction, sport_specific: enrichedSportSpecific },
            {
              sport,
              home_pitcher_name: snap.home_starter?.player_name ?? null,
              away_pitcher_name: snap.away_starter?.player_name ?? null,
              home_team_abbr: snap.home_team.abbreviation,
              away_team_abbr: snap.away_team.abbreviation,
              home_first_inning_starts:
                snap.home_starter?.first_inning_starts ?? null,
              away_first_inning_starts:
                snap.away_starter?.first_inning_starts ?? null,
              home_first_inning_era:
                snap.home_starter?.first_inning_era ?? null,
              away_first_inning_era:
                snap.away_starter?.first_inning_era ?? null,
              home_season_era: snap.home_starter?.season_era ?? null,
              away_season_era: snap.away_starter?.season_era ?? null,
            }
          );
          // Explicit legacy drop (Sub-D1): pull member_summary out of the
          // spread so it doesn't persist alongside the new breakdown_v2
          // namespace. ESLint-suppressed underscore prefix documents the
          // intentional unused destructure.
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { member_summary: _legacyMs, ...withoutLegacy } =
            enrichedSportSpecific as AutoModelSportSpecific & {
              member_summary?: string | null;
            };
          withBreakdown = {
            ...withoutLegacy,
            breakdown_v2: { model_breakdown: breakdown.model_breakdown },
            operator_detail: breakdown.operator_detail,
            breakdown_version: breakdown.breakdown_version,
            breakdown_generated_at: breakdown.breakdown_generated_at,
          } as AutoModelSportSpecific;
        } catch (bdErr) {
          console.warn(
            `[automodelService] pickBreakdownGenerator threw for ` +
              `game_external_id=${snap.game_external_id}: ${
                bdErr instanceof Error ? bdErr.message : String(bdErr)
              }. Proceeding without breakdown.`
          );
        }
      }

      const finalPredictionV1: AutoModelOutput = {
        ...reviewedPrediction,
        sport_specific: withBreakdown,
      };

      // 2d.5 — Phase 6B.1: branch on effective model version.
      // For "v1" mode → pass-through, behavior unchanged from prior phases.
      // For "v2" or "shadow" → run V2 with try/catch; on error, fall back
      // to V1 with a logged warning. "v2" writes V2's prediction values;
      // "shadow" keeps V1's values and only attaches v2_audit.
      const finalPrediction: AutoModelOutput = applyV2IfSelected({
        snap,
        v1Output: finalPredictionV1,
        stage,
        effectiveVersion,
      });

      // 2e — tally
      predictions.push(finalPrediction);
      if (finalPrediction.sport_specific.held) held_count++;
      if (finalPrediction.predicted_ml_winner === null) pick_null_counts.ml++;
      if (finalPrediction.predicted_ou_side === null) pick_null_counts.ou++;
      if (finalPrediction.predicted_nrfi === null) pick_null_counts.nrfi++;
      total_deterministic_corrections +=
        finalPrediction.sport_specific.ai_sanity.deterministic_corrections.length;
    } catch (e) {
      errors.push({
        game_external_id: snap.game_external_id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // ─── Step 3 — DB writes (Phase 3C) ─────────────────────────────────
  let db_writes: AutoModelDbWriteOutcome | null = null;
  if (wantWrite) {
    db_writes = await runDbWrites(sport, slate_date, predictions);
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
    db_writes,
  };
}

/**
 * Phase 3C — controlled DB write step. Called only when the two-key gate
 * passed (caller's writeToDb=true + env AUTOMODEL_DB_WRITES_ENABLED=true).
 *
 * Returns a structured outcome rather than throwing. The caller embeds
 * the outcome in AutoModelRunResult.db_writes so partial success
 * (ingest OK, grades failed) is observable instead of hidden behind
 * an exception.
 */
async function runDbWrites(
  sport: Sport,
  slate_date: string,
  predictions: AutoModelOutput[]
): Promise<AutoModelDbWriteOutcome> {
  const computed_at = new Date().toISOString();

  // Map external_id → game_id for the slate (loadGameIdMap is the same
  // helper the manual upload route uses).
  const gameIdByExternal = await loadGameIdMap(sport, slate_date);

  // Adapt model outputs to the ingester's input row shape.
  const rows = predictions.map((p) =>
    autoModelOutputToScoresRow(p, computed_at)
  );

  // Reuse the validated ingest pipeline. Audit row in scores_model_runs
  // is written internally by ingestScoresModel via UPSERT on
  // (sport, source, run_date) — no separate audit code here.
  let ingestResult: IngestionResult;
  try {
    ingestResult = await ingestScoresModel(
      supabase,
      sport,
      rows,
      gameIdByExternal,
      {
        source: "auto_v1_mlb_rules",
        runDate: slate_date,
        validationMode: "auto_model",
      }
    );
  } catch (e) {
    // ingestScoresModel itself doesn't throw under normal conditions
    // (row-level errors land in result.failed). But defensively surface
    // any bulk-level failure as a structured result rather than letting
    // it escape to the caller, so the manual workflow can never end up
    // in a state where the model ran but the operator never sees why.
    const message = e instanceof Error ? e.message : String(e);
    return {
      attempted: true,
      ingest: {
        inserted: 0,
        updated: 0,
        failed: rows.length,
        run_id: null,
        errors: [
          {
            game_external_id: -1,
            errors: [`ingest threw before completion: ${message}`],
          },
        ],
      },
      market_signals: null,
      grades: null,
    };
  }

  const ingest = {
    inserted: ingestResult.inserted,
    updated: ingestResult.updated,
    failed: ingestResult.failed.length,
    run_id: ingestResult.run_id,
    errors: ingestResult.failed.map((f) => ({
      game_external_id: f.row.game_external_id,
      errors: f.errors,
    })),
  };

  // Skip downstream when nothing landed.
  if (ingest.inserted + ingest.updated === 0) {
    return {
      attempted: true,
      ingest,
      market_signals: null,
      grades: null,
    };
  }

  // Downstream 1 — market signals. Partial-fail tolerant.
  let market_signals: AutoModelDbWriteOutcome["market_signals"];
  try {
    const ms = await updateMarketSignalsForSlate(sport, slate_date);
    market_signals = {
      game_predictions_updated: ms.gamePredictionsUpdated,
      prop_predictions_updated: ms.propPredictionsUpdated,
      per_market: ms.perMarket,
      error: null,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    market_signals = { error: message, game_predictions_updated: 0 };
  }

  // Downstream 2 — grades. Partial-fail tolerant.
  let grades: AutoModelDbWriteOutcome["grades"];
  try {
    const g = await updateGradesForSlate(sport, slate_date);
    grades = {
      game_predictions_updated: g.gamePredictionsUpdated,
      prop_predictions_updated: g.propPredictionsUpdated,
      per_market: g.perMarket,
      error: null,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    grades = { error: message, game_predictions_updated: 0 };
  }

  return {
    attempted: true,
    ingest,
    market_signals,
    grades,
  };
}

// ─────────────────────────────────────────────────────────────
// Phase 6B.1 — V2 selection / shadow / fallback helper
// ─────────────────────────────────────────────────────────────

/**
 * Phase 6B.1 — apply V2 prediction to the per-game pipeline if the
 * effective version requests it.
 *
 *   effectiveVersion="v1"     → pass-through V1 output unchanged.
 *   effectiveVersion="v2"     → run V2; on success, use V2's prediction
 *                               values; on error, fall back to V1 with a
 *                               logged warning and tag model_used=v2_fallback_v1.
 *   effectiveVersion="shadow" → run V2; keep V1 prediction values; attach
 *                               v2_audit to sport_specific for comparison.
 *
 * V2 errors NEVER abort the per-game pipeline. The function is wrapped in
 * try/catch so a buggy V2 run produces a fallback to V1, not a per-game
 * exception. This guarantees no game loses its prediction because of a
 * model-version selection problem.
 */
/**
 * Compute the hold_picks list for the ingester validator. hold_picks
 * reflects the CURRENT model's truth — does not inherit V1's stale
 * holds when the current model produced a pick. This matches the user's
 * V2.1 principle: holds only for truly missing/unsafe markets, not
 * "no value" or inherited-from-V1 markets.
 */
function computeHoldPicks(
  _v1HoldPicks: Array<"ml" | "ou" | "nrfi"> | undefined,
  picks: { ml: unknown; ou: unknown; nrfi: unknown },
): Array<"ml" | "ou" | "nrfi"> {
  const holdPicks: Array<"ml" | "ou" | "nrfi"> = [];
  if (picks.ml === null) holdPicks.push("ml");
  if (picks.ou === null) holdPicks.push("ou");
  if (picks.nrfi === null) holdPicks.push("nrfi");
  return holdPicks;
}

function applyV2IfSelected(args: {
  snap: GameSnapshot;
  v1Output: AutoModelOutput;
  stage: ModelStage;
  effectiveVersion: AutomodelVersion;
}): AutoModelOutput {
  const { snap, v1Output, stage, effectiveVersion } = args;
  if (effectiveVersion === "v1") {
    return {
      ...v1Output,
      sport_specific: {
        ...v1Output.sport_specific,
        model_used: "v1",
      },
    };
  }

  // ── V2.1 path (Phase 6B V2.1 — layered prediction-integrity model) ──
  if (effectiveVersion === "v2_1") {
    let v21;
    try {
      v21 = runMlbAutoModelV2_1(snap, v1Output, stage);
    } catch (e) {
      console.warn(
        `[automodelService] runMlbAutoModelV2_1 threw for game_external_id=` +
          `${snap.game_external_id}: ${e instanceof Error ? e.message : String(e)}. ` +
          `Falling back to V1.`
      );
      return {
        ...v1Output,
        sport_specific: {
          ...v1Output.sport_specific,
          model_used: "v2_1_fallback_v1",
        },
      };
    }
    const a = v21.v21Audit;
    const holdPicks = computeHoldPicks(v1Output.sport_specific.hold_picks, {
      ml: v21.predicted_ml_winner,
      ou: v21.predicted_ou_side,
      nrfi: v21.predicted_nrfi,
    });
    return {
      ...v1Output,
      predicted_home_score: v21.predicted_home_score,
      predicted_away_score: v21.predicted_away_score,
      predicted_total: v21.predicted_total,
      predicted_ml_winner: v21.predicted_ml_winner,
      ml_confidence: v21.ml_confidence,
      predicted_ou_side: v21.predicted_ou_side,
      ou_confidence: v21.ou_confidence,
      predicted_nrfi: v21.predicted_nrfi,
      nrfi_confidence: v21.nrfi_confidence,
      sport_specific: {
        ...v1Output.sport_specific,
        model_version: MODEL_VERSION_V2_1,
        model_used: "v2_1",
        hold_picks: holdPicks,
        // V2.1 owns held + hold_reason — derive from V2.1's hold_picks
        // truth so stale V1 flags (e.g., "missing_or_scratched_starter"
        // when V2.1 has real picks) cannot override the current model.
        held: holdPicks.length === 3,
        hold_reason:
          holdPicks.length === 3
            ? (v1Output.sport_specific.hold_reason ?? "all_markets_held")
            : null,
        // V2.1-specific summary fields requested by Daniel.
        ml_play_grade: a.ml_play_grade,
        ou_play_grade: a.ou_play_grade,
        ml_prediction_type: a.ml_prediction_type,
        ou_prediction_type: a.ou_prediction_type,
        ml_best_angle_eligible: a.best_angle_eligible_ml,
        ou_best_angle_eligible: a.best_angle_eligible_ou,
        ml_best_angle_reason: a.ml_best_angle_reason,
        ou_best_angle_reason: a.ou_best_angle_reason,
        ml_no_bet_reason: a.ml_no_bet_reason,
        ou_no_bet_reason: a.ou_no_bet_reason,
        ml_market_aligned: a.ml_market_aligned,
        ou_market_aligned: a.ou_market_aligned,
        v2_provisional: a.provisional,
        v2_data_quality_tier: a.data_quality_tier,
        v2_best_angle_eligible: a.best_angle_eligible_ml || a.best_angle_eligible_ou,
        v2_1_audit: a,
        model_integrity_notes: a.model_integrity_notes,
      },
    };
  }

  // ── V2 / shadow path ────────────────────────────────────────────────
  let v2;
  try {
    v2 = runMlbAutoModelV2(snap, v1Output, stage);
  } catch (e) {
    console.warn(
      `[automodelService] runMlbAutoModelV2 threw for game_external_id=` +
        `${snap.game_external_id}: ${e instanceof Error ? e.message : String(e)}. ` +
        `Falling back to V1.`
    );
    return {
      ...v1Output,
      sport_specific: {
        ...v1Output.sport_specific,
        model_used: "v2_fallback_v1",
      },
    };
  }

  if (effectiveVersion === "shadow") {
    return {
      ...v1Output,
      sport_specific: {
        ...v1Output.sport_specific,
        model_used: "shadow_v1",
        v2_audit: v2.v2Audit,
        v2_provisional: v2.v2Audit.provisional,
        v2_data_quality_tier: v2.v2Audit.dataQuality.tier,
        v2_best_angle_eligible: v2.v2Audit.bestAngleEligibility.eligible,
      },
    };
  }

  // V2 writes its prediction values. Phase 6B.1.1 hold_picks fix
  // re-applied here so V2 writes also pass ingest validation when V2
  // produces null picks for "no value" markets.
  const v2HoldPicks = computeHoldPicks(v1Output.sport_specific.hold_picks, {
    ml: v2.predicted_ml_winner,
    ou: v2.predicted_ou_side,
    nrfi: v2.predicted_nrfi,
  });
  return {
    ...v1Output,
    predicted_home_score: v2.predicted_home_score,
    predicted_away_score: v2.predicted_away_score,
    predicted_total: v2.predicted_total,
    predicted_ml_winner: v2.predicted_ml_winner,
    ml_confidence: v2.ml_confidence,
    predicted_ou_side: v2.predicted_ou_side,
    ou_confidence: v2.ou_confidence,
    predicted_nrfi: v2.predicted_nrfi,
    nrfi_confidence: v2.nrfi_confidence,
    sport_specific: {
      ...v1Output.sport_specific,
      model_version: MODEL_VERSION_V2,
      model_used: "v2",
      hold_picks: v2HoldPicks,
      // V2 owns held + hold_reason — derive from V2's hold_picks truth so
      // stale V1 flags cannot override the current model.
      held: v2HoldPicks.length === 3,
      hold_reason:
        v2HoldPicks.length === 3
          ? (v1Output.sport_specific.hold_reason ?? "all_markets_held")
          : null,
      v2_audit: v2.v2Audit,
      v2_provisional: v2.v2Audit.provisional,
      v2_data_quality_tier: v2.v2Audit.dataQuality.tier,
      v2_best_angle_eligible: v2.v2Audit.bestAngleEligibility.eligible,
    },
  };
}
