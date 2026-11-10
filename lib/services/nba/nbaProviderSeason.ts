/** BALLDONTLIE keys the NBA season by its starting calendar year.
 * Keep the existing daily writer's UTC October boundary authoritative.
 */
export function currentNbaProviderSeason(now: Date): number {
  return now.getUTCMonth() >= 9 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}
