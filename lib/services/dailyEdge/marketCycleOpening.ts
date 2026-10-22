export const DAILY_EDGE_CURRENT_MARKET_CYCLE_OPENING_MAX_DAYS = 14 as const;

const DAY_MS = 24 * 60 * 60 * 1_000;

/**
 * A provider-native opening quote belongs to the exact provider event and is
 * valid movement evidence whenever it predates kickoff. Long-range NFL
 * look-ahead openers are still real openings; an arbitrary age window must not
 * silently collapse them into the first quote captured by our writer.
 *
 * Locked records bypass timestamp validation so a newer reader can never
 * reinterpret or suppress their stored evidence.
 */
export function isVerifiedEventOpening(args: {
  openingObservedAt: string | null | undefined;
  gameStartAt: string | null | undefined;
  locked: boolean;
}): boolean {
  if (args.locked) return true;
  const openingMs = Date.parse(args.openingObservedAt ?? "");
  const gameStartMs = Date.parse(args.gameStartAt ?? "");
  if (!Number.isFinite(openingMs) || !Number.isFinite(gameStartMs)) return false;
  return openingMs < gameStartMs;
}

/**
 * CFB retains the preceding bounded-cycle presentation contract until a
 * release-pure board replay proves that its older provider landmarks are the
 * same exact market rather than preseason/placeholder context.
 */
export function isCurrentMarketCycleOpening(args: {
  openingObservedAt: string | null | undefined;
  gameStartAt: string | null | undefined;
  locked: boolean;
  maxAgeDays?: number;
}): boolean {
  if (args.locked) return true;
  const openingMs = Date.parse(args.openingObservedAt ?? "");
  const gameStartMs = Date.parse(args.gameStartAt ?? "");
  const maxAgeDays = args.maxAgeDays ?? DAILY_EDGE_CURRENT_MARKET_CYCLE_OPENING_MAX_DAYS;
  if (!Number.isFinite(openingMs) || !Number.isFinite(gameStartMs)) return false;
  if (!Number.isFinite(maxAgeDays) || maxAgeDays <= 0) return false;
  return openingMs < gameStartMs && openingMs >= gameStartMs - maxAgeDays * DAY_MS;
}
