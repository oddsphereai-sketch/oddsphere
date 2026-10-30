import type { CbbPlayerGame, CbbPlayerSeason, CbbRatingState } from "./types";
import { cbbPlayedMinutes } from "./rosterContext";

export const CBB_ROSTER_PRIOR_RESEARCH_RELEASE = "cbb_private_2026_10_29_r20_observed_roster_prior";

/**
 * Private post-opener candidate only. Previously observed player participation
 * can attenuate a stale team prior; it cannot identify an unplayed newcomer.
 */
export function attenuateCbbPriorFromObservedRoster(prior: CbbRatingState, priorPlayers: CbbPlayerSeason[],
  appearances: CbbPlayerGame[], season: number, asOf: string, effect: number, disabledTeams: ReadonlySet<number> = new Set()) {
  const at = Date.parse(asOf);
  if (!Number.isFinite(at) || prior.season !== season - 1 || !(effect >= 0 && effect <= 1) ||
    priorPlayers.some(row => row.season !== season - 1)) throw new Error("invalid CBB roster prior fit");
  const oldMinutes = new Map<number, number>(), playerMinutes = new Map<number, Map<number, number>>();
  for (const row of priorPlayers) {
    const minutes = row.min !== null && Number.isFinite(row.min) && row.min > 0 && row.games_played > 0
      ? row.min * row.games_played : 0;
    oldMinutes.set(row.team.id, (oldMinutes.get(row.team.id) ?? 0) + minutes);
    const byPlayer = playerMinutes.get(row.team.id) ?? new Map<number, number>();
    byPlayer.set(row.player.id, (byPlayer.get(row.player.id) ?? 0) + minutes);
    playerMinutes.set(row.team.id, byPlayer);
  }
  const observed = new Map<number, CbbPlayerGame>();
  for (const row of appearances) {
    if (row.game.season !== season || cbbPlayedMinutes(row.min) <= 0) continue;
    const playedAt = Date.parse(row.game.date);
    if (!Number.isFinite(playedAt)) throw new Error("invalid CBB player appearance time");
    if (playedAt + 6 * 60 * 60 * 1000 <= at) {
      const previous = observed.get(row.player.id);
      if (!previous || previous.game.date < row.game.date) observed.set(row.player.id, row);
    }
  }
  const playersByTeam = new Map<number, Set<number>>(), gamesByTeam = new Map<number, Set<number>>();
  for (const row of observed.values()) {
    const players = playersByTeam.get(row.team.id) ?? new Set<number>(); players.add(row.player.id); playersByTeam.set(row.team.id, players);
  }
  for (const row of appearances) {
    if (row.game.season !== season || cbbPlayedMinutes(row.min) <= 0 ||
      Date.parse(row.game.date) + 6 * 60 * 60 * 1000 > at) continue;
    const games = gamesByTeam.get(row.team.id) ?? new Set<number>(); games.add(row.game.id); gamesByTeam.set(row.team.id, games);
  }
  const teams = { ...prior.teams }, diagnostics = new Map<number, { observedGames: number; observedPriorMinutesShare: number | null; scale: number }>();
  for (const [idText, rating] of Object.entries(prior.teams)) {
    const id = Number(idText), old = oldMinutes.get(id) ?? 0;
    const returning = [...(playersByTeam.get(id) ?? [])].reduce((sum, player) => sum + (playerMinutes.get(id)?.get(player) ?? 0), 0);
    // This is observed participation, not verified roster retention: an injured
    // or unused returner is absent from this numerator until they play.
    const observedPriorMinutesShare = old > 0 ? Math.min(1, returning / old) : null;
    const observedGames = gamesByTeam.get(id)?.size ?? 0;
    const evidenceWeight = observedGames / (observedGames + 2);
    const scale = disabledTeams.has(id) || observedPriorMinutesShare === null ? 1 :
      1 - effect * evidenceWeight * (1 - observedPriorMinutesShare);
    teams[id] = { ...rating, offense: rating.offense * scale, defense: rating.defense * scale, pace: rating.pace * scale };
    diagnostics.set(id, { observedGames, observedPriorMinutesShare, scale });
  }
  return { prior: { ...prior, teams }, diagnostics };
}
