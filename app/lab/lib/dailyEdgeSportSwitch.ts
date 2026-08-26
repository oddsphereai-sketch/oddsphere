import type { Sport } from "@/lib/types/domain/Sport";

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
