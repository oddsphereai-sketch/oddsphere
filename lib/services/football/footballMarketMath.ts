import type {
  FootballMarketObservation,
  FootballSplitObservation,
} from "./footballModelContract";

export type PairedFootballPrice = {
  firstSide: string;
  secondSide: string;
  firstNoVigProbability: number;
  secondNoVigProbability: number;
  overround: number;
};

export type FootballMovementRead = {
  valid: boolean;
  reason: string | null;
  direction: "toward_home" | "toward_away" | "toward_over" | "toward_under" | "flat" | "unknown";
  lineDelta: number | null;
  impliedProbabilityDelta: number | null;
  crossedKeyNumbers: number[];
};

export type FootballPublicRead = {
  availability: "available" | "unavailable";
  publicSide: string | null;
  ticketsPct: number | null;
  moneyPct: number | null;
  moneyTicketGap: number | null;
  attribution: {
    provider: string;
    sourceKey: string;
    sourceType: FootballSplitObservation["sourceType"];
    sportsbook: string | null;
    booksUsed: number | null;
    observedAt: string;
  } | null;
};

export type ReverseLineMovementRead = {
  status: "candidate" | "not_detected" | "unavailable";
  reason: string;
};

export function americanToImpliedProbability(american: number): number {
  if (!Number.isFinite(american) || american === 0) {
    throw new Error(`Invalid American price: ${american}`);
  }
  return american > 0
    ? 100 / (american + 100)
    : Math.abs(american) / (Math.abs(american) + 100);
}

function samePairedMarket(first: FootballMarketObservation, second: FootballMarketObservation): boolean {
  const lineMatches = first.market === "spread"
    ? first.lineValue !== null && second.lineValue !== null && Math.abs(first.lineValue) === Math.abs(second.lineValue)
    : first.lineValue === second.lineValue;
  return first.provider === second.provider &&
    first.sourceKey === second.sourceKey &&
    first.sportsbook === second.sportsbook &&
    first.providerEventId === second.providerEventId &&
    first.market === second.market &&
    first.observedAt === second.observedAt &&
    first.side !== second.side &&
    lineMatches;
}

export function removeFootballVig(
  first: FootballMarketObservation,
  second: FootballMarketObservation,
): PairedFootballPrice {
  if (!samePairedMarket(first, second)) {
    throw new Error("Football prices must be a synchronized same-source, same-event, same-market pair.");
  }
  const firstRaw = americanToImpliedProbability(first.americanPrice);
  const secondRaw = americanToImpliedProbability(second.americanPrice);
  const total = firstRaw + secondRaw;
  return {
    firstSide: first.side,
    secondSide: second.side,
    firstNoVigProbability: firstRaw / total,
    secondNoVigProbability: secondRaw / total,
    overround: total - 1,
  };
}

function identityMatches(first: FootballMarketObservation, current: FootballMarketObservation): boolean {
  return first.provider === current.provider &&
    first.sourceKey === current.sourceKey &&
    first.sportsbook === current.sportsbook &&
    first.providerEventId === current.providerEventId &&
    first.market === current.market &&
    first.side === current.side;
}

function keysCrossed(from: number, to: number, keyNumbers: readonly number[]): number[] {
  const low = Math.min(Math.abs(from), Math.abs(to));
  const high = Math.max(Math.abs(from), Math.abs(to));
  return keyNumbers.filter((key) => key > low && key <= high);
}

/**
 * Compare one source series over time. Spread values are always interpreted
 * from the selected side's signed line; totals use the posted total.
 */
export function deriveFootballMovement(args: {
  first: FootballMarketObservation;
  current: FootballMarketObservation;
  keyNumbers: readonly number[];
}): FootballMovementRead {
  if (!identityMatches(args.first, args.current)) {
    return { valid: false, reason: "source_or_market_identity_mismatch", direction: "unknown", lineDelta: null, impliedProbabilityDelta: null, crossedKeyNumbers: [] };
  }
  if (Date.parse(args.current.observedAt) <= Date.parse(args.first.observedAt)) {
    return { valid: false, reason: "non_chronological_observations", direction: "unknown", lineDelta: null, impliedProbabilityDelta: null, crossedKeyNumbers: [] };
  }
  const impliedProbabilityDelta = americanToImpliedProbability(args.current.americanPrice) -
    americanToImpliedProbability(args.first.americanPrice);
  if (args.first.market === "moneyline") {
    const direction = Math.abs(impliedProbabilityDelta) < 1e-9
      ? "flat"
      : impliedProbabilityDelta > 0
        ? args.current.side === "home" ? "toward_home" : "toward_away"
        : args.current.side === "home" ? "toward_away" : "toward_home";
    return { valid: true, reason: null, direction, lineDelta: null, impliedProbabilityDelta, crossedKeyNumbers: [] };
  }
  if (args.first.lineValue === null || args.current.lineValue === null) {
    return { valid: false, reason: "missing_line_value", direction: "unknown", lineDelta: null, impliedProbabilityDelta: null, crossedKeyNumbers: [] };
  }
  const lineDelta = args.current.lineValue - args.first.lineValue;
  const direction = Math.abs(lineDelta) < 1e-9
    ? "flat"
    : args.first.market === "total"
      ? lineDelta > 0 ? "toward_over" : "toward_under"
      : args.current.side === "home"
        ? lineDelta < 0 ? "toward_home" : "toward_away"
        : lineDelta < 0 ? "toward_away" : "toward_home";
  return {
    valid: true,
    reason: null,
    direction,
    lineDelta,
    impliedProbabilityDelta,
    crossedKeyNumbers: args.first.market === "spread"
      ? keysCrossed(args.first.lineValue, args.current.lineValue, args.keyNumbers)
      : [],
  };
}

export function deriveFootballPublicRead(
  observations: FootballSplitObservation[],
  minimumHeavyTicketsPct: number,
): FootballPublicRead {
  if (!Number.isFinite(minimumHeavyTicketsPct) || minimumHeavyTicketsPct < 50 || minimumHeavyTicketsPct > 100) {
    throw new Error("minimumHeavyTicketsPct must be between 50 and 100.");
  }
  const scopes = new Set(observations.map((row) => [
    row.provider,
    row.sourceKey,
    row.sourceType,
    row.sportsbook,
    row.booksUsed,
    row.providerEventId,
    row.market,
  ].join("|")));
  if (scopes.size > 1) throw new Error("Football public reads must be resolved from one attributed provider/source/event/market scope at a time.");
  if (observations.some((row) => !Number.isFinite(Date.parse(row.observedAt)) || !Number.isFinite(Date.parse(row.fetchedAt)) || (row.sourceUpdatedAt !== null && !Number.isFinite(Date.parse(row.sourceUpdatedAt))))) {
    throw new Error("Football split observations require valid provenance timestamps.");
  }
  const validPercent = (value: number | null) => value !== null && Number.isFinite(value) && value >= 0 && value <= 100;
  const complete = observations.filter((row) => validPercent(row.ticketsPct));
  const buckets = new Map<string, FootballSplitObservation[]>();
  for (const row of complete) {
    const lineKey = row.market === "spread" && row.lineValue !== null
      ? String(Math.abs(row.lineValue))
      : String(row.lineValue);
    const key = [row.provider, row.sourceKey, row.sourceType, row.sportsbook, row.booksUsed, row.providerEventId, row.market, lineKey, row.sourceUpdatedAt, row.observedAt].join("|");
    buckets.set(key, [...(buckets.get(key) ?? []), row]);
  }
  const coherent = [...buckets.values()]
    .filter((rows) => {
      if (rows.length !== 2 || new Set(rows.map((row) => row.side)).size !== 2) return false;
      const expectedSides = rows[0].market === "total" ? ["over", "under"] : ["home", "away"];
      if (expectedSides.some((side) => !rows.some((row) => row.side === side))) return false;
      const tickets = rows.map((row) => row.ticketsPct);
      if (!tickets.every(validPercent) || Math.abs((tickets[0] ?? 0) + (tickets[1] ?? 0) - 100) > 1) return false;
      const money = rows.map((row) => row.moneyPct);
      const noMoney = money.every((value) => value === null);
      const coherentMoney = money.every(validPercent) && Math.abs((money[0] ?? 0) + (money[1] ?? 0) - 100) <= 1;
      return noMoney || coherentMoney;
    })
    .sort((a, b) => Date.parse(b[0].observedAt) - Date.parse(a[0].observedAt))[0];
  if (!coherent) {
    return { availability: "unavailable", publicSide: null, ticketsPct: null, moneyPct: null, moneyTicketGap: null, attribution: null };
  }
  const sorted = [...coherent].sort((a, b) => (b.ticketsPct ?? -1) - (a.ticketsPct ?? -1));
  const leader = sorted[0];
  if ((leader.ticketsPct ?? 0) < minimumHeavyTicketsPct) {
    return { availability: "available", publicSide: null, ticketsPct: leader.ticketsPct, moneyPct: leader.moneyPct, moneyTicketGap: leader.moneyPct === null ? null : leader.moneyPct - leader.ticketsPct!, attribution: splitAttribution(leader) };
  }
  return {
    availability: "available",
    publicSide: leader.side,
    ticketsPct: leader.ticketsPct,
    moneyPct: leader.moneyPct,
    moneyTicketGap: leader.moneyPct === null ? null : leader.moneyPct - leader.ticketsPct!,
    attribution: splitAttribution(leader),
  };
}

function splitAttribution(row: FootballSplitObservation): NonNullable<FootballPublicRead["attribution"]> {
  return {
    provider: row.provider,
    sourceKey: row.sourceKey,
    sourceType: row.sourceType,
    sportsbook: row.sportsbook,
    booksUsed: row.booksUsed,
    observedAt: row.observedAt,
  };
}

/**
 * A conservative candidate label, never a grade or betting decision. The
 * caller must supply a validated public threshold and a valid movement read.
 */
export function classifyReverseLineMovement(args: {
  publicRead: FootballPublicRead;
  movement: FootballMovementRead;
}): ReverseLineMovementRead {
  if (args.publicRead.availability === "unavailable" || args.publicRead.publicSide === null) {
    return { status: "unavailable", reason: "heavy_public_side_unavailable" };
  }
  if (!args.movement.valid || args.movement.direction === "unknown") {
    return { status: "unavailable", reason: args.movement.reason ?? "valid_movement_unavailable" };
  }
  const movedAgainstPublic =
    (args.publicRead.publicSide === "home" && args.movement.direction === "toward_away") ||
    (args.publicRead.publicSide === "away" && args.movement.direction === "toward_home") ||
    (args.publicRead.publicSide === "over" && args.movement.direction === "toward_under") ||
    (args.publicRead.publicSide === "under" && args.movement.direction === "toward_over");
  return movedAgainstPublic
    ? { status: "candidate", reason: "validated_movement_opposes_source_attributed_heavy_public_side" }
    : { status: "not_detected", reason: "movement_does_not_oppose_heavy_public_side" };
}
