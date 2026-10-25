import type { NflPreviewBookOdds } from "./balldontlieNflPreviewSlate";
import type {
  NflForwardPlaybookLine,
  NflForwardPlaybookSplitSet,
} from "./nflForwardEvidence";
import type { NflForwardContextMarket } from "./nflForwardEvidenceCapture";
import {
  buildNflMarketState,
  type NflMarketStateSide,
} from "./nflMarketState";
import type { NflRegularSharpSplitSet } from "./sharpApiNflSplits";
import {
  buildNflCategoricalMarketAdjustedForecast,
  type NflV1WeekOneOutcomeForecast,
} from "./nflV1WeekOneOutcome";

export const NFL_THREE_STATE_MARKET_READER_RELEASE =
  "nfl_three_state_market_reader_2026_10_25_r1" as const;

type Snapshot = {
  capturedAt: string;
  markets: Record<"moneyline" | "spread" | "total", Pick<NflForwardContextMarket, "families">>;
};

export type NflThreeStateMarketAuthority = {
  release: typeof NFL_THREE_STATE_MARKET_READER_RELEASE;
  status: "available" | "unavailable";
  reason:
    | "qualified_named_price_and_independent_flow"
    | "no_stable_named_moneyline_direction"
    | "named_moneyline_disagreement"
    | "opposing_flow"
    | "no_independent_flow_confirmation";
  side: NflMarketStateSide | null;
  outcomeBoundarySide: NflMarketStateSide | null;
  spreadBoundary: number | null;
  namedSources: string[];
  confirmingSplitSources: string[];
  excludedFamilies: string[];
};

export type NflThreeStateMarketReader = NflThreeStateMarketAuthority & {
  state: "unavailable" | "confirmation" | "value_resistance" | "outcome_correction";
  initialHomeMargin: number;
  finalHomeMargin: number;
  outcomeCorrectionApplied: boolean;
  spreadBoundaryCorrectionApplied: boolean;
};

export function buildNflThreeStateMarketAuthority(args: {
  evaluatedAt: string;
  snapshots: Snapshot[];
  current: NflPreviewBookOdds;
  comparableCurrentBooks: NflPreviewBookOdds[];
  playbookLine: NflForwardPlaybookLine | null;
  playbookSplits: NflForwardPlaybookSplitSet | null;
  sharpSplits: NflRegularSharpSplitSet | null;
  excludedFamilies: Iterable<string>;
}): NflThreeStateMarketAuthority {
  const excludedFamilies = [...new Set([...args.excludedFamilies].map(normalizeBook).filter(Boolean))].sort();
  const state = buildNflMarketState({
    market: "moneyline",
    evaluatedAt: args.evaluatedAt,
    snapshots: args.snapshots,
    excludedFamilies,
    current: args.current,
    playbookLine: args.playbookLine,
    playbookSplits: args.playbookSplits,
    sharpSplits: args.sharpSplits,
  });
  const stableNamed = state.trails.filter((trail) =>
    trail.sourceClass === "named" &&
    trail.direction !== null &&
    trail.persistenceTimeShare >= 2 / 3 &&
    trail.reversalMagnitude === 0 &&
    !trail.buybackToOpening
  );
  if (stableNamed.length === 0) {
    return unavailable("no_stable_named_moneyline_direction", excludedFamilies);
  }
  const namedDirections = new Set(stableNamed.map((trail) => trail.direction));
  if (namedDirections.size !== 1) {
    return unavailable("named_moneyline_disagreement", excludedFamilies);
  }
  const side = stableNamed[0]!.direction!;
  if (state.splits.some((split) => split.direction === -side)) {
    return unavailable("opposing_flow", excludedFamilies);
  }
  const namedSources = [...new Set(stableNamed.map((trail) => normalizeBook(trail.source)))].sort();
  const confirmingSplits = state.splits.filter((split) =>
    split.direction === side &&
    (split.sportsbook === null || !namedSources.includes(normalizeBook(split.sportsbook)))
  );
  if (confirmingSplits.length === 0) {
    return unavailable("no_independent_flow_confirmation", excludedFamilies);
  }
  return {
    release: NFL_THREE_STATE_MARKET_READER_RELEASE,
    status: "available",
    reason: "qualified_named_price_and_independent_flow",
    side,
    outcomeBoundarySide: targetExcludedMoneylineSide({
      books: args.comparableCurrentBooks,
      excludedFamilies,
      evaluatedAt: args.evaluatedAt,
    }),
    spreadBoundary: targetExcludedSpreadBoundary({
      books: args.comparableCurrentBooks,
      excludedFamilies,
      evaluatedAt: args.evaluatedAt,
    }),
    namedSources,
    confirmingSplitSources: [...new Set(confirmingSplits.map((split) =>
      split.sportsbook === null ? split.source : normalizeBook(split.sportsbook)))].sort(),
    excludedFamilies,
  };
}

export function applyNflThreeStateMarketReader(args: {
  forecast: NflV1WeekOneOutcomeForecast;
  authority: NflThreeStateMarketAuthority;
}): NflV1WeekOneOutcomeForecast {
  const initialHomeMargin = args.forecast.expectedHomeScore - args.forecast.expectedAwayScore;
  const total = args.forecast.expectedHomeScore + args.forecast.expectedAwayScore;
  const independentSide = sign(initialHomeMargin);
  let finalHomeMargin = initialHomeMargin;
  let state: NflThreeStateMarketReader["state"] = "unavailable";
  let outcomeCorrectionApplied = false;
  let spreadBoundaryCorrectionApplied = false;

  if (args.authority.status === "available" && args.authority.side !== null) {
    if (args.authority.side === independentSide) {
      state = "confirmation";
    } else if (args.authority.outcomeBoundarySide === args.authority.side) {
      state = "outcome_correction";
      finalHomeMargin = -initialHomeMargin;
      outcomeCorrectionApplied = true;
    } else {
      state = "value_resistance";
      const boundary = args.authority.spreadBoundary;
      if (boundary !== null && args.authority.side !== sign(initialHomeMargin - boundary)) {
        const candidate = 2 * boundary - initialHomeMargin;
        if (sign(candidate) === independentSide && total > Math.abs(candidate)) {
          finalHomeMargin = candidate;
          spreadBoundaryCorrectionApplied = true;
        }
      }
    }
  }

  const threeStateMarketReader: NflThreeStateMarketReader = {
    ...args.authority,
    state,
    initialHomeMargin,
    finalHomeMargin,
    outcomeCorrectionApplied,
    spreadBoundaryCorrectionApplied,
  };
  if (!outcomeCorrectionApplied && !spreadBoundaryCorrectionApplied) {
    return { ...args.forecast, threeStateMarketReader };
  }
  const corrected = buildNflCategoricalMarketAdjustedForecast({
    baseForecast: args.forecast,
    expectedHomeMargin: finalHomeMargin,
    expectedTotal: total,
    marketInputPolicy: "qualified_categorical_boundary_no_scalar_blend",
  });
  return {
    ...args.forecast,
    ...corrected,
    marketEvidence: args.forecast.marketEvidence,
    targetExclusion: args.forecast.targetExclusion,
    noWeightMarketReader: args.forecast.noWeightMarketReader,
    threeStateMarketReader,
  };
}

function unavailable(
  reason: Extract<NflThreeStateMarketAuthority["reason"],
    "no_stable_named_moneyline_direction" | "named_moneyline_disagreement" |
    "opposing_flow" | "no_independent_flow_confirmation">,
  excludedFamilies: string[],
): NflThreeStateMarketAuthority {
  return {
    release: NFL_THREE_STATE_MARKET_READER_RELEASE,
    status: "unavailable",
    reason,
    side: null,
    outcomeBoundarySide: null,
    spreadBoundary: null,
    namedSources: [],
    confirmingSplitSources: [],
    excludedFamilies,
  };
}

function targetExcludedMoneylineSide(args: {
  books: NflPreviewBookOdds[];
  excludedFamilies: Iterable<string>;
  evaluatedAt: string;
}): NflMarketStateSide | null {
  const books = freshDistinctBooks(args).filter((book) => book.moneyline !== null);
  if (books.length < 3) return null;
  const homeFair = median(books.map((book) => {
    const home = implied(book.moneyline!.homePrice);
    const away = implied(book.moneyline!.awayPrice);
    return home / (home + away);
  }));
  return Math.abs(homeFair - 0.5) < 1e-9 ? null : sign(homeFair - 0.5);
}

function targetExcludedSpreadBoundary(args: {
  books: NflPreviewBookOdds[];
  excludedFamilies: Iterable<string>;
  evaluatedAt: string;
}): number | null {
  const books = freshDistinctBooks(args).filter((book) => book.spread !== null);
  return books.length < 3 ? null : median(books.map((book) => -book.spread!.homeLine));
}

function freshDistinctBooks(args: {
  books: NflPreviewBookOdds[];
  excludedFamilies: Iterable<string>;
  evaluatedAt: string;
}): NflPreviewBookOdds[] {
  const evaluatedAt = Date.parse(args.evaluatedAt);
  if (!Number.isFinite(evaluatedAt)) throw new Error("NFL three-state evaluatedAt is invalid.");
  const excluded = new Set([...args.excludedFamilies].map(normalizeBook));
  const latest = new Map<string, NflPreviewBookOdds>();
  for (const book of args.books) {
    const family = normalizeBook(book.sportsbook);
    const observedAt = Date.parse(book.observedAt);
    if (!family || excluded.has(family) || !Number.isFinite(observedAt) || observedAt > evaluatedAt ||
        evaluatedAt - observedAt > 120 * 60_000) continue;
    const prior = latest.get(family);
    if (!prior || Date.parse(prior.observedAt) < observedAt) latest.set(family, book);
  }
  return [...latest.values()];
}

function normalizeBook(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function median(values: number[]): number {
  const ordered = [...values].sort((first, second) => first - second);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1
    ? ordered[middle]!
    : (ordered[middle - 1]! + ordered[middle]!) / 2;
}

function implied(price: number): number {
  if (!Number.isFinite(price) || price === 0) throw new Error("NFL three-state price must be non-zero American odds.");
  return price < 0 ? -price / (-price + 100) : 100 / (price + 100);
}

function sign(value: number): NflMarketStateSide {
  return value >= 0 ? 1 : -1;
}
