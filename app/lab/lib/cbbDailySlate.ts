import type { CbbRollingScheduleDto, DailyEdgeGameDto, DailyEdgeResponse } from "@/app/lab/lib/labTypes";
import { dateKeyInTimeZone } from "@/app/lab/lib/dailyEdgeBoardDates";

export type CbbSlateDay = {
  date: string;
  analyzed: number;
  scheduled: number;
};

const ET = "America/New_York";

export function cbbGameSlateDate(game: DailyEdgeGameDto): string | null {
  return game.gameStartAt ? dateKeyInTimeZone(game.gameStartAt, ET) : null;
}

export function cbbSlateDays(snapshot: DailyEdgeResponse): CbbSlateDay[] {
  const days = new Map<string, CbbSlateDay>();
  for (const game of snapshot.games) {
    const date = cbbGameSlateDate(game);
    if (!date) continue;
    const day = days.get(date) ?? { date, analyzed: 0, scheduled: 0 };
    day.analyzed += 1;
    days.set(date, day);
  }
  for (const game of snapshot.cbbRollingSchedule?.games ?? []) {
    const date = game.slateDate;
    const day = days.get(date) ?? { date, analyzed: 0, scheduled: 0 };
    day.scheduled += 1;
    days.set(date, day);
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function initialCbbSlateDate(snapshot: DailyEdgeResponse, requestedGameId: string | null): string {
  const requested = snapshot.games.find((game) => game.id === requestedGameId);
  const requestedDate = requested ? cbbGameSlateDate(requested) : null;
  if (requestedDate) return requestedDate;
  const days = cbbSlateDays(snapshot).filter((day) => day.date >= snapshot.date);
  return days.find((day) => day.date === snapshot.date)?.date
    ?? days.find((day) => day.analyzed > 0)?.date
    ?? days[0]?.date
    ?? snapshot.date;
}

export function cbbAnalyzedGamesForDate(games: DailyEdgeGameDto[], date: string): DailyEdgeGameDto[] {
  return games.filter((game) => cbbGameSlateDate(game) === date);
}

export function cbbScheduleForDate(schedule: CbbRollingScheduleDto | undefined, date: string): CbbRollingScheduleDto | undefined {
  return schedule ? { ...schedule, games: schedule.games.filter((game) => game.slateDate === date) } : undefined;
}
