/**
 * Select the MAIN consensus total line for a game — the modal line by distinct-
 * book count, NOT the highest-priority single book and NOT a median across an
 * alt-line ladder. Sport-agnostic (MLB/NBA/NHL totals).
 *
 * 2026-06-23 (Daniel: HOU@TOR showed a heavily-juiced "−167" total on a 9.5/10
 * line while five books agreed at 8.5): the old MLB picker took the first
 * BOOK_PRIORITY book's line, so a single book diverging 1–1.5 runs (often via an
 * asymmetric over/under split with heavy juice) overrode the multi-book
 * consensus. Now: drop blocked/corrupted books (fliff/kalshi), then pick the line
 * value the MOST distinct books quote; tie-break to the modal value nearest the
 * median (so a fringe alt line can't win a tie). Mirrors selectMainNhlTotalLine.
 */
import { isBlockedSportsbook } from "@/lib/config/blockedSportsbooks";

export function selectMainTotalLine(
  lines: ReadonlyArray<{ sportsbook?: string | null; line_value?: number | null }>,
): number | null {
  const clean = lines.filter((l) => l.line_value != null && !isBlockedSportsbook(l.sportsbook));
  if (clean.length === 0) return null;
  // A book quoting both over+under at one line counts once for that line.
  const booksByLine = new Map<number, Set<string>>();
  for (const l of clean) {
    const v = l.line_value as number;
    if (!booksByLine.has(v)) booksByLine.set(v, new Set());
    booksByLine.get(v)!.add(String(l.sportsbook));
  }
  const distinct = [...booksByLine.keys()].sort((a, b) => a - b);
  const maxBooks = Math.max(...[...booksByLine.values()].map((s) => s.size));
  const modes = distinct.filter((v) => booksByLine.get(v)!.size === maxBooks);
  if (modes.length === 1) return modes[0]!;
  const median = distinct[Math.floor(distinct.length / 2)]!;
  return modes.reduce(
    (best, v) => (Math.abs(v - median) < Math.abs(best - median) ? v : best),
    modes[0]!,
  );
}
