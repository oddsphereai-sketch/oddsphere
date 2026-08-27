import type { Sport } from "@/lib/types/domain/Sport";

export const DAILY_EDGE_SPORT_SWITCH_FALLBACK_MS = 10_000;

export function dailyEdgeSportDestinationIsCurrent(currentHref: string, destination: string): boolean {
  const current = new URL(currentHref, "http://localhost");
  const target = new URL(destination, current.origin);
  if (current.pathname !== target.pathname) return false;

  const normalize = (params: URLSearchParams) =>
    [...params.entries()]
      .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
        leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue))
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join("&");

  return normalize(current.searchParams) === normalize(target.searchParams);
}

export function buildDailyEdgeSportSwitchDestination({
  pathname,
  currentSearch,
  nextSport,
  explicitDestinations,
  slateDate,
}: {
  pathname: string;
  currentSearch: string;
  nextSport: Sport;
  explicitDestinations?: Partial<Record<Sport, string>>;
  slateDate: (sport: Sport) => string;
}): string {
  const explicitDestination = explicitDestinations?.[nextSport];
  if (explicitDestination) return explicitDestination;

  const params = new URLSearchParams(currentSearch);
  params.set("sport", nextSport);
  if (nextSport === "soccer") params.set("league", "epl");
  else params.delete("league");
  params.delete("game");
  params.delete("market");

  if (nextSport === "mlb" || nextSport === "wnba") {
    params.set("date", slateDate(nextSport));
    params.set("fresh", "1");
  } else {
    params.delete("date");
    params.delete("fresh");
  }

  return `${pathname}?${params.toString()}`;
}
