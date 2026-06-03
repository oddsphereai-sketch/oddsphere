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
import { reviewAutoModelOutput } from "../automodel/aiSanityBoundary";
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
  const respectLocks = opts.respectLocks !== false;
  let effectiveFilter: number[] | undefined = opts.gameExternalIdsFilter;
  if (respectLocks) {
    const lockedExternalIds = await fetchLockedExternalIds(sport, slate_date);
    if (lockedExternalIds.size > 0) {
      if (effectiveFilter === undefined) {
        // No prior filter — build one that excludes locked games.
        // We need the full slate's external ids to subtract from, so a
        // bare "exclude locked" needs the slate's external_id list first.
        const allExternalIds = await fetchSlateExternalIds(sport, slate_date);
        effectiveFilter = allExternalIds.filter(
          (id) => !lockedExternalIds.has(id)
        );
      } else {
        effectiveFilter = effectiveFilter.filter(
          (id) => !lockedExternalIds.has(id)
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

      // 2c — Phase 4C: enrich sport_specific via the optional hook.
      // Hook errors do NOT fail the game — log + proceed with the
      // un-enriched prediction so a single buggy hook can't sink the
      // whole slate. When hook is undefined (Phase 3B/3C callers),
      // this branch is skipped entirely → existing behavior preserved.
      let enrichedSportSpecific: AutoModelSportSpecific =
        rawPrediction.sport_specific;
      if (opts.enrichmentHook !== undefined) {
        try {
          const extra = opts.enrichmentHook(snap, rawPrediction);
          enrichedSportSpecific = {
            ...rawPrediction.sport_specific,
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
          const breakdown = generatePickBreakdown(
            { ...rawPrediction, sport_specific: enrichedSportSpecific },
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

      const finalPrediction: AutoModelOutput = {
        ...rawPrediction,
        sport_specific: withBreakdown,
      };

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
