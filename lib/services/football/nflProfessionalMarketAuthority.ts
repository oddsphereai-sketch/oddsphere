import type { NflForwardPlaybookLine, NflForwardPlaybookSplitSet } from "./nflForwardEvidence";
import type { NflForwardContextMarket } from "./nflForwardEvidenceCapture";
import type { NflRegularSharpSplitSet } from "./sharpApiNflSplits";
import {
  buildNflMarketState,
  NFL_MARKET_STATE_RELEASE,
  type NflMarketState,
  type NflMarketStateSide,
  type NflMarketStateTrail,
} from "./nflMarketState";

export const NFL_PROFESSIONAL_MARKET_AUTHORITY_RELEASE =
  "nfl_professional_market_authority_2026_10_09_r4_provider_feed_continuity" as const;

type Market = "moneyline" | "spread" | "total";
type Side = NflMarketStateSide;
type Snapshot = {
  capturedAt: string;
  markets: Record<Market, Pick<NflForwardContextMarket, "families">>;
};

export type NflProfessionalMarketRead = {
  status: "qualified" | "unavailable";
  side: "home" | "away" | "over" | "under" | null;
  reason:
    | "stable_two_named_moneyline_prices"
    | "number_and_price_alignment"
    | "two_named_total_number_moves"
    | "broad_stable_retail_total_number_move"
    | "insufficient_authority"
    | "opposing_named_flow";
  sources: string[];
  namedSources: string[];
  opposingSources: string[];
  resistance: NflMarketState["resistance"];
  stateRelease: typeof NFL_MARKET_STATE_RELEASE;
};

export type NflProfessionalMarketAuthority = {
  release: typeof NFL_PROFESSIONAL_MARKET_AUTHORITY_RELEASE;
  evaluatedAt: string;
  excludedFamiliesByMarket: Record<Market, string[]>;
  moneylineSide: "home" | "away" | null;
  spreadSide: "home" | "away" | null;
  totalSide: "over" | "under" | null;
  reads: Record<Market, NflProfessionalMarketRead>;
};

export function buildNflProfessionalMarketAuthority(args: {
  evaluatedAt: string;
  snapshots: Snapshot[];
  current: {
    sportsbook: string;
    spread: { homeLine: number } | null;
    total: { line: number } | null;
  };
  playbookLine: NflForwardPlaybookLine | null;
  playbookSplits: NflForwardPlaybookSplitSet | null;
  sharpSplits: NflRegularSharpSplitSet | null;
  excludedFamiliesByMarket?: Partial<Record<Market, Iterable<string>>>;
}): NflProfessionalMarketAuthority {
  const states = Object.fromEntries((["moneyline", "spread", "total"] as const).map((market) => [market,
    buildNflMarketState({
      market,
      evaluatedAt: args.evaluatedAt,
      snapshots: args.snapshots,
      excludedFamilies: args.excludedFamiliesByMarket?.[market],
      current: args.current,
      playbookLine: args.playbookLine,
      playbookSplits: args.playbookSplits,
      sharpSplits: args.sharpSplits,
    }),
  ])) as Record<Market, NflMarketState>;
  const moneyline = moneylineRead(states.moneyline);
  const spread = spreadRead(states.spread);
  const total = totalRead(states.total, args.current.sportsbook);
  return {
    release: NFL_PROFESSIONAL_MARKET_AUTHORITY_RELEASE,
    evaluatedAt: args.evaluatedAt,
    excludedFamiliesByMarket: Object.fromEntries((["moneyline", "spread", "total"] as const).map((market) => [
      market,
      [...new Set([...(args.excludedFamiliesByMarket?.[market] ?? [])].map(canonical).filter(Boolean))].sort(),
    ])) as Record<Market, string[]>,
    moneylineSide: moneyline.side === "home" || moneyline.side === "away" ? moneyline.side : null,
    spreadSide: spread.side === "home" || spread.side === "away" ? spread.side : null,
    totalSide: total.side === "over" || total.side === "under" ? total.side : null,
    reads: { moneyline, spread, total },
  };
}

function moneylineRead(state: NflMarketState): NflProfessionalMarketRead {
  const named = state.trails.filter((trail) => trail.sourceClass === "named" && trail.direction !== null);
  if (named.length < 2 || new Set(named.map((trail) => trail.direction)).size !== 1 ||
      named.some((trail) => trail.buybackToOpening || trail.reversalMagnitude > 0 || trail.persistenceTimeShare < 2 / 3)) {
    return unavailable(state, named);
  }
  const direction = named[0]!.direction!;
  return available(state, direction, "stable_two_named_moneyline_prices", named, []);
}

function spreadRead(state: NflMarketState): NflProfessionalMarketRead {
  const aligned = state.trails.filter((trail) => trail.numberDirection !== null &&
    trail.priceDirection === trail.numberDirection && trail.persistenceTimeShare >= 2 / 3 &&
    trail.reversalMagnitude === 0 && !trail.buybackToOpening);
  const direction = consensus(aligned, (trail) => trail.numberDirection, 2, 2 / 3);
  if (direction === null) return unavailable(state, aligned);
  const selected = aligned.filter((trail) => trail.numberDirection === direction);
  const opposed = aligned.filter((trail) => trail.numberDirection === -direction);
  const opposingNamedFlow = state.splits.some((split) => split.source === "named_book" && split.direction === -direction);
  if (opposingNamedFlow) return unavailable(state, selected, "opposing_named_flow", opposed);
  const alignedFlow = state.splits.some((split) => split.direction === direction);
  if (!alignedFlow) return unavailable(state, selected, "insufficient_authority", opposed);
  return available(state, direction, "number_and_price_alignment", selected, opposed);
}

function totalRead(
  state: NflMarketState,
  selectedSportsbook: string,
): NflProfessionalMarketRead {
  const direction = consensus(state.trails, (trail) => trail.numberDirection, 2, 2 / 3);
  if (direction === null) return unavailable(state, []);
  const aligned = state.trails.filter((trail) => trail.numberDirection === direction);
  const opposed = state.trails.filter((trail) => trail.numberDirection === -direction);
  const namedAligned = aligned.filter((trail) => trail.sourceClass === "named");
  const namedOpposed = opposed.filter((trail) => trail.sourceClass === "named");
  const retailAligned = aligned.filter((trail) => trail.sourceClass === "retail");
  const stableNamed = namedAligned.filter((trail) => trail.persistenceTimeShare >= 2 / 3 &&
    trail.reversalMagnitude === 0 && !trail.buybackToOpening);
  if (stableNamed.length >= 2) {
    return available(state, direction, "two_named_total_number_moves", aligned, opposed);
  }
  const selected = state.trails.find((trail) => canonical(trail.source) === canonical(selectedSportsbook));
  const fullConsensus = consensus(state.trails, (trail) => trail.direction, 3, 2 / 3);
  const broadStable = retailAligned.length >= 5 && opposed.length === 0 && namedOpposed.length === 0 &&
    selected?.direction === direction && fullConsensus === direction &&
    aligned.every((trail) => trail.persistenceTimeShare >= 2 / 3 &&
      trail.reversalMagnitude === 0 && !trail.buybackToOpening);
  return broadStable
    ? available(state, direction, "broad_stable_retail_total_number_move", retailAligned, opposed)
    : unavailable(state, aligned, "insufficient_authority", opposed);
}

function available(
  state: NflMarketState,
  direction: Side,
  reason: Extract<NflProfessionalMarketRead["reason"],
    "stable_two_named_moneyline_prices" | "number_and_price_alignment" |
    "two_named_total_number_moves" | "broad_stable_retail_total_number_move">,
  selected: NflMarketStateTrail[],
  opposed: NflMarketStateTrail[],
): NflProfessionalMarketRead {
  return {
    status: "qualified",
    side: sideName(state.market, direction),
    reason,
    sources: selected.map((trail) => trail.source),
    namedSources: selected.filter((trail) => trail.sourceClass === "named").map((trail) => trail.source),
    opposingSources: opposed.map((trail) => trail.source),
    resistance: state.resistance,
    stateRelease: NFL_MARKET_STATE_RELEASE,
  };
}

function unavailable(
  state: NflMarketState,
  selected: NflMarketStateTrail[],
  reason: Extract<NflProfessionalMarketRead["reason"], "insufficient_authority" | "opposing_named_flow"> = "insufficient_authority",
  opposed: NflMarketStateTrail[] = [],
): NflProfessionalMarketRead {
  return {
    status: "unavailable",
    side: null,
    reason,
    sources: selected.map((trail) => trail.source),
    namedSources: selected.filter((trail) => trail.sourceClass === "named").map((trail) => trail.source),
    opposingSources: opposed.map((trail) => trail.source),
    resistance: state.resistance,
    stateRelease: NFL_MARKET_STATE_RELEASE,
  };
}

function consensus(
  rows: NflMarketStateTrail[],
  direction: (trail: NflMarketStateTrail) => Side | null,
  minimumSources: number,
  minimumAgreement: number,
): Side | null {
  const values = rows.flatMap((trail) => {
    const value = direction(trail);
    return value === null ? [] : [value];
  });
  if (values.length < minimumSources) return null;
  const score = values.reduce<number>((sum, value) => sum + value, 0);
  const selected = sign(score === 0 ? values[0]! : score);
  return values.filter((value) => value === selected).length / values.length >= minimumAgreement ? selected : null;
}

function sideName(market: Market, side: Side) {
  return market === "total" ? side === 1 ? "over" as const : "under" as const
    : side === 1 ? "home" as const : "away" as const;
}

function canonical(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, ""); }
function sign(value: number): Side { return value >= 0 ? 1 : -1; }
