import type { EplTrainingMatch } from "./eplShadowModel";

/**
 * Reader evidence is deliberately narrower than the model's training set.
 * It may use the current and immediately prior EPL season, but never older
 * top-flight history for a returning club while calling that sample recent.
 */
export function recentComparableEplMatches(
  matches: EplTrainingMatch[],
  teamId: number,
  currentSeason = 2026,
): EplTrainingMatch[] {
  return matches
    .filter((match) => match.season >= currentSeason - 1)
    .filter((match) => match.home_team_id === teamId || match.away_team_id === teamId)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, 10);
}
