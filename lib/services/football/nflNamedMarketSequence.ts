import type { NflForwardPlaybookLine, NflForwardPlaybookSplitSet } from "./nflForwardEvidence";
import type { NflForwardContextMarket } from "./nflForwardEvidenceCapture";
import type { NflRegularSharpSplitSet } from "./sharpApiNflSplits";
import {
  buildNflMarketState,
  NFL_MARKET_STATE_RELEASE,
  type NflMarketState,
} from "./nflMarketState";

export const NFL_NAMED_MARKET_SEQUENCE_RELEASE =
  "nfl_named_market_sequence_2026_10_09_r2_target_excluded_market_state" as const;

// The evaluated member quote is not known until the target-exclusion loop
// settles. Three retail followers guarantee that removing any one evaluated
// family still leaves the required two-source confirmation.
const TARGET_EXCLUSION_SAFE_RETAIL_FOLLOWERS = 3;
type Market = "moneyline" | "spread" | "total";
type Side = -1 | 1;

export type NflNamedMarketSequenceRead = {
  status: "qualified" | "unavailable";
  side: "home" | "away" | "over" | "under" | null;
  reason:
    | "named_lead_retail_follow"
    | "named_move_public_split_confirmed"
    | "named_move_sharp_flow_confirmed"
    | "named_move_retail_flow_confirmed"
    | "not_validated_for_production"
    | "insufficient_named_sources"
    | "named_book_disagreement"
    | "named_buyback_or_instability"
    | "unconfirmed_named_move"
    | "opposing_fresh_split";
  namedSources: string[];
  followerSources: string[];
  firstNamedMoveAt: string | null;
  namedLeadCompletedAt: string | null;
  followerDelaysMinutes: number[];
  resistance: NflMarketState["resistance"];
  sharpSplitSource: string | null;
  stateRelease: typeof NFL_MARKET_STATE_RELEASE;
  numberMoveSources: string[];
  priceOnlyMoveSources: string[];
};

export type NflNamedMarketSequenceAuthority = {
  release: typeof NFL_NAMED_MARKET_SEQUENCE_RELEASE;
  evaluatedAt: string;
  moneylineSide: "home" | "away" | null;
  spreadSide: "home" | "away" | null;
  totalSide: null;
  reads: Record<Market, NflNamedMarketSequenceRead>;
};

type Snapshot = {
  capturedAt: string;
  markets: Record<Market, Pick<NflForwardContextMarket, "families">>;
};

export function buildNflNamedMarketSequenceAuthority(args: {
  evaluatedAt: string;
  snapshots: Snapshot[];
  current: {
    spread: { homeLine: number } | null;
    total: { line: number } | null;
  };
  playbookLine: NflForwardPlaybookLine | null;
  playbookSplits: NflForwardPlaybookSplitSet | null;
  sharpSplits: NflRegularSharpSplitSet | null;
  excludedFamiliesByMarket?: Partial<Record<Market, Iterable<string>>>;
  minimumFollowerSources?: number;
}): NflNamedMarketSequenceAuthority {
  const evaluatedAt = Date.parse(args.evaluatedAt);
  if (!Number.isFinite(evaluatedAt)) throw new Error("NFL named-sequence evaluatedAt is invalid.");
  const moneyline = qualifiedRead(args, "moneyline");
  const spread = qualifiedRead(args, "spread");
  const totalAudit = qualifiedRead(args, "total");
  const total: NflNamedMarketSequenceRead = {
    ...totalAudit,
    status: "unavailable",
    side: null,
    reason: "not_validated_for_production",
  };
  return {
    release: NFL_NAMED_MARKET_SEQUENCE_RELEASE,
    evaluatedAt: args.evaluatedAt,
    moneylineSide: moneyline.side === "home" || moneyline.side === "away" ? moneyline.side : null,
    spreadSide: spread.side === "home" || spread.side === "away" ? spread.side : null,
    totalSide: null,
    reads: { moneyline, spread, total },
  };
}

function qualifiedRead(
  args: Parameters<typeof buildNflNamedMarketSequenceAuthority>[0],
  market: Market,
): NflNamedMarketSequenceRead {
  const state = buildNflMarketState({
    market,
    evaluatedAt: args.evaluatedAt,
    snapshots: args.snapshots,
    excludedFamilies: args.excludedFamiliesByMarket?.[market],
    current: args.current,
    playbookLine: args.playbookLine,
    playbookSplits: args.playbookSplits,
    sharpSplits: args.sharpSplits,
  });
  const movedNamed = state.trails.filter((trail) => trail.sourceClass === "named" && trail.direction !== null);
  if (movedNamed.length < 2) return unavailable("insufficient_named_sources", movedNamed);
  if (new Set(movedNamed.map((trail) => trail.direction)).size !== 1) {
    return unavailable("named_book_disagreement", movedNamed);
  }
  const direction = movedNamed[0]!.direction!;
  if (movedNamed.some((trail) => trail.buybackToOpening || trail.reversalMagnitude > 0 ||
      trail.persistenceTimeShare < 2 / 3)) {
    return unavailable("named_buyback_or_instability", movedNamed);
  }
  const namedTimes = movedNamed.flatMap((trail) => {
    const firstMoveAt = firstMaterialMoveAt(trail);
    return firstMoveAt ? [Date.parse(firstMoveAt)] : [];
  });
  if (namedTimes.length !== movedNamed.length || namedTimes.some((value) => !Number.isFinite(value))) {
    return unavailable("named_buyback_or_instability", movedNamed);
  }
  const firstNamedMoveAt = Math.min(...namedTimes);
  const followers = state.followerSources;
  const publicSplit = state.splits.find((split) => split.source === "public_consensus") ?? null;
  const namedSharpSplit = state.splits.find((split) => split.source === "named_book") ?? null;
  const retailSplit = state.splits.find((split) => split.source === "retail_book") ?? null;
  const opposingSplit = [publicSplit, namedSharpSplit, retailSplit].find((split) => split?.direction === -direction);
  if (opposingSplit || state.resistance === "reverse_flow") {
    return {
      ...unavailable(opposingSplit ? "opposing_fresh_split" : "named_book_disagreement", movedNamed),
      followerSources: followers,
      firstNamedMoveAt: new Date(firstNamedMoveAt).toISOString(),
      namedLeadCompletedAt: state.namedLeadCompletedAt,
      followerDelaysMinutes: state.followerDelaysMinutes,
      resistance: state.resistance,
      sharpSplitSource: namedSharpSplit?.sportsbook ?? retailSplit?.sportsbook ?? null,
    };
  }
  const publicConfirmed = publicSplit?.direction === direction;
  const sharpFlowConfirmed = namedSharpSplit?.direction === direction;
  const retailFlowConfirmed = retailSplit?.direction === direction;
  const minimumFollowers = args.minimumFollowerSources ?? TARGET_EXCLUSION_SAFE_RETAIL_FOLLOWERS;
  if (followers.length < minimumFollowers && !publicConfirmed && !sharpFlowConfirmed && !retailFlowConfirmed) {
    return {
      ...unavailable("unconfirmed_named_move", movedNamed),
      followerSources: followers,
      firstNamedMoveAt: new Date(firstNamedMoveAt).toISOString(),
      namedLeadCompletedAt: state.namedLeadCompletedAt,
      followerDelaysMinutes: state.followerDelaysMinutes,
      resistance: state.resistance,
      sharpSplitSource: namedSharpSplit?.sportsbook ?? retailSplit?.sportsbook ?? null,
    };
  }
  return {
    status: "qualified",
    side: sideName(market, direction),
    reason: followers.length >= minimumFollowers
      ? "named_lead_retail_follow"
      : publicConfirmed
        ? "named_move_public_split_confirmed"
        : sharpFlowConfirmed
          ? "named_move_sharp_flow_confirmed"
          : "named_move_retail_flow_confirmed",
    namedSources: movedNamed.map((trail) => trail.source),
    followerSources: followers,
    firstNamedMoveAt: new Date(firstNamedMoveAt).toISOString(),
    namedLeadCompletedAt: state.namedLeadCompletedAt,
    followerDelaysMinutes: state.followerDelaysMinutes,
    resistance: state.resistance,
    sharpSplitSource: namedSharpSplit?.sportsbook ?? retailSplit?.sportsbook ?? null,
    stateRelease: NFL_MARKET_STATE_RELEASE,
    numberMoveSources: state.trails.filter((trail) => trail.numberDirection !== null).map((trail) => trail.source),
    priceOnlyMoveSources: state.trails.filter((trail) => trail.numberDirection === null && trail.priceDirection !== null)
      .map((trail) => trail.source),
  };
}

function unavailable(
  reason: Extract<NflNamedMarketSequenceRead["reason"],
    "insufficient_named_sources" | "named_book_disagreement" | "named_buyback_or_instability" | "unconfirmed_named_move" | "opposing_fresh_split">,
  named: Array<{ source: string; numberDirection: Side | null; priceDirection: Side | null }>,
): NflNamedMarketSequenceRead {
  return {
    status: "unavailable",
    side: null,
    reason,
    namedSources: named.map((trail) => trail.source),
    followerSources: [],
    firstNamedMoveAt: null,
    namedLeadCompletedAt: null,
    followerDelaysMinutes: [],
    resistance: "none",
    sharpSplitSource: null,
    stateRelease: NFL_MARKET_STATE_RELEASE,
    numberMoveSources: named.filter((trail) => trail.numberDirection !== null).map((trail) => trail.source),
    priceOnlyMoveSources: named.filter((trail) => trail.numberDirection === null && trail.priceDirection !== null)
      .map((trail) => trail.source),
  };
}

function firstMaterialMoveAt(trail: { firstNumberMoveAt: string | null; firstPriceMoveAt: string | null }) {
  return [trail.firstNumberMoveAt, trail.firstPriceMoveAt]
    .filter((value): value is string => value !== null)
    .sort()[0] ?? null;
}

function sideName(market: Market, side: Side) {
  return market === "total" ? (side === 1 ? "over" as const : "under" as const)
    : side === 1 ? "home" as const : "away" as const;
}
