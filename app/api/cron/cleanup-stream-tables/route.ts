/**
 * GET /api/cron/cleanup-stream-tables
 *
 * Daily TTL prune of the raw odds-feed / audit tables that grow UNBOUNDED from
 * the WS worker + line refreshers. Keeps them small so the daily-edge route and
 * the slate-cycle cron stay fast: multi-game `line_history` reads degenerate on
 * a bloated table → Postgres statement timeouts → "tonight's slate stuck
 * loading" + slate-cycle overruns its 300s maxDuration (the 2026-06-16 incident).
 *
 * Retention (operator-authorized 2026-06-16):
 *   • line_history         — keep 4 days (covers openers + CLV reconcile catch-up)
 *   • odds_events_raw      — keep 2 days (pure WS audit log, not read by the app)
 *   • line_movements       — keep 2 days (compact WS trigger/display context)
 *   • odds_current_stream  — keep 2 days (latest stream snapshots for old games
 *                            otherwise linger forever on the unique key)
 *
 * SAFETY: calibration / tracking data lives in prediction_records and
 * prediction_grades and is NEVER touched here — line_history is the raw odds
 * FEED and odds_events_raw is the WS AUDIT log; CLV + openers are already
 * computed into the prediction_records snapshots post-game, so old raw rows are
 * pure bloat. CRON_SECRET Bearer auth. Batched delete by id (no giant delete).
 */
import { supabase } from "@/lib/db/supabase";
import { validateCronAuth } from "@/lib/cron/auth";

export const maxDuration = 300;

const LINE_HISTORY_RETENTION_DAYS = 4;
const ODDS_EVENTS_RAW_RETENTION_DAYS = 2;
const LINE_MOVEMENTS_RETENTION_DAYS = 2;
const ODDS_CURRENT_STREAM_RETENTION_DAYS = 2;
const BATCH = 1000; // PostgREST per-request row cap
const MAX_BATCHES = 2000; // backstop (≤2M rows) so a bug can't loop forever

async function prune(
  table: string,
  tsCol: string,
  cutoffIso: string,
): Promise<{ deleted: number; error: string | null; capped: boolean }> {
  let deleted = 0;
  let i = 0;
  for (; i < MAX_BATCHES; i++) {
    const { data, error } = await supabase
      .from(table)
      .select("id")
      .lt(tsCol, cutoffIso)
      .order("id", { ascending: true })
      .limit(BATCH);
    if (error) return { deleted, error: `select: ${error.message}`, capped: false };
    const ids = (data ?? []).map((r) => (r as { id: number }).id);
    if (ids.length === 0) break;
    const { error: delErr } = await supabase.from(table).delete().in("id", ids);
    if (delErr) return { deleted, error: `delete: ${delErr.message}`, capped: false };
    deleted += ids.length;
  }
  return { deleted, error: null, capped: i >= MAX_BATCHES };
}

export async function GET(request: Request): Promise<Response> {
  const auth = validateCronAuth(request);
  if (!auth.ok) return auth.response;

  const now = Date.now();
  const lhCutoff = new Date(now - LINE_HISTORY_RETENTION_DAYS * 86_400_000).toISOString();
  const oerCutoff = new Date(now - ODDS_EVENTS_RAW_RETENTION_DAYS * 86_400_000).toISOString();
  const lmCutoff = new Date(now - LINE_MOVEMENTS_RETENTION_DAYS * 86_400_000).toISOString();
  const ocsCutoff = new Date(now - ODDS_CURRENT_STREAM_RETENTION_DAYS * 86_400_000).toISOString();

  const odds_events_raw = await prune("odds_events_raw", "received_at", oerCutoff);
  const line_history = await prune("line_history", "recorded_at", lhCutoff);
  const line_movements = await prune("line_movements", "moved_at", lmCutoff);
  const odds_current_stream = await prune("odds_current_stream", "observed_at", ocsCutoff);

  return Response.json({
    ok:
      odds_events_raw.error === null &&
      line_history.error === null &&
      line_movements.error === null &&
      odds_current_stream.error === null,
    retention: {
      line_history_days: LINE_HISTORY_RETENTION_DAYS,
      odds_events_raw_days: ODDS_EVENTS_RAW_RETENTION_DAYS,
      line_movements_days: LINE_MOVEMENTS_RETENTION_DAYS,
      odds_current_stream_days: ODDS_CURRENT_STREAM_RETENTION_DAYS,
    },
    odds_events_raw,
    line_history,
    line_movements,
    odds_current_stream,
  });
}
