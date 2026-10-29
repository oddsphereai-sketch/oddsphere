import type { CbbPlayer, CbbPlayerGame, CbbPlayerSeason } from "./types";

/** Provider player_stats includes DNP rows; only positive court time proves participation. */
export function cbbPlayedMinutes(value: CbbPlayerGame["min"]): number {
  if (value === null) return 0;
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : 0;
  const trimmed = value.trim();
  const numeric = Number(trimmed);
  if (trimmed && Number.isFinite(numeric)) return numeric > 0 ? numeric : 0;
  const clock = /^(\d+):(\d{2})$/.exec(trimmed);
  if (!clock || Number(clock[2]) >= 60) return 0;
  return Number(clock[1]) + Number(clock[2]) / 60;
}

/** Current membership + prior production. No last-season current nested-team identity leakage. */
export function buildCbbRosterContext(teamId: number, players: CbbPlayer[], prior: CbbPlayerSeason[], previousSeason: number) {
  const roster = players.filter(player => player.team.id === teamId);
  const ids = new Set(roster.map(player => player.id));
  if (ids.size !== roster.length) throw new Error("ambiguous CBB current roster");
  const teamHistory = prior.filter(row => row.team.id === teamId && row.season === previousSeason);
  const playerHistory = prior.filter(row => ids.has(row.player.id) && row.season === previousSeason);
  const minutes = (row: CbbPlayerSeason) => row.min !== null && Number.isFinite(row.min) && row.min > 0 ? row.min * row.games_played : 0;
  const oldMinutes = teamHistory.reduce((sum, row) => sum + minutes(row), 0);
  const retainedMinutes = teamHistory.filter(row => ids.has(row.player.id)).reduce((sum, row) => sum + minutes(row), 0);
  const coverage = roster.length ? roster.filter(player => playerHistory.some(row => row.player.id === player.id)).length / roster.length : 0;
  return { teamId, currentPlayers: roster.length, priorProductionCoverage: coverage,
    returningMinutesShare: oldMinutes ? retainedMinutes / oldMinutes : null,
    incomingTransfers: roster.filter(player => playerHistory.some(row => row.player.id === player.id && row.team.id !== teamId))
      .map(player => ({ playerId: player.id, name: `${player.first_name} ${player.last_name}`,
        priorTeams: [...new Set(playerHistory.filter(row => row.player.id === player.id).map(row => row.team.full_name))] })),
    playersWithoutPriorDiEvidence: roster.filter(player => !playerHistory.some(row => row.player.id === player.id)).map(player => player.id),
    injuryStatus: "unknown" as const, numericalAdjustmentApplied: false,
    impactCalibration: "pending_historical_roster_availability_bindings" as const };
}

/** A roster may enter private pregame research only if both source receipts predate the forecast. */
export function buildCbbRosterContextAt(teamId: number, roster: { fetchedAt: string; data: CbbPlayer[] },
  prior: { fetchedAt: string; data: CbbPlayerSeason[] }, previousSeason: number, asOf: string) {
  const target = Date.parse(asOf), rosterAt = Date.parse(roster.fetchedAt), priorAt = Date.parse(prior.fetchedAt);
  if (![target, rosterAt, priorAt].every(Number.isFinite) || rosterAt > target || priorAt > target) {
    throw new Error("CBB roster evidence arrived after pregame as-of");
  }
  if (prior.data.some(row => row.season !== previousSeason)) throw new Error("CBB roster prior mixes seasons");
  return { ...buildCbbRosterContext(teamId, roster.data, prior.data, previousSeason),
    rosterObservedAt: roster.fetchedAt, priorStatsObservedAt: prior.fetchedAt, forecastAsOf: asOf };
}

/** Historical partial membership from *earlier completed games*, not target-season totals. */
export function buildCbbObservedRosterContext(teamId: number, appearances: CbbPlayerGame[],
  prior: CbbPlayerSeason[], season: number, asOf: string) {
  const at = Date.parse(asOf);
  if (!Number.isFinite(at) || prior.some(row => row.season !== season - 1)) throw new Error("invalid CBB historical roster context");
  if (appearances.some(row => row.game.season === season && !Number.isFinite(Date.parse(row.game.date)))) {
    throw new Error("invalid CBB player-game timestamp");
  }
  const earlier = appearances.filter(row => row.game.season === season && cbbPlayedMinutes(row.min) > 0 &&
    Date.parse(row.game.date) + 6 * 60 * 60 * 1000 <= at)
    .sort((a, b) => a.game.date.localeCompare(b.game.date) || a.game.id - b.game.id);
  const lastSeen = new Map<number, CbbPlayerGame>();
  for (const row of earlier) lastSeen.set(row.player.id, row);
  const observedPlayers: CbbPlayer[] = [...lastSeen.values()].map(row => ({ ...row.player, team: row.team }));
  return { ...buildCbbRosterContext(teamId, observedPlayers, prior, season - 1),
    membershipEvidence: "earlier_game_participants_only" as const,
    observedTeamGames: new Set(earlier.filter(row => row.team.id === teamId).map(row => row.game.id)).size,
    forecastAsOf: asOf };
}
