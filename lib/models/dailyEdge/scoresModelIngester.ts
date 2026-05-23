/**
 * Daniel's scores-model ingester — validates uploaded model output and
 * upserts to game_predictions.
 *
 * V1 input: JSON-shaped rows (matches daniels_model.json fixture).
 * Future: CSV upload via Phase 4 admin route.
 *
 * Upsert semantics: ON CONFLICT (game_id) DO UPDATE — re-running with the
 * same game_id replaces the prior row's predicted_* and confidence fields
 * but preserves the BIGSERIAL id (so prediction_results FKs still resolve).
 *
 * The function does NOT throw on per-row validation failures — it collects
 * them in the `failed` array so the caller can log a partial-success batch.
 * One bad row should not kill the whole ingestion.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type DanielsModelRow = {
  game_external_id: number;
  predicted_home_runs: number;
  predicted_away_runs: number;
  predicted_total: number;
  predicted_ml_winner: string;       // 'home' | 'away'
  ml_confidence: number;             // 0-100
  predicted_ou_side: string;          // 'over' | 'under'
  ou_confidence: number;
  predicted_nrfi: boolean;
  nrfi_confidence: number;
  model_version: string;
  computed_at: string;                // ISO 8601
};

export type IngestionResult = {
  inserted: number;
  updated: number;
  skipped: number;
  failed: Array<{ row: DanielsModelRow; error: string }>;
};

// ─────────────────────────────────────────────────────────────────────────
// Pure validator — testable without Supabase
// ─────────────────────────────────────────────────────────────────────────

export function validateDanielsModelRow(
  row: DanielsModelRow,
  knownGameExternalIds: Set<number>
): { ok: true } | { ok: false; error: string } {
  if (!Number.isFinite(row.game_external_id) || row.game_external_id <= 0) {
    return { ok: false, error: `invalid game_external_id: ${row.game_external_id}` };
  }
  if (!knownGameExternalIds.has(row.game_external_id)) {
    return {
      ok: false,
      error: `unknown game_external_id ${row.game_external_id} (no matching game in DB)`,
    };
  }
  if (row.ml_confidence < 0 || row.ml_confidence > 100) {
    return { ok: false, error: `ml_confidence out of range [0,100]: ${row.ml_confidence}` };
  }
  if (row.ou_confidence < 0 || row.ou_confidence > 100) {
    return { ok: false, error: `ou_confidence out of range [0,100]: ${row.ou_confidence}` };
  }
  if (row.nrfi_confidence < 0 || row.nrfi_confidence > 100) {
    return { ok: false, error: `nrfi_confidence out of range [0,100]: ${row.nrfi_confidence}` };
  }
  if (row.predicted_ml_winner !== "home" && row.predicted_ml_winner !== "away") {
    return { ok: false, error: `predicted_ml_winner must be 'home' or 'away'` };
  }
  if (row.predicted_ou_side !== "over" && row.predicted_ou_side !== "under") {
    return { ok: false, error: `predicted_ou_side must be 'over' or 'under'` };
  }
  if (row.predicted_home_runs < 0 || row.predicted_away_runs < 0) {
    return { ok: false, error: `predicted runs must be ≥ 0` };
  }
  if (!row.model_version || row.model_version.trim().length === 0) {
    return { ok: false, error: `model_version is required` };
  }
  if (Number.isNaN(Date.parse(row.computed_at))) {
    return { ok: false, error: `computed_at must be a valid ISO timestamp` };
  }
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────
// Ingester — impure; takes the Supabase client
// ─────────────────────────────────────────────────────────────────────────

/**
 * Upsert validated rows into game_predictions.
 *
 * @param client Supabase service-role client.
 * @param rows  Daniel's model output rows.
 * @param gameIdByExternal external_id → DB id map; must include every row's
 *                          game_external_id (failures bubble into `failed`).
 */
export async function ingestDanielsModel(
  client: SupabaseClient,
  rows: DanielsModelRow[],
  gameIdByExternal: Map<number, number>
): Promise<IngestionResult> {
  const result: IngestionResult = {
    inserted: 0,
    updated: 0,
    skipped: 0,
    failed: [],
  };
  const knownExternalIds = new Set(gameIdByExternal.keys());

  type ToUpsert = {
    row: DanielsModelRow;
    gameId: number;
  };
  const validated: ToUpsert[] = [];

  for (const row of rows) {
    const v = validateDanielsModelRow(row, knownExternalIds);
    if (!v.ok) {
      result.failed.push({ row, error: v.error });
      continue;
    }
    const gameId = gameIdByExternal.get(row.game_external_id);
    if (gameId === undefined) {
      // Shouldn't happen post-validation, but defensive
      result.failed.push({ row, error: "game_id mapping missing post-validation" });
      continue;
    }
    validated.push({ row, gameId });
  }

  if (validated.length === 0) return result;

  // Check which game_ids already have predictions — distinguishes
  // inserted vs updated for the result counts.
  const validatedIds = validated.map((v) => v.gameId);
  const { data: existing } = await client
    .from("game_predictions")
    .select("game_id")
    .in("game_id", validatedIds);
  const existingSet = new Set(
    ((existing ?? []) as { game_id: number }[]).map((r) => r.game_id)
  );

  // Build upsert payload
  const payload = validated.map(({ row, gameId }) => ({
    game_id: gameId,
    predicted_home_runs: row.predicted_home_runs,
    predicted_away_runs: row.predicted_away_runs,
    predicted_total: row.predicted_total,
    predicted_ml_winner: row.predicted_ml_winner,
    ml_confidence: row.ml_confidence,
    predicted_ou_side: row.predicted_ou_side,
    ou_confidence: row.ou_confidence,
    predicted_nrfi: row.predicted_nrfi,
    nrfi_confidence: row.nrfi_confidence,
    model_version: row.model_version,
    computed_at: row.computed_at,
  }));

  const { error } = await client
    .from("game_predictions")
    .upsert(payload, { onConflict: "game_id" });

  if (error) {
    // Bulk upsert failed — mark all validated rows as failed
    for (const { row } of validated) {
      result.failed.push({ row, error: `bulk upsert failed: ${error.message}` });
    }
    return result;
  }

  // Count inserted vs updated based on the pre-existing snapshot
  for (const { gameId } of validated) {
    if (existingSet.has(gameId)) {
      result.updated++;
    } else {
      result.inserted++;
    }
  }

  return result;
}
