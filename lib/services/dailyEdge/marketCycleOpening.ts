export const DAILY_EDGE_CURRENT_MARKET_CYCLE_OPENING_MAX_DAYS = 14 as const;

const DAY_MS = 24 * 60 * 60 * 1_000;

/**
 * A provider-native look-ahead opener remains valuable raw evidence, but it is
 * not the opening anchor for the current game-week market cycle. Member price
 * trails and same-day movement reads may use only an opener inside this
 * bounded window. Locked records bypass this filter so their stored evidence
 * can never be reinterpreted by a later reader release.
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
