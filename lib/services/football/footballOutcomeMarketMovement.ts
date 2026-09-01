export const FOOTBALL_OUTCOME_MOVEMENT_MAX_SHIFT_POINTS = 0.75 as const;
export const FOOTBALL_OUTCOME_MOVEMENT_CURRENT_ANCHOR_COMPLEMENT_WEIGHT = 0.25 as const;
export const FOOTBALL_OUTCOME_MOVEMENT_PRICE_PP_PER_POINT = 4 as const;

type FootballBookQuote = {
  sportsbook: string;
  observedAt: string;
  marketObservedAt?: Partial<Record<"moneyline" | "spread" | "total", string>>;
  moneyline: { awayPrice: number; homePrice: number } | null;
  spread: { awayLine: number; awayPrice: number; homeLine: number; homePrice: number } | null;
  total: { line: number; overPrice: number; underPrice: number } | null;
};

export type FootballOutcomeMarketMovement = {
  status: "available" | "unavailable";
  sportsbook: string | null;
  openingObservedAt: string | null;
  currentObservedAt: string | null;
  homeMarginLineDelta: number | null;
  homeMarginFairProbabilityDeltaPp: number | null;
  totalLineDelta: number | null;
  overFairProbabilityDeltaPp: number | null;
  homeMarginShiftPoints: number;
  totalShiftPoints: number;
};

/**
 * Converts a strictly same-book opening-to-current trail into a small PMF
 * adjustment. The current line already owns the market anchor, so movement
 * may influence only the complementary 25% of the forecast rather than being
 * counted as a second full market observation.
 */
export function readFootballOutcomeMarketMovement(args: {
  opening: FootballBookQuote | null;
  current: FootballBookQuote | null;
  evaluatedAt: string;
}): FootballOutcomeMarketMovement {
  const unavailable = (): FootballOutcomeMarketMovement => ({
    status: "unavailable",
    sportsbook: null,
    openingObservedAt: null,
    currentObservedAt: null,
    homeMarginLineDelta: null,
    homeMarginFairProbabilityDeltaPp: null,
    totalLineDelta: null,
    overFairProbabilityDeltaPp: null,
    homeMarginShiftPoints: 0,
    totalShiftPoints: 0,
  });
  if (!args.opening || !args.current || normalizeBook(args.opening.sportsbook) !== normalizeBook(args.current.sportsbook)) {
    return unavailable();
  }
  const evaluatedMs = Date.parse(args.evaluatedAt);
  if (!Number.isFinite(evaluatedMs)) throw new Error("Football outcome movement evaluatedAt is invalid.");

  const moneylineTiming = validMarketTiming(args.opening, args.current, "moneyline", evaluatedMs);
  const spreadTiming = validMarketTiming(args.opening, args.current, "spread", evaluatedMs);
  const totalTiming = validMarketTiming(args.opening, args.current, "total", evaluatedMs);

  const moneylineHomeFairDeltaPp = moneylineTiming && args.opening.moneyline && args.current.moneyline
    ? 100 * (twoSidedFair(args.current.moneyline.homePrice, args.current.moneyline.awayPrice) -
      twoSidedFair(args.opening.moneyline.homePrice, args.opening.moneyline.awayPrice))
    : null;
  const spreadHomeFairDeltaPp = spreadTiming && args.opening.spread && args.current.spread
    ? 100 * (twoSidedFair(args.current.spread.homePrice, args.current.spread.awayPrice) -
      twoSidedFair(args.opening.spread.homePrice, args.opening.spread.awayPrice))
    : null;
  const homeMarginLineDelta = spreadTiming && args.opening.spread && args.current.spread
    ? args.opening.spread.homeLine - args.current.spread.homeLine
    : null;
  const homeMarginFairProbabilityDeltaPp = meanFinite([moneylineHomeFairDeltaPp, spreadHomeFairDeltaPp]);
  const totalLineDelta = totalTiming && args.opening.total && args.current.total
    ? args.current.total.line - args.opening.total.line
    : null;
  const overFairProbabilityDeltaPp = totalTiming && args.opening.total && args.current.total
    ? 100 * (twoSidedFair(args.current.total.overPrice, args.current.total.underPrice) -
      twoSidedFair(args.opening.total.overPrice, args.opening.total.underPrice))
    : null;
  const homeMarginShiftPoints = movementShift([
    homeMarginLineDelta === null ? null : FOOTBALL_OUTCOME_MOVEMENT_CURRENT_ANCHOR_COMPLEMENT_WEIGHT * homeMarginLineDelta,
    probabilityMovementShift(homeMarginFairProbabilityDeltaPp),
  ]);
  const totalShiftPoints = movementShift([
    totalLineDelta === null ? null : FOOTBALL_OUTCOME_MOVEMENT_CURRENT_ANCHOR_COMPLEMENT_WEIGHT * totalLineDelta,
    probabilityMovementShift(overFairProbabilityDeltaPp),
  ]);
  const openingObservedAt = earliestValidTimestamp(args.opening, ["moneyline", "spread", "total"]);
  const currentObservedAt = latestValidTimestamp(args.current, ["moneyline", "spread", "total"]);
  return {
    status: moneylineTiming || spreadTiming || totalTiming ? "available" : "unavailable",
    sportsbook: moneylineTiming || spreadTiming || totalTiming ? args.current.sportsbook : null,
    openingObservedAt,
    currentObservedAt,
    homeMarginLineDelta,
    homeMarginFairProbabilityDeltaPp,
    totalLineDelta,
    overFairProbabilityDeltaPp,
    homeMarginShiftPoints,
    totalShiftPoints,
  };
}

/** Circa remains the primary directional authority; secondary evidence can
 * strengthen, weaken, or neutralize it, but can never reverse it. */
export function combineFootballOutcomeEvidenceShift(args: {
  sharpShift: number;
  movementShift: number;
  publicShift: number;
  maximum: number;
  secondaryWeightWithSharp?: number;
}): number {
  const secondaryWeight = args.secondaryWeightWithSharp ?? 0.5;
  const raw = args.sharpShift === 0
    ? args.movementShift + args.publicShift
    : args.sharpShift + secondaryWeight * (args.movementShift + args.publicShift);
  if (args.sharpShift !== 0 && raw !== 0 && Math.sign(raw) !== Math.sign(args.sharpShift)) return 0;
  return Math.max(-args.maximum, Math.min(args.maximum, raw));
}

function validMarketTiming(
  opening: FootballBookQuote,
  current: FootballBookQuote,
  market: "moneyline" | "spread" | "total",
  evaluatedMs: number,
): boolean {
  if (!opening[market] || !current[market]) return false;
  const openingMs = Date.parse(opening.marketObservedAt?.[market] ?? opening.observedAt);
  const currentMs = Date.parse(current.marketObservedAt?.[market] ?? current.observedAt);
  return Number.isFinite(openingMs) && Number.isFinite(currentMs) &&
    openingMs <= currentMs && currentMs <= evaluatedMs;
}

function probabilityMovementShift(deltaPp: number | null): number | null {
  if (deltaPp === null) return null;
  return FOOTBALL_OUTCOME_MOVEMENT_CURRENT_ANCHOR_COMPLEMENT_WEIGHT *
    deltaPp / FOOTBALL_OUTCOME_MOVEMENT_PRICE_PP_PER_POINT;
}

function movementShift(values: Array<number | null>): number {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (finite.length === 0) return 0;
  const value = finite.reduce((sum, entry) => sum + entry, 0) / finite.length;
  return Math.max(-FOOTBALL_OUTCOME_MOVEMENT_MAX_SHIFT_POINTS, Math.min(FOOTBALL_OUTCOME_MOVEMENT_MAX_SHIFT_POINTS, value));
}

function meanFinite(values: Array<number | null>): number | null {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return finite.length === 0 ? null : finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function twoSidedFair(selectedPrice: number, opposingPrice: number): number {
  const selected = implied(selectedPrice);
  const opposing = implied(opposingPrice);
  return selected / (selected + opposing);
}

function implied(price: number): number {
  if (!Number.isFinite(price) || price === 0) throw new Error("Football outcome movement price must be non-zero American odds.");
  return price > 0 ? 100 / (price + 100) : -price / (-price + 100);
}

function normalizeBook(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function earliestValidTimestamp(
  quote: FootballBookQuote,
  markets: Array<"moneyline" | "spread" | "total">,
): string | null {
  return validTimestamps(quote, markets).sort((first, second) => Date.parse(first) - Date.parse(second))[0] ?? null;
}

function latestValidTimestamp(
  quote: FootballBookQuote,
  markets: Array<"moneyline" | "spread" | "total">,
): string | null {
  return validTimestamps(quote, markets).sort((first, second) => Date.parse(second) - Date.parse(first))[0] ?? null;
}

function validTimestamps(
  quote: FootballBookQuote,
  markets: Array<"moneyline" | "spread" | "total">,
): string[] {
  return markets
    .filter((market) => quote[market] !== null)
    .map((market) => quote.marketObservedAt?.[market] ?? quote.observedAt)
    .filter((value) => Number.isFinite(Date.parse(value)));
}
