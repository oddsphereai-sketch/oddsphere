/** Pure NHL game-id helpers. NHL IDs encode YYYY + game type + sequence. */
export function nhlSeasonStartYearFromExternalId(externalId: number): number {
  return Math.trunc(externalId / 1_000_000);
}

/** 01 preseason, 02 regular season, 03 playoffs. */
export function nhlGameTypeFromExternalId(externalId: number): 1 | 2 | 3 | null {
  const type = Math.trunc(externalId / 10_000) % 100;
  return type === 1 || type === 2 || type === 3 ? type : null;
}
