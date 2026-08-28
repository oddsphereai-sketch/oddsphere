#!/usr/bin/env tsx

/** SELECT-only current CFB replay for the frozen two-axis r18 outcome contract. */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readCfbForwardEvidence } from "../../lib/services/football/cfbForwardEvidenceStore";
import { activeCfbWeeklyWindow, isGameInCfbWeeklyWindow } from "../../lib/services/football/cfbWeeklyWindow";
import { buildCfbV1DecisionBundle, getCfbV1Forecast, type CfbV1Grade } from "../../lib/services/football/cfbV1Decision";
import {
  buildCfbMarketInformedOutcomeForecast,
  resolveCfbCanonicalMarketAnchor,
} from "../../lib/services/football/cfbMarketInformedOutcome";

const GRADES: CfbV1Grade[] = ["Best Angle", "Lean", "Watchlist", "No Play"];

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase read credentials are required.");
  const now = process.argv.find((value) => value.startsWith("--now="))?.slice(6) ?? new Date().toISOString();
  const rows = await readCfbForwardEvidence({
    client: createClient(url, key, { auth: { persistSession: false } }),
    season: 2026,
  });
  const window = activeCfbWeeklyWindow(now);
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!isGameInCfbWeeklyWindow({ scheduledStart: row.gameStartAt }, window)) continue;
    const prior = latest.get(row.providerGameId);
    if (!prior || Date.parse(row.capturedAt) > Date.parse(prior.capturedAt)) latest.set(row.providerGameId, row);
  }

  const games = [...latest.values()]
    .sort((first, second) => first.gameStartAt.localeCompare(second.gameStartAt))
    .map((row) => {
      const payload = row.payload;
      const independent = getCfbV1Forecast(payload.game.providerGameId);
      const anchor = resolveCfbCanonicalMarketAnchor({
        books: payload.market.currentBooks,
        contextLines: {
          homeSpread: payload.market.playbookLine?.homeSpread ?? null,
          totalLine: payload.market.playbookLine?.total ?? null,
        },
      });
      if (!anchor) throw new Error(`${payload.game.away.abbreviation}@${payload.game.home.abbreviation} has no canonical outcome anchor.`);
      const primary = buildCfbMarketInformedOutcomeForecast({ independentForecast: independent, anchor });
      assertForecastCoherence(primary);
      const decisionBundle = buildCfbV1DecisionBundle({
        providerGameId: payload.game.providerGameId,
        awayTeam: payload.game.away.abbreviation,
        homeTeam: payload.game.home.abbreviation,
        gameStartsAt: payload.game.scheduledStart,
        comparableCurrentBooks: payload.market.currentBooks,
        evaluatedAt: payload.capturedAt,
        healthHolds: payload.coverage.healthHolds ?? [],
        forecast: independent,
        contextLines: {
          homeSpread: payload.market.playbookLine?.homeSpread ?? null,
          totalLine: payload.market.playbookLine?.total ?? null,
        },
      });
      return {
        providerGameId: payload.game.providerGameId,
        matchup: `${payload.game.away.abbreviation}@${payload.game.home.abbreviation}`,
        capturedAt: payload.capturedAt,
        anchor,
        independent: summaryForecast(independent),
        primaryMarketInformed: summaryForecast(primary),
        decisions: decisionBundle.evaluatedBets.map((decision) => ({
          market: decision.market,
          side: decision.side,
          grade: decision.grade,
          probability: decision.modelProbability,
          fairProbability: decision.marketFairProbability,
          edgePercentagePoints: decision.edgePercentagePoints,
          expectedValue: decision.expectedValue,
          sportsbook: decision.evaluatedQuote.sportsbook,
          line: decision.evaluatedQuote.line,
          price: decision.evaluatedQuote.price,
        })),
        unavailableMarkets: decisionBundle.heldMarkets,
      };
    });

  const decisions = games.flatMap((game) => game.decisions);
  const primaryScores = games.flatMap((game) => [game.primaryMarketInformed.expectedAwayPoints, game.primaryMarketInformed.expectedHomePoints]);
  const independentScores = games.flatMap((game) => [game.independent.expectedAwayPoints, game.independent.expectedHomePoints]);
  console.log(JSON.stringify({
    release: "cfb_current_market_informed_outcome_replay_2026_08_28_r18",
    readOnly: true,
    providerCalls: 0,
    writes: 0,
    evidenceRowsRead: rows.length,
    games: games.length,
    markets: games.length * 3,
    exactPriceDecisions: decisions.length,
    unavailableMarkets: games.length * 3 - decisions.length,
    gradeCounts: Object.fromEntries(GRADES.map((grade) => [grade, decisions.filter((decision) => decision.grade === grade).length])),
    actionablePromotions: 0,
    actionableDemotions: 0,
    scoreDispersion: {
      independentTeamScoreSd: standardDeviation(independentScores),
      primaryMarketInformedTeamScoreSd: standardDeviation(primaryScores),
      primaryExpectedMarginSd: standardDeviation(games.map((game) => game.primaryMarketInformed.expectedMarginHome)),
      primaryExpectedTotalSd: standardDeviation(games.map((game) => game.primaryMarketInformed.expectedTotal)),
    },
    gamesDetail: games,
  }, null, 2));
}

function summaryForecast(forecast: ReturnType<typeof getCfbV1Forecast>) {
  return {
    expectedAwayPoints: forecast.expectedAwayPoints,
    expectedHomePoints: forecast.expectedHomePoints,
    expectedMarginHome: forecast.expectedMarginHome,
    expectedTotal: forecast.expectedTotal,
    homeWinProbability: forecast.homeWinProbability,
    representativeScore: forecast.representativeScore,
  };
}

function assertForecastCoherence(forecast: ReturnType<typeof getCfbV1Forecast>): void {
  const mass = forecast.pmf.reduce((sum, cell) => sum + cell.probability, 0);
  const home = forecast.pmf.reduce((sum, cell) => sum + cell.home * cell.probability, 0);
  const away = forecast.pmf.reduce((sum, cell) => sum + cell.away * cell.probability, 0);
  const homeWin = forecast.pmf.reduce((sum, cell) =>
    sum + (cell.home > cell.away ? cell.probability : cell.home === cell.away ? 0.5 * cell.probability : 0), 0);
  if (Math.abs(mass - 1) > 1e-10 || Math.abs(home - forecast.expectedHomePoints) > 1e-10 ||
    Math.abs(away - forecast.expectedAwayPoints) > 1e-10 || Math.abs(homeWin - forecast.homeWinProbability) > 1e-10) {
    throw new Error(`${forecast.providerGameId} market-informed PMF summary mismatch.`);
  }
  const expectedWinner = forecast.expectedMarginHome > 0 ? "home" : forecast.expectedMarginHome < 0 ? "away" : "tie";
  const probabilityWinner = forecast.homeWinProbability > 0.5 ? "home" : forecast.homeWinProbability < 0.5 ? "away" : "tie";
  const representativeWinner = forecast.representativeScore.home > forecast.representativeScore.away ? "home" :
    forecast.representativeScore.home < forecast.representativeScore.away ? "away" : "tie";
  if (expectedWinner !== probabilityWinner || (probabilityWinner !== "tie" && representativeWinner !== probabilityWinner)) {
    throw new Error(`${forecast.providerGameId} score/winner directions disagree.`);
  }
}

function standardDeviation(values: number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
