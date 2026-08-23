import type { MarketEdgeDto, OddsTrailStopDto } from "./labTypes";

export type PointLineMarketPulseMovement = {
  open: number;
  previous: number | null;
  current: number;
  openLine: number;
  previousLine: number | null;
  currentLine: number;
  sportsbook: string;
  coherentTrail: true;
  openingLabel: "Opening";
};

function sameTrackedLine(first: number | null, current: number | null): boolean {
  if (first === null || current === null) return first === current;
  return Math.abs(first - current) < 0.001;
}

/**
 * Resolve the dedicated same-book point-line trail used by Total/Spread
 * Market Pulse. The exact-price trail remains separate display context; it
 * must not erase a verified move in the selected number (+3.5 to +4.5).
 *
 * The canonical market read and visible endpoints must agree exactly.
 * Otherwise this fails closed and the reader falls back to price movement.
 */
export function resolvePointLineMarketPulseMovement(
  market: MarketEdgeDto,
): PointLineMarketPulseMovement | null {
  const canonical = market.marketReadV2?.movement;
  if (
    !canonical ||
    (canonical.directionRelativeToPick !== "support" &&
      canonical.directionRelativeToPick !== "resistance")
  ) {
    return null;
  }

  const groups = new Map<string, OddsTrailStopDto[]>();
  for (const stop of market.lineTrail ?? []) {
    if (
      !stop.sportsbook ||
      !Number.isFinite(stop.american) ||
      stop.line === null ||
      !Number.isFinite(stop.line)
    ) {
      continue;
    }
    const group = groups.get(stop.sportsbook) ?? [];
    group.push(stop);
    groups.set(stop.sportsbook, group);
  }

  const coherent = Array.from(groups.values())
    .filter(
      (group) =>
        group.length >= 2 &&
        (group.at(-1)?.label === "current" || group.at(-1)?.label === "locked"),
    )
    .sort((a, b) => b.length - a.length)[0];
  if (!coherent) return null;

  const first = coherent[0]!;
  const terminal = coherent[coherent.length - 1]!;
  if (
    first.line === null ||
    terminal.line === null ||
    sameTrackedLine(first.line, terminal.line) ||
    !sameTrackedLine(canonical.firstTrackedLine, first.line) ||
    !sameTrackedLine(canonical.currentLine, terminal.line) ||
    canonical.firstTrackedPrice !== first.american ||
    canonical.currentPrice !== terminal.american
  ) {
    return null;
  }

  let previous: OddsTrailStopDto | null = null;
  for (let index = coherent.length - 2; index > 0; index -= 1) {
    const candidate = coherent[index]!;
    if (
      candidate.american !== terminal.american ||
      !sameTrackedLine(candidate.line, terminal.line)
    ) {
      previous = candidate;
      break;
    }
  }
  if (previous === null && coherent.length >= 2) {
    previous = coherent[coherent.length - 2]!;
  }

  return {
    open: first.american,
    previous: previous?.american ?? null,
    current: terminal.american,
    openLine: first.line,
    previousLine: previous?.line ?? null,
    currentLine: terminal.line,
    sportsbook: terminal.sportsbook!,
    coherentTrail: true,
    openingLabel: "Opening",
  };
}
