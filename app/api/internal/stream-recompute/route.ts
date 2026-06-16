/**
 * POST /api/internal/stream-recompute
 *
 * Authenticated internal endpoint the streaming worker calls when a MEANINGFUL
 * line move is detected on unlocked games. It runs the EXISTING lock-safe
 * recompute path — identical to the proven pregame-sweep stale-trigger — so
 * there is exactly one mutation path with one lock contract.
 *
 * Safety (see lib/streaming/streamRecompute.ts for the tested core):
 *   • CRON_SECRET Bearer auth required (validateCronAuth).
 *   • generatePredictionsForSlate is ALWAYS called with respectLocks:true.
 *   • Locked game external ids are excluded BEFORE the call (belt-and-
 *     suspenders on top of the service's own Layer-2 lock pre-filter).
 *   • Writes happen ONLY when STREAM_RECOMPUTE_ACTIVE=true AND the body
 *     explicitly sets shadow:false (default shadow=true → dry-run). The
 *     service's own AUTOMODEL_DB_WRITES_ENABLED two-key gate still applies.
 *
 * Body: { sport, date, gameExternalIds: number[], reason?, shadow? }
 */

import { supabase } from "@/lib/db/supabase";
import { validateCronAuth } from "@/lib/cron/auth";
import { generatePredictionsForSlate } from "@/lib/services/automodelService";
import {
  runStreamRecompute,
  type StreamRecomputeBody,
} from "@/lib/streaming/streamRecompute";
import type { Sport } from "@/lib/types/domain/Sport";

export const maxDuration = 60;

/**
 * External ids of games on this slate whose game_predictions row is locked.
 * Replicates automodelService.fetchLockedExternalIds (which is private).
 */
async function readLockedExternalIds(sport: Sport, date: string): Promise<Set<number>> {
  const { data, error } = await supabase
    .from("game_predictions")
    .select("games!inner ( external_id, sport, slate_date ), locked_at")
    .not("locked_at", "is", null)
    .eq("games.sport", sport)
    .eq("games.slate_date", date);
  if (error) {
    throw new Error(`stream-recompute readLockedExternalIds failed for ${sport}/${date}: ${error.message}`);
  }
  const rows = (data ?? []) as unknown as Array<{ games: { external_id: number } }>;
  return new Set(rows.map((r) => r.games.external_id));
}

export async function POST(request: Request): Promise<Response> {
  const auth = validateCronAuth(request);
  if (!auth.ok) return auth.response;

  let body: StreamRecomputeBody;
  try {
    body = (await request.json()) as StreamRecomputeBody;
  } catch {
    return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const recomputeActive = process.env.STREAM_RECOMPUTE_ACTIVE === "true";

  const result = await runStreamRecompute(body, {
    recomputeActive,
    readLockedExternalIds,
    runSlate: (sport, date, stage, opts) =>
      generatePredictionsForSlate(sport, date, stage, opts),
    log: (line) => console.log(`[stream-recompute] ${line}`),
  });

  return Response.json(result, { status: result.ok ? 200 : 400 });
}
