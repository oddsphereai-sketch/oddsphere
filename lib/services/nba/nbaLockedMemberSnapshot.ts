import type { NbaDailyEdgeGameDto } from "./buildNbaDailyEdgeDto";
import type { DailyEdgeGameDto } from "../../../app/lab/lib/labTypes";
import { computeLocksAt } from "../../automodel/lockState";

export const NBA_LOCKED_MEMBER_SNAPSHOT_RELEASE =
  "nba_locked_member_snapshot_2026_10_20_r2_complete_card_evidence" as const;

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

function readStoredMemberGame(value: unknown): DailyEdgeGameDto | null {
  if (value === null || typeof value !== "object") return null;
  const stored = (value as { nba_daily_edge_game_at_capture?: unknown })
    .nba_daily_edge_game_at_capture;
  if (stored === null || typeof stored !== "object") return null;
  const candidate = stored as Partial<DailyEdgeGameDto>;
  if (
    typeof candidate.external_id !== "number" ||
    typeof candidate.id !== "string" ||
    candidate.markets === null || typeof candidate.markets !== "object" ||
    candidate.predictions === null || typeof candidate.predictions !== "object"
  ) return null;
  return stored as DailyEdgeGameDto;
}

export function buildNbaLockedMemberCapture(args: {
  gameDto: NbaDailyEdgeGameDto;
  memberGame: DailyEdgeGameDto;
}): Record<string, unknown> {
  if (args.memberGame.external_id !== args.gameDto.game_external_id) {
    throw new Error("NBA locked member capture identity mismatch");
  }
  return {
    nba_locked_member_snapshot_release: NBA_LOCKED_MEMBER_SNAPSHOT_RELEASE,
    nba_game_dto_at_capture: args.gameDto,
    nba_daily_edge_game_at_capture: args.memberGame,
  };
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
}): {
  games: NbaDailyEdgeGameDto[];
  memberGamesByExternalId: Map<number, DailyEdgeGameDto>;
} {
  const rowsByGame = new Map<number, NbaLockedMemberRecord[]>();
  for (const row of args.rows) {
    if (row.locked_at === null) continue;
    rowsByGame.set(row.game_id, [...(rowsByGame.get(row.game_id) ?? []), row]);
  }
  const memberGamesByExternalId = new Map<number, DailyEdgeGameDto>();
  const games = args.games.map((game) => {
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
    const lockTimestamps = new Set(lockedRows.map((row) => row.locked_at));
    if (
      stored.some((row) => row.game_external_id !== game.game_external_id || JSON.stringify(row) !== identity) ||
      lockTimestamps.size !== 1
    ) {
      throw new Error(`NBA locked member DTO mismatch for game_id=${dbId}`);
    }

    const storedMemberGames = lockedRows
      .map((row) => readStoredMemberGame(row.snapshot_json))
      .filter((row): row is DailyEdgeGameDto => row !== null);
    if (storedMemberGames.length > 0) {
      if (storedMemberGames.length !== 3) {
        throw new Error(`NBA locked member card is incomplete for game_id=${dbId}`);
      }
      const memberIdentity = JSON.stringify(storedMemberGames[0]);
      if (
        storedMemberGames.some((row) =>
          row.external_id !== game.game_external_id || JSON.stringify(row) !== memberIdentity
        )
      ) {
        throw new Error(`NBA locked member card mismatch for game_id=${dbId}`);
      }
      const lockedAt = lockedRows[0]!.locked_at!;
      const captured = storedMemberGames[0]!;
      memberGamesByExternalId.set(game.game_external_id, {
        ...captured,
        scheduledLockAt: computeLocksAt(captured.gameStartAt) ?? captured.scheduledLockAt,
        lockState: "locked",
        lockedAt,
      });
    }
    // Preserve the exact captured DTO and overlay only the authoritative
    // column-owned lifecycle timestamp for the response adapter. The stored
    // snapshot_json remains byte-for-byte immutable.
    return { ...stored[0]!, locked_at: lockedRows[0]!.locked_at };
  });
  return { games, memberGamesByExternalId };
}
