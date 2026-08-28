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

export type FirstInningMarketPulseMovement = {
  open: number;
  previous: number | null;
  current: number;
  openLine: number | null;
  previousLine: number | null;
  currentLine: number | null;
  sportsbook: string;
  coherentTrail: true;
  openingLabel: "Opening";
};

function firstInningSportsbook(source: string | null): string | null {
  if (!source) return null;
  const normalized = source.replace(/^fi_market_ok_/i, "").trim();
  if (!normalized || normalized === "lines" || normalized === "unavailable") {
    return null;
  }
  return normalized;
}

/**
 * Resolve MLB first-inning Market Pulse from the exact two-sided board shown
 * immediately below the pulse. The generic picked-side odds trail can belong
 * to the evaluated sportsbook while the FI board belongs to a different
 * current same-book pair. Using the generic trail for the headline makes a
 * visible NRFI move such as -135 to -150 appear beneath a resistance label
 * derived from another book.
 *
 * Fail closed unless the displayed board has a named sportsbook and complete
 * selected-side opening/current endpoints. The route guarantees that an FI
 * opening is retained only when it belongs to this same sportsbook.
 */
export function resolveFirstInningMarketPulseMovement(
  market: MarketEdgeDto,
): FirstInningMarketPulseMovement | null {
  const board = market.fiMarketBoard ?? null;
  const pick = (market.pick ?? "").trim().toUpperCase();
  const sportsbook = firstInningSportsbook(board?.source ?? null);
  if (!board || !sportsbook || (pick !== "NRFI" && pick !== "YRFI")) {
    return null;
  }

  const nrfi = pick === "NRFI";
  const open = nrfi ? board.nrfiOpenAmerican ?? null : board.yrfiOpenAmerican ?? null;
  const previous = nrfi
    ? board.nrfiPreviousAmerican ?? null
    : board.yrfiPreviousAmerican ?? null;
  const current = nrfi ? board.nrfiAmerican : board.yrfiAmerican;
  if (
    open === null ||
    current === null ||
    !Number.isFinite(open) ||
    !Number.isFinite(current)
  ) {
    return null;
  }

  return {
    open,
    previous:
      previous !== null && Number.isFinite(previous) ? previous : null,
    current,
    openLine: board.line,
    previousLine: board.line,
    currentLine: board.line,
    sportsbook,
    coherentTrail: true,
    openingLabel: "Opening",
  };
}

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
