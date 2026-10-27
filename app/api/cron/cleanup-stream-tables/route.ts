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
 *   • lab_response_snapshots — remove cache rows 24 hours after their explicit
 *                              stale_until boundary. These rows are already
 *                              unreadable by every member route at that point.
 *
 * SAFETY: calibration / tracking data lives in prediction_records and
 * prediction_grades and is NEVER touched here — line_history is the raw odds
 * FEED and odds_events_raw is the WS AUDIT log; CLV + openers are already
 * computed into the prediction_records snapshots post-game, so old raw rows are
 * pure bloat. CRON_SECRET Bearer auth. Batched delete by key (no giant delete).
 */
import { supabase } from "@/lib/db/supabase";
import { cronHandler } from "@/lib/cron/runCron";

export const maxDuration = 300;

const LINE_HISTORY_RETENTION_DAYS = 4;
const ODDS_EVENTS_RAW_RETENTION_DAYS = 2;
const LINE_MOVEMENTS_RETENTION_DAYS = 2;
const ODDS_CURRENT_STREAM_RETENTION_DAYS = 2;
const LAB_RESPONSE_SNAPSHOT_RETENTION_GRACE_HOURS = 24;
const BATCH = 1000; // PostgREST per-request row cap
const MAX_BATCHES = 2000; // backstop (≤2M rows) so a bug can't loop forever
const LAB_RESPONSE_SNAPSHOT_BATCH = 250;
const LAB_RESPONSE_SNAPSHOT_MAX_BATCHES = 8; // ≤2,000 expired cache rows/run

async function prune(
  table: string,
  keyColumn: string,
  tsCol: string,
  cutoffIso: string,
  batchSize = BATCH,
  maxBatches = MAX_BATCHES,
): Promise<{ deleted: number; error: string | null; capped: boolean }> {
  let deleted = 0;
  let i = 0;
  for (; i < maxBatches; i++) {
    const { data, error } = await supabase
      .from(table)
      .select(keyColumn)
      .lt(tsCol, cutoffIso)
      .order(tsCol, { ascending: true })
      .limit(batchSize);
    if (error) return { deleted, error: `select: ${error.message}`, capped: false };
    const ids = (data ?? [])
      .map((row) => (row as unknown as Record<string, unknown>)[keyColumn])
      .filter((value): value is string | number => typeof value === "string" || typeof value === "number");
    if (ids.length === 0) break;
    const { error: delErr } = await supabase.from(table).delete().in(keyColumn, ids);
    if (delErr) return { deleted, error: `delete: ${delErr.message}`, capped: false };
    deleted += ids.length;
  }
  return { deleted, error: null, capped: i >= maxBatches };
}

export async function GET(request: Request): Promise<Response> {
  return cronHandler(
    request,
    "cleanup_stream_tables",
    async () => {
      const now = Date.now();
      const lhCutoff = new Date(now - LINE_HISTORY_RETENTION_DAYS * 86_400_000).toISOString();
      const oerCutoff = new Date(now - ODDS_EVENTS_RAW_RETENTION_DAYS * 86_400_000).toISOString();
      const lmCutoff = new Date(now - LINE_MOVEMENTS_RETENTION_DAYS * 86_400_000).toISOString();
      const ocsCutoff = new Date(now - ODDS_CURRENT_STREAM_RETENTION_DAYS * 86_400_000).toISOString();
      const labSnapshotCutoff = new Date(
        now - LAB_RESPONSE_SNAPSHOT_RETENTION_GRACE_HOURS * 3_600_000,
      ).toISOString();

      // Reclaim unreadable response-cache rows first. The other stream-table
      // policies can have a much larger historical backlog, and must not starve
      // this small bounded cleanup if a run approaches maxDuration.
      const lab_response_snapshots = await prune(
        "lab_response_snapshots",
        "snapshot_key",
        "stale_until",
        labSnapshotCutoff,
        LAB_RESPONSE_SNAPSHOT_BATCH,
        LAB_RESPONSE_SNAPSHOT_MAX_BATCHES,
      );
      const odds_events_raw = await prune("odds_events_raw", "id", "received_at", oerCutoff);
      const line_history = await prune("line_history", "id", "recorded_at", lhCutoff);
      const line_movements = await prune("line_movements", "id", "moved_at", lmCutoff);
      const odds_current_stream = await prune("odds_current_stream", "id", "observed_at", ocsCutoff);
      const errors = [
        odds_events_raw.error,
        line_history.error,
        line_movements.error,
        odds_current_stream.error,
        lab_response_snapshots.error,
      ].filter((x): x is string => x !== null);

      return {
        records_updated:
          odds_events_raw.deleted +
          line_history.deleted +
          line_movements.deleted +
          odds_current_stream.deleted +
          lab_response_snapshots.deleted,
        api_calls_made: 0,
        partial: errors.length > 0,
        details: {
          retention: {
            line_history_days: LINE_HISTORY_RETENTION_DAYS,
            odds_events_raw_days: ODDS_EVENTS_RAW_RETENTION_DAYS,
            line_movements_days: LINE_MOVEMENTS_RETENTION_DAYS,
            odds_current_stream_days: ODDS_CURRENT_STREAM_RETENTION_DAYS,
            lab_response_snapshot_grace_hours: LAB_RESPONSE_SNAPSHOT_RETENTION_GRACE_HOURS,
          },
          odds_events_raw,
          line_history,
          line_movements,
          odds_current_stream,
          lab_response_snapshots,
        },
      };
    },
    { lockMinutes: 60 },
  );
}
