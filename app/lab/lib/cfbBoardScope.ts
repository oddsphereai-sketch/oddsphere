import type { DailyEdgeGameDto } from "./labTypes";
import type { Sport } from "@/lib/types/domain/Sport";

export const CFB_MEMBER_BOARD_SCOPE_RELEASE =
  "cfb_member_board_scope_2026_08_29_r1_fbs_default" as const;

export type CfbBoardScope = "fbs" | "division_i";

export function resolveInitialCfbBoardScope(args: {
  sport: Sport;
  games: DailyEdgeGameDto[];
  requestedGameId: string | null;
}): CfbBoardScope {
  if (args.sport !== "cfb" || args.requestedGameId === null) return "fbs";
  return args.games.find((game) => game.id === args.requestedGameId)?.collegeFootballScope === "fcs_only"
    ? "division_i"
    : "fbs";
}

export function selectCfbBoardGames(
  games: DailyEdgeGameDto[],
  sport: Sport,
  scope: CfbBoardScope,
): DailyEdgeGameDto[] {
  if (sport !== "cfb" || scope === "division_i") return games;
  const classified = games.filter((game) => game.collegeFootballScope !== undefined);
  if (classified.length === 0) return games;
  const fbs = classified.filter((game) => game.collegeFootballScope === "fbs_involved");
  return fbs.length > 0 ? fbs : games;
}
