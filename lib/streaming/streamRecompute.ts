/**
 * Stream recompute core (2026-06-16). PURE/testable: all I/O injected, no DB,
 * no Next imports — so the lock-safety suite runs with mocks. The Vercel route
 * (app/api/internal/stream-recompute/route.ts) is a thin wrapper that supplies
 * the real generatePredictionsForSlate + a Supabase locked-ids reader.
 *
 * Lock-safety contract enforced HERE (verified by tests):
 *   1. The slate runner is ALWAYS called with respectLocks:true.
 *   2. Locked game external ids are excluded BEFORE the runner is called
 *      (belt-and-suspenders on top of the service's own Layer-2 pre-filter).
 *   3. Writes happen ONLY when recomputeActive AND shadow === false; shadow
 *      (default true) and recomputeActive-off both force writeToDb:false.
 *   4. If every requested game is locked, the runner is NOT called at all —
 *      a locked decision can never be mutated through this path.
 */

import { isSlateDate } from "../dates/slateDate";
import type { Sport } from "../types/domain/Sport";
import type { ModelStage } from "../automodel/types";

const VALID_SPORTS = new Set<string>(["mlb", "nba", "nfl", "cbb", "cfb", "nhl", "ucl", "soccer"]);

/** Stage is fixed to the proven stale-trigger path used by pregame-sweep. */
export const STREAM_RECOMPUTE_STAGE: ModelStage = "morning_draft";

export type StreamRecomputeBody = {
  sport?: unknown;
  date?: unknown;
  gameExternalIds?: unknown;
  reason?: unknown;
  shadow?: unknown;
};

/** Subset of generatePredictionsForSlate's result the core needs. */
export type SlateRunOutcome = { game_count: number; db_writes: unknown | null };

export type RunSlateFn = (
  sport: Sport,
  date: string,
  stage: ModelStage,
  opts: { writeToDb: boolean; gameExternalIdsFilter: number[]; respectLocks: true },
) => Promise<SlateRunOutcome>;

export type StreamRecomputeDeps = {
  runSlate: RunSlateFn;
  readLockedExternalIds: (sport: Sport, date: string) => Promise<Set<number>>;
  /** STREAM_RECOMPUTE_ACTIVE — when false, never writes (dry-run at most). */
  recomputeActive: boolean;
  log?: (line: string) => void;
};

export type StreamRecomputeResult = {
  ok: boolean;
  ran: boolean;
  writeToDb: boolean;
  shadow: boolean;
  requested: number;
  eligible: number[];
  excludedLocked: number[];
  gameCount?: number;
  wroteToDb?: boolean;
  reason?: string;
  error?: string;
};

function toIntIds(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  const out: number[] = [];
  for (const x of v) {
    const n = typeof x === "number" ? x : Number(x);
    if (Number.isInteger(n)) out.push(n);
  }
  return [...new Set(out)];
}

export async function runStreamRecompute(
  body: StreamRecomputeBody,
  deps: StreamRecomputeDeps,
): Promise<StreamRecomputeResult> {
  const sport = typeof body.sport === "string" ? body.sport : "";
  const date = typeof body.date === "string" ? body.date : "";
  // Shadow defaults to TRUE — a caller must explicitly pass shadow:false to
  // ever write. This is the safety default.
  const shadow = body.shadow !== false;
  const ids = toIntIds(body.gameExternalIds);

  const base = { ok: false, ran: false, writeToDb: false, shadow, requested: ids.length, eligible: [], excludedLocked: [] } as StreamRecomputeResult;

  if (!VALID_SPORTS.has(sport)) return { ...base, error: `invalid sport: ${String(body.sport)}` };
  if (!isSlateDate(date)) return { ...base, error: `invalid date (expected YYYY-MM-DD): ${String(body.date)}` };
  if (ids.length === 0) return { ...base, ok: true, reason: "no game ids" };

  // Belt-and-suspenders: exclude locked games BEFORE recompute (the service's
  // respectLocks:true also pre-filters, but we never even hand locked ids in).
  const locked = await deps.readLockedExternalIds(sport as Sport, date);
  const excludedLocked = ids.filter((id) => locked.has(id));
  const eligible = ids.filter((id) => !locked.has(id));

  // Writes require BOTH the master flag AND an explicit non-shadow call.
  const writeToDb = deps.recomputeActive && shadow === false;

  if (eligible.length === 0) {
    deps.log?.(`stream-recompute: all ${ids.length} requested game(s) locked — nothing to recompute`);
    return { ...base, ok: true, ran: false, writeToDb, eligible, excludedLocked, reason: "all requested games locked" };
  }

  const res = await deps.runSlate(sport as Sport, date, STREAM_RECOMPUTE_STAGE, {
    writeToDb,
    gameExternalIdsFilter: eligible,
    respectLocks: true, // ALWAYS — never false from the stream path
  });

  return {
    ok: true,
    ran: true,
    writeToDb,
    shadow,
    requested: ids.length,
    eligible,
    excludedLocked,
    gameCount: res.game_count,
    wroteToDb: res.db_writes !== null,
  };
}
