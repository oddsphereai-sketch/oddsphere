import { settleCbbMarket } from "./model";
import type { buildCbbProvisionalBoard } from "./provisionalBoard";

export const CBB_PROVISIONAL_LIFECYCLE_RELEASE = "cbb_candidate_2026_10_29_r1_locked_board_contract" as const;
export type CbbProvisionalBoard = ReturnType<typeof buildCbbProvisionalBoard>;
export type CbbProvisionalSnapshot = {
  release: typeof CBB_PROVISIONAL_LIFECYCLE_RELEASE;
  gameId: number;
  startsAt: string;
  capturedAt: string;
  lockedAt: string | null;
  board: CbbProvisionalBoard;
};

function time(value: string, name: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid CBB ${name}`);
  return parsed;
}

/** An in-memory lifecycle contract for the future sole leased CBB writer. */
export function advanceCbbProvisionalSnapshot(args: {
  existing: CbbProvisionalSnapshot | null;
  candidate: CbbProvisionalBoard | null;
  startsAt: string;
  now: string;
}): CbbProvisionalSnapshot {
  const start = time(args.startsAt, "start"), now = time(args.now, "clock");
  if (args.existing) {
    if (args.existing.startsAt !== args.startsAt || args.existing.board.gameId !== args.existing.gameId ||
      args.existing.release !== CBB_PROVISIONAL_LIFECYCLE_RELEASE) throw new Error("CBB stored snapshot identity mismatch");
    // Even malformed future candidates must not reinterpret a locked public record.
    if (args.existing.lockedAt !== null) return args.existing;
  }
  const cutoff = start - 60 * 60_000;
  if (now >= cutoff) {
    if (!args.existing) throw new Error("CBB cannot create a prediction after the T-60 lock cutoff");
    return { ...args.existing, lockedAt: args.now };
  }
  if (!args.candidate) {
    if (args.existing) return args.existing;
    throw new Error("CBB has no prelock candidate to capture");
  }
  if (args.candidate.gameId !== args.existing?.gameId && args.existing !== null) {
    throw new Error("CBB candidate changed stored game identity");
  }
  if (args.candidate.rows.length !== 3 ||
    new Set(args.candidate.rows.map(row => row.market)).size !== 3 ||
    time(args.candidate.asOf, "candidate as-of") > now) {
    throw new Error("CBB candidate is incomplete or from the future");
  }
  return { release: CBB_PROVISIONAL_LIFECYCLE_RELEASE,
    gameId: args.candidate.gameId, startsAt: args.startsAt, capturedAt: args.now,
    lockedAt: null, board: args.candidate };
}

/** Reader precedence is exact: stored locked payload wins over every current DTO. */
export function readCbbProvisionalSnapshot(args: {
  locked: CbbProvisionalSnapshot | null;
  unlocked: CbbProvisionalSnapshot | null;
}): CbbProvisionalSnapshot | null {
  if (args.locked?.lockedAt) return args.locked;
  return args.unlocked;
}

/** Official result semantics use only the immutable pick and exact stored line. */
export function settleLockedCbbProvisionalBoard(snapshot: CbbProvisionalSnapshot,
  result: { home: number; away: number }) {
  if (snapshot.lockedAt === null) throw new Error("CBB cannot settle an unlocked snapshot");
  if (![result.home, result.away].every(value => Number.isInteger(value) && value >= 0)) {
    throw new Error("CBB settlement requires a final integer score");
  }
  return snapshot.board.rows.map(row => {
    if (row.selection !== null && row.selection !== "first" && row.selection !== "second") {
      throw new Error("CBB locked selection is invalid");
    }
    return { market: row.market, grade: row.grade,
      selection: row.selection, line: row.line, price: row.price,
      outcome: row.selection === null ? null :
        settleCbbMarket(row.market, row.selection, row.line, result.home, result.away) };
  });
}
