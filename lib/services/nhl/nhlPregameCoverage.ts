/**
 * A non-pregame NHL game can leave the provider coverage gate only after all
 * three official predictions are locked. Unknown/scheduled states and any
 * incomplete lock continue to fail closed.
 */
export function requiresNhlPregameMarketCoverage(
  status: string | null,
  hasCompleteLock: boolean,
): boolean {
  const normalized = (status ?? "").trim().toUpperCase();
  const noLongerPregame = [
    "LIVE",
    "IN_PROGRESS",
    "FINAL",
    "COMPLETED",
    "CANCELED",
    "CANCELLED",
    "POSTPONED",
  ].includes(normalized);
  return !noLongerPregame || !hasCompleteLock;
}
