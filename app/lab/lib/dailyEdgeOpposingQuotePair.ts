/** Opposing handicaps have opposite signs; totals share a threshold. This
 * compares displayed source tuples only and has no grading authority. */
export function dailyEdgeOpposingQuotePairMatches(args: {
  selectedLine: number | null; opposingLine: number | null;
  selectedBook: string | null; opposingBook: string | null;
  opposingSide: string | null;
}): boolean {
  if (!args.selectedBook || !args.opposingBook ||
    args.selectedBook.trim().toLowerCase() !== args.opposingBook.trim().toLowerCase()) return false;
  if (args.selectedLine === null || args.opposingLine === null) return args.selectedLine === args.opposingLine;
  if (!Number.isFinite(args.selectedLine) || !Number.isFinite(args.opposingLine)) return false;
  return Math.abs(args.selectedLine - (
    args.opposingSide === "home" || args.opposingSide === "away" ? -args.opposingLine : args.opposingLine
  )) < 0.001;
}
