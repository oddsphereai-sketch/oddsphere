export type MlbPropsMatchupHistoryCandidate<T> = {
  key: string;
  value: T;
  actionablePriority: number;
  gameStartTime: string;
  upcoming: boolean;
};

export function selectMlbPropsMatchupHistoryCandidates<T>(
  candidates: MlbPropsMatchupHistoryCandidate<T>[],
  limit: number,
): MlbPropsMatchupHistoryCandidate<T>[] {
  return [...candidates]
    .sort(compareMlbPropsMatchupHistoryCandidates)
    .slice(0, Math.max(0, limit));
}

export function compareMlbPropsMatchupHistoryCandidates<T>(
  a: MlbPropsMatchupHistoryCandidate<T>,
  b: MlbPropsMatchupHistoryCandidate<T>,
): number {
  return Number(b.upcoming) - Number(a.upcoming)
    || b.actionablePriority - a.actionablePriority
    || Date.parse(a.gameStartTime) - Date.parse(b.gameStartTime)
    || a.key.localeCompare(b.key);
}
