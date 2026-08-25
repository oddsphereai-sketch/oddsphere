import type { DailyEdgeGameDto, DailyEdgeResponse } from "@/app/lab/lib/labTypes";
import { computeSlateDate, currentSoccerBoardDate } from "@/lib/dates/slateDate";

export const DAILY_EDGE_WEEKLY_READER_LIFECYCLE_RELEASE =
  "daily_edge_weekly_reader_lifecycle_2026_08_24_r2" as const;

export type WeeklyReaderSport = "nfl" | "soccer";

function currentWeeklyReaderDate(sport: WeeklyReaderSport, now: Date): string {
  return sport === "soccer"
    ? currentSoccerBoardDate(now)
    : computeSlateDate(sport, now);
}

/**
 * Weekly model snapshots retain every game for lock, audit, and settlement
 * integrity. The member board is a narrower read: once the board rolls into a
 * new Eastern date, games scheduled on an earlier date no longer compete with
 * the remaining slate.
 *
 * Unknown or malformed legacy kickoff timestamps fail open. Hiding a game
 * without a trustworthy scheduled date would be less honest than retaining it.
 */
export function weeklyReaderGameIsVisible(
  game: Pick<DailyEdgeGameDto, "gameStartAt">,
  sport: WeeklyReaderSport,
  now: Date = new Date(),
): boolean {
  if (!game.gameStartAt) return true;

  try {
    return computeSlateDate(sport, game.gameStartAt) >= currentWeeklyReaderDate(sport, now);
  } catch {
    return true;
  }
}

export function filterWeeklyReaderSnapshot(
  snapshot: DailyEdgeResponse,
  sport: WeeklyReaderSport,
  now: Date = new Date(),
): DailyEdgeResponse {
  const games = snapshot.games.filter((game) => weeklyReaderGameIsVisible(game, sport, now));
  return games.length === snapshot.games.length ? snapshot : { ...snapshot, games };
}
