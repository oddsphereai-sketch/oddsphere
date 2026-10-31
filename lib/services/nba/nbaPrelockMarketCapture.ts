export const NBA_PRELOCK_MARKET_CAPTURE_RELEASE = "nba_prelock_market_capture_2026_10_31_r2_shared_public_cache" as const;
export type NbaPrelockCaptureScope = { externalIds: readonly number[]; deadlineAtMs: number };
export type NbaPrelockCaptureReceipt = { release: typeof NBA_PRELOCK_MARKET_CAPTURE_RELEASE; externalIds: readonly number[];
  ingestionRunId: string; capturedAt: string; providerRequestCeiling: 4; providerErrors: readonly string[] };

/** Operational bounds, never a permission based on market magnitude. */
export function assertNbaPrelockCaptureBudget(scope: NbaPrelockCaptureScope, nowMs = Date.now()) {
  if (!scope.externalIds.length || scope.externalIds.length > 16 || new Set(scope.externalIds).size !== scope.externalIds.length ||
      scope.externalIds.some(id => !Number.isSafeInteger(id) || id <= 0) || !Number.isFinite(scope.deadlineAtMs)) {
    throw new Error("Invalid NBA pre-lock capture scope");
  }
  if (nowMs >= scope.deadlineAtMs) throw new Error("NBA pre-lock capture deadline exceeded; lock must wait for a complete pass");
}

export function selectNbaPrelockCaptureGames<T extends { externalId: number }>(sport: string, games: readonly T[], scope: NbaPrelockCaptureScope) {
  assertNbaPrelockCaptureBudget(scope);
  if (sport !== "nba") throw new Error("NBA pre-lock scope cannot alter another sport's collector");
  const selected = games.filter(game => scope.externalIds.includes(game.externalId));
  if (selected.length !== scope.externalIds.length || new Set(selected.map(g => g.externalId)).size !== selected.length) {
    throw new Error("NBA pre-lock capture could not identify every entering game exactly once");
  }
  return selected;
}
