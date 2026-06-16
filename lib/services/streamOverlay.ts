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
 * Defensive batched read of the latest live stream price per
 * (game, market, side). Returns an EMPTY map on any error (e.g. the v24
 * table does not exist yet) so callers degrade to cron-only. Never throws.
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
      .select("game_id, market_type, side, odds_american, line_value, observed_at")
      .in("game_id", gameIds)) as { data: unknown; error: unknown };
    if (error) return map; // table missing / RLS / any error → degrade cleanly
    const rows = (data ?? []) as Array<{
      game_id: number; market_type: string; side: string;
      odds_american: number | null; line_value: number | null; observed_at: string | null;
    }>;
    for (const r of rows) {
      const key = streamKey(r.game_id, r.market_type, r.side);
      const existing = map.get(key);
      // Keep the freshest per key (defensive — table is unique per key, but be safe).
      if (existing === undefined || (r.observed_at ?? "") > (existing.observedAt ?? "")) {
        map.set(key, { american: r.odds_american, line: r.line_value, observedAt: r.observed_at });
      }
    }
  } catch {
    return map;
  }
  return map;
}
