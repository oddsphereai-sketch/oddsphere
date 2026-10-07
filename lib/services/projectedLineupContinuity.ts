export type ProjectedLineupPersistenceRow = {
  game_id: number;
  team_id: number;
  player_id: number;
  batting_position: number | null;
  starting_position: string | null;
  is_confirmed: boolean;
  is_dh: boolean;
};

export type ProjectedLineupTeamUnit = {
  gameId: number;
  teamId: number;
  rows: ProjectedLineupPersistenceRow[];
};

export function lineupTeamKey(gameId: number, teamId: number): string {
  return `${gameId}|${teamId}`;
}

/**
 * A projected provider response may replace one team only after it contains a
 * usable mapped batting unit. Empty/partial responses remain observations, not
 * proof that the previous verified lineup should be cleared.
 */
export function selectCompleteProjectedLineupUnits(args: {
  rows: readonly ProjectedLineupPersistenceRow[];
  expectedTeamIdsByGame: ReadonlyMap<number, ReadonlySet<number>>;
  confirmedTeamKeys?: ReadonlySet<string>;
  minimumMappedBatters?: number;
}): {
  units: ProjectedLineupTeamUnit[];
  incompleteTeamKeys: string[];
  confirmedTeamKeys: string[];
} {
  const minimumMappedBatters = args.minimumMappedBatters ?? 8;
  const confirmedTeamKeys = args.confirmedTeamKeys ?? new Set<string>();
  const rowsByTeam = new Map<string, ProjectedLineupPersistenceRow[]>();

  for (const row of args.rows) {
    const expectedTeams = args.expectedTeamIdsByGame.get(row.game_id);
    if (!expectedTeams?.has(row.team_id)) continue;
    const key = lineupTeamKey(row.game_id, row.team_id);
    const rows = rowsByTeam.get(key) ?? [];
    rows.push(row);
    rowsByTeam.set(key, rows);
  }

  const units: ProjectedLineupTeamUnit[] = [];
  const incomplete: string[] = [];
  const alreadyConfirmed: string[] = [];

  for (const [gameId, teamIds] of args.expectedTeamIdsByGame) {
    for (const teamId of teamIds) {
      const key = lineupTeamKey(gameId, teamId);
      if (confirmedTeamKeys.has(key)) {
        alreadyConfirmed.push(key);
        continue;
      }

      const rows = rowsByTeam.get(key) ?? [];
      const uniquePlayers = new Set<number>();
      const uniqueBattingPositions = new Set<number>();
      for (const row of rows) {
        if (!Number.isSafeInteger(row.player_id) || row.player_id <= 0) continue;
        if (
          row.batting_position === null ||
          !Number.isInteger(row.batting_position) ||
          row.batting_position < 1 ||
          row.batting_position > 9
        ) {
          continue;
        }
        uniquePlayers.add(row.player_id);
        uniqueBattingPositions.add(row.batting_position);
      }

      if (
        uniquePlayers.size < minimumMappedBatters ||
        uniqueBattingPositions.size < minimumMappedBatters
      ) {
        incomplete.push(key);
        continue;
      }

      const dedupedRows = [...new Map(rows.map((row) => [row.player_id, row])).values()];
      units.push({ gameId, teamId, rows: dedupedRows });
    }
  }

  return {
    units,
    incompleteTeamKeys: incomplete,
    confirmedTeamKeys: alreadyConfirmed,
  };
}
