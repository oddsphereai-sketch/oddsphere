import type { DailyEdgeGameDto, DailyEdgeResponse } from "@/app/lab/lib/labTypes";

/**
 * A locked member read is the public betting record. Later refreshes may add
 * the official result and correct fixture metadata, but they cannot replace
 * the locked projections, markets, prices, grades, or supporting evidence.
 */
export function preserveLockedEplGames(
  previous: DailyEdgeResponse | null,
  incoming: DailyEdgeResponse,
): DailyEdgeResponse {
  if (!previous) return incoming;
  const previousByExternalId = new Map(previous.games.map((game) => [game.external_id, game]));
  return {
    ...incoming,
    games: incoming.games.map((fresh) => {
      const locked = previousByExternalId.get(fresh.external_id);
      if (!locked || locked.lockState !== "locked" || !locked.lockedAt) return fresh;
      const preserved: DailyEdgeGameDto = {
        ...locked,
        // These fields describe the event rather than the wager and may still
        // receive an official correction after the betting record is frozen.
        id: fresh.id,
        sport: fresh.sport,
        external_id: fresh.external_id,
        awayTeam: fresh.awayTeam,
        awayTeamLogo: fresh.awayTeamLogo,
        homeTeam: fresh.homeTeam,
        homeTeamLogo: fresh.homeTeamLogo,
        gameTime: fresh.gameTime,
        gameStartAt: fresh.gameStartAt,
        gameStartMinutes: fresh.gameStartMinutes,
        scheduledLockAt: fresh.scheduledLockAt,
        lockState: "locked",
        lockedAt: locked.lockedAt,
        result: fresh.result ?? locked.result,
        holdReason: null,
      };
      return preserved;
    }),
  };
}
