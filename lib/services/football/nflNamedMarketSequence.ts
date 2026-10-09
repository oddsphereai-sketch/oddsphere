import type { NflForwardPlaybookLine, NflForwardPlaybookSplitSet } from "./nflForwardEvidence";
import type {
  NflForwardContextFamily,
  NflForwardContextMarket,
} from "./nflForwardEvidenceCapture";
import type { NflRegularSharpSplit, NflRegularSharpSplitSet } from "./sharpApiNflSplits";

export const NFL_NAMED_MARKET_SEQUENCE_RELEASE =
  "nfl_named_market_sequence_2026_10_08_r1_strict_lead_follow" as const;

const FRESH_MINUTES = 120;
// The evaluated member quote is not known until the target-exclusion loop
// settles. Three retail followers guarantee that removing any one evaluated
// family still leaves the required two-source confirmation.
const TARGET_EXCLUSION_SAFE_RETAIL_FOLLOWERS = 3;
const NAMED_BOOKS = new Set(["circa", "pinnacle", "bookmaker"]);
type Market = "moneyline" | "spread" | "total";
type Side = -1 | 1;

export type NflNamedMarketSequenceRead = {
  status: "qualified" | "unavailable";
  side: "home" | "away" | "over" | "under" | null;
  reason:
    | "named_lead_retail_follow"
    | "named_move_public_split_confirmed"
    | "named_move_sharp_flow_confirmed"
    | "not_validated_for_production"
    | "insufficient_named_sources"
    | "named_book_disagreement"
    | "named_buyback_or_instability"
    | "unconfirmed_named_move"
    | "opposing_fresh_split";
  namedSources: string[];
  followerSources: string[];
  firstNamedMoveAt: string | null;
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

type Trail = {
  source: string;
  named: boolean;
  direction: Side | null;
  firstMoveAt: string | null;
  persistence: number;
  reversed: boolean;
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
  const marketTrails = trails(args.snapshots, market, args.evaluatedAt);
  const movedNamed = marketTrails.filter((trail): trail is Trail & { direction: Side } =>
    trail.named && trail.direction !== null);
  if (movedNamed.length < 2) return unavailable("insufficient_named_sources", movedNamed);
  if (new Set(movedNamed.map((trail) => trail.direction)).size !== 1) {
    return unavailable("named_book_disagreement", movedNamed);
  }
  const direction = movedNamed[0]!.direction;
  if (movedNamed.some((trail) => trail.reversed || trail.persistence < 2 / 3)) {
    return unavailable("named_buyback_or_instability", movedNamed);
  }
  const namedTimes = movedNamed.flatMap((trail) => trail.firstMoveAt ? [Date.parse(trail.firstMoveAt)] : []);
  if (namedTimes.length !== movedNamed.length || namedTimes.some((value) => !Number.isFinite(value))) {
    return unavailable("named_buyback_or_instability", movedNamed);
  }
  const firstNamedMoveAt = Math.min(...namedTimes);
  const followers = marketTrails.filter((trail) =>
    !trail.named && trail.direction === direction && !trail.reversed && trail.persistence >= 2 / 3 &&
    trail.firstMoveAt !== null && Date.parse(trail.firstMoveAt) >= firstNamedMoveAt);
  const publicSplit = splitDirection(args, market, "public");
  const sharpSplit = splitDirection(args, market, "sharp");
  if (publicSplit === -direction || sharpSplit === -direction) {
    return {
      ...unavailable("opposing_fresh_split", movedNamed),
      followerSources: followers.map((trail) => trail.source),
      firstNamedMoveAt: new Date(firstNamedMoveAt).toISOString(),
    };
  }
  const publicConfirmed = publicSplit === direction;
  const sharpFlowConfirmed = sharpSplit === direction;
  if (followers.length < TARGET_EXCLUSION_SAFE_RETAIL_FOLLOWERS && !publicConfirmed && !sharpFlowConfirmed) {
    return {
      ...unavailable("unconfirmed_named_move", movedNamed),
      followerSources: followers.map((trail) => trail.source),
      firstNamedMoveAt: new Date(firstNamedMoveAt).toISOString(),
    };
  }
  return {
    status: "qualified",
    side: sideName(market, direction),
    reason: followers.length >= TARGET_EXCLUSION_SAFE_RETAIL_FOLLOWERS
      ? "named_lead_retail_follow"
      : publicConfirmed
        ? "named_move_public_split_confirmed"
        : "named_move_sharp_flow_confirmed",
    namedSources: movedNamed.map((trail) => trail.source),
    followerSources: followers.map((trail) => trail.source),
    firstNamedMoveAt: new Date(firstNamedMoveAt).toISOString(),
  };
}

function trails(snapshots: Snapshot[], market: Market, evaluatedAt: string): Trail[] {
  const evaluatedAtMs = Date.parse(evaluatedAt);
  const bySource = new Map<string, Array<{ capturedAt: string; family: NflForwardContextFamily }>>();
  for (const snapshot of snapshots) {
    if (Date.parse(snapshot.capturedAt) > evaluatedAtMs) continue;
    for (const family of snapshot.markets[market].families) {
      const source = canonical(family[0]);
      bySource.set(source, [...(bySource.get(source) ?? []), { capturedAt: snapshot.capturedAt, family }]);
    }
  }
  return [...bySource.entries()].flatMap(([source, rows]): Trail[] => {
    const ordered = rows.sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
    const opening = ordered.find((row) => row.family[4] !== null &&
      Date.parse(row.family[4]![0]) <= evaluatedAtMs && row.family[4]![0] < row.family[5][0])?.family[4] ?? null;
    if (!opening) return [];
    const openingAxis = axis(market, opening);
    if (openingAxis === null) return [];
    const series = [...new Map(ordered.flatMap((row) => {
      const value = axis(market, row.family[5]);
      return value === null || Date.parse(row.family[5][0]) > evaluatedAtMs
        ? []
        : [[row.family[5][0], { at: row.family[5][0], value }] as const];
    })).values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const current = series.at(-1);
    if (!current) return [];
    const currentAgeMinutes = (evaluatedAtMs - Date.parse(current.at)) / 60_000;
    if (!Number.isFinite(currentAgeMinutes) || currentAgeMinutes < 0 || currentAgeMinutes > FRESH_MINUTES) return [];
    const minimum = market === "moneyline" ? 0.01 : 0.5;
    const delta = current.value - openingAxis;
    const direction = Math.abs(delta) >= minimum ? sign(delta) : null;
    const moved = series.filter((row) => Math.abs(row.value - openingAxis) >= minimum);
    const aligned = direction === null ? [] : moved.filter((row) => sign(row.value - openingAxis) === direction);
    return [{
      source,
      named: NAMED_BOOKS.has(source),
      direction,
      firstMoveAt: moved[0]?.at ?? null,
      persistence: moved.length ? aligned.length / moved.length : 0,
      reversed: direction !== null && moved.some((row) => sign(row.value - openingAxis) !== direction),
    }];
  });
}

function splitDirection(
  args: Parameters<typeof buildNflNamedMarketSequenceAuthority>[0],
  market: Market,
  source: "public" | "sharp",
): Side | null {
  const split = source === "public" ? args.playbookSplits?.[market] : args.sharpSplits?.[market];
  if (!split) return null;
  const observedAt = source === "sharp"
    ? (split as NflRegularSharpSplit).providerFetchedAt ?? split.capturedAt
    : split.capturedAt;
  const ageMinutes = (Date.parse(args.evaluatedAt) - Date.parse(observedAt)) / 60_000;
  if (!Number.isFinite(ageMinutes) || ageMinutes < 0 || ageMinutes > FRESH_MINUTES) return null;
  if (source === "public" && market === "spread" &&
      (!args.current.spread || !lineMatches(args.playbookLine?.homeSpread, args.current.spread.homeLine))) return null;
  if (source === "public" && market === "total" &&
      (!args.current.total || !lineMatches(args.playbookLine?.total, args.current.total.line))) return null;
  const money = market === "total" ? split.overMoneyPct : split.homeMoneyPct;
  const tickets = market === "total" ? split.overBetsPct : split.homeBetsPct;
  if (!Number.isFinite(money) || !Number.isFinite(tickets)) return null;
  const gap = (money as number) - (tickets as number);
  const minimum = source === "sharp" ? 10 : 8;
  return Math.abs(gap) >= minimum ? sign(gap) : null;
}

function unavailable(
  reason: Extract<NflNamedMarketSequenceRead["reason"],
    "insufficient_named_sources" | "named_book_disagreement" | "named_buyback_or_instability" | "unconfirmed_named_move" | "opposing_fresh_split">,
  named: Trail[],
): NflNamedMarketSequenceRead {
  return {
    status: "unavailable",
    side: null,
    reason,
    namedSources: named.map((trail) => trail.source),
    followerSources: [],
    firstNamedMoveAt: null,
  };
}

function axis(market: Market, value: NflForwardContextFamily[5]): number | null {
  if (market === "moneyline") {
    const away = implied(value[4]);
    const home = implied(value[5]);
    return home / (away + home);
  }
  if (value[3] === null) return null;
  return market === "spread" ? -value[3] : value[3];
}

function sideName(market: Market, side: Side) {
  return market === "total" ? (side === 1 ? "over" as const : "under" as const)
    : side === 1 ? "home" as const : "away" as const;
}

function lineMatches(first: number | null | undefined, second: number) {
  return first !== null && first !== undefined && Number.isFinite(first) && Math.abs(first - second) < 0.001;
}

function canonical(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, ""); }
function sign(value: number): Side { return value >= 0 ? 1 : -1; }
function implied(price: number) { return price < 0 ? -price / (-price + 100) : 100 / (price + 100); }
