import type { OddsTrailStopDto } from "./labTypes";

export type DailyEdgeCurrentOnlyMovement = {
  open: number | null;
  current: number | null;
  openLine: number | null;
  currentLine: number | null;
  sportsbook: string | null;
};

/**
 * Resolve a non-coherent/current-only movement row without mixing tuple fields.
 *
 * Writer-time market interpretation may describe a different evaluated book or
 * point line. The reader's current quote must instead remain the exact stored
 * (sportsbook, side, line, price) terminal observation. Opening stays null
 * until the same displayed book has a persisted first observation.
 */
export function resolveDailyEdgeCurrentOnlyMovement(args: {
  trail: OddsTrailStopDto[];
  displayedPrice: number | null;
  displayedBook: string | null;
  fallbackLine: number | null;
}): DailyEdgeCurrentOnlyMovement {
  const currentObserved = [...args.trail].reverse().find((stop) =>
    (stop.label === "current" || stop.label === "locked") &&
    (args.displayedBook === null || stop.sportsbook === args.displayedBook) &&
    (args.displayedPrice === null || stop.american === args.displayedPrice)
  ) ?? [...args.trail].reverse().find((stop) => stop.label === "current" || stop.label === "locked") ?? null;
  const terminalBook = currentObserved?.sportsbook ?? args.displayedBook;
  const firstObserved = args.trail.find((stop) =>
    (stop.label === "first" || stop.label === "open") &&
    (terminalBook === null || stop.sportsbook === terminalBook)
  ) ?? null;

  return {
    open: firstObserved?.american ?? null,
    current: currentObserved?.american ?? args.displayedPrice,
    openLine: firstObserved?.line ?? null,
    currentLine: currentObserved?.line ?? args.fallbackLine,
    sportsbook: terminalBook,
  };
}
