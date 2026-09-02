/**
 * Phase 6B.32 — `is_opener` flag helper.
 *
 * Every MLB/NBA/NHL line-refresh writer previously hardcoded
 * `is_opener: false` on every `line_history` insert (see
 * linesService.ts:185,348 / refreshNbaLinesService.ts:514 /
 * refreshNhlLinesService.ts:345). The result was that no row was ever
 * flagged as the opener, which broke the `line_movement` computation
 * in `predictionRecordService.buildLineMovementSnapshot` and removed
 * the line-move section from every locked Daily Edge card.
 *
 * This helper takes a payload of about-to-insert rows, queries the DB
 * for which (game_id, market_type, side, sportsbook, player_id) keys
 * already have line_history rows, and stamps `is_opener = true` only
 * on the first row per never-seen key.
 *
 * Idempotent in the face of repeated calls — a key that's already
 * been recorded as an opener earlier stays non-opener on subsequent
 * polls, which is the correct semantic.
 */

import { supabase } from "../db/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

export type HistoryRowLike = {
  game_id: number;
  market_type: string;
  side: string;
  sportsbook: string;
  player_id: number | null;
  is_opener?: boolean;
};

function keyOf(r: { game_id: number; market_type: string; side: string; sportsbook: string; player_id: number | null }): string {
  return `${r.game_id}|${r.market_type}|${r.side}|${r.sportsbook}|${r.player_id ?? "null"}`;
}

export const LINE_HISTORY_OPENER_PAGE_SIZE = 1_000;
export const LINE_HISTORY_OPENER_MAX_ROWS = 50_000;

export type LineHistoryOpenerReadResult = {
  existingKeys: Set<string>;
  rowsRead: number;
  queries: number;
  error: string | null;
};

/**
 * Read the complete bounded history for the exact incoming identities.
 *
 * PostgREST may cap an un-ranged select at 1,000 rows. The old helper used
 * such a select and therefore mistook every identity outside the first page
 * for a never-seen identity. This reader requests an exact count, pages in a
 * deterministic id order, rejects truncation/count drift/duplicate ids, and
 * restores the full tuple match client-side after the compact database IN
 * filters. On an unverifiable read it returns no keys plus an error so the
 * caller can safely avoid stamping any new opener.
 */
export async function readExistingLineHistoryIdentityKeys(
  client: SupabaseClient,
  payload: ReadonlyArray<HistoryRowLike>,
  options: { pageSize?: number; maxRows?: number } = {},
): Promise<LineHistoryOpenerReadResult> {
  const wantedKeys = new Set(payload.map(keyOf));
  const gameIds = [...new Set(payload.map((row) => row.game_id))].sort((a, b) => a - b);
  const marketTypes = [...new Set(payload.map((row) => row.market_type))].sort();
  const pageSize = Number.isInteger(options.pageSize) && (options.pageSize ?? 0) > 0
    ? options.pageSize!
    : LINE_HISTORY_OPENER_PAGE_SIZE;
  const maxRows = Number.isInteger(options.maxRows) && (options.maxRows ?? 0) > 0
    ? options.maxRows!
    : LINE_HISTORY_OPENER_MAX_ROWS;
  const result: LineHistoryOpenerReadResult = {
    existingKeys: new Set<string>(),
    rowsRead: 0,
    queries: 0,
    error: null,
  };
  if (wantedKeys.size === 0) return result;
  const fail = (message: string): LineHistoryOpenerReadResult => {
    result.existingKeys.clear();
    result.error = message;
    return result;
  };

  let expectedRows: number | null = null;
  const seenIds = new Set<number>();
  for (let from = 0; expectedRows === null || from < expectedRows; from += pageSize) {
    result.queries += 1;
    const query = await client
      .from("line_history")
      .select("id,game_id,market_type,side,sportsbook,player_id", { count: "exact" })
      .in("game_id", gameIds)
      .in("market_type", marketTypes)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (query.error) {
      return fail(`line-history opener read failed: ${query.error.message}`);
    }
    if (typeof query.count !== "number") {
      return fail("line-history opener read returned no exact count; truncation cannot be excluded");
    }
    if (query.count > maxRows) {
      return fail(`line-history opener read cap exceeded: count=${query.count} cap=${maxRows}`);
    }
    expectedRows ??= query.count;
    if (query.count !== expectedRows) {
      return fail(`line-history opener row count changed during pagination: initial=${expectedRows} current=${query.count}`);
    }
    const page = query.data ?? [];
    const expectedPageRows = Math.min(pageSize, expectedRows - from);
    if (page.length !== expectedPageRows) {
      return fail(`line-history opener pagination truncated: offset=${from} expected=${expectedPageRows} received=${page.length}`);
    }
    result.rowsRead += page.length;
    for (const row of page) {
      if (typeof row.id !== "number") {
        return fail("line-history opener row has no numeric id; deterministic pagination cannot be verified");
      }
      if (seenIds.has(row.id)) {
        return fail(`line-history opener pagination returned duplicate id=${row.id}`);
      }
      seenIds.add(row.id);
      const key = keyOf(row as HistoryRowLike);
      if (wantedKeys.has(key)) result.existingKeys.add(key);
    }
  }
  return result;
}

/**
 * Returns the same payload with `is_opener` set:
 *   • `true`  for rows whose (game, market, side, book, player) tuple has
 *             NEVER appeared in line_history before AND only once per
 *             tuple within the payload (the earliest row by array order).
 *   • `false` for all other rows.
 *
 * On any DB error, falls back to `is_opener: false` for ALL rows so the
 * caller's insert isn't blocked. That preserves the pre-Phase-6B.32
 * behavior — better to lose opener flagging than fail the slate refresh.
 */
export async function flagOpenersInHistoryPayload<T extends HistoryRowLike>(
  payload: T[],
  options: {
    client?: SupabaseClient;
    pageSize?: number;
    maxRows?: number;
  } = {},
): Promise<T[]> {
  if (payload.length === 0) return payload;

  const read = await readExistingLineHistoryIdentityKeys(
    options.client ?? supabase,
    payload,
    { pageSize: options.pageSize, maxRows: options.maxRows },
  );
  if (read.error !== null) {
    // Safest fallback: keep is_opener=false. Surface via console so
    // the next operator probe can spot the issue.
    console.warn(`[lineHistoryOpenerHelper] pre-fetch failed: ${read.error}; keeping is_opener=false for ${payload.length} row(s)`);
    return payload.map((r) => ({ ...r, is_opener: false }));
  }

  // Walk payload in array order — first row per never-seen key becomes
  // the opener; everything else stays false.
  const flaggedKeysFromPayload = new Set<string>();
  return payload.map((r) => {
    const k = keyOf(r);
    if (!read.existingKeys.has(k) && !flaggedKeysFromPayload.has(k)) {
      flaggedKeysFromPayload.add(k);
      return { ...r, is_opener: true };
    }
    return { ...r, is_opener: false };
  });
}
