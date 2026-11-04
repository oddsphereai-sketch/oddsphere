/** Settlement/tracking identity only: never used to change a model input or pick.
 * A conventional trailing suffix may differ between quote and roster feeds.
 * Callers must still require one unique ID in the exact game and team. */
export function nflPlayerPropsSettlementNameKey(value: string): string {
  return value.trim().replace(/\s+(?:jr\.?|sr\.?|ii|iii|iv)$/i, "")
    .toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function nflPlayerPropsSettlementTeamKey(value: string): string {
  const team = value.trim().toUpperCase();
  return ({ LAR: "LA", WSH: "WAS", OAK: "LV", SD: "LAC", STL: "LA" } as Record<string, string>)[team] ?? team;
}
