import type { MlbPropMarketKey } from "./config";
import type { MlbPropProviderBundle, PropOddsSnapshot } from "./providers";
import { buildMlbPropFeatureSnapshot } from "./featureBuilder";
import { PitcherOutsModel, PitcherStrikeoutsModel, type BasePropModel } from "./models";
import { recommendPropBet, type PropRecommendation } from "./recommendations";

export type MlbPropBacktestResult = {
  name: string;
  marketKeys: MlbPropMarketKey[];
  bets: number;
  wins: number;
  losses: number;
  pushes: number;
  unitsWon: number;
  roi: number;
  avgEv: number;
  avgEdge: number;
  recommendations: Array<{
    gameId: string;
    playerId: string;
    marketKey: MlbPropMarketKey;
    recommendation: PropRecommendation;
    result: "win" | "loss" | "push" | "pending" | "no_play";
    closingAmericanOdds: number | null;
    clv: number | null;
  }>;
};

export async function runFixtureMlbPropBacktest(args: {
  provider: MlbPropProviderBundle;
  date: string;
  asOfTimestamp: string;
  marketKeys?: MlbPropMarketKey[];
}): Promise<MlbPropBacktestResult> {
  const marketKeys = args.marketKeys ?? ["pitcher_strikeouts"];
  const odds = await args.provider.getPropOdds({ date: args.date, asOfTimestamp: args.asOfTimestamp });
  const closingOdds = await args.provider.getPropOdds({ date: args.date, asOfTimestamp: "9999-12-31T00:00:00.000Z" });
  const results = await args.provider.getResults({ date: args.date });
  const grouped = groupOdds(odds).filter((row) => marketKeys.includes(row.marketKey));
  const recommendations: MlbPropBacktestResult["recommendations"] = [];

  for (const row of grouped) {
    const model = modelForMarket(row.marketKey);
    if (!model) continue;
    const feature = await buildMlbPropFeatureSnapshot({
      provider: args.provider,
      gameId: row.gameId,
      playerId: row.playerId,
      marketKey: row.marketKey,
      line: row.line,
      asOfTimestamp: args.asOfTimestamp,
    });
    const [prediction] = await model.predict_proba([feature]);
    const recommendation = recommendPropBet({
      prediction,
      overOdds: row.over,
      underOdds: row.under,
      asOfTimestamp: args.asOfTimestamp,
      config: { maxOddsAgeSeconds: 10_000 },
    });
    const settled = results.find(
      (result) =>
        result.gameId === row.gameId &&
        result.playerId === row.playerId &&
        result.marketKey === row.marketKey,
    );
    const closing = findClosingOdds(closingOdds, row, recommendation.side);
    recommendations.push({
      gameId: row.gameId,
      playerId: row.playerId,
      marketKey: row.marketKey,
      recommendation,
      result: recommendation.status === "recommended" ? settle(recommendation, settled) : "no_play",
      closingAmericanOdds: closing?.americanOdds ?? null,
      clv: recommendation.americanOdds && closing ? recommendation.americanOdds - closing.americanOdds : null,
    });
  }

  const betRows = recommendations.filter((row) => row.recommendation.status === "recommended");
  const wins = betRows.filter((row) => row.result === "win").length;
  const losses = betRows.filter((row) => row.result === "loss").length;
  const pushes = betRows.filter((row) => row.result === "push").length;
  const unitsWon = betRows.reduce((sum, row) => {
    if (row.result === "win") return sum + row.recommendation.recommendedUnits;
    if (row.result === "loss") return sum - 1;
    return sum;
  }, 0);
  const avgEv = average(betRows.map((row) => row.recommendation.expectedValue ?? 0));
  const avgEdge = average(betRows.map((row) => row.recommendation.edge ?? 0));
  return {
    name: `fixture_${args.date}`,
    marketKeys,
    bets: betRows.length,
    wins,
    losses,
    pushes,
    unitsWon,
    roi: betRows.length > 0 ? unitsWon / betRows.length : 0,
    avgEv,
    avgEdge,
    recommendations,
  };
}

type GroupedOdds = {
  marketKey: MlbPropMarketKey;
  gameId: string;
  playerId: string;
  line: number;
  over: PropOddsSnapshot | null;
  under: PropOddsSnapshot | null;
};

function groupOdds(rows: PropOddsSnapshot[]): GroupedOdds[] {
  const map = new Map<string, GroupedOdds>();
  for (const row of rows.filter((candidate) => candidate.snapshotRole !== "closing")) {
    const key = `${row.gameId}:${row.playerId}:${row.marketKey}:${row.line}`;
    const existing = map.get(key) ?? {
      marketKey: row.marketKey,
      gameId: row.gameId,
      playerId: row.playerId,
      line: row.line,
      over: null,
      under: null,
    };
    existing[row.side] = row;
    map.set(key, existing);
  }
  return [...map.values()];
}

function modelForMarket(marketKey: MlbPropMarketKey): BasePropModel | null {
  if (marketKey === "pitcher_strikeouts") return new PitcherStrikeoutsModel();
  if (marketKey === "pitcher_outs") return new PitcherOutsModel();
  return null;
}

function findClosingOdds(rows: PropOddsSnapshot[], grouped: GroupedOdds, side: "over" | "under"): PropOddsSnapshot | null {
  return rows
    .filter((row) =>
      row.snapshotRole === "closing" &&
      row.gameId === grouped.gameId &&
      row.playerId === grouped.playerId &&
      row.marketKey === grouped.marketKey &&
      row.line === grouped.line &&
      row.side === side,
    )
    .sort((a, b) => b.asOfTimestamp.localeCompare(a.asOfTimestamp))[0] ?? null;
}

function settle(recommendation: PropRecommendation, result: Awaited<ReturnType<MlbPropProviderBundle["getResults"]>>[number] | undefined) {
  if (!result || result.settlementStatus !== "settled") return "pending";
  if (result.push) return "push";
  if (recommendation.side === "over") return result.overWon ? "win" : "loss";
  return result.underWon ? "win" : "loss";
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
