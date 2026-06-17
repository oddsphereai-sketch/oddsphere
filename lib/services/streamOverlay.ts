/**
 * Stream overlay helpers (2026-06-16). The daily-edge route + soccer adapter
 * overlay live `odds_current_stream` prices onto the cron `lines` price ONLY
 * when the stream observation is fresher than the cron observation.
 *
 * `pickFresherCurrent` is PURE (unit-tested). `loadStreamCurrentForSlate` is a
 * DEFENSIVE batched reader: if the v24 `odds_current_stream` table does not
 * exist yet (migration not applied) or any error occurs, it returns an empty
 * map so every reader degrades cleanly to the cron-only path.
 */

import { bookPriorityRank } from "../config/bookPriority";
import { isBlockedSportsbook } from "../config/blockedSportsbooks";

export type PriceObservation = {
  american: number | null;
  observedAt: string | null;
};

export type StreamCurrent = {
  american: number | null;
  line: number | null;
  observedAt: string | null;
};

/**
 * Choose the displayed "Current" price between the cron `lines` value and a
 * live `odds_current_stream` value. A cron value with a null `observedAt`
 * came straight from the live `lines` row → treated as "now" (freshest). The
 * stream value wins only when it has a price AND its observation is strictly
 * newer than the cron observation.
 */
export function pickFresherCurrent(
  cron: PriceObservation,
  stream: StreamCurrent | null,
  nowMs: number,
): PriceObservation {
  if (stream === null || stream.american === null) return cron;
  if (cron.american === null) {
    return { american: stream.american, observedAt: stream.observedAt };
  }
  // Null cron stamp = live lines row = freshest possible (now).
  const cronTs = cron.observedAt !== null ? Date.parse(cron.observedAt) : nowMs;
  const streamTs = stream.observedAt !== null ? Date.parse(stream.observedAt) : 0;
  if (Number.isFinite(streamTs) && streamTs > cronTs) {
    return { american: stream.american, observedAt: stream.observedAt };
  }
  return cron;
}

/** Map key: `${gameId}::${marketType}::${side}`. */
export function streamKey(gameId: number, marketType: string, side: string): string {
  return `${gameId}::${marketType}::${side}`;
}

export type LastMove = {
  prevAmerican: number | null;
  nextAmerican: number | null;
  movedAtIso: string | null;
  booksMoved: number | null;
  totalBooks: number | null;
  /** Picked-side LINE/point before→after the last move (e.g. total 8.5 → 9).
   * Null for moneyline (no line) or when unchanged. Distinct from the odds move. */
  prevLineValue: number | null;
  nextLineValue: number | null;
};

/**
 * Defensive batched read of the most-recent picked-side move per
 * (game, market, side) from line_movements. Returns an EMPTY map on any error
 * (v24 table absent / RLS) so callers degrade to no last-move. booksMoved =
 * distinct books that moved in the last 30m; totalBooks = distinct books that
 * moved in the last 60m (a consensus proxy). Never throws.
 */
export async function loadLastMovesForSlate(
  supabase: SupabaseLike,
  gameIds: number[],
  nowMs: number,
): Promise<Map<string, LastMove>> {
  const map = new Map<string, LastMove>();
  if (gameIds.length === 0) return map;
  type Row = { game_id: number; market_type: string; side: string | null; sportsbook: string; prev_odds_american: number | null; next_odds_american: number | null; prev_line_value: number | null; next_line_value: number | null; moved_at: string };
  const rowsByKey = new Map<string, Row[]>();
  try {
    for (let i = 0; i < gameIds.length; i += 20) {
      const chunk = gameIds.slice(i, i + 20);
      let from = 0;
      for (;;) {
        const { data, error } = (await supabase
          .from("line_movements")
          .select("game_id, market_type, side, sportsbook, prev_odds_american, next_odds_american, prev_line_value, next_line_value, moved_at")
          .in("game_id", chunk)
          .range(from, from + 999)) as { data: unknown; error: unknown };
        if (error) return map; // table missing / error → degrade
        const page = (data ?? []) as Row[];
        for (const r of page) {
          if (r.side === null) continue;
          const key = streamKey(r.game_id, r.market_type, r.side);
          (rowsByKey.get(key) ?? rowsByKey.set(key, []).get(key)!).push(r);
        }
        if (page.length < 1000) break;
        from += 1000;
      }
    }
  } catch {
    return map;
  }
  for (const [key, rowsAll] of rowsByKey) {
    // 2026-06-17 — only TRUSTED books drive the displayed move, using the SAME
    // BOOK_PRIORITY ranking as the line + current-odds overlay. Otherwise an
    // off-market outlier (e.g. a wide bovada total at 11.5 vs the ~9 consensus)
    // becomes the "latest move" and the Total Line row diverges hard from the
    // sharp Market line. Fail closed: if no trusted book moved, emit nothing for
    // this key (the move row simply doesn't render) rather than show an outlier.
    const rows = rowsAll.filter(
      (r) => !isBlockedSportsbook(r.sportsbook) && Number.isFinite(bookPriorityRank(r.sportsbook)),
    );
    if (rows.length === 0) continue;
    // The displayed move = the sharpest trusted book that moved; within that
    // book, its most recent move.
    rows.sort((a, b) => {
      const ra = bookPriorityRank(a.sportsbook);
      const rb = bookPriorityRank(b.sportsbook);
      if (ra !== rb) return ra - rb;
      return Date.parse(b.moved_at) - Date.parse(a.moved_at);
    });
    const latest = rows[0];
    const booksMoved = new Set(rows.filter((r) => nowMs - Date.parse(r.moved_at) <= 30 * 60000).map((r) => r.sportsbook)).size;
    const totalBooks = new Set(rows.filter((r) => nowMs - Date.parse(r.moved_at) <= 60 * 60000).map((r) => r.sportsbook)).size;
    map.set(key, {
      prevAmerican: latest.prev_odds_american,
      nextAmerican: latest.next_odds_american,
      movedAtIso: latest.moved_at,
      booksMoved: booksMoved > 0 ? booksMoved : null,
      totalBooks: totalBooks > 0 ? totalBooks : null,
      prevLineValue: latest.prev_line_value,
      nextLineValue: latest.next_line_value,
    });
  }
  return map;
}

/**
 * Minimal structural shape of the Supabase query path we use. Loosely typed
 * (the builder is a thenable, not a Promise) to avoid deep generic
 * instantiation against the full SupabaseClient type.
 */
type SupabaseLike = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

/**
 * Defensive batched read of the live stream price per (game, market, side),
 * selecting the SHARPEST trusted book (BOOK_PRIORITY) — not whichever book
 * ticked last — and filtering blocked/untrusted books (fail closed). Returns an
 * EMPTY map on any error (e.g. the v24 table does not exist yet) so callers
 * degrade to the cron-only path. Never throws.
 */
export async function loadStreamCurrentForSlate(
  supabase: SupabaseLike,
  gameIds: number[],
): Promise<Map<string, StreamCurrent>> {
  const map = new Map<string, StreamCurrent>();
  if (gameIds.length === 0) return map;
  try {
    const { data, error } = (await supabase
      .from("odds_current_stream")
      .select("game_id, market_type, side, sportsbook, odds_american, line_value, observed_at")
      .in("game_id", gameIds)) as { data: unknown; error: unknown };
    if (error) return map; // table missing / RLS / any error → degrade cleanly
    const rows = (data ?? []) as Array<{
      game_id: number; market_type: string; side: string; sportsbook: string;
      odds_american: number | null; line_value: number | null; observed_at: string | null;
    }>;
    // 2026-06-17 — per (game, market, side) keep the SHARPEST trusted book,
    // using the SAME BOOK_PRIORITY ranking the cron line uses — NOT whichever
    // book happened to tick last. This makes the displayed "current" price
    // coherent with the displayed (sharp) line and movement. FAIL CLOSED:
    // blocked books (#39) and any book absent from BOOK_PRIORITY are never
    // selected, so an off-market outlier (e.g. a wide bovada total) can never
    // surface as the current price. A key with no trusted stream price is left
    // unset → the reader falls back to the cron `lines` value.
    const bestRankByKey = new Map<string, number>();
    for (const r of rows) {
      if (r.odds_american === null) continue;           // no usable price
      if (isBlockedSportsbook(r.sportsbook)) continue;  // #39 defense-in-depth
      const rank = bookPriorityRank(r.sportsbook);
      if (!Number.isFinite(rank)) continue;             // untrusted book → skip
      const key = streamKey(r.game_id, r.market_type, r.side);
      const prevRank = bestRankByKey.get(key);
      if (prevRank === undefined || rank < prevRank) {
        bestRankByKey.set(key, rank);
        map.set(key, { american: r.odds_american, line: r.line_value, observedAt: r.observed_at });
      }
    }
  } catch {
    return map;
  }
  return map;
}
