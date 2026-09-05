#!/usr/bin/env tsx

/** SELECT-only launch audit for the current CFB immutable-evidence wave. */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readCfbForwardEvidence } from "../../lib/services/football/cfbForwardEvidenceStore";
import { activeCfbWeeklyWindow, isGameInCfbWeeklyWindow } from "../../lib/services/football/cfbWeeklyWindow";
import type { CfbV1Market } from "../../lib/services/football/cfbV1Decision";

const MARKETS: CfbV1Market[] = ["moneyline", "spread", "total"];

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
  const windowRows = rows.filter((row) => isGameInCfbWeeklyWindow({ scheduledStart: row.gameStartAt }, window));
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of windowRows) {
    const previous = latest.get(row.providerGameId);
    if (!previous || Date.parse(row.capturedAt) > Date.parse(previous.capturedAt)) latest.set(row.providerGameId, row);
  }

  const games = [...latest.values()]
    .sort((first, second) => first.gameStartAt.localeCompare(second.gameStartAt))
    .map((row) => {
      const payload = row.payload;
      const decisions = new Map(payload.decisions.evaluatedBets.map((decision) => [decision.market, decision]));
      const held = new Map(payload.decisions.heldMarkets.map((market) => [market.market, market.reason]));
      return {
        providerGameId: row.providerGameId,
        matchup: `${payload.game.away.abbreviation}@${payload.game.home.abbreviation}`,
        capturedAt: row.capturedAt,
        releases: {
          schema: payload.schemaRelease,
          collector: payload.collectorRelease,
          member: payload.memberRelease,
          decision: payload.decisions.decisionRelease,
        },
        expectedScore: {
          away: payload.decisions.forecast.expectedAwayPoints,
          home: payload.decisions.forecast.expectedHomePoints,
          representative: payload.decisions.forecast.representativeScore,
        },
        coverage: payload.coverage,
        sharpEventRelease: payload.market.sharpApiOddsRelease,
        exactBooks: payload.market.currentBooks.map((book) => ({
          sportsbook: book.sportsbook,
          provider: book.provider ?? "balldontlie",
          targetEligible: book.targetEligible !== false,
          observedAt: book.observedAt,
          moneyline: book.moneyline,
          spread: book.spread,
          total: book.total,
        })),
        markets: MARKETS.map((market) => {
          const decision = decisions.get(market);
          return decision ? {
            market,
            status: "evaluated",
            side: decision.side,
            grade: decision.grade,
            independentProbability: decision.independentProbability,
            calibratedProbability: decision.calibratedProbability,
            modelProbability: decision.modelProbability,
            marketFairProbability: decision.marketFairProbability,
            edgePercentagePoints: decision.edgePercentagePoints,
            expectedValue: decision.expectedValue,
            quote: decision.evaluatedQuote,
            consensus: decision.consensus,
          } : {
            market,
            status: "unavailable",
            reason: held.get(market) ?? "missing_market_decision",
          };
        }),
      };
    });

  const sjsuHistory = windowRows
    .filter((row) => row.providerGameId === "457612")
    .sort((first, second) => Date.parse(first.capturedAt) - Date.parse(second.capturedAt))
    .map((row) => ({
      capturedAt: row.capturedAt,
      stage: row.stage,
      schemaRelease: row.payload.schemaRelease,
      memberRelease: row.payload.memberRelease,
      decisionRelease: row.payload.decisions.decisionRelease,
      sharpEventRelease: row.payload.market.sharpApiOddsRelease,
      books: row.payload.market.currentBooks.map((book) => ({
        sportsbook: book.sportsbook,
        provider: book.provider ?? "balldontlie",
        targetEligible: book.targetEligible !== false,
        observedAt: book.observedAt,
        markets: MARKETS.filter((market) => book[market] !== null),
      })),
      evaluated: row.payload.decisions.evaluatedBets.map((decision) => ({
        market: decision.market,
        side: decision.side,
        grade: decision.grade,
        quote: decision.evaluatedQuote,
      })),
      held: row.payload.decisions.heldMarkets,
    }));

  const report = {
    release: "cfb_launch_readiness_select_audit_2026_08_28_r1",
    readOnly: true,
    providerCalls: 0,
    writes: 0,
    evidenceRowsRead: rows.length,
    currentWindowRows: windowRows.length,
    games: games.length,
    markets: games.length * MARKETS.length,
    gamesDetail: games,
    sjsuHistory,
  };
  const latestRows = [...latest.values()];
  const marketSummaries = games.flatMap((game) => game.markets);
  const unavailableReasons = marketSummaries.reduce<Record<string, number>>((counts, market) => {
      if (market.status !== "unavailable") return counts;
      const reason = market.reason ?? "unknown";
      counts[reason] = (counts[reason] ?? 0) + 1;
      return counts;
    }, {});
  const summary = {
    release: report.release,
    readOnly: true,
    providerCalls: 0,
    writes: 0,
    evidenceRowsRead: rows.length,
    currentWindowRows: windowRows.length,
    games: games.length,
    markets: games.length * MARKETS.length,
    stages: Object.fromEntries(["opening", "unlocked", "t60"].map((stage) => [
      stage,
      latestRows.filter((row) => row.stage === stage).length,
    ])),
    evaluatedMarkets: marketSummaries.filter((market) => market.status === "evaluated").length,
    unavailableMarkets: marketSummaries.filter((market) => market.status === "unavailable").length,
    unavailableReasons,
    lockExceptions: games.flatMap((game) => game.markets
      .filter((market) => market.status === "unavailable" && market.reason === "t60_capture_late")
      .map((market) => ({ matchup: game.matchup, market: market.market, reason: market.reason }))),
    releaseFamilies: Object.fromEntries([...new Set(latestRows.map((row) => row.payload.memberRelease))].sort().map((release) => [
      release,
      latestRows.filter((row) => row.payload.memberRelease === release).length,
    ])),
    coverage: {
      currentOdds: latestRows.filter((row) => row.payload.coverage.currentOdds).length,
      targetExcludedConsensusReady: latestRows.filter((row) => row.payload.coverage.targetExcludedConsensusReady).length,
      playbookSplits: latestRows.filter((row) => row.payload.coverage.playbookSplits).length,
      sharpApiSplits: latestRows.filter((row) => row.payload.coverage.sharpApiSplits).length,
      weather: latestRows.filter((row) => row.payload.coverage.weather).length,
      activeQuarterbacks: latestRows.filter((row) => row.payload.coverage.activeQuarterbacks).length,
      healthHolds: latestRows.filter((row) => row.payload.coverage.healthHolds.length > 0).length,
    },
  };

  console.log(JSON.stringify(process.argv.includes("--summary") ? summary : report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
