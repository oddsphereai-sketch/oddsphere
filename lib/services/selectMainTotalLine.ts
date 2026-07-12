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

export const MAIN_TOTAL_LINE_FRESHNESS_WINDOW_MS = 45 * 60 * 1000;

type TotalLineCandidate = {
  sportsbook?: string | null;
  line_value?: number | null;
  side?: string | null;
  fetched_at?: string | null;
};

function parsedTimeMs(v: string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/**
 * Keep only the freshest observed line cluster when competing total lines are
 * separated by enough time to represent a stale market. This still lets a fully
 * stale slate resolve from its best available rows, but prevents yesterday's
 * MIL/PIT shape: an older two-book 11.5 cluster beating a fresher 8.5/9.5 main
 * market because the stale cluster happened to have more distinct books.
 */
export function filterToFreshestTotalLineCluster<T extends { line_value?: number | null; fetched_at?: string | null }>(
  lines: ReadonlyArray<T>,
  freshnessWindowMs: number = MAIN_TOTAL_LINE_FRESHNESS_WINDOW_MS,
): T[] {
  const latestByLine = new Map<number, number>();
  for (const line of lines) {
    if (line.line_value === null || line.line_value === undefined) continue;
    const t = parsedTimeMs(line.fetched_at);
    if (t === null) continue;
    const prev = latestByLine.get(line.line_value);
    if (prev === undefined || t > prev) latestByLine.set(line.line_value, t);
  }
  if (latestByLine.size === 0) return [...lines];

  const freshest = Math.max(...latestByLine.values());
  const cutoff = freshest - freshnessWindowMs;
  const freshLineValues = new Set(
    [...latestByLine.entries()]
      .filter(([, t]) => t >= cutoff)
      .map(([line]) => line),
  );
  if (freshLineValues.size === 0) return [...lines];

  const filtered = lines.filter(
    (line) => line.line_value !== null && line.line_value !== undefined && freshLineValues.has(line.line_value),
  );
  return filtered.length > 0 ? filtered : [...lines];
}

export function selectMainTotalLine(
  lines: ReadonlyArray<TotalLineCandidate>,
): number | null {
  const clean = lines.filter((l) => l.line_value != null && !isBlockedSportsbook(l.sportsbook));
  if (clean.length === 0) return null;

  const hasSideData = clean.some((l) => l.side === "over" || l.side === "under");
  const eligible = hasSideData
    ? clean.filter((candidate) => {
        const book = candidate.sportsbook ?? null;
        const line = candidate.line_value;
        if (book === null || line === null || line === undefined) return false;
        return (
          clean.some((row) => row.sportsbook === book && row.line_value === line && row.side === "over") &&
          clean.some((row) => row.sportsbook === book && row.line_value === line && row.side === "under")
        );
      })
    : clean;
  if (eligible.length === 0) return null;
  const freshEligible = filterToFreshestTotalLineCluster(eligible);
  if (freshEligible.length === 0) return null;

  // A book quoting both over+under at one line counts once for that line.
  const booksByLine = new Map<number, Set<string>>();
  for (const l of freshEligible) {
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
