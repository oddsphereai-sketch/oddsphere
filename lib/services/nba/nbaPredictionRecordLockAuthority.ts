export const NBA_PREDICTION_RECORD_LOCK_AUTHORITY_RELEASE =
  "nba_prediction_record_lock_authority_2026_10_31_r1_legacy_locked_tuple_precedence" as const;

export const NBA_PREDICTION_RECORD_LOCK_MARKETS = ["moneyline", "spread", "total"] as const;

export type NbaPredictionRecordLockRow = {
  game_id: number;
  market: string;
  model_version: string | null;
  locked_at: string | null;
};

/**
 * An already-locked three-market tuple remains the authoritative public
 * record even after the runtime model release advances. Grouping by release
 * prevents mixed-version rows from fabricating a complete lock. Unlocked
 * current-release rows never take precedence over an immutable older lock.
 */
export function resolveNbaPredictionRecordLocks(
  gameIds: readonly number[],
  rows: readonly NbaPredictionRecordLockRow[],
): Map<number, string | null> {
  const locks = new Map<number, string | null>();
  for (const gameId of gameIds) {
    const gameRows = rows.filter((row) => row.game_id === gameId);
    const releases = new Map<string, NbaPredictionRecordLockRow[]>();
    for (const row of gameRows) {
      if (row.model_version === null) continue;
      releases.set(row.model_version, [...(releases.get(row.model_version) ?? []), row]);
    }

    const completeLockedTuples = [...releases.values()].filter((releaseRows) => {
      const byMarket = new Map(releaseRows.map((row) => [row.market, row]));
      return releaseRows.length === NBA_PREDICTION_RECORD_LOCK_MARKETS.length &&
        byMarket.size === NBA_PREDICTION_RECORD_LOCK_MARKETS.length &&
        NBA_PREDICTION_RECORD_LOCK_MARKETS.every((market) => byMarket.has(market)) &&
        releaseRows.every((row) => row.locked_at !== null);
    });
    const lockedAt = completeLockedTuples
      .flatMap((releaseRows) => releaseRows.map((row) => row.locked_at as string))
      .sort()[0] ?? null;
    locks.set(gameId, lockedAt);
  }
  return locks;
}
