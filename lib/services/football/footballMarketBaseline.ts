import type { FootballMarket, FootballMarketObservation, FootballSide } from "./footballModelContract";
import { removeFootballVig } from "./footballMarketMath";

export const FOOTBALL_MARKET_ONLY_BENCHMARK_RELEASE = "football_market_only_benchmark_2026_08_19_r1" as const;

export type FootballTwoWayMarketPair = readonly [FootballMarketObservation, FootballMarketObservation];

export type MarketBaselineComponent = {
  market: FootballMarket;
  sourceKey: string;
  sportsbook: string | null;
  observedAt: string;
  firstSide: FootballSide;
  secondSide: FootballSide;
  firstNoVigProbability: number;
  secondNoVigProbability: number;
  overround: number;
};

export type FootballMarketOnlyBenchmark = {
  release: typeof FOOTBALL_MARKET_ONLY_BENCHMARK_RELEASE;
  providerEventId: string;
  decisionTimestamp: string;
  homeWinProbability: number | null;
  homeCoverProbability: number | null;
  overProbability: number | null;
  projectedHomeMargin: number | null;
  projectedTotal: number | null;
  components: MarketBaselineComponent[];
  marketOnly: true;
};

const EXPECTED_SIDES: Record<FootballMarket, readonly FootballSide[]> = {
  moneyline: ["home", "away"],
  spread: ["home", "away"],
  total: ["over", "under"],
};

function validateAsOfPair(pair: FootballTwoWayMarketPair, market: FootballMarket, decisionTimestamp: string): void {
  const decision = Date.parse(decisionTimestamp);
  if (!Number.isFinite(decision)) throw new Error("Market benchmark requires a valid decision timestamp.");
  const sides = new Set(pair.map((row) => row.side));
  const expected = EXPECTED_SIDES[market];
  if (pair.some((row) => row.market !== market) || expected.some((side) => !sides.has(side))) {
    throw new Error(`${market} benchmark requires a coherent ${expected.join("/")} pair.`);
  }
  for (const row of pair) {
    const observed = Date.parse(row.observedAt);
    if (!Number.isFinite(observed) || observed > decision) {
      throw new Error(`${market} benchmark contains an invalid or future market observation.`);
    }
  }
}

function component(pair: FootballTwoWayMarketPair, market: FootballMarket): MarketBaselineComponent {
  const fair = removeFootballVig(pair[0], pair[1]);
  return {
    market,
    sourceKey: pair[0].sourceKey,
    sportsbook: pair[0].sportsbook,
    observedAt: pair[0].observedAt,
    firstSide: pair[0].side,
    secondSide: pair[1].side,
    firstNoVigProbability: fair.firstNoVigProbability,
    secondNoVigProbability: fair.secondNoVigProbability,
    overround: fair.overround,
  };
}

function probabilityFor(pair: FootballTwoWayMarketPair, side: FootballSide): number {
  const fair = removeFootballVig(pair[0], pair[1]);
  if (pair[0].side === side) return fair.firstNoVigProbability;
  if (pair[1].side === side) return fair.secondNoVigProbability;
  throw new Error(`Side ${side} is absent from the market pair.`);
}

/**
 * Build the benchmark the independent model must beat. Each market component
 * stays tied to its own synchronized source instead of manufacturing a
 * consensus from asynchronous best prices.
 */
export function buildFootballMarketOnlyBenchmark(args: {
  providerEventId: string;
  decisionTimestamp: string;
  moneyline?: FootballTwoWayMarketPair;
  spread?: FootballTwoWayMarketPair;
  total?: FootballTwoWayMarketPair;
}): FootballMarketOnlyBenchmark {
  const entries = (["moneyline", "spread", "total"] as const)
    .map((market) => [market, args[market]] as const)
    .filter((entry): entry is readonly [FootballMarket, FootballTwoWayMarketPair] => entry[1] !== undefined);
  if (entries.length === 0) throw new Error("Market-only benchmark requires at least one complete two-way market.");
  for (const [market, pair] of entries) {
    validateAsOfPair(pair, market, args.decisionTimestamp);
    if (pair.some((row) => row.providerEventId !== args.providerEventId)) {
      throw new Error("Market benchmark event identity mismatch.");
    }
  }
  const spreadHome = args.spread?.find((row) => row.side === "home");
  const totalOver = args.total?.find((row) => row.side === "over");
  return {
    release: FOOTBALL_MARKET_ONLY_BENCHMARK_RELEASE,
    providerEventId: args.providerEventId,
    decisionTimestamp: args.decisionTimestamp,
    homeWinProbability: args.moneyline ? probabilityFor(args.moneyline, "home") : null,
    homeCoverProbability: args.spread ? probabilityFor(args.spread, "home") : null,
    overProbability: args.total ? probabilityFor(args.total, "over") : null,
    projectedHomeMargin: spreadHome?.lineValue === null || spreadHome?.lineValue === undefined ? null : -spreadHome.lineValue,
    projectedTotal: totalOver?.lineValue ?? null,
    components: entries.map(([market, pair]) => component(pair, market)),
    marketOnly: true,
  };
}
