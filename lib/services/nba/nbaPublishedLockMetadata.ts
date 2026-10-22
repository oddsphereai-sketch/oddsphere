import type { DailyEdgeResponse } from "@/app/lab/lib/labTypes";
import { computeLocksAt } from "@/lib/automodel/lockState";

export const NBA_MEMBER_LOCK_PUBLICATION_RELEASE =
  "nba_member_lock_publication_2026_10_22_r3_roster_regime_residual";

export type NbaPublishedLockRow = {
  game_id: number;
  market: string;
  locked_at: string | null;
};

export function applyNbaPublishedLockMetadata(args: {
  payload: DailyEdgeResponse;
  dbIdByExternalId: ReadonlyMap<number, number>;
  rows: readonly NbaPublishedLockRow[];
}): { payload: DailyEdgeResponse; lockedGames: number; changedGames: number } {
  const rowsByGame = new Map<number, NbaPublishedLockRow[]>();
  for (const row of args.rows) {
    if (row.locked_at === null) continue;
    rowsByGame.set(row.game_id, [...(rowsByGame.get(row.game_id) ?? []), row]);
  }

  let lockedGames = 0;
  let changedGames = 0;
  const games = args.payload.games.map((game) => {
    const dbId = args.dbIdByExternalId.get(game.external_id);
    if (dbId === undefined) return game;
    const lockedRows = rowsByGame.get(dbId) ?? [];
    if (lockedRows.length === 0) return game;

    const markets = new Set(lockedRows.map((row) => row.market));
    const timestamps = new Set(lockedRows.map((row) => row.locked_at));
    if (
      lockedRows.length !== 3 ||
      !["moneyline", "spread", "total"].every((market) => markets.has(market)) ||
      timestamps.size !== 1
    ) {
      throw new Error(`NBA published lock tuple is incomplete for game_id=${dbId}`);
    }

    const lockedAt = lockedRows[0]!.locked_at!;
    lockedGames += 1;
    if (game.lockState === "locked" && game.lockedAt === lockedAt) return game;
    changedGames += 1;
    return {
      ...game,
      scheduledLockAt: computeLocksAt(game.gameStartAt) ?? game.scheduledLockAt,
      lockState: "locked" as const,
      lockedAt,
    };
  });

  return {
    payload: changedGames === 0 ? args.payload : { ...args.payload, games },
    lockedGames,
    changedGames,
  };
}
