import { addDaysToSlate, computeSlateDate, isSlateDate } from "../dates/slateDate";
import type { CbbGame } from "./types";

export const CBB_ROLLING_SLATE_RELEASE = "cbb_rolling_slate_2026_10_29_r1_seven_et_days" as const;
export const CBB_ROLLING_SLATE_DAYS = 7 as const;

export function cbbRollingSlateDates(anchorDate: string): string[] {
  if (!isSlateDate(anchorDate)) throw new Error("Invalid CBB rolling slate anchor date");
  return Array.from({ length: CBB_ROLLING_SLATE_DAYS }, (_, offset) =>
    addDaysToSlate(anchorDate, offset));
}

/** Exact ET-day membership, not the UTC date or a fixed football week. */
export function cbbRollingSlateGames(games: CbbGame[], anchorDate: string) {
  const dates = cbbRollingSlateDates(anchorDate);
  const allowed = new Set(dates);
  const ids = new Set<number>();
  const byDate = new Map(dates.map(date => [date, [] as CbbGame[]]));
  for (const game of games) {
    if (!Number.isInteger(game.id) || game.id <= 0 || !Number.isFinite(Date.parse(game.date))) {
      throw new Error("Invalid CBB rolling fixture identity or start");
    }
    const date = computeSlateDate("cbb", game.date);
    if (!allowed.has(date)) continue;
    if (ids.has(game.id)) throw new Error(`Duplicate CBB rolling fixture ${game.id}`);
    ids.add(game.id);
    byDate.get(date)!.push(game);
  }
  return dates.map(date => ({ date, games: byDate.get(date)!.sort((a, b) =>
    Date.parse(a.date) - Date.parse(b.date) || a.id - b.id) }));
}
