/**
 * Scores-model ingester — validates uploaded predictions per sport schema
 * and upserts to game_predictions + records an audit row in scores_model_runs.
 *
 * Replaces the V1 MLB-only ingestDanielsModel(...) from Phase 3D. The new
 * signature is sport-aware:
 *
 *   ingestScoresModel(client, "mlb", rows, gameIdByExternal)
 *   ingestScoresModel(client, "ucl", rows, gameIdByExternal)
 *
 * Per-sport validation comes from sportSchemas.ts. Per-sport ingestion
 * differences (sport_specific JSONB shape, mirroring rules) are also
 * driven by the schema — no special-case branches in the ingester.
 *
 * Audit trail: every call writes a scores_model_runs row keyed on
 * (sport, source, run_date) so manual vs future auto-model performance
 * can be compared empirically. Re-uploads UPSERT the audit row.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Sport } from "../types/domain/Sport";
import type { PredictionSource } from "../types/domain/Prediction";
import type { SourceType } from "../types/domain/Grade";
import {
  getSportSchema,
  type SportSchemaField,
} from "./sportSchemas";

/**
 * Fix 6.1 (Gap-23.5) — infer the data-provenance `source_type` from the
 * caller's `prediction_source` value. The production filter at
 * lib/db/productionFilter.ts excludes `source_type='mock'` rows from
 * member-facing responses; rows uploaded by Daniel via the admin route
 * must be tagged `'manual'` so they pass the filter.
 *
 * Mapping (Flag B1 — inference, not explicit param):
 *   • manual_daniel → "manual"    (V1 admin upload path — pass filter)
 *   • auto_v1/v2/auto_*  → "real_api" (future cron-driven real providers)
 *   • anything unrecognized → "mock" (defensive — never accidentally leak
 *     unverified data into production)
 *
 * Tracked follow-ups: when Phase 8 real_api providers land, their write
 * path may call ingestScoresModel with a new PredictionSource value; this
 * helper auto-maps `auto_*` → `real_api`, so no caller changes needed.
 */
function inferSourceType(predictionSource: PredictionSource): SourceType {
  if (predictionSource === "manual_daniel") return "manual";
  if (
    typeof predictionSource === "string" &&
    predictionSource.startsWith("auto_")
  ) {
    return "real_api";
  }
  return "mock";
}

/** Exported for the test suite to verify the inference contract. */
export { inferSourceType };

// ─────────────────────────────────────────────────────────────────────────
// Validation mode (Phase 3C)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Phase 3C — validation mode for `validateScoresModelRow`.
 *
 *   • "manual" (default): every `required: true` schema field MUST be
 *     present. Matches V1 behavior — preserves the strict admin-upload
 *     contract (no silent incomplete manual uploads).
 *
 *   • "auto_model": pick fields (predicted_ml_winner, ml_confidence,
 *     predicted_ou_side, ou_confidence, predicted_nrfi, nrfi_confidence)
 *     MAY be null/undefined when justified by sport_specific hold context
 *     — i.e. `sport_specific.held === true` OR
 *     `sport_specific.hold_picks` includes the corresponding market
 *     ("ml" / "ou" / "nrfi"). Unjustified nulls still fail with a clear
 *     "auto_model: unjustified null" message. Non-pick required fields
 *     (scores, totals, model_version, etc.) and all format checks are
 *     mode-agnostic.
 *
 * Daniel approved this narrow relaxation in Phase 3C planning so that
 * the auto-model's hold-per-market design (Phase 3A's `null` pick when
 * data is thin or confidence is below floor) writes honestly through
 * `ingestScoresModel` without forcing fake 51% picks or skipping
 * partially-held games entirely.
 */
export type ScoresModelValidationMode = "manual" | "auto_model";

/**
 * Pick fields eligible for the auto_model null-justification relaxation.
 * Keyed by field key → which market (ml/ou/nrfi) the null must be
 * justified against in `sport_specific.hold_picks`.
 *
 * Non-pick required fields (predicted_home_score, predicted_total, etc.)
 * are intentionally NOT in this map — the auto-model always produces
 * scores, so a null score is always an error.
 */
const AUTO_MODEL_RELAXABLE_PICK_FIELDS: Readonly<
  Record<string, "ml" | "ou" | "nrfi">
> = {
  predicted_ml_winner: "ml",
  ml_confidence: "ml",
  predicted_ou_side: "ou",
  ou_confidence: "ou",
  predicted_nrfi: "nrfi",
  nrfi_confidence: "nrfi",
};

/**
 * Check whether a null on `field` is justified by sport_specific hold
 * context. Used by `validateScoresModelRow` only when
 * `validationMode === "auto_model"`.
 *
 * Justified when EITHER:
 *   • `sport_specific.held === true` (whole row held), OR
 *   • `sport_specific.hold_picks` is an array including the field's market
 *
 * Anything else (missing sport_specific, non-array hold_picks, market
 * not listed) → unjustified → caller emits the required-field error.
 */
function isAutoNullJustified(
  field: SportSchemaField,
  row: ScoresModelInputRow
): boolean {
  const market = AUTO_MODEL_RELAXABLE_PICK_FIELDS[field.key];
  if (!market) return false;
  const sportSpecific = row.sport_specific as
    | { held?: unknown; hold_picks?: unknown }
    | null
    | undefined;
  if (!sportSpecific) return false;
  const serializedSportSpecific = sportSpecific as Record<string, unknown>;
  // FI V2 Toss-Up is a valid first-class prediction state: it deliberately
  // clears the directional NRFI/YRFI column while retaining the audited
  // posterior in sport_specific. It is not a data-quality hold.
  if (
    market === "nrfi" &&
    row.predicted_nrfi === null &&
    serializedSportSpecific.fi_model_used === "fi_v2" &&
    serializedSportSpecific.nrfi_decision_kind === "toss_up"
  ) {
    return true;
  }
  if (sportSpecific.held === true) return true;
  if (
    Array.isArray(sportSpecific.hold_picks) &&
    (sportSpecific.hold_picks as unknown[]).includes(market)
  ) {
    return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────
// Input row shape (loose — schema enforces what's required per sport)
// ─────────────────────────────────────────────────────────────────────────

export type ScoresModelInputRow = {
  game_external_id: number;
  // Sport-agnostic core (top-level columns; presence per schema)
  predicted_home_score?: number;
  predicted_away_score?: number;
  predicted_total?: number;
  predicted_ml_winner?: string;
  ml_confidence?: number;
  predicted_ou_side?: string;
  ou_confidence?: number;
  predicted_nrfi?: boolean | null;
  nrfi_confidence?: number;
  // Per-sport extras (validated against schema's sport_specific fields)
  sport_specific?: Record<string, unknown>;
  // Metadata
  model_version: string;
  computed_at: string;       // ISO 8601
  /**
   * Phase 4.2.B — optional manual-override flag. When true, this write
   * bypasses the Layer 1 lock guard and updates locked predictions. Used
   * by the (future) manual-edit route to fix a bad pick after T-60 lock
   * has passed. Defaults to false / undefined for every existing caller
   * (cron path, manual upload via admin route, automodelService) so no
   * existing behavior changes.
   *
   * The persisted DB column `is_override` is set by buildPayload from
   * source semantics, not from this field — this field is a directive
   * to the GUARD only, not a write to the column. The guard reads it
   * pre-upsert; if it ever needs to be persisted as well, a separate
   * change can wire that in.
   */
  is_override?: boolean;
};

/** Back-compat alias — Phase 3D callers used this name. */
export type DanielsModelRow = ScoresModelInputRow & {
  predicted_home_score: number;
  predicted_away_score: number;
  predicted_total: number;
  predicted_ml_winner: string;
  ml_confidence: number;
  predicted_ou_side: string;
  ou_confidence: number;
  predicted_nrfi: boolean;
  nrfi_confidence: number;
};

export type IngestionResult = {
  inserted: number;
  updated: number;
  failed: Array<{ row: ScoresModelInputRow; errors: string[] }>;
  /** ID of the scores_model_runs audit row (null on early-fail before insert). */
  run_id: number | null;
};

// ─────────────────────────────────────────────────────────────────────────
// Pure validator — testable without Supabase
// ─────────────────────────────────────────────────────────────────────────

/**
 * Validate one row against the sport's schema.
 * Returns the row when valid, or a list of error messages.
 *
 * Phase 3C: `validationMode` defaults to "manual" — strict, every
 * required field present. Pass "auto_model" from the automodelService
 * write branch to permit nulls on pick fields when justified by
 * sport_specific hold context. See ScoresModelValidationMode docs.
 */
export function validateScoresModelRow(
  sport: Sport,
  row: ScoresModelInputRow,
  knownGameExternalIds: Set<number>,
  validationMode: ScoresModelValidationMode = "manual"
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  // Top-level required: game_external_id, model_version, computed_at
  if (!Number.isFinite(row.game_external_id) || row.game_external_id <= 0) {
    errors.push(`invalid game_external_id: ${row.game_external_id}`);
  } else if (!knownGameExternalIds.has(row.game_external_id)) {
    errors.push(
      `unknown game_external_id ${row.game_external_id} (no matching game in DB)`
    );
  }
  if (!row.model_version || row.model_version.trim().length === 0) {
    errors.push(`model_version is required`);
  }
  if (Number.isNaN(Date.parse(row.computed_at))) {
    errors.push(`computed_at must be a valid ISO timestamp`);
  }

  // Per-sport schema enforcement
  const schema = getSportSchema(sport);
  for (const field of schema.fields) {
    const value = readFieldValue(field, row);
    if (value === undefined || value === null) {
      if (!field.required) continue;
      // Phase 3C: in auto_model mode, allow nulls on pick fields when
      // justified by sport_specific hold context. Unjustified nulls
      // surface a distinct error so the operator can tell at a glance
      // whether the row was malformed vs missing hold context.
      if (
        validationMode === "auto_model" &&
        field.key in AUTO_MODEL_RELAXABLE_PICK_FIELDS
      ) {
        if (isAutoNullJustified(field, row)) continue;
        errors.push(
          `${field.label} (${field.key}) is required (auto_model: ` +
            `unjustified null — sport_specific.held !== true and ` +
            `hold_picks does not include "${AUTO_MODEL_RELAXABLE_PICK_FIELDS[field.key]}")`
        );
        continue;
      }
      errors.push(`${field.label} (${field.key}) is required`);
      continue;
    }
    const fieldError = validateFieldValue(field, value);
    if (fieldError) errors.push(fieldError);
  }

  if (errors.length === 0) return { ok: true };
  return { ok: false, errors };
}

function readFieldValue(
  field: SportSchemaField,
  row: ScoresModelInputRow
): unknown {
  if (field.scope === "top_level") {
    return (row as unknown as Record<string, unknown>)[field.key];
  }
  return (row.sport_specific ?? {})[field.key];
}

function validateFieldValue(field: SportSchemaField, value: unknown): string | null {
  const label = `${field.label} (${field.key})`;
  switch (field.type) {
    case "number":
    case "percent": {
      if (typeof value !== "number" || Number.isNaN(value)) {
        return `${label} must be a number, got ${typeof value}`;
      }
      if (field.min !== undefined && value < field.min) {
        return `${label} must be >= ${field.min}, got ${value}`;
      }
      if (field.max !== undefined && value > field.max) {
        return `${label} must be <= ${field.max}, got ${value}`;
      }
      return null;
    }
    case "enum": {
      if (typeof value !== "string") {
        return `${label} must be a string, got ${typeof value}`;
      }
      if (field.options && !field.options.includes(value)) {
        return `${label} must be one of ${field.options.join("|")}, got '${value}'`;
      }
      return null;
    }
    case "boolean": {
      if (typeof value !== "boolean") {
        return `${label} must be a boolean, got ${typeof value}`;
      }
      return null;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Payload builder — drives top-level + sport_specific writes from schema
// ─────────────────────────────────────────────────────────────────────────

/**
 * Fix 7.2.3 — invariant `predicted_total = home + away`. The form's
 * disabled-total input already submits the computed value, but the
 * ingester re-derives defensively before UPSERT so any direct-API caller
 * (curl, future automation) that submits a mismatched total has it
 * silently corrected. Rounds to 1 decimal place to dodge float artifacts
 * (4.1 + 3.2 → 7.3, not 7.300000000000001).
 *
 * Applies only when both component fields are numeric AND the schema
 * declares a `computeFrom: "predicted_home_score + predicted_away_score"`
 * field. For sports that don't declare it the row passes through
 * unchanged.
 *
 * Exported for direct unit testing.
 */
export function reconcilePredictedTotal(
  sport: Sport,
  row: ScoresModelInputRow
): ScoresModelInputRow {
  const schema = getSportSchema(sport);
  const hasComputedTotal = schema.fields.some(
    (f) =>
      f.key === "predicted_total" &&
      f.computeFrom === "predicted_home_score + predicted_away_score"
  );
  if (!hasComputedTotal) return row;

  const home = (row as Record<string, unknown>).predicted_home_score;
  const away = (row as Record<string, unknown>).predicted_away_score;
  if (typeof home !== "number" || typeof away !== "number") return row;
  if (!Number.isFinite(home) || !Number.isFinite(away)) return row;

  const total = Math.round((home + away) * 10) / 10;
  return {
    ...row,
    predicted_total: total,
  } as ScoresModelInputRow;
}

function buildPayload(
  sport: Sport,
  row: ScoresModelInputRow,
  gameId: number,
  source: PredictionSource
): Record<string, unknown> {
  const schema = getSportSchema(sport);
  // Fix 7.2.3: server-side recompute of predicted_total. See helper above.
  const reconciledRow = reconcilePredictedTotal(sport, row);
  // Fix 6.1 (Gap-23.5): set source_type explicitly. Pre-Fix-6.1 this column
  // was omitted, so the DB default 'mock' applied to every row — including
  // Daniel's manual uploads, which then got filtered out in production.
  // The inferSourceType helper maps the existing prediction_source ("who
  // wrote this") to source_type ("what provenance tier").
  const topLevel: Record<string, unknown> = {
    game_id: gameId,
    prediction_source: source,
    source_type: inferSourceType(source),
    is_override: false,
    original_auto_prediction: null,
    model_version: reconciledRow.model_version,
    computed_at: reconciledRow.computed_at,
  };
  // Phase 3C: preserve caller-supplied sport_specific fields as the base
  // so Phase 3A audit context (model_version, stage, held, hold_picks,
  // hold_reason, auto_factors, ai_sanity, …) survives ingest. Schema-
  // declared sport_specific fields (e.g. MLB listed_line, UCL win-pct,
  // mirrored predicted_nrfi) overlay the base in the schema loop below
  // and remain canonical for keys both sides care about.
  //
  // Manual-upload back-compat: callers that don't pass sport_specific
  // (or pass only schema-declared fields) see the identical output they
  // got pre-3C. The spread of `null`/`undefined` yields `{}` — no extra
  // keys leak in.
  const sportSpecific: Record<string, unknown> = {
    ...(reconciledRow.sport_specific ?? {}),
  };

  const persistExplicitFiTossUpNull = (field: SportSchemaField): boolean =>
    field.key === "predicted_nrfi" &&
    reconciledRow.predicted_nrfi === null &&
    reconciledRow.sport_specific?.fi_model_used === "fi_v2" &&
    reconciledRow.sport_specific?.nrfi_decision_kind === "toss_up";

  for (const field of schema.fields) {
    const value = readFieldValue(field, reconciledRow);
    if (value === undefined || (value === null && !persistExplicitFiTossUpNull(field))) continue;
    if (field.scope === "top_level") {
      topLevel[field.key] = value;
      if (field.mirrorToSportSpecific) sportSpecific[field.key] = value;
    } else {
      sportSpecific[field.key] = value;
    }
  }

  topLevel.sport_specific =
    Object.keys(sportSpecific).length > 0 ? sportSpecific : null;
  return topLevel;
}

// ─────────────────────────────────────────────────────────────────────────
// Ingester — impure; takes the Supabase client
// ─────────────────────────────────────────────────────────────────────────

export type IngestOptions = {
  /** Override the slate date used for the scores_model_runs audit row.
   *  Defaults to today (UTC). */
  runDate?: string;
  /** prediction_source value. Defaults to 'manual_daniel' (V1 manual upload). */
  source?: PredictionSource;
  /**
   * Phase 3C — validation mode. Defaults to "manual" (strict). Pass
   * "auto_model" from automodelService to permit nulls on pick fields
   * when justified by sport_specific hold context. See
   * `ScoresModelValidationMode` for the full contract.
   */
  validationMode?: ScoresModelValidationMode;
};

export async function ingestScoresModel(
  client: SupabaseClient,
  sport: Sport,
  rows: ScoresModelInputRow[],
  gameIdByExternal: Map<number, number>,
  options: IngestOptions = {}
): Promise<IngestionResult> {
  const source = options.source ?? "manual_daniel";
  const runDate =
    options.runDate ?? new Date().toISOString().slice(0, 10);
  const validationMode: ScoresModelValidationMode =
    options.validationMode ?? "manual";
  const startedAt = new Date().toISOString();

  const result: IngestionResult = {
    inserted: 0,
    updated: 0,
    failed: [],
    run_id: null,
  };
  const knownExternalIds = new Set(gameIdByExternal.keys());

  type ToUpsert = { row: ScoresModelInputRow; gameId: number };
  const validated: ToUpsert[] = [];

  for (const row of rows) {
    const v = validateScoresModelRow(
      sport,
      row,
      knownExternalIds,
      validationMode
    );
    if (!v.ok) {
      result.failed.push({ row, errors: v.errors });
      continue;
    }
    const gameId = gameIdByExternal.get(row.game_external_id);
    if (gameId === undefined) {
      result.failed.push({
        row,
        errors: ["game_id mapping missing post-validation"],
      });
      continue;
    }
    validated.push({ row, gameId });
  }

  // Always record an audit row even on full-failure, so the run is visible.
  // We UPSERT at the end so the timeline (started_at / completed_at) is correct.
  const errorMessages: string[] = result.failed.flatMap((f) =>
    f.errors.map((e) => `[ext_id ${f.row.game_external_id}] ${e}`)
  );

  if (validated.length === 0) {
    const runId = await writeAuditRow(client, {
      sport,
      source,
      run_date: runDate,
      predictions_count: rows.length,
      successful_count: 0,
      failed_count: result.failed.length,
      model_version: rows[0]?.model_version ?? null,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      error_messages: errorMessages,
    });
    result.run_id = runId;
    return result;
  }

  // Pre-existing snapshot for insert-vs-update counts AND (Phase 4.2.B)
  // Layer 1 lock guard. We read game_id + locked_at + is_override here so
  // the same query feeds the existing-vs-new accounting AND the lock-skip
  // decision below — keeps the round-trip count at one.
  const validatedIds = validated.map((v) => v.gameId);
  const { data: existing } = await client
    .from("game_predictions")
    .select("game_id, locked_at, is_override, sport_specific")
    .in("game_id", validatedIds);
  type ExistingRow = {
    game_id: number;
    locked_at: string | null;
    is_override: boolean;
    // Read so we can PRESERVE additive metadata keys (posted_lines) that the
    // model write would otherwise wipe by replacing sport_specific wholesale.
    sport_specific: Record<string, unknown> | null;
  };
  const existingByGameId = new Map<number, ExistingRow>(
    ((existing ?? []) as ExistingRow[]).map((r) => [r.game_id, r])
  );
  const existingSet = new Set(existingByGameId.keys());

  // Phase 4.2.B Layer 1 — lock guard.
  //
  // Filter out validated rows that target an already-locked
  // game_predictions row, UNLESS the incoming row is a manual override.
  // Locked-and-skipped rows are pushed onto result.failed[] with a
  // stable errors marker so callers (cron audit log, operator scripts)
  // can detect lock-related skips distinctly from validation failures.
  //
  // Manual override semantics (incoming row carries is_override=true):
  //   • V1 status: no code path currently sets incoming is_override=true.
  //     The bypass exists as the documented escape hatch promised by
  //     Phase 4.2.B planning ("manual overrides may still update locked
  //     games"). When a future manual-edit route lands, it sets
  //     is_override=true on the input row and bypasses this guard.
  //   • The bypass is checked on the INCOMING row's is_override field
  //     (added below as an optional field on ScoresModelInputRow), NOT
  //     on the existing DB row's is_override. The DB-side flag tracks
  //     "this row has been overridden in the past"; the incoming flag
  //     declares "this write is an override action".
  //
  // The audit row's failed_count reflects locked-skipped rows so the
  // refresh_log surfaces them as visible activity.
  const writable: ToUpsert[] = [];
  for (const v of validated) {
    const ex = existingByGameId.get(v.gameId);
    const isLocked = ex !== undefined && ex.locked_at !== null;
    const incomingIsOverride =
      (v.row as { is_override?: boolean }).is_override === true;
    if (isLocked && !incomingIsOverride) {
      result.failed.push({
        row: v.row,
        errors: ["locked: cron write blocked because locked_at is set; manual override path required to update"],
      });
      continue;
    }
    writable.push(v);
  }

  // If lock guard skipped every row, we still need to record an audit
  // entry with the skipped count and return cleanly — same shape as the
  // validated.length === 0 path above but reached for a different reason.
  if (writable.length === 0) {
    const lockMessages: string[] = result.failed.flatMap((f) =>
      f.errors
        .filter((e) => e.startsWith("locked:"))
        .map((e) => `[ext_id ${f.row.game_external_id}] ${e}`)
    );
    const runId = await writeAuditRow(client, {
      sport,
      source,
      run_date: runDate,
      predictions_count: rows.length,
      successful_count: 0,
      failed_count: result.failed.length,
      model_version: rows[0]?.model_version ?? null,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      error_messages: [...errorMessages, ...lockMessages],
    });
    result.run_id = runId;
    return result;
  }

  // Build payload and upsert (only the rows that passed the lock guard).
  //
  // Phase 6B.18 — DEFENSIVE LOCK PRESERVATION. Pre-6B.18 we relied on
  // Supabase/PostgREST's documented "only SET columns present in the
  // payload" behavior. In practice the prod 2026-06-07 evidence shows
  // game_predictions.locked_at being cleared between cron firings
  // somewhere in this pipeline (multiple re-lock entries per game in
  // admin_audit_log). Explicit defense-in-depth: read the existing
  // row's locked_at + is_override before upsert and include them
  // verbatim in the payload, so EXCLUDED.locked_at and
  // EXCLUDED.is_override re-set the same value on conflict instead of
  // relying on column omission to preserve them. Has no effect on
  // unlocked rows (existing locked_at IS null → set null → preserved).
  const payload = writable.map(({ row, gameId }) => {
    const base = buildPayload(sport, row, gameId, source);
    const ex = existingByGameId.get(gameId);
    if (ex !== undefined) {
      base.locked_at = ex.locked_at;
      base.is_override = ex.is_override;
      // 2026-06-16 — PRESERVE additive `posted_lines` (First Published) across
      // the overwrite. The model write rebuilds sport_specific from the model
      // output only, which would otherwise WIPE posted_lines on every
      // recompute. We carry the existing value verbatim when the incoming
      // payload doesn't already have one. Only this additive metadata key is
      // preserved — predictions/scores/grades are untouched. No effect when
      // the existing row had no posted_lines.
      const existingPosted = (ex.sport_specific as { posted_lines?: unknown } | null)?.posted_lines;
      if (existingPosted != null) {
        const ss = (base.sport_specific as Record<string, unknown> | null) ?? {};
        if (ss.posted_lines == null) {
          base.sport_specific = { ...ss, posted_lines: existingPosted };
        }
      }
    }
    return base;
  });
  const { error } = await client
    .from("game_predictions")
    .upsert(payload, { onConflict: "game_id" });

  if (error) {
    // Bulk upsert blew up — every `writable` row failed. (Rows that were
    // already pushed to result.failed by the lock guard above stay there.)
    for (const { row } of writable) {
      result.failed.push({
        row,
        errors: [`bulk upsert failed: ${error.message}`],
      });
    }
    errorMessages.push(`bulk upsert failed: ${error.message}`);
    const runId = await writeAuditRow(client, {
      sport,
      source,
      run_date: runDate,
      predictions_count: rows.length,
      successful_count: 0,
      failed_count: result.failed.length,
      model_version: rows[0]?.model_version ?? null,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      error_messages: errorMessages,
    });
    result.run_id = runId;
    return result;
  }

  // Only the rows that actually got upserted count as inserts/updates.
  for (const { gameId } of writable) {
    if (existingSet.has(gameId)) result.updated++;
    else result.inserted++;
  }

  // Audit row reflects rows that actually wrote (writable.length), not the
  // pre-lock-guard count (validated.length). Phase 4.2.B lock-skipped rows
  // appear in result.failed and propagate to failed_count + error_messages
  // — but successful_count is now exclusively for rows that hit the UPSERT.
  const lockMessages: string[] = result.failed.flatMap((f) =>
    f.errors
      .filter((e) => e.startsWith("locked:"))
      .map((e) => `[ext_id ${f.row.game_external_id}] ${e}`)
  );
  const allErrorMessages = [...errorMessages, ...lockMessages];
  const runId = await writeAuditRow(client, {
    sport,
    source,
    run_date: runDate,
    predictions_count: rows.length,
    successful_count: writable.length,
    failed_count: result.failed.length,
    model_version: rows[0]?.model_version ?? null,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    error_messages: allErrorMessages.length > 0 ? allErrorMessages : null,
  });
  result.run_id = runId;
  return result;
}

type AuditRow = {
  sport: Sport;
  source: PredictionSource;
  run_date: string;
  predictions_count: number;
  successful_count: number;
  failed_count: number;
  model_version: string | null;
  started_at: string;
  completed_at: string;
  error_messages: string[] | null;
};

async function writeAuditRow(
  client: SupabaseClient,
  row: AuditRow
): Promise<number | null> {
  const { data, error } = await client
    .from("scores_model_runs")
    .upsert(row, { onConflict: "sport,source,run_date" })
    .select("id")
    .single();
  if (error) {
    // Non-fatal — log but don't break ingestion. The audit row is for
    // observability, not for the success of the upsert.
    console.error(`scores_model_runs write failed: ${error.message}`);
    return null;
  }
  return (data as { id: number } | null)?.id ?? null;
}

// ─────────────────────────────────────────────────────────────────────────
// Back-compat: existing Phase 3D callers used ingestDanielsModel
// ─────────────────────────────────────────────────────────────────────────

/**
 * @deprecated Use ingestScoresModel(client, 'mlb', rows, gameIdByExternal).
 * Kept as a thin shim so Phase 3D scripts continue to work during the 4B
 * cutover. Will be removed once all callers are migrated.
 */
export async function ingestDanielsModel(
  client: SupabaseClient,
  rows: DanielsModelRow[],
  gameIdByExternal: Map<number, number>
): Promise<IngestionResult> {
  return ingestScoresModel(client, "mlb", rows, gameIdByExternal);
}

/** @deprecated Use validateScoresModelRow(sport, row, knownGameExternalIds). */
export function validateDanielsModelRow(
  row: DanielsModelRow,
  knownGameExternalIds: Set<number>
): { ok: true } | { ok: false; error: string } {
  const v = validateScoresModelRow("mlb", row, knownGameExternalIds);
  if (v.ok) return { ok: true };
  return { ok: false, error: v.errors[0] ?? "validation failed" };
}
