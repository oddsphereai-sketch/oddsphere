import type { NflPlayerPropsInferenceContext } from "./nflPlayerPropsInferenceContext";
import { nflPlayerPropsSettlementNameKey as nameKey, nflPlayerPropsSettlementTeamKey as teamKey } from "./nflPlayerPropsSettlementIdentity";

/** Only enrich a new tracking insert from already captured pre-lock identity.
 * Never update a decision, infer a player from outcomes, or guess on ambiguity. */
export function nflPlayerPropsTrackingIdentity(args: {
  decision: { gameId: string; providerPlayerId: string | null; playerName: string; team: string; scheduledStart: string; lockAt: string };
  context?: NflPlayerPropsInferenceContext;
}): { playerId: string | null; source: "quote" | "exact_game_pregame_roster" | "unresolved"; capturedAt: string | null } {
  const { decision, context } = args;
  if (decision.providerPlayerId) return { playerId: decision.providerPlayerId, source: "quote", capturedAt: null };
  const game = context?.games.find(game => game.canonicalGameId === decision.gameId
    && Date.parse(game.scheduledStart) === Date.parse(decision.scheduledStart));
  const depth = game && [game.awayDepth, game.homeDepth].find(depth => teamKey(depth.team) === teamKey(decision.team));
  if (depth?.provider === "balldontlie" && Date.parse(depth.capturedAt) <= Date.parse(decision.lockAt)) {
    const ids = [...new Set(depth.roster.filter(player => nameKey(player.name) === nameKey(decision.playerName)
      && player.playerId && /^\d+$/.test(player.playerId)).map(player => player.playerId!))];
    if (ids.length === 1) return { playerId: ids[0]!, source: "exact_game_pregame_roster", capturedAt: depth.capturedAt };
  }
  return { playerId: null, source: "unresolved", capturedAt: null };
}
