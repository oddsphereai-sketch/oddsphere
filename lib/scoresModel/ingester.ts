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
  predicted_nrfi?: boolean;
  nrfi_confidence?: number;
  // Per-sport extras (validated against schema's sport_specific fields)
  sport_specific?: Record<string, unknown>;
  // Metadata
  model_version: string;
  computed_at: string;       // ISO 8601
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
 */
export function validateScoresModelRow(
  sport: Sport,
  row: ScoresModelInputRow,
  knownGameExternalIds: Set<number>
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
      if (field.required) errors.push(`${field.label} (${field.key}) is required`);
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

function buildPayload(
  sport: Sport,
  row: ScoresModelInputRow,
  gameId: number,
  source: PredictionSource
): Record<string, unknown> {
  const schema = getSportSchema(sport);
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
    model_version: row.model_version,
    computed_at: row.computed_at,
  };
  const sportSpecific: Record<string, unknown> = {};

  for (const field of schema.fields) {
    const value = readFieldValue(field, row);
    if (value === undefined || value === null) continue;
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
    const v = validateScoresModelRow(sport, row, knownExternalIds);
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

  // Pre-existing snapshot for insert-vs-update counts
  const validatedIds = validated.map((v) => v.gameId);
  const { data: existing } = await client
    .from("game_predictions")
    .select("game_id")
    .in("game_id", validatedIds);
  const existingSet = new Set(
    ((existing ?? []) as { game_id: number }[]).map((r) => r.game_id)
  );

  // Build payload and upsert
  const payload = validated.map(({ row, gameId }) =>
    buildPayload(sport, row, gameId, source)
  );
  const { error } = await client
    .from("game_predictions")
    .upsert(payload, { onConflict: "game_id" });

  if (error) {
    for (const { row } of validated) {
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
      failed_count: rows.length,
      model_version: rows[0]?.model_version ?? null,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      error_messages: errorMessages,
    });
    result.run_id = runId;
    return result;
  }

  for (const { gameId } of validated) {
    if (existingSet.has(gameId)) result.updated++;
    else result.inserted++;
  }

  const runId = await writeAuditRow(client, {
    sport,
    source,
    run_date: runDate,
    predictions_count: rows.length,
    successful_count: validated.length,
    failed_count: result.failed.length,
    model_version: rows[0]?.model_version ?? null,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    error_messages: errorMessages.length > 0 ? errorMessages : null,
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
