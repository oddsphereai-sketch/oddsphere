import { readFile } from "node:fs/promises";

type Forecast = {
  gameId: string;
  playerName: string;
  market: string;
  line: number;
  prediction: "over" | "under" | "yes" | "no";
  result: "win" | "loss" | "push";
  actual: number;
  projection: number | null;
  independentProjection: number | null;
  rawProbability: number;
  marketProbability: number;
  finalProbability: number;
  exactOfferCount: number;
  bestAvailableSportsbook: string | null;
  canonicalMainLine: boolean;
  decisionRelease: string;
};

type TrackingReport = { forecasts: Forecast[] };
type PrivateHistoryRow = {
  gameId: string;
  playerName: string;
  market: string;
  line: number;
  sportsbook: string;
  marketMovement: string;
};
type PrivateHistory = { history: { rows: PrivateHistoryRow[] } };

const reportPath = stringArg("--report") ?? "/private/tmp/nfl-props-week8.json";
const historyPaths = [5, 6, 7].map((week) => ({
  week,
  path: stringArg(`--week${week}`) ?? `/private/tmp/nfl-props-week${week}-private-history.json`,
}));
const decisionRelease = stringArg("--decision-release")
  ?? "nfl_player_props_decision_2026_10_15_r32_independent_rushing_yards";

const weights = [0, 0.1, 0.2, 0.35, 0.5, 0.75, 1];
const marketFlipThresholds = [0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.075, 0.1];
const minimumOfferCounts = [2, 3, 4, 5, 6];

async function main(): Promise<void> {
  const report = JSON.parse(await readFile(reportPath, "utf8")) as TrackingReport;
  const weekByGame = new Map<string, number>();
  const evidenceByScope = new Map<string, PrivateHistoryRow[]>();
  for (const item of historyPaths) {
    const history = JSON.parse(await readFile(item.path, "utf8")) as PrivateHistory;
    for (const row of history.history.rows) {
      weekByGame.set(String(row.gameId), item.week);
      const key = scopeKey(row);
      evidenceByScope.set(key, [...(evidenceByScope.get(key) ?? []), row]);
    }
  }

  const rows = report.forecasts.filter((row) => row.decisionRelease === decisionRelease
    && row.canonicalMainLine
    && row.prediction !== "yes"
    && row.prediction !== "no"
    && row.result !== "push"
    && weekByGame.has(String(row.gameId)));
  const markets = [...new Set(rows.map((row) => row.market))].sort();
  const output = Object.fromEntries(markets.map((market) => {
    const marketRows = rows.filter((row) => row.market === market);
    return [market, {
      records: marketRows.length,
      weeks: Object.fromEntries([5, 6, 7].map((week) => [week, summarize(
        marketRows.filter((row) => weekByGame.get(String(row.gameId)) === week),
      )])),
      combined: summarize(marketRows),
      projection: projectionSummary(marketRows),
    }];
  }));

  console.log(JSON.stringify({
    readOnly: true,
    reportPath,
    decisionRelease,
    gamesByWeek: Object.fromEntries([5, 6, 7].map((week) => [week,
      new Set(rows.filter((row) => weekByGame.get(String(row.gameId)) === week).map((row) => row.gameId)).size,
    ])),
    rows: rows.length,
    markets: output,
    receivingYardsMarketDisagreements: rows.filter((row) => row.market === "receiving_yards"
      && (overProbability(row, "rawProbability") >= 0.5) !== (overProbability(row, "marketProbability") >= 0.5))
      .map((row) => ({
        week: weekByGame.get(String(row.gameId)),
        gameId: row.gameId,
        player: row.playerName,
        line: row.line,
        actual: row.actual,
        winningSide: row.actual > row.line ? "over" : "under",
        independentOver: round(overProbability(row, "rawProbability")),
        marketOver: round(overProbability(row, "marketProbability")),
        incumbentOver: round(overProbability(row, "finalProbability")),
        exactOfferCount: row.exactOfferCount,
        bestAvailableSportsbook: row.bestAvailableSportsbook,
        books: [...new Set((evidenceByScope.get(scopeKey(row)) ?? []).map((item) => item.sportsbook))].sort(),
        movements: [...new Set((evidenceByScope.get(scopeKey(row)) ?? []).map((item) => `${item.sportsbook}:${item.marketMovement}`))].sort(),
      })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function summarize(values: Forecast[]) {
  return {
    records: values.length,
    independent: score(values, (row) => overProbability(row, "rawProbability")),
    market: score(values, (row) => overProbability(row, "marketProbability")),
    incumbent: score(values, (row) => overProbability(row, "finalProbability")),
    residualWeights: Object.fromEntries(weights.map((weight) => [weight.toFixed(2), score(values, (row) => {
      const independent = overProbability(row, "rawProbability");
      const market = overProbability(row, "marketProbability");
      return sigmoid(logit(market) + weight * (logit(independent) - logit(market)));
    })])),
    discreteMarketCorrection: Object.fromEntries(marketFlipThresholds.map((threshold) => [threshold.toFixed(3), score(values, (row) => {
      const independent = overProbability(row, "rawProbability");
      const market = overProbability(row, "marketProbability");
      const disagrees = (independent >= 0.5) !== (market >= 0.5);
      return disagrees && Math.abs(market - 0.5) >= threshold ? market : independent;
    })])),
    crossBookDirection: Object.fromEntries(minimumOfferCounts.map((minimumOffers) => [String(minimumOffers), score(values, (row) => {
      const independent = overProbability(row, "rawProbability");
      const market = overProbability(row, "marketProbability");
      const disagrees = (independent >= 0.5) !== (market >= 0.5);
      return disagrees && row.exactOfferCount >= minimumOffers ? market : independent;
    })])),
  };
}

function score(values: Forecast[], probability: (row: Forecast) => number) {
  let wins = 0;
  let losses = 0;
  let over = 0;
  let under = 0;
  let brier = 0;
  for (const row of values) {
    const overProbability = probability(row);
    const side = overProbability >= 0.5 ? "over" : "under";
    const actualOver = row.actual > row.line;
    if ((side === "over") === actualOver) wins += 1;
    else losses += 1;
    if (side === "over") over += 1;
    else under += 1;
    brier += (overProbability - Number(actualOver)) ** 2;
  }
  return {
    wins,
    losses,
    hitRate: values.length ? round(wins / values.length) : null,
    over,
    under,
    brier: values.length ? round(brier / values.length) : null,
  };
}

function projectionSummary(values: Forecast[]) {
  const valid = values.filter((row) => row.projection !== null && row.independentProjection !== null);
  return {
    records: valid.length,
    final: errors(valid, (row) => row.projection!),
    independent: errors(valid, (row) => row.independentProjection!),
  };
}

function errors(values: Forecast[], projection: (row: Forecast) => number) {
  const residuals = values.map((row) => projection(row) - row.actual);
  return {
    mae: residuals.length ? round(residuals.reduce((sum, value) => sum + Math.abs(value), 0) / residuals.length) : null,
    bias: residuals.length ? round(residuals.reduce((sum, value) => sum + value, 0) / residuals.length) : null,
  };
}

function overProbability(row: Forecast, key: "rawProbability" | "marketProbability" | "finalProbability"): number {
  return row.prediction === "over" ? row[key] : 1 - row[key];
}

function logit(value: number): number {
  const bounded = Math.max(1e-6, Math.min(1 - 1e-6, value));
  return Math.log(bounded / (1 - bounded));
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function stringArg(name: string): string | null {
  const prefix = `${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function scopeKey(row: Pick<Forecast, "gameId" | "playerName" | "market" | "line">): string {
  return [row.gameId, row.playerName.toLowerCase().replace(/[^a-z0-9]/g, ""), row.market, row.line].join("|");
}

function round(value: number): number {
  return Math.round(value * 100_000) / 100_000;
}
