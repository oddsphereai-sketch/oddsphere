import type { CbbPlayer, CbbPlayerSeason } from "./types";

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
