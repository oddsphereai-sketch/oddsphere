export type PitcherFirstInningGame = {
  game_date: string;
  home_pitcher_id: number | null;
  away_pitcher_id: number | null;
  inning_scores: unknown;
};

export function pitcherFirstInningPoint(
  row: PitcherFirstInningGame,
  pitcherId: number,
): { date: string; runsAllowed: number } | null {
  const scores = parseInningScores(row.inning_scores);
  if (!scores) return null;
  const runsAllowed = row.away_pitcher_id === pitcherId
    ? scores.home[0]
    : row.home_pitcher_id === pitcherId
      ? scores.away[0]
      : null;
  return typeof runsAllowed === "number"
    ? { date: row.game_date, runsAllowed }
    : null;
}

function parseInningScores(value: unknown): { away: unknown[]; home: unknown[] } | null {
  if (value === null || typeof value !== "object") return null;
  const scores = value as { away?: unknown; home?: unknown };
  return Array.isArray(scores.away) && Array.isArray(scores.home)
    ? { away: scores.away, home: scores.home }
    : null;
}
