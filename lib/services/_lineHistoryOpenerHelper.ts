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
): Promise<T[]> {
  if (payload.length === 0) return payload;

  // Build distinct keys in payload.
  const keys = new Set<string>();
  for (const r of payload) keys.add(keyOf(r));

  // Pre-fetch which of those keys already exist in line_history.
  // The query is on indexed columns (game_id) so a few hundred rows
  // returns fast; we narrow further client-side.
  const gameIds = Array.from(new Set(payload.map((r) => r.game_id)));
  const marketTypes = Array.from(new Set(payload.map((r) => r.market_type)));
  const { data, error } = await supabase
    .from("line_history")
    .select("game_id, market_type, side, sportsbook, player_id")
    .in("game_id", gameIds)
    .in("market_type", marketTypes);
  if (error !== null) {
    // Safest fallback: keep is_opener=false. Surface via console so
    // the next operator probe can spot the issue.
    console.warn(`[lineHistoryOpenerHelper] pre-fetch failed: ${error.message}; keeping is_opener=false for ${payload.length} row(s)`);
    return payload.map((r) => ({ ...r, is_opener: false }));
  }

  const existingKeys = new Set<string>(
    (data ?? []).map((r) =>
      keyOf(r as { game_id: number; market_type: string; side: string; sportsbook: string; player_id: number | null }),
    ),
  );

  // Walk payload in array order — first row per never-seen key becomes
  // the opener; everything else stays false.
  const flaggedKeysFromPayload = new Set<string>();
  return payload.map((r) => {
    const k = keyOf(r);
    if (!existingKeys.has(k) && !flaggedKeysFromPayload.has(k)) {
      flaggedKeysFromPayload.add(k);
      return { ...r, is_opener: true };
    }
    return { ...r, is_opener: false };
  });
}
