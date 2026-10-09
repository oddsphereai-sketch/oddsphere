import type { NflForwardPlaybookLine, NflForwardPlaybookSplitSet } from "./nflForwardEvidence";
import type { NflForwardContextFamily, NflForwardContextMarket } from "./nflForwardEvidenceCapture";
import type { NflRegularSharpSplit, NflRegularSharpSplitSet } from "./sharpApiNflSplits";

export const NFL_MARKET_STATE_RELEASE =
  "nfl_market_state_2026_10_09_r1_truthful_signal_identity" as const;

export type NflMarketStateMarket = "moneyline" | "spread" | "total";
export type NflMarketStateSide = -1 | 1;

export type NflMarketStateTrail = {
  source: string;
  sourceClass: "named" | "retail";
  openingAt: string;
  currentAt: string;
  openingNumber: number | null;
  currentNumber: number | null;
  numberDelta: number | null;
  openingFairFirstProbability: number;
  currentFairFirstProbability: number;
  fairProbabilityDeltaPp: number;
  openingHoldPp: number;
  currentHoldPp: number;
  holdDeltaPp: number;
  firstNumberMoveAt: string | null;
  firstPriceMoveAt: string | null;
  moveOrder: "number_before_price" | "price_before_number" | "same_observation" | "number_only" | "price_only" | "none";
  lastEconomicMoveAt: string | null;
  direction: NflMarketStateSide | null;
  numberDirection: NflMarketStateSide | null;
  priceDirection: NflMarketStateSide | null;
  persistenceTimeShare: number;
  reversalMagnitude: number;
  buybackToOpening: boolean;
  crossedKeyNumbers: number[];
};

export type NflMarketStateSplit = {
  source: "public_consensus" | "named_book" | "retail_book" | "unknown_book";
  sportsbook: string | null;
  observedAt: string;
  ageMinutes: number;
  gapPp: number;
  direction: NflMarketStateSide;
  exactLineMatched: boolean | null;
  denominatorKnown: false;
};

export type NflMarketState = {
  release: typeof NFL_MARKET_STATE_RELEASE;
  market: NflMarketStateMarket;
  evaluatedAt: string;
  excludedFamilies: string[];
  trails: NflMarketStateTrail[];
  splits: NflMarketStateSplit[];
  namedDirection: NflMarketStateSide | null;
  namedLeadCompletedAt: string | null;
  followerSources: string[];
  followerDelaysMinutes: number[];
  resistance: "none" | "flow_resistance" | "reverse_flow" | "book_disagreement";
  unavailable: {
    absoluteHandle: true;
    ticketCount: true;
    betSize: true;
    limits: true;
    originatingMarket: true;
    suspensionLifecycle: true;
  };
};

type Snapshot = {
  capturedAt: string;
  markets: Record<NflMarketStateMarket, Pick<NflForwardContextMarket, "families">>;
};

const FRESH_MINUTES = 120;
const NAMED_PRICE_BOOKS = new Set(["circa", "pinnacle"]);
const PRICE_MOVE_PP = 1;
const ECONOMIC_PRICE_MOVE_PP = 0.25;

export function buildNflMarketState(args: {
  market: NflMarketStateMarket;
  evaluatedAt: string;
  snapshots: Snapshot[];
  excludedFamilies?: Iterable<string>;
  current: {
    spread: { homeLine: number } | null;
    total: { line: number } | null;
  };
  playbookLine: NflForwardPlaybookLine | null;
  playbookSplits: NflForwardPlaybookSplitSet | null;
  sharpSplits: NflRegularSharpSplitSet | null;
}): NflMarketState {
  const evaluatedAt = Date.parse(args.evaluatedAt);
  if (!Number.isFinite(evaluatedAt)) throw new Error("NFL market-state evaluatedAt is invalid.");
  const excluded = new Set([...(args.excludedFamilies ?? [])].map(canonical).filter(Boolean));
  const trails = buildTrails(args.snapshots, args.market, evaluatedAt)
    .filter((trail) => !excluded.has(trail.source));
  const splits = buildSplits(args, evaluatedAt, excluded);
  const namedMoved = trails.filter((trail): trail is NflMarketStateTrail & { direction: NflMarketStateSide } =>
    trail.sourceClass === "named" && trail.direction !== null && !trail.buybackToOpening);
  const namedDirections = new Set(namedMoved.map((trail) => trail.direction));
  const namedDirection = namedMoved.length >= 2 && namedDirections.size === 1
    ? namedMoved[0]!.direction
    : null;
  const namedMoveTimes = namedDirection === null
    ? []
    : namedMoved.map(firstMaterialMoveAt).filter((value): value is string => value !== null);
  const namedLeadCompletedAt = namedMoveTimes.length === namedMoved.length && namedMoveTimes.length >= 2
    ? new Date(Math.max(...namedMoveTimes.map(Date.parse))).toISOString()
    : null;
  const namedLeadCompletedAtMs = namedLeadCompletedAt === null ? null : Date.parse(namedLeadCompletedAt);
  const followers = namedDirection === null || namedLeadCompletedAt === null
    ? []
    : trails.filter((trail) => trail.sourceClass === "retail" && trail.direction === namedDirection &&
      !trail.buybackToOpening && firstMaterialMoveAt(trail) !== null &&
      Date.parse(firstMaterialMoveAt(trail)!) >= namedLeadCompletedAtMs!);
  const qualifyingSplits = splits.filter((split) => Math.abs(split.gapPp) >= splitMinimum(split));
  const flow = strongestSplit(qualifyingSplits);
  const priceDirections = trails.filter((trail) => trail.direction !== null).map((trail) => trail.direction!);
  const bookDisagreement = priceDirections.includes(1) && priceDirections.includes(-1);
  const materialPriceDirection = consensusDirection(priceDirections);
  const resistance = bookDisagreement
    ? "book_disagreement" as const
    : flow && materialPriceDirection === null
      ? "flow_resistance" as const
      : flow && materialPriceDirection === -flow.direction
        ? "reverse_flow" as const
        : "none" as const;
  return {
    release: NFL_MARKET_STATE_RELEASE,
    market: args.market,
    evaluatedAt: args.evaluatedAt,
    excludedFamilies: [...excluded].sort(),
    trails,
    splits,
    namedDirection,
    namedLeadCompletedAt,
    followerSources: followers.map((trail) => trail.source),
    followerDelaysMinutes: followers.map((trail) =>
      (Date.parse(firstMaterialMoveAt(trail)!) - namedLeadCompletedAtMs!) / 60_000),
    resistance,
    unavailable: {
      absoluteHandle: true,
      ticketCount: true,
      betSize: true,
      limits: true,
      originatingMarket: true,
      suspensionLifecycle: true,
    },
  };
}

function buildTrails(
  snapshots: Snapshot[],
  market: NflMarketStateMarket,
  evaluatedAt: number,
): NflMarketStateTrail[] {
  const bySource = new Map<string, Array<{ capturedAt: string; family: NflForwardContextFamily }>>();
  for (const snapshot of snapshots) {
    if (Date.parse(snapshot.capturedAt) > evaluatedAt) continue;
    for (const family of snapshot.markets[market].families) {
      const source = canonical(family[0]);
      bySource.set(source, [...(bySource.get(source) ?? []), { capturedAt: snapshot.capturedAt, family }]);
    }
  }
  return [...bySource.entries()].flatMap(([source, rows]): NflMarketStateTrail[] => {
    const ordered = [...rows].sort((first, second) => Date.parse(first.capturedAt) - Date.parse(second.capturedAt));
    const opening = ordered.find((row) => row.family[4] !== null &&
      Date.parse(row.family[4]![0]) <= evaluatedAt && row.family[4]![0] < row.family[5][0])?.family[4] ?? null;
    if (!opening) return [];
    const observations = [...new Map(ordered.flatMap((row) =>
      Date.parse(row.family[5][0]) <= evaluatedAt ? [[row.family[5][0], row.family[5]] as const] : [])).values()]
      .sort((first, second) => Date.parse(first[0]) - Date.parse(second[0]));
    const current = observations.at(-1);
    if (!current || !fresh(current[0], evaluatedAt)) return [];
    const openingNumber = numberAxis(market, opening);
    const currentNumber = numberAxis(market, current);
    const openingProbability = fairFirstProbability(market, opening);
    const currentProbability = fairFirstProbability(market, current);
    const numberDelta = openingNumber === null || currentNumber === null ? null : currentNumber - openingNumber;
    const probabilityDeltaPp = 100 * (currentProbability - openingProbability);
    const threshold = numberThreshold(market);
    const numberDirection = numberDelta !== null && threshold !== null && Math.abs(numberDelta) >= threshold
      ? sign(numberDelta)
      : null;
    const priceDirection = Math.abs(probabilityDeltaPp) >= PRICE_MOVE_PP ? sign(probabilityDeltaPp) : null;
    const direction = numberDirection ?? priceDirection;
    const firstNumberMoveAt = threshold === null || openingNumber === null
      ? null
      : observations.find((value) => {
          const next = numberAxis(market, value);
          return next !== null && Math.abs(next - openingNumber) >= threshold;
        })?.[0] ?? null;
    const firstPriceMoveAt = observations.find((value) =>
      Math.abs(100 * (fairFirstProbability(market, value) - openingProbability)) >= PRICE_MOVE_PP)?.[0] ?? null;
    const economic = observations.filter((value, index) => {
      const previous = index === 0 ? opening : observations[index - 1]!;
      return numberAxis(market, previous) !== numberAxis(market, value) ||
        Math.abs(100 * (fairFirstProbability(market, value) - fairFirstProbability(market, previous))) >=
          ECONOMIC_PRICE_MOVE_PP;
    });
    const firstAlignedAt = direction === null
      ? null
      : observations.find((value) => observationDirection(market, opening, value) === direction)?.[0] ?? null;
    const persistence = direction === null || firstAlignedAt === null
      ? 0
      : timeShare(
          observations,
          opening,
          evaluatedAt,
          (value) => observationDirection(market, opening, value) === direction,
          Date.parse(firstAlignedAt),
        );
    const oppositeMagnitudes = direction === null ? [] : observations.map((value) => {
      if (observationDirection(market, opening, value) !== -direction) return 0;
      const number = numberAxis(market, value);
      const numberMagnitude = openingNumber !== null && number !== null ? number - openingNumber : 0;
      const priceMagnitude = 100 * (fairFirstProbability(market, value) - openingProbability);
      const magnitude = threshold !== null && Math.abs(numberMagnitude) >= threshold ? numberMagnitude : priceMagnitude / 100;
      return Math.abs(magnitude);
    });
    const everMoved = observations.some((value) => observationDirection(market, opening, value) !== null);
    return [{
      source,
      sourceClass: NAMED_PRICE_BOOKS.has(source) ? "named" : "retail",
      openingAt: opening[0],
      currentAt: current[0],
      openingNumber,
      currentNumber,
      numberDelta,
      openingFairFirstProbability: openingProbability,
      currentFairFirstProbability: currentProbability,
      fairProbabilityDeltaPp: probabilityDeltaPp,
      openingHoldPp: holdPp(opening),
      currentHoldPp: holdPp(current),
      holdDeltaPp: holdPp(current) - holdPp(opening),
      firstNumberMoveAt,
      firstPriceMoveAt,
      moveOrder: moveOrder(firstNumberMoveAt, firstPriceMoveAt),
      lastEconomicMoveAt: economic.at(-1)?.[0] ?? null,
      direction,
      numberDirection,
      priceDirection,
      persistenceTimeShare: persistence,
      reversalMagnitude: Math.max(0, ...oppositeMagnitudes),
      buybackToOpening: everMoved && direction === null,
      crossedKeyNumbers: crossedKeys(market, openingNumber, currentNumber),
    }];
  });
}

function buildSplits(
  args: Parameters<typeof buildNflMarketState>[0],
  evaluatedAt: number,
  excluded: Set<string>,
): NflMarketStateSplit[] {
  const result: NflMarketStateSplit[] = [];
  const add = (source: "public" | "sharp", split: NflRegularSharpSplit | NflForwardPlaybookSplitSet[NflMarketStateMarket] | null) => {
    if (!split) return;
    const sportsbook = source === "sharp" && "sourceSportsbook" in split
      ? canonical(split.sourceSportsbook ?? "") || null
      : null;
    if (sportsbook && excluded.has(sportsbook)) return;
    const observedAt = source === "sharp" && "providerFetchedAt" in split
      ? split.providerFetchedAt ?? split.capturedAt
      : split.capturedAt;
    const ageMinutes = (evaluatedAt - Date.parse(observedAt)) / 60_000;
    if (!Number.isFinite(ageMinutes) || ageMinutes < 0 || ageMinutes > FRESH_MINUTES) return;
    const money = args.market === "total" ? split.overMoneyPct : split.homeMoneyPct;
    const tickets = args.market === "total" ? split.overBetsPct : split.homeBetsPct;
    if (!Number.isFinite(money) || !Number.isFinite(tickets)) return;
    const gapPp = (money as number) - (tickets as number);
    if (Math.abs(gapPp) < (source === "sharp" ? 10 : 8)) return;
    const exactLineMatched = source === "public" && args.market === "spread"
      ? lineMatches(args.playbookLine?.homeSpread, args.current.spread?.homeLine)
      : source === "public" && args.market === "total"
        ? lineMatches(args.playbookLine?.total, args.current.total?.line)
        : null;
    if (exactLineMatched === false) return;
    result.push({
      source: source === "public"
        ? "public_consensus"
        : sportsbook === "circa"
          ? "named_book"
          : sportsbook === "draftkings" || sportsbook === "betmgm"
            ? "retail_book"
            : "unknown_book",
      sportsbook,
      observedAt,
      ageMinutes,
      gapPp,
      direction: sign(gapPp),
      exactLineMatched,
      denominatorKnown: false,
    });
  };
  add("public", args.playbookSplits?.[args.market] ?? null);
  add("sharp", args.sharpSplits?.[args.market] ?? null);
  return result;
}

function strongestSplit(values: NflMarketStateSplit[]) {
  return [...values].sort((first, second) => splitAuthority(second) - splitAuthority(first) ||
    Math.abs(second.gapPp) - Math.abs(first.gapPp))[0] ?? null;
}

function splitAuthority(value: NflMarketStateSplit) {
  return value.source === "named_book" ? 3 : value.source === "public_consensus" ? 2 : 1;
}

function splitMinimum(value: NflMarketStateSplit) {
  return value.source === "public_consensus" ? 8 : 10;
}

function consensusDirection(values: NflMarketStateSide[]): NflMarketStateSide | null {
  if (values.length === 0) return null;
  const score = values.reduce<number>((sum, value) => sum + value, 0);
  return Math.abs(score) / values.length >= 0.5 ? sign(score) : null;
}

function firstMaterialMoveAt(trail: NflMarketStateTrail) {
  const values = [trail.firstNumberMoveAt, trail.firstPriceMoveAt].filter((value): value is string => value !== null);
  return values.sort()[0] ?? null;
}

function numberAxis(market: NflMarketStateMarket, value: NflForwardContextFamily[5]): number | null {
  if (market === "moneyline" || value[3] === null) return null;
  return market === "spread" ? -value[3] : value[3];
}

function fairFirstProbability(market: NflMarketStateMarket, value: NflForwardContextFamily[5]): number {
  const first = implied(value[4]);
  const second = implied(value[5]);
  return market === "total" ? first / (first + second) : second / (first + second);
}

function holdPp(value: NflForwardContextFamily[5]) {
  return 100 * (implied(value[4]) + implied(value[5]) - 1);
}

function numberThreshold(market: NflMarketStateMarket) {
  return market === "moneyline" ? null : 0.5;
}

function observationDirection(
  market: NflMarketStateMarket,
  opening: NflForwardContextFamily[5],
  current: NflForwardContextFamily[5],
): NflMarketStateSide | null {
  const threshold = numberThreshold(market);
  const openingNumber = numberAxis(market, opening);
  const currentNumber = numberAxis(market, current);
  if (threshold !== null && openingNumber !== null && currentNumber !== null &&
      Math.abs(currentNumber - openingNumber) >= threshold) {
    return sign(currentNumber - openingNumber);
  }
  const priceDelta = 100 * (fairFirstProbability(market, current) - fairFirstProbability(market, opening));
  return Math.abs(priceDelta) >= PRICE_MOVE_PP ? sign(priceDelta) : null;
}

function timeShare(
  observations: NflForwardContextFamily[5][],
  opening: NflForwardContextFamily[5],
  evaluatedAt: number,
  predicate: (value: NflForwardContextFamily[5]) => boolean,
  startsAt: number,
) {
  if (observations.length === 0) return 0;
  let aligned = 0;
  let total = 0;
  for (let index = 0; index < observations.length; index++) {
    const value = observations[index]!;
    const start = Math.max(Date.parse(value[0]), Date.parse(opening[0]), startsAt);
    const end = index + 1 < observations.length ? Date.parse(observations[index + 1]![0]) : evaluatedAt;
    const duration = Math.max(0, end - start);
    total += duration;
    if (predicate(value)) aligned += duration;
  }
  return total > 0 ? aligned / total : 0;
}

function moveOrder(numberAt: string | null, priceAt: string | null): NflMarketStateTrail["moveOrder"] {
  if (numberAt && priceAt) return numberAt === priceAt ? "same_observation" : numberAt < priceAt ? "number_before_price" : "price_before_number";
  return numberAt ? "number_only" : priceAt ? "price_only" : "none";
}

function crossedKeys(market: NflMarketStateMarket, opening: number | null, current: number | null) {
  if (market !== "spread" || opening === null || current === null) return [];
  return [-7, -3, 0, 3, 7].filter((key) =>
    (opening < key && current >= key) || (opening > key && current <= key));
}

function lineMatches(first: number | null | undefined, second: number | null | undefined) {
  return first !== null && first !== undefined && second !== null && second !== undefined &&
    Number.isFinite(first) && Number.isFinite(second) && Math.abs(first - second) < 0.001;
}

function fresh(value: string, evaluatedAt: number) {
  const observedAt = Date.parse(value);
  const ageMinutes = (evaluatedAt - observedAt) / 60_000;
  return Number.isFinite(ageMinutes) && ageMinutes >= 0 && ageMinutes <= FRESH_MINUTES;
}

function canonical(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, ""); }
function sign(value: number): NflMarketStateSide { return value >= 0 ? 1 : -1; }
function implied(price: number) { return price < 0 ? -price / (-price + 100) : 100 / (price + 100); }
