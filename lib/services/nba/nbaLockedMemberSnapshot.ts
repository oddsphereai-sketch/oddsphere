import type { NbaDailyEdgeGameDto } from "./buildNbaDailyEdgeDto";

export type NbaLockedMemberRecord = {
  game_id: number;
  market: string;
  locked_at: string | null;
  snapshot_json: unknown;
};

function readStoredGameDto(value: unknown): NbaDailyEdgeGameDto | null {
  if (value === null || typeof value !== "object") return null;
  const stored = (value as { nba_game_dto_at_capture?: unknown }).nba_game_dto_at_capture;
  if (stored === null || typeof stored !== "object") return null;
  const candidate = stored as Partial<NbaDailyEdgeGameDto>;
  if (
    typeof candidate.game_external_id !== "number" ||
    typeof candidate.matchup !== "string" ||
    candidate.projection === null || typeof candidate.projection !== "object" ||
    candidate.intelligence === null || typeof candidate.intelligence !== "object"
  ) return null;
  return stored as NbaDailyEdgeGameDto;
}

/**
 * Replace dynamic games with the exact DTO captured by an immutable lock.
 * Multiple official-market rows must carry byte-identical payloads. Missing
 * legacy payloads are not reconstructed here; their stored fields remain
 * untouched and the historical response-snapshot reader keeps precedence.
 */
export function applyNbaLockedMemberSnapshotPrecedence(args: {
  games: readonly NbaDailyEdgeGameDto[];
  dbIdByExternalId: ReadonlyMap<number, number>;
  rows: readonly NbaLockedMemberRecord[];
}): NbaDailyEdgeGameDto[] {
  const rowsByGame = new Map<number, NbaLockedMemberRecord[]>();
  for (const row of args.rows) {
    if (row.locked_at === null) continue;
    rowsByGame.set(row.game_id, [...(rowsByGame.get(row.game_id) ?? []), row]);
  }
  return args.games.map((game) => {
    const dbId = args.dbIdByExternalId.get(game.game_external_id);
    if (dbId === undefined) return game;
    const lockedRows = rowsByGame.get(dbId) ?? [];
    const stored = lockedRows
      .map((row) => readStoredGameDto(row.snapshot_json))
      .filter((row): row is NbaDailyEdgeGameDto => row !== null);
    if (stored.length === 0) return game;
    const markets = new Set(lockedRows.map((row) => row.market));
    if (
      lockedRows.length !== 3 || stored.length !== 3 ||
      !["moneyline", "spread", "total"].every((market) => markets.has(market))
    ) {
      throw new Error(`NBA locked member DTO is incomplete for game_id=${dbId}`);
    }
    const identity = JSON.stringify(stored[0]);
    if (
      stored.some((row) => row.game_external_id !== game.game_external_id || JSON.stringify(row) !== identity)
    ) {
      throw new Error(`NBA locked member DTO mismatch for game_id=${dbId}`);
    }
    return stored[0]!;
  });
}
