/**
 * POST /api/admin/upload-scores-model
 *
 * Body: { sport, date, predictions: ScoresModelInputRow[] }
 *
 * Validates each prediction against the sport's schema (via the ingester),
 * UPSERTs to game_predictions, records a row in scores_model_runs, then
 * triggers verdict regeneration for the affected games so cards update
 * immediately.
 *
 * Returns counts + per-row error messages. Idempotent — re-upload same day
 * overwrites prior values for matching game_ids.
 */

import { supabase } from "@/lib/db/supabase";
import { validateAdminAuth } from "@/lib/auth/admin";
import {
  ingestScoresModel,
  type ScoresModelInputRow,
} from "@/lib/scoresModel/ingester";
import { predictionService } from "@/lib/services/predictionService";
import { loadGameIdMap } from "@/lib/services/_idMaps";
import type { Sport } from "@/lib/types/domain/Sport";

type RequestBody = {
  sport: Sport;
  date: string;
  predictions: ScoresModelInputRow[];
};

export async function POST(request: Request) {
  const auth = validateAdminAuth(request);
  if (!auth.ok) return auth.response;

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.sport || !body.date) {
    return Response.json(
      { error: "Required body fields: sport, date, predictions[]" },
      { status: 400 }
    );
  }
  if (!Array.isArray(body.predictions)) {
    return Response.json(
      { error: "predictions must be an array" },
      { status: 400 }
    );
  }

  // Resolve game_external_id → game_id for the slate
  const gameIdByExternal = await loadGameIdMap(body.sport, body.date);

  // Ingest
  const result = await ingestScoresModel(
    supabase,
    body.sport,
    body.predictions,
    gameIdByExternal,
    { runDate: body.date, source: "manual_daniel" }
  );

  // Trigger sharp verdict regeneration for affected games (only if any
  // predictions actually wrote). Verdicts re-compose using the new scores
  // model context — same pipeline whether triggered here or by a cron.
  let verdictsUpdated = 0;
  if (result.inserted + result.updated > 0) {
    const gameIds = [...gameIdByExternal.values()];
    const v = await predictionService.regenerateSharpVerdicts(gameIds);
    verdictsUpdated = v.records_updated ?? 0;
  }

  return Response.json({
    sport: body.sport,
    date: body.date,
    inserted: result.inserted,
    updated: result.updated,
    failed: result.failed.length,
    verdicts_updated: verdictsUpdated,
    run_id: result.run_id,
    errors: result.failed.map((f) => ({
      game_external_id: f.row.game_external_id,
      errors: f.errors,
    })),
  });
}
