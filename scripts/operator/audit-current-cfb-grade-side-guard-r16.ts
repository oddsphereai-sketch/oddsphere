#!/usr/bin/env tsx

/** SELECT-only current-board replay through the PMF-side grade guard. */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readCfbForwardEvidence } from "../../lib/services/football/cfbForwardEvidenceStore";
import { activeCfbWeeklyWindow, isGameInCfbWeeklyWindow } from "../../lib/services/football/cfbWeeklyWindow";
import {
  buildCfbV1DecisionBundle,
  cfbV1LineProbabilities,
  getCfbV1Forecast,
  type CfbV1ExactPriceDecision,
  type CfbV1Grade,
  type CfbV1Market,
} from "../../lib/services/football/cfbV1Decision";

const MARKETS: CfbV1Market[] = ["moneyline", "spread", "total"];
const GRADES: CfbV1Grade[] = ["Best Angle", "Lean", "Watchlist", "No Play"];

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase read credentials are required.");
  const now = process.argv.find((value) => value.startsWith("--now="))?.slice(6) ?? new Date().toISOString();
  const rows = await readCfbForwardEvidence({ client: createClient(url, key, { auth: { persistSession: false } }), season: 2026 });
  const window = activeCfbWeeklyWindow(now);
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!isGameInCfbWeeklyWindow({ scheduledStart: row.gameStartAt }, window)) continue;
    const previous = latest.get(row.providerGameId);
    if (!previous || Date.parse(row.capturedAt) > Date.parse(previous.capturedAt)) latest.set(row.providerGameId, row);
  }
  const games = [...latest.values()].sort((first, second) => first.gameStartAt.localeCompare(second.gameStartAt)).map((row) => {
    const payload = row.payload;
    const healthHolds = payload.coverage.healthHolds ?? [];
    const bundle = buildCfbV1DecisionBundle({
      providerGameId: payload.game.providerGameId,
      awayTeam: payload.game.away.abbreviation,
      homeTeam: payload.game.home.abbreviation,
      gameStartsAt: payload.game.scheduledStart,
      comparableCurrentBooks: payload.market.currentBooks,
      evaluatedAt: payload.capturedAt,
      healthHolds,
      forecast: getCfbV1Forecast(payload.game.providerGameId),
      contextLines: { homeSpread: payload.market.playbookLine?.homeSpread ?? null, totalLine: payload.market.playbookLine?.total ?? null },
    });
    const old = new Map(payload.decisions.evaluatedBets.map((decision) => [decision.market, decision]));
    const candidate = new Map(bundle.evaluatedBets.map((decision) => [decision.market, decision]));
    const markets = MARKETS.map((market) => {
      const prior = old.get(market) ?? null;
      const next = candidate.get(market) ?? null;
      if (next) assertPmfSide(bundle.forecast, next, payload.game.away.abbreviation, payload.game.home.abbreviation);
      return {
        market,
        prior: summary(prior),
        candidate: summary(next),
        sideChanged: Boolean(prior && next && prior.side !== next.side),
        actionablePromotion: !actionable(prior?.grade) && actionable(next?.grade),
        actionableDemotion: actionable(prior?.grade) && !actionable(next?.grade),
      };
    });
    return {
      matchup: `${payload.game.away.abbreviation}@${payload.game.home.abbreviation}`,
      capturedAt: payload.capturedAt,
      expectedScore: `${payload.decisions.forecast.expectedAwayPoints.toFixed(1)}-${payload.decisions.forecast.expectedHomePoints.toFixed(1)}`,
      markets,
    };
  });
  const marketRows = games.flatMap((game) => game.markets);
  const prior = marketRows.flatMap((row) => row.prior ? [row.prior] : []);
  const candidate = marketRows.flatMap((row) => row.candidate ? [row.candidate] : []);
  console.log(JSON.stringify({
    release: "cfb_current_grade_side_guard_replay_2026_08_27_r16",
    readOnly: true,
    providerCalls: 0,
    writes: 0,
    evidenceRowsRead: rows.length,
    games: games.length,
    markets: games.length * 3,
    prior: counts(prior),
    candidate: counts(candidate),
    priorUnavailable: games.length * 3 - prior.length,
    candidateUnavailable: games.length * 3 - candidate.length,
    actionablePromotions: marketRows.filter((row) => row.actionablePromotion).length,
    actionableDemotions: marketRows.filter((row) => row.actionableDemotion).length,
    changedSides: marketRows.filter((row) => row.sideChanged).length,
    gamesDetail: games,
  }, null, 2));
}

function summary(decision: CfbV1ExactPriceDecision | null): null | Record<string, unknown> {
  return decision ? {
    market: decision.market,
    side: decision.side,
    grade: decision.grade,
    probability: decision.modelProbability,
    marketFairProbability: decision.marketFairProbability,
    edgePercentagePoints: decision.edgePercentagePoints,
    expectedValue: decision.expectedValue,
    sportsbook: decision.evaluatedQuote.sportsbook,
    line: decision.evaluatedQuote.line,
    price: decision.evaluatedQuote.price,
  } : null;
}

function counts(rows: Array<Record<string, unknown>>): Record<CfbV1Grade, number> {
  return Object.fromEntries(GRADES.map((grade) => [grade, rows.filter((row) => row.grade === grade).length])) as Record<CfbV1Grade, number>;
}

function actionable(grade: unknown): boolean { return grade === "Best Angle" || grade === "Lean"; }

function assertPmfSide(
  forecast: ReturnType<typeof getCfbV1Forecast>,
  decision: CfbV1ExactPriceDecision,
  away: string,
  home: string,
): void {
  const homeSpread = decision.market === "spread" && decision.evaluatedQuote.line !== null
    ? decision.side.startsWith(home) ? decision.evaluatedQuote.line : -decision.evaluatedQuote.line
    : 0;
  const probabilities = cfbV1LineProbabilities({
    forecast,
    homeSpread,
    totalLine: decision.market === "total" ? decision.evaluatedQuote.line ?? forecast.expectedTotal : forecast.expectedTotal,
  });
  const selected = decision.market === "moneyline"
    ? probabilities.moneyline.home >= probabilities.moneyline.away ? home : away
    : decision.market === "spread"
      ? probabilities.spread.home >= probabilities.spread.away ? home : away
      : probabilities.total.over >= probabilities.total.under ? "Over" : "Under";
  if (!decision.side.startsWith(selected)) throw new Error(`${forecast.providerGameId} ${decision.market} grade side contradicts PMF.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
