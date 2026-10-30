import type { CbbScoreFeatureRow } from "./scoreResearch";
import type { CbbFourFactors, CbbTrainingGame } from "./types";

export const CBB_SCHEDULE_FACTOR_RESEARCH_RELEASE = "cbb_private_2026_10_29_r19_schedule_factors";
const keys = ["efg", "turnoverRate", "offensiveReboundRate", "freeThrowRate"] as const;
const neutral: CbbFourFactors = { efg: 0.5, turnoverRate: 0.18, offensiveReboundRate: 0.28, freeThrowRate: 0.3 };

type Observation = { team: number; opponent: number; factor: CbbFourFactors; weight: number };

/** Private candidate: ridge-adjusted offense/allowed Four Factors using only prior completed games. */
export function scheduleAdjustedFactors(history: CbbTrainingGame[], season: number, asOf: string, ridge = 5) {
  if (!(ridge > 0) || !Number.isFinite(Date.parse(asOf))) throw new Error("invalid CBB factor fit");
  const games = history.filter(game => game.season === season && game.neutral !== null &&
    Date.parse(game.date) + 6 * 60 * 60 * 1000 <= Date.parse(asOf));
  const rows: Observation[] = games.flatMap(game => {
    const weight = Math.exp(-Math.max(0, (Date.parse(asOf) - Date.parse(game.date)) / 86400000) / 90);
    return [
      { team: game.homeId, opponent: game.awayId, factor: game.homeFactors, weight },
      { team: game.awayId, opponent: game.homeId, factor: game.awayFactors, weight },
    ];
  });
  const ids = [...new Set(rows.flatMap(row => [row.team, row.opponent]))];
  const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0);
  const league = Object.fromEntries(keys.map(key => [key, totalWeight > 0
    ? rows.reduce((sum, row) => sum + row.weight * row.factor[key], 0) / totalWeight
    : neutral[key]])) as CbbFourFactors;
  const offense = new Map<number, CbbFourFactors>(ids.map(id => [id, { efg: 0, turnoverRate: 0, offensiveReboundRate: 0, freeThrowRate: 0 }]));
  const allowed = new Map<number, CbbFourFactors>(ids.map(id => [id, { efg: 0, turnoverRate: 0, offensiveReboundRate: 0, freeThrowRate: 0 }]));
  const byTeam = new Map<number, Observation[]>(), byOpponent = new Map<number, Observation[]>();
  for (const row of rows) {
    byTeam.set(row.team, [...(byTeam.get(row.team) ?? []), row]);
    byOpponent.set(row.opponent, [...(byOpponent.get(row.opponent) ?? []), row]);
  }
  for (let iteration = 0; iteration < 12; iteration++) {
    for (const id of ids) for (const key of keys) {
      const own = byTeam.get(id) ?? [], faced = byOpponent.get(id) ?? [];
      offense.get(id)![key] = own.reduce((sum, row) => sum + row.weight *
        (row.factor[key] - league[key] - (allowed.get(row.opponent)?.[key] ?? 0)), 0) /
        (ridge + own.reduce((sum, row) => sum + row.weight, 0));
      allowed.get(id)![key] = faced.reduce((sum, row) => sum + row.weight *
        (row.factor[key] - league[key] - (offense.get(row.team)?.[key] ?? 0)), 0) /
        (ridge + faced.reduce((sum, row) => sum + row.weight, 0));
    }
  }
  return { league, offense, allowed, games: games.length };
}

/** Replaces only the eight matchup-factor features; score and labels remain untouched. */
export function enrichScheduleFactors(rows: CbbScoreFeatureRow[], history: CbbTrainingGame[], ridge = 5): CbbScoreFeatureRow[] {
  const fits = new Map<string, ReturnType<typeof scheduleAdjustedFactors>>();
  return rows.map(row => {
    const { game, forecast } = row;
    const key = `${game.season}:${forecast.asOf}`;
    let fit = fits.get(key);
    if (!fit) { fit = scheduleAdjustedFactors(history, game.season, forecast.asOf, ridge); fits.set(key, fit); }
    const matchup = (own: number, opponent: number, factor: keyof CbbFourFactors) =>
      fit!.league[factor] + (fit!.offense.get(own)?.[factor] ?? 0) + (fit!.allowed.get(opponent)?.[factor] ?? 0);
    const home = keys.map(factor => matchup(game.homeId, game.awayId, factor));
    const away = keys.map(factor => matchup(game.awayId, game.homeId, factor));
    const features = [...row.features];
    for (let i = 0; i < 4; i++) {
      features[7 + i] = (home[i] - away[i]) * 10;
      features[11 + i] = (home[i] + away[i] - 2 * neutral[keys[i]]) * 10;
    }
    return { ...row, features };
  });
}
