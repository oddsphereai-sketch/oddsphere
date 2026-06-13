/**
 * Sportsbooks we refuse to use as a price/line source anywhere in the pipeline.
 *
 * 2026-06-13 (Daniel: "Don't use fliff anymore"): fliff repeatedly ships
 * corrupted / team-flipped lines (e.g. tonight's Spurs −205 favorite quoted at
 * +385, and the WC home/away swaps), poisoning consensus, openers, and
 * line-move. Names are matched case-insensitively. Filter at every point lines
 * are CONSUMED (consensus, current price, opener/line-move) so blocked rows in
 * the DB are ignored even if a writer already persisted them.
 */
export const BLOCKED_SPORTSBOOKS: ReadonlySet<string> = new Set(["fliff"]);

export function isBlockedSportsbook(name: string | null | undefined): boolean {
  if (name === null || name === undefined) return false;
  return BLOCKED_SPORTSBOOKS.has(name.trim().toLowerCase());
}
