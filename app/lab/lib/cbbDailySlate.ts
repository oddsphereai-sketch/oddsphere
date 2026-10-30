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

export function initialCbbSlateDate(snapshot: DailyEdgeResponse, requestedGameId: string | null, presentDate = snapshot.date): string {
  const requested = snapshot.games.find((game) => game.id === requestedGameId);
  const requestedDate = requested ? cbbGameSlateDate(requested) : null;
  if (requestedDate) return requestedDate;
  const days = cbbSlateDays(snapshot).filter((day) => day.date >= presentDate);
  return days.find((day) => day.date === presentDate)?.date
    ?? days.find((day) => day.analyzed > 0)?.date
    ?? days[0]?.date
    ?? presentDate;
}

export function cbbAnalyzedGameForExternalId(games: DailyEdgeGameDto[], externalId: number): DailyEdgeGameDto | undefined {
  return games.find((game) => game.external_id === externalId);
}

export function cbbChronologicalBoardEntries(analyzed: DailyEdgeGameDto[], scheduled: CbbRollingScheduleDto["games"]) {
  const analyzedIds = new Set(analyzed.map((game) => game.external_id));
  const entries: Array<{ kind: "analyzed"; game: DailyEdgeGameDto } | { kind: "pending"; game: CbbRollingScheduleDto["games"][number] }> = [
    ...analyzed.map((game) => ({ kind: "analyzed" as const, game })),
    ...scheduled.filter((game) => !analyzedIds.has(game.externalId)).map((game) => ({ kind: "pending" as const, game })),
  ];
  return entries.sort((a, b) => Date.parse(a.game.gameStartAt ?? "") - Date.parse(b.game.gameStartAt ?? ""));
}

export function cbbAnalyzedGamesForDate(games: DailyEdgeGameDto[], date: string): DailyEdgeGameDto[] {
  return games.filter((game) => cbbGameSlateDate(game) === date);
}

export function cbbScheduleForDate(schedule: CbbRollingScheduleDto | undefined, date: string): CbbRollingScheduleDto | undefined {
  return schedule ? { ...schedule, games: schedule.games.filter((game) => game.slateDate === date) } : undefined;
}
