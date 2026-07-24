export const MLB_PROPS_GAME_LOCK_MINUTES = 60;
export const MLB_PROPS_TRACKING_POLICY_RELEASE_ID = "mlb_props_tracking_t60_game_v1";

export function mlbPropsGameLockCutoff(gameStartTimestamp: string): string | null {
  const startMs = Date.parse(gameStartTimestamp);
  if (!Number.isFinite(startMs)) return null;
  return new Date(startMs - MLB_PROPS_GAME_LOCK_MINUTES * 60_000).toISOString();
}

export function mlbPropsGameLockIsDue(gameStartTimestamp: string, observedAt: string): boolean {
  const startMs = Date.parse(gameStartTimestamp);
  const observedMs = Date.parse(observedAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(observedMs)) return false;
  const cutoffMs = startMs - MLB_PROPS_GAME_LOCK_MINUTES * 60_000;
  return observedMs >= cutoffMs && observedMs < startMs;
}
