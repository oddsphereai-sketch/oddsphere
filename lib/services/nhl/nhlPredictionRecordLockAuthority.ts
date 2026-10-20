import { NHL_REGULAR_MODEL_RELEASE } from "../../automodel/nhlRegularModelV1";

export const NHL_PREDICTION_RECORD_LOCK_AUTHORITY_RELEASE =
  "nhl_prediction_record_lock_authority_2026_10_20_r1_current_three_market_tuple" as const;

export const NHL_PREDICTION_RECORD_LOCK_MARKETS = ["moneyline", "spread", "total"] as const;

export type NhlPredictionRecordLockRow = {
  game_id: number;
  market: string;
  model_version: string | null;
  locked_at: string | null;
};

/**
 * Resolve the NHL lock only from the exact current-release three-market tuple.
 * Partial, duplicate, legacy-release, or mixed locked/unlocked tuples stay
 * unresolved so the pregame sweep fails closed instead of inventing a lock.
 */
export function resolveNhlPredictionRecordLocks(
  gameIds: readonly number[],
  rows: readonly NhlPredictionRecordLockRow[],
): Map<number, string | null> {
  const locks = new Map<number, string | null>();
  for (const gameId of gameIds) {
    const gameRows = rows.filter((row) => row.game_id === gameId);
    const byMarket = new Map(gameRows.map((row) => [row.market, row]));
    const complete = gameRows.length === NHL_PREDICTION_RECORD_LOCK_MARKETS.length
      && byMarket.size === NHL_PREDICTION_RECORD_LOCK_MARKETS.length
      && NHL_PREDICTION_RECORD_LOCK_MARKETS.every((market) => byMarket.has(market))
      && gameRows.every((row) => row.model_version === NHL_REGULAR_MODEL_RELEASE)
      && gameRows.every((row) => row.locked_at !== null);
    locks.set(
      gameId,
      complete
        ? gameRows.map((row) => row.locked_at as string).sort()[0]!
        : null,
    );
  }
  return locks;
}
