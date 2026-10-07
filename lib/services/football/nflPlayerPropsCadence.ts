import type { NflPlayerPropsProductionSnapshot } from "./nflPlayerPropsProductionContract";

export const NFL_PLAYER_PROPS_CADENCE_RELEASE =
  "nfl_player_props_cadence_2026_10_07_r1_state_aware_refresh" as const;

const FIFTEEN_MINUTES_MS = 15 * 60_000;
const THIRTY_MINUTES_MS = 30 * 60_000;
const SIXTY_MINUTES_MS = 60 * 60_000;
const TWO_HOURS_MS = 2 * 60 * 60_000;
const SIX_HOURS_MS = 6 * 60 * 60_000;

export type NflPlayerPropsCadencePlan = {
  release: typeof NFL_PLAYER_PROPS_CADENCE_RELEASE;
  run: boolean;
  reason:
    | "missing_snapshot"
    | "invalid_snapshot_time"
    | "lock_due"
    | "fifteen_minute_refresh_due"
    | "thirty_minute_refresh_due"
    | "hourly_refresh_due"
    | "not_due";
  cadenceMinutes: 15 | 30 | 60;
  snapshotAgeMinutes: number | null;
  nearestLockMinutes: number | null;
};

/**
 * Plans only whether the existing authoritative NFL props writer is due.
 * It never writes, fetches providers, changes a prediction, or creates a
 * second writer. The surrounding NFL route still owns the shared sport lease.
 */
export function planNflPlayerPropsRefresh(args: {
  now: string;
  previous: Pick<NflPlayerPropsProductionSnapshot, "generatedAt" | "board"> | null;
}): NflPlayerPropsCadencePlan {
  const nowMs = Date.parse(args.now);
  if (!Number.isFinite(nowMs)) throw new Error("NFL player props cadence now is invalid.");
  if (!args.previous) return plan(true, "missing_snapshot", 60, null, null);

  const generatedAtMs = Date.parse(args.previous.generatedAt);
  if (!Number.isFinite(generatedAtMs) || generatedAtMs > nowMs + 60_000) {
    return plan(true, "invalid_snapshot_time", 60, null, nearestLockMinutes(args.previous, nowMs));
  }

  const unlockedUpcoming = args.previous.board.decisions.filter((row) => (
    row.state === "unlocked" && Date.parse(row.scheduledStart) > nowMs
  ));
  const nearestLockMs = minimumFinite(unlockedUpcoming.map((row) => Date.parse(row.lockAt) - nowMs));
  const nearestLock = nearestLockMs === null ? null : nearestLockMs / 60_000;
  const snapshotAgeMs = nowMs - generatedAtMs;
  const snapshotAge = snapshotAgeMs / 60_000;

  if (nearestLockMs !== null && nearestLockMs <= 0) {
    return plan(true, "lock_due", 15, snapshotAge, nearestLock);
  }

  const cadenceMs = nearestLockMs !== null && nearestLockMs <= TWO_HOURS_MS
    ? FIFTEEN_MINUTES_MS
    : nearestLockMs !== null && nearestLockMs <= SIX_HOURS_MS
      ? THIRTY_MINUTES_MS
      : SIXTY_MINUTES_MS;
  const cadenceMinutes = (cadenceMs / 60_000) as 15 | 30 | 60;
  if (snapshotAgeMs >= cadenceMs) {
    const reason = cadenceMinutes === 15
      ? "fifteen_minute_refresh_due"
      : cadenceMinutes === 30
        ? "thirty_minute_refresh_due"
        : "hourly_refresh_due";
    return plan(true, reason, cadenceMinutes, snapshotAge, nearestLock);
  }
  return plan(false, "not_due", cadenceMinutes, snapshotAge, nearestLock);
}

function nearestLockMinutes(
  previous: Pick<NflPlayerPropsProductionSnapshot, "board">,
  nowMs: number,
): number | null {
  const nearest = minimumFinite(previous.board.decisions
    .filter((row) => row.state === "unlocked" && Date.parse(row.scheduledStart) > nowMs)
    .map((row) => Date.parse(row.lockAt) - nowMs));
  return nearest === null ? null : nearest / 60_000;
}

function minimumFinite(values: number[]): number | null {
  const finite = values.filter(Number.isFinite);
  return finite.length ? Math.min(...finite) : null;
}

function plan(
  run: boolean,
  reason: NflPlayerPropsCadencePlan["reason"],
  cadenceMinutes: NflPlayerPropsCadencePlan["cadenceMinutes"],
  snapshotAgeMinutes: number | null,
  nearestLockMinutesValue: number | null,
): NflPlayerPropsCadencePlan {
  return {
    release: NFL_PLAYER_PROPS_CADENCE_RELEASE,
    run,
    reason,
    cadenceMinutes,
    snapshotAgeMinutes: round(snapshotAgeMinutes),
    nearestLockMinutes: round(nearestLockMinutesValue),
  };
}

function round(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10;
}
