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
  "nfl_three_state_market_reader_2026_10_26_r4_winner_cover_arbitration" as const;

type Snapshot = {
  capturedAt: string;
  markets: Record<"moneyline" | "spread" | "total", Pick<NflForwardContextMarket, "families">>;
};

export type NflThreeStateMarketAuthority = {
  release: typeof NFL_THREE_STATE_MARKET_READER_RELEASE;
  status: "available" | "unavailable";
  reason:
    | "qualified_named_price_and_independent_flow"
    | "qualified_named_price_and_two_source_flow"
    | "qualified_named_price_flow_and_cross_market_consensus"
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
  const namedSources = [...new Set(stableNamed.map((trail) => normalizeBook(trail.source)))].sort();
  if (state.splits.some((split) => split.direction === -side)) {
    return unavailable("opposing_flow", excludedFamilies);
  }
  const confirmingSplits = state.splits.filter((split) =>
    split.direction === side &&
    (split.sportsbook === null || !namedSources.includes(normalizeBook(split.sportsbook)))
  );
  if (confirmingSplits.length > 0) {
    return available({
      reason: "qualified_named_price_and_independent_flow",
      side,
      namedSources,
      confirmingSplitSources: [...new Set(confirmingSplits.map((split) =>
        split.sportsbook === null ? split.source : normalizeBook(split.sportsbook)))].sort(),
      args,
      excludedFamilies,
    });
  }
  const independentFlows = twoSourceMoneylineFlows({
    evaluatedAt: args.evaluatedAt,
    playbookSplits: args.playbookSplits,
    sharpSplits: args.sharpSplits,
    excludedFamilies,
    namedSources,
  });
  if (independentFlows.some((flow) => flow.direction === -side)) {
    return unavailable("opposing_flow", excludedFamilies);
  }
  const confirmingFlows = independentFlows.filter((flow) => flow.direction === side);
  if (new Set(confirmingFlows.map((flow) => flow.source)).size >= 2) {
    return available({
      reason: "qualified_named_price_and_two_source_flow",
      side,
      namedSources,
      confirmingSplitSources: [...new Set(confirmingFlows.map((flow) => flow.source))].sort(),
      args,
      excludedFamilies,
    });
  }
  const outcomeBoundarySide = targetExcludedMoneylineSide({
    books: args.comparableCurrentBooks,
    excludedFamilies,
    evaluatedAt: args.evaluatedAt,
  });
  const spreadBoundary = targetExcludedSpreadBoundary({
    books: args.comparableCurrentBooks,
    excludedFamilies,
    evaluatedAt: args.evaluatedAt,
  });
  return confirmingFlows.length > 0 && outcomeBoundarySide === side &&
    spreadBoundary !== null && sign(spreadBoundary) === side
    ? available({
        reason: "qualified_named_price_flow_and_cross_market_consensus",
        side,
        namedSources,
        confirmingSplitSources: [...new Set([
          ...confirmingFlows.map((flow) => flow.source),
          "target_excluded_moneyline_consensus",
          "target_excluded_spread_consensus",
        ])].sort(),
        args,
        excludedFamilies,
      })
    : unavailable("no_independent_flow_confirmation", excludedFamilies);
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
    const boundary = args.authority.spreadBoundary;
    const independentSpreadSide = boundary === null || boundary === 0
      ? independentSide
      : sign(initialHomeMargin - boundary);
    if (args.authority.side === independentSide && args.authority.side === independentSpreadSide) {
      state = "confirmation";
    } else if (args.authority.side !== independentSide &&
        args.authority.outcomeBoundarySide === args.authority.side) {
      state = "outcome_correction";
      const crossMarketCandidate = boundary === null ? null : 2 * boundary - initialHomeMargin;
      finalHomeMargin = args.authority.reason === "qualified_named_price_flow_and_cross_market_consensus" &&
        boundary !== null && crossMarketCandidate !== null && sign(crossMarketCandidate) === args.authority.side &&
        sign(crossMarketCandidate - boundary) === args.authority.side && total > Math.abs(crossMarketCandidate)
        ? crossMarketCandidate
        : -initialHomeMargin;
      outcomeCorrectionApplied = true;
    } else {
      state = "value_resistance";
      if (boundary !== null && boundary !== 0 && args.authority.side !== sign(initialHomeMargin - boundary)) {
        const sharpSideIsMarketUnderdog = args.authority.side !== sign(boundary);
        const candidate = sharpSideIsMarketUnderdog
          ? boundary / 2
          : 2 * boundary - initialHomeMargin;
        if (sign(candidate) === independentSide &&
            sign(candidate - boundary) === args.authority.side &&
            total > Math.abs(candidate)) {
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

function available(args: {
  reason: Extract<NflThreeStateMarketAuthority["reason"],
    "qualified_named_price_and_independent_flow" | "qualified_named_price_and_two_source_flow" |
    "qualified_named_price_flow_and_cross_market_consensus">;
  side: NflMarketStateSide;
  namedSources: string[];
  confirmingSplitSources: string[];
  args: Parameters<typeof buildNflThreeStateMarketAuthority>[0];
  excludedFamilies: string[];
}): NflThreeStateMarketAuthority {
  return {
    release: NFL_THREE_STATE_MARKET_READER_RELEASE,
    status: "available",
    reason: args.reason,
    side: args.side,
    outcomeBoundarySide: targetExcludedMoneylineSide({
      books: args.args.comparableCurrentBooks,
      excludedFamilies: args.excludedFamilies,
      evaluatedAt: args.args.evaluatedAt,
    }),
    spreadBoundary: targetExcludedSpreadBoundary({
      books: args.args.comparableCurrentBooks,
      excludedFamilies: args.excludedFamilies,
      evaluatedAt: args.args.evaluatedAt,
    }),
    namedSources: args.namedSources,
    confirmingSplitSources: args.confirmingSplitSources,
    excludedFamilies: args.excludedFamilies,
  };
}

function twoSourceMoneylineFlows(args: {
  evaluatedAt: string;
  playbookSplits: NflForwardPlaybookSplitSet | null;
  sharpSplits: NflRegularSharpSplitSet | null;
  excludedFamilies: string[];
  namedSources: string[];
}): Array<{ source: string; direction: NflMarketStateSide }> {
  const evaluatedAt = Date.parse(args.evaluatedAt);
  const excluded = new Set(args.excludedFamilies);
  const result: Array<{ source: string; direction: NflMarketStateSide }> = [];
  const add = (source: string, observedAt: string, homeMoneyPct: number | null, homeBetsPct: number | null) => {
    const observed = Date.parse(observedAt);
    const ageMinutes = (evaluatedAt - observed) / 60_000;
    if (!Number.isFinite(observed) || !Number.isFinite(ageMinutes) || ageMinutes < 0 || ageMinutes > 120 ||
        !Number.isFinite(homeMoneyPct) || !Number.isFinite(homeBetsPct)) return;
    const gap = (homeMoneyPct as number) - (homeBetsPct as number);
    if (Math.abs(gap) < 2) return;
    result.push({ source, direction: sign(gap) });
  };
  const publicSplit = args.playbookSplits?.moneyline;
  if (publicSplit) {
    add("public_consensus", publicSplit.capturedAt, publicSplit.homeMoneyPct, publicSplit.homeBetsPct);
  }
  const sharpSplit = args.sharpSplits?.moneyline;
  if (sharpSplit) {
    const family = normalizeBook(sharpSplit.sourceSportsbook ?? "");
    if (family && !excluded.has(family) && !args.namedSources.includes(family)) {
      add(family, sharpSplit.providerFetchedAt ?? sharpSplit.capturedAt,
        sharpSplit.homeMoneyPct, sharpSplit.homeBetsPct);
    }
  }
  return result;
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
