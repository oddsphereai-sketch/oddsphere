import { computeSlateDate, currentSoccerBoardDate } from "@/lib/dates/slateDate";

export type EplRoundFixture = {
  date: string;
  round_number: number | null;
  status_state: string;
};

/**
 * Keep the round containing the current soccer board date selected even after
 * its final fixture completes. The member reader owns the 2 a.m. ET rollover;
 * provider completion must not advance the public board early.
 */
export function selectEplDefaultRound(
  matches: EplRoundFixture[],
  now: Date = new Date(),
): number {
  const boardDate = currentSoccerBoardDate(now);
  const boardDayRounds = matches
    .filter((match) => {
      if (match.round_number === null) return false;
      try {
        return computeSlateDate("soccer", match.date) === boardDate;
      } catch {
        return false;
      }
    })
    .map((match) => match.round_number as number);
  if (boardDayRounds.length > 0) return Math.min(...boardDayRounds);

  const futureRounds = matches
    .filter((match) => match.status_state !== "final" && match.round_number !== null)
    .map((match) => match.round_number as number);
  return futureRounds.length > 0
    ? Math.min(...futureRounds)
    : Math.max(1, ...matches.map((match) => match.round_number ?? 0));
}
