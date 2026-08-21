export type RequestedDailyEdgeMatchup = {
  id: string;
  awayTeam: string;
  homeTeam: string;
};

export function parseDailyEdgeAvailabilityMatchup(
  value: string,
): RequestedDailyEdgeMatchup | null {
  const [id, awayTeam, homeTeam, extra] = value.split("|");
  if (extra !== undefined || !id || !awayTeam || !homeTeam) return null;
  if (
    !/^[a-z0-9_-]+$/i.test(id) ||
    !/^[a-z0-9]{1,8}$/i.test(awayTeam) ||
    !/^[a-z0-9]{1,8}$/i.test(homeTeam)
  ) return null;
  return { id, awayTeam, homeTeam };
}
