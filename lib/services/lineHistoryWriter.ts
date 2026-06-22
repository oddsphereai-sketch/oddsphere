/**
 * Resilient line_history writer (2026-06-22).
 *
 * Root cause it fixes: the line-refresh writers inserted the whole slate's
 * line_history rows in one batched `.insert([...])`. Supabase insert is atomic,
 * so ONE malformed/rejected row rejected the ENTIRE batch — and because the
 * `lines` insert commits FIRST, the result was `lines` populated but
 * `line_history` empty for ~72% of games, silently (the throw was swallowed
 * upstream as a "partial" cycle). That broke CLV + line-movement coverage
 * (only ~27% of games had any closing line).
 *
 * line_history has NO unique constraint, so upsert/ignoreDuplicates has no
 * conflict target — chunk + row-level isolation is the right tool. On a chunk
 * error we retry the chunk row-by-row: good rows persist, and the exact
 * offending row + Postgres error are captured (which also CONFIRMS the
 * rejection cause the next time a real row fails).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type LineHistoryInsertResult = {
  attempted: number;
  inserted: number;
  failed: number;
  firstError: string | null;
  failedSample: Record<string, unknown> | null;
};

const DEFAULT_CHUNK_SIZE = 200;

/**
 * Insert line_history rows resiliently. Never throws — returns a result the
 * caller surfaces. A single bad row strands only itself, never the slate.
 */
export async function insertLineHistoryResilient(
  supabase: SupabaseClient,
  rows: ReadonlyArray<Record<string, unknown>>,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
): Promise<LineHistoryInsertResult> {
  const result: LineHistoryInsertResult = {
    attempted: rows.length,
    inserted: 0,
    failed: 0,
    firstError: null,
    failedSample: null,
  };
  if (rows.length === 0) return result;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize) as Record<string, unknown>[];
    const { error } = await supabase.from("line_history").insert(chunk);
    if (error === null) {
      result.inserted += chunk.length;
      continue;
    }
    // Chunk rejected — isolate row-by-row so good rows still land and the
    // offending row + error are captured.
    for (const row of chunk) {
      const { error: rowErr } = await supabase.from("line_history").insert([row]);
      if (rowErr === null) {
        result.inserted += 1;
        continue;
      }
      result.failed += 1;
      if (result.firstError === null) {
        result.firstError = rowErr.message;
        result.failedSample = row;
      }
    }
  }
  return result;
}

/**
 * Best-effort visibility row in data_refresh_log for a line_history insert
 * failure. Never throws — logging must not break a refresh.
 */
export async function logLineHistoryInsertFailure(
  supabase: SupabaseClient,
  source: string,
  sport: string | null,
  result: LineHistoryInsertResult,
): Promise<void> {
  try {
    const now = new Date().toISOString();
    const message =
      `[${source}] line_history insert: ${result.failed}/${result.attempted} rows rejected. ` +
      `firstError=${result.firstError ?? "n/a"} sample=${JSON.stringify(result.failedSample ?? null)}`;
    await supabase.from("data_refresh_log").insert({
      data_source: "line_history_insert_failure",
      sport,
      refresh_started_at: now,
      refresh_completed_at: now,
      refresh_status: "failed",
      records_updated: result.inserted,
      api_calls_made: 0,
      error_message: message.slice(0, 1000),
    });
  } catch (e) {
    console.error(
      `[lineHistoryWriter] failed to log line_history insert failure: ${(e as Error).message}`,
    );
  }
}
