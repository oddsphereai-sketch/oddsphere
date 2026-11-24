import type { DailyEdgeGameDto, DailyEdgeResponse } from "@/app/lab/lib/labTypes";

export const NBA_MEMBER_LOCK_PUBLICATION_RELEASE =
  "nba_member_lock_publication_2026_11_23_r11_exact_saved_cards";

export type NbaPublishedLockRow = {
  game_id: number;
  market: string;
  locked_at: string | null;
};

export function applyNbaPublishedLockMetadata(args: {
  payload: DailyEdgeResponse;
  dbIdByExternalId: ReadonlyMap<number, number>;
  rows: readonly NbaPublishedLockRow[];
  lockedMemberGamesByExternalId: ReadonlyMap<number, DailyEdgeGameDto>;
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
    // Existing published locks are opaque history. This handoff only acts on
    // an unlocked card crossing into its first authoritative stored lock.
    if (game.lockedAt != null) {
      if (!Number.isFinite(Date.parse(game.lockedAt)) || Date.parse(game.lockedAt) !== Date.parse(lockedAt)) throw new Error(`NBA existing published lock timestamp mismatch for game_id=${dbId}`);
      return game;
    }
    const captured = args.lockedMemberGamesByExternalId.get(game.external_id);
    if (!captured || captured.external_id !== game.external_id || captured.id !== game.id ||
        captured.lockState !== "locked" || captured.lockedAt !== lockedAt) {
      throw new Error(`NBA exact saved lock card is unavailable for game_id=${dbId}`);
    }
    changedGames += 1;
    return captured;
  });

  return {
    payload: changedGames === 0 ? args.payload : { ...args.payload, games },
    lockedGames,
    changedGames,
  };
}
