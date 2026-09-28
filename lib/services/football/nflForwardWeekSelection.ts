import { addDaysToSlate, computeSlateDate } from "@/lib/dates/slateDate";

export const NFL_FORWARD_WEEK_SELECTION_RELEASE =
  "nfl_forward_week_selection_2026_09_28_r2_completed_slate_rollover" as const;

export const NFL_FORWARD_BOARD_ROLLOVER_HOUR_ET = 2 as const;

const NFL_REGULAR_WEEK_ONE_BOARD_START_ET: Readonly<Record<number, string>> = {
  2026: "2026-09-08",
};

/**
 * Resolve the NFL board week from the Eastern football calendar while keeping
 * the configured week as an operator-controlled floor. The current production
 * season is explicitly anchored; an unknown future season fails closed to the
 * configured value until its opening week is declared.
 */
export function resolveNflForwardWeek(input: {
  season: number;
  configuredWeek: number;
  now?: Date;
}): number {
  if (!Number.isInteger(input.season) || input.season < 2026 || input.season > 2100) {
    throw new Error("NFL forward season must be an integer from 2026 through 2100.");
  }
  if (!Number.isInteger(input.configuredWeek) || input.configuredWeek < 1 || input.configuredWeek > 18) {
    throw new Error("NFL configured forward week must be an integer from 1 through 18.");
  }
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("NFL forward week selection requires a valid timestamp.");

  const weekOneBoardStart = NFL_REGULAR_WEEK_ONE_BOARD_START_ET[input.season];
  if (!weekOneBoardStart) return input.configuredWeek;
  const currentEtDate = computeSlateDate("nfl", now);
  const elapsedDays = calendarDayNumber(currentEtDate) - calendarDayNumber(weekOneBoardStart);
  if (elapsedDays < 0) return input.configuredWeek;

  const calendarWeek = Math.min(18, Math.floor(elapsedDays / 7) + 1);
  return Math.max(input.configuredWeek, calendarWeek);
}

/**
 * Advance an already-published, completed Sunday-only slate without hiding a
 * live Monday game. Missing or malformed schedule evidence fails closed to the
 * calendar week.
 */
export function resolveNflOperationalWeek(input: {
  season: number;
  configuredWeek: number;
  scheduledStarts: string[];
  now?: Date;
}): number {
  const now = input.now ?? new Date();
  const calendarWeek = resolveNflForwardWeek({
    season: input.season,
    configuredWeek: input.configuredWeek,
    now,
  });
  if (calendarWeek >= 18 || input.scheduledStarts.length === 0) return calendarWeek;
  const boardDate = currentNflBoardDate(now);
  let latestSlateDate: string | null = null;
  for (const scheduledStart of input.scheduledStarts) {
    try {
      const slateDate = computeSlateDate("nfl", scheduledStart);
      if (latestSlateDate === null || slateDate > latestSlateDate) latestSlateDate = slateDate;
    } catch {
      return calendarWeek;
    }
  }
  return latestSlateDate !== null && latestSlateDate < boardDate ? calendarWeek + 1 : calendarWeek;
}

function currentNflBoardDate(now: Date): string {
  const hourEt = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(now));
  const todayEt = computeSlateDate("nfl", now);
  return hourEt < NFL_FORWARD_BOARD_ROLLOVER_HOUR_ET ? addDaysToSlate(todayEt, -1) : todayEt;
}

function calendarDayNumber(value: string): number {
  return Math.floor(Date.parse(`${value}T12:00:00.000Z`) / 86_400_000);
}
