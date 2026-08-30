import type { NcaafGame } from "./balldontlieNcaafSlate";

export const CFB_WEEKLY_WINDOW_RELEASE =
  "cfb_weekly_window_2026_08_30_r3_completed_slate_roll_forward" as const;

export type CfbWeeklyWindow = {
  release: typeof CFB_WEEKLY_WINDOW_RELEASE;
  easternWeekStartsOn: "tuesday";
  boardStartDate: string;
  boardEndDate: string;
  providerQueryStartDate: string;
  providerQueryEndDate: string;
};

/**
 * CFB's product week is the Thursday-through-Monday game window selected by
 * the preceding Tuesday in America/New_York. The provider query includes the
 * following UTC date so a Monday-night Eastern kickoff cannot be lost at UTC
 * midnight; eligibility is then rechecked against the Eastern board dates.
 */
export function activeCfbWeeklyWindow(now: string | Date): CfbWeeklyWindow {
  const instant = typeof now === "string" ? new Date(now) : new Date(now.getTime());
  if (!Number.isFinite(instant.getTime())) throw new Error("CFB weekly window requires a valid timestamp.");
  const easternDate = dateInTimeZone(instant, "America/New_York");
  const anchor = dateAtUtcNoon(easternDate);
  const daysSinceTuesday = (anchor.getUTCDay() - 2 + 7) % 7;
  const tuesday = addDays(anchor, -daysSinceTuesday);
  const thursday = addDays(tuesday, 2);
  const monday = addDays(tuesday, 6);
  return {
    release: CFB_WEEKLY_WINDOW_RELEASE,
    easternWeekStartsOn: "tuesday",
    boardStartDate: isoDate(thursday),
    boardEndDate: isoDate(monday),
    providerQueryStartDate: isoDate(thursday),
    providerQueryEndDate: isoDate(addDays(monday, 1)),
  };
}

export function nextCfbWeeklyWindow(window: CfbWeeklyWindow): CfbWeeklyWindow {
  const thursday = addDays(dateAtUtcNoon(window.boardStartDate), 7);
  const monday = addDays(dateAtUtcNoon(window.boardEndDate), 7);
  return {
    release: CFB_WEEKLY_WINDOW_RELEASE,
    easternWeekStartsOn: "tuesday",
    boardStartDate: isoDate(thursday),
    boardEndDate: isoDate(monday),
    providerQueryStartDate: isoDate(thursday),
    providerQueryEndDate: isoDate(addDays(monday, 1)),
  };
}

type CfbWeeklyEvidenceRow = {
  providerGameId: string;
  gameStartAt: string;
  payload: { slateGameCount: number };
};

/**
 * Keep the Tuesday-anchored window while any captured game can still play.
 * Once the authoritative opening wave is complete and every captured kickoff
 * has passed, expose the next Thursday-through-Monday window immediately.
 * Requiring complete evidence prevents a missing Monday game from being
 * mistaken for a finished slate.
 */
export function resolveCfbForwardWindow(args: {
  now: string | Date;
  evidence: CfbWeeklyEvidenceRow[];
  /** The sole writer may advance before rows for the next window exist. */
  advanceWithoutNextEvidence?: boolean;
}): CfbWeeklyWindow {
  const current = activeCfbWeeklyWindow(args.now);
  const nowMs = typeof args.now === "string" ? Date.parse(args.now) : args.now.getTime();
  if (!Number.isFinite(nowMs)) throw new Error("CFB forward window requires a valid timestamp.");
  const currentRows = args.evidence.filter((row) =>
    isGameInCfbWeeklyWindow({ scheduledStart: row.gameStartAt }, current)
  );
  if (currentRows.length === 0) return current;

  const expectedGames = Math.max(...currentRows.map((row) => row.payload.slateGameCount));
  const capturedGames = new Set(currentRows.map((row) => row.providerGameId)).size;
  const completeOpeningWave = Number.isInteger(expectedGames) && expectedGames > 0 && capturedGames >= expectedGames;
  const hasFutureKickoff = currentRows.some((row) => {
    const startsAt = Date.parse(row.gameStartAt);
    return !Number.isFinite(startsAt) || startsAt > nowMs;
  });
  const next = nextCfbWeeklyWindow(current);
  const nextEvidenceExists = args.evidence.some((row) =>
    isGameInCfbWeeklyWindow({ scheduledStart: row.gameStartAt }, next)
  );
  return completeOpeningWave && !hasFutureKickoff && (args.advanceWithoutNextEvidence === true || nextEvidenceExists)
    ? next
    : current;
}

export function isGameInCfbWeeklyWindow(game: Pick<NcaafGame, "scheduledStart">, window: CfbWeeklyWindow): boolean {
  const easternDate = dateInTimeZone(new Date(game.scheduledStart), "America/New_York");
  return easternDate >= window.boardStartDate && easternDate <= window.boardEndDate;
}

export function eligibleCfbWeeklyGames(games: NcaafGame[], window: CfbWeeklyWindow): NcaafGame[] {
  const output = games.filter((game) => isGameInCfbWeeklyWindow(game, window));
  const ids = new Set(output.map((game) => game.providerGameId));
  if (ids.size !== output.length) throw new Error("CFB weekly slate contains duplicate provider game IDs.");
  return output.sort((first, second) => Date.parse(first.scheduledStart) - Date.parse(second.scheduledStart) || first.providerGameId.localeCompare(second.providerGameId));
}

function dateInTimeZone(value: Date, timeZone: string): string {
  if (!Number.isFinite(value.getTime())) throw new Error("CFB game start must be a valid timestamp.");
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) throw new Error("CFB weekly window could not resolve an Eastern date.");
  return `${year}-${month}-${day}`;
}

function dateAtUtcNoon(value: string): Date {
  return new Date(`${value}T12:00:00.000Z`);
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 86_400_000);
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
