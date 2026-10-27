/**
 * Release boundary for the shared game_predictions market-signal / grade
 * derivation lock guard. Any behavior change here must advance this value.
 */
export const SHARED_DERIVATION_LOCK_GUARD_RELEASE =
  "shared_derivation_lock_guard_2026_10_27_r1_locked_record_immutability" as const;

/**
 * Stored game_predictions rows become immutable as soon as locked_at is set.
 * Services must apply this read-side check and repeat the same predicate in
 * the UPDATE so a lock that races between read and write also wins.
 */
export function isUnlockedForSharedDerivation(
  lockedAt: string | null,
): boolean {
  return lockedAt === null;
}
