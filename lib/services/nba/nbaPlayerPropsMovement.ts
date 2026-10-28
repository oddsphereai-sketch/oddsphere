import type { NbaPlayerPropPriceObservation } from "./nbaPlayerPropsContract";
import type { NbaPlayerPropsMemberDecision } from "./nbaPlayerPropsProductContract";

type Movement = NbaPlayerPropsMemberDecision["movement"];

export function selectNbaPlayerPropsMovementTarget(args: {
  observations: readonly NbaPlayerPropPriceObservation[];
  sportsbook: string;
  side: "over" | "under";
  line: number;
  americanPrice: number;
}): NbaPlayerPropPriceObservation | null {
  return freshest(args.observations.filter((row) =>
    normalize(row.sportsbook) === normalize(args.sportsbook)
    && row.side === args.side
    && row.line === args.line
    && row.americanPrice === args.americanPrice
    && !row.isLive));
}

/**
 * Builds one honest same-provider, same-sportsbook trail ending at the exact
 * quote used by the member decision. Providers such as Owls expose alternate
 * ladders in the same market; a different ladder may participate only when it
 * is the sole complete two-sided line at that observation time.
 */
export function buildNbaPlayerPropsSameBookMovement(args: {
  observations: readonly NbaPlayerPropPriceObservation[];
  target: NbaPlayerPropPriceObservation;
}): Movement {
  const target = args.target;
  const targetObservedAt = Date.parse(target.observedAt);
  if (!Number.isFinite(targetObservedAt) || target.isLive || (target.side !== "over" && target.side !== "under")) {
    return null;
  }

  const scope = args.observations.filter((row) =>
    row.provider === target.provider
    && row.providerEventId === target.providerEventId
    && row.canonicalGameId === target.canonicalGameId
    && playerIdentity(row) === playerIdentity(target)
    && normalize(row.sportsbook) === normalize(target.sportsbook)
    && row.market === target.market
    && row.providerMarket === target.providerMarket
    && row.offerType === target.offerType
    && !row.isLive
    && Date.parse(row.observedAt) <= targetObservedAt);

  const timestamps = [...new Set(scope.map((row) => row.observedAt))]
    .sort((left, right) => Date.parse(left) - Date.parse(right));
  const states: NbaPlayerPropPriceObservation[] = [];
  for (const observedAt of timestamps) {
    const atTimestamp = scope.filter((row) => row.observedAt === observedAt);
    const sameSide = atTimestamp.filter((row) => row.side === target.side);
    const exact = freshest(sameSide.filter((row) => row.line === target.line));
    if (exact) {
      states.push(exact);
      continue;
    }
    const completeLines = completeTwoSidedLines(atTimestamp);
    if (completeLines.length !== 1) continue;
    const onlyLine = completeLines[0]!;
    const unambiguous = freshest(sameSide.filter((row) => row.line === onlyLine));
    if (unambiguous) states.push(unambiguous);
  }

  // The member quote is the non-negotiable endpoint even if the provider
  // returned the opposing side a few milliseconds later in the same cycle.
  const beforeTarget = states.filter((row) => Date.parse(row.observedAt) < targetObservedAt);
  const trail = distinctEconomicStates([...beforeTarget, target]);
  if (trail.length === 0) return null;
  const officialOpening = earliest(scope
    .filter((row) => row.isOpening && row.side === target.side && row.line === target.line));
  const opening = officialOpening ?? trail[0]!;
  const current = target;
  const prior = [...trail]
    .reverse()
    .find((row) => row.observedAt !== current.observedAt
      && (row.line !== current.line || row.americanPrice !== current.americanPrice)) ?? null;

  return {
    sportsbook: target.sportsbook,
    openingLine: opening.line,
    priorLine: prior?.line ?? null,
    currentLine: current.line,
    openingPrice: opening.americanPrice,
    priorPrice: prior?.americanPrice ?? null,
    currentPrice: current.americanPrice,
  };
}

function completeTwoSidedLines(rows: readonly NbaPlayerPropPriceObservation[]): number[] {
  const sidesByLine = new Map<number, Set<string>>();
  for (const row of rows) {
    if (row.side !== "over" && row.side !== "under") continue;
    sidesByLine.set(row.line, new Set([...(sidesByLine.get(row.line) ?? []), row.side]));
  }
  return [...sidesByLine.entries()]
    .filter(([, sides]) => sides.has("over") && sides.has("under"))
    .map(([line]) => line)
    .sort((left, right) => left - right);
}

function distinctEconomicStates(
  rows: readonly NbaPlayerPropPriceObservation[],
): NbaPlayerPropPriceObservation[] {
  const output: NbaPlayerPropPriceObservation[] = [];
  for (const row of [...rows].sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt))) {
    const prior = output.at(-1);
    if (prior && prior.line === row.line && prior.americanPrice === row.americanPrice) {
      output[output.length - 1] = row;
    } else {
      output.push(row);
    }
  }
  return output;
}

function freshest<T extends { observedAt: string }>(rows: readonly T[]): T | null {
  return [...rows].sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt))[0] ?? null;
}

function earliest<T extends { observedAt: string }>(rows: readonly T[]): T | null {
  return [...rows].sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt))[0] ?? null;
}

function playerIdentity(row: NbaPlayerPropPriceObservation): string {
  return row.canonicalPlayerId
    ?? (row.providerPlayerId ? `${row.provider}:${row.providerPlayerId}` : normalize(row.playerName ?? ""));
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}
