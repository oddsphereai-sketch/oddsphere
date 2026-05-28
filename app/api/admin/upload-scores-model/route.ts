/**
 * POST /api/admin/upload-scores-model
 *
 * Body: { sport, date, predictions: ScoresModelInputRow[] }
 *
 * Validates each prediction against the sport's schema (via the ingester),
 * UPSERTs to game_predictions, records a row in scores_model_runs, then
 * synchronously derives per-pick grades (Fix 6.1.1) so Daily Edge renders
 * actual pick cards immediately instead of "No Pick" until the next cron
 * run.
 *
 * Returns counts + per-row error messages + grades_updated summary.
 * Idempotent — re-upload same day overwrites prior values for matching
 * game_ids and re-runs derivation against the freshly-written rows.
 */

import { supabase } from "@/lib/db/supabase";
import { validateAdminAuth } from "@/lib/auth/admin";
import {
  ingestScoresModel,
  type ScoresModelInputRow,
} from "@/lib/scoresModel/ingester";
import { updateGradesForSlate } from "@/lib/services/gradeDerivationService";
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

  // Fix 6.1.1 (Flag A1): synchronously derive per-pick grades for the slate
  // we just ingested. Without this call, manual uploads leave ml_grade /
  // ou_grade / nrfi_grade NULL until the next morning-slate or pregame-
  // sweep cron run — and operator-created slates on dates the cron will
  // never visit (e.g. far-future test slates) stay un-graded forever, so
  // the Daily Edge UI renders "No Pick" until somebody intervenes. The
  // combined Fix 6.1 + Fix 7.2 production smoke surfaced this gap.
  //
  // Flag B1 — structured partial success: if updateGradesForSlate throws,
  // we do NOT roll back the successful ingest. The raw prediction data is
  // valid and can be re-derived later (next cron tick or a re-upload).
  // The route returns 200 with both the successful ingest counts AND a
  // grades_updated.error field describing the failure. Operator sees both
  // pieces of state in the response.
  type GradesUpdated = {
    game_predictions: number;
    prop_predictions: number;
    per_market: {
      ml: { derived: number; written: number };
      ou: { derived: number; written: number };
      nrfi: { derived: number; written: number };
    };
    error?: string;
  };
  let gradesUpdated: GradesUpdated;
  try {
    const derived = await updateGradesForSlate(body.sport, body.date);
    gradesUpdated = {
      game_predictions: derived.gamePredictionsUpdated,
      prop_predictions: derived.propPredictionsUpdated,
      per_market: derived.perMarket,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    gradesUpdated = {
      game_predictions: 0,
      prop_predictions: 0,
      per_market: {
        ml: { derived: 0, written: 0 },
        ou: { derived: 0, written: 0 },
        nrfi: { derived: 0, written: 0 },
      },
      error: message,
    };
  }

  return Response.json({
    sport: body.sport,
    date: body.date,
    inserted: result.inserted,
    updated: result.updated,
    failed: result.failed.length,
    // Fix 6.1.1 (Flag C1): verdicts_updated dropped. It was a Fix-4.1
    // vestige that always returned 0 because the legacy regenerateSharp-
    // Verdicts pipeline was deleted; the replacement work (calling
    // updateGradesForSlate) was never added until now. grades_updated
    // below is the new at-rest grade derivation contract.
    run_id: result.run_id,
    // Fix 6.1 (Gap-23.5): explicit provenance tag so the admin tool can
    // surface "this upload IS production-visible" feedback. Mirrors what
    // ingestScoresModel actually wrote to game_predictions.source_type.
    source_type_written: "manual" as const,
    grades_updated: gradesUpdated,
    errors: result.failed.map((f) => ({
      game_external_id: f.row.game_external_id,
      errors: f.errors,
    })),
  });
}
