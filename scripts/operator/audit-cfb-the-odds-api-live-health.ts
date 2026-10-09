#!/usr/bin/env tsx

/** SELECT-only audit of live CFB quote coverage and The Odds API continuity. */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readCfbForwardMarketHistory, readCfbForwardWriterEvidence } from "../../lib/services/football/cfbForwardEvidenceStore";
import { selectLatestCfbMemberEvidenceRows } from "../../lib/services/football/cfbMemberFixture";
import { isGameInCfbWeeklyWindow, resolveCfbForwardWindow } from "../../lib/services/football/cfbWeeklyWindow";

loadEnvConfig(process.cwd());

const MARKETS = ["moneyline", "spread", "total"] as const;

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase read credentials are required.");
  const now = new Date().toISOString();
  const client = createClient(url, key, { auth: { persistSession: false } });
  const writer = await readCfbForwardWriterEvidence({ client, season: 2026 });
  const window = resolveCfbForwardWindow({ now, evidence: writer.evidence, advanceWithoutNextEvidence: true });
  const windowRows = writer.evidence.filter((row) => isGameInCfbWeeklyWindow({ scheduledStart: row.gameStartAt }, window));
  const latest = selectLatestCfbMemberEvidenceRows(windowRows, now);
  const marketHistory = await readCfbForwardMarketHistory({
    client,
    season: 2026,
    providerGameIds: latest.map((row) => row.providerGameId),
  });

  const providerRows = latest.filter((row) => row.payload.market.currentBooks.some((book) => book.provider === "theoddsapi"));
  const latestAttempts = [...marketHistory]
    .filter((row) => (row.payload.requestBudget?.theOddsApi ?? 0) > 0)
    .sort((a, b) => Date.parse(attemptedAt(b)) - Date.parse(attemptedAt(a)));
  const attemptInstants = [...new Set(latestAttempts.map(attemptedAt))].slice(0, 12);
  const latestAttempt = latestAttempts[0] ?? null;
  const recentAttempts = attemptInstants.map((capturedAt) => {
    const row = latestAttempts.find((candidate) => attemptedAt(candidate) === capturedAt)!;
    return {
      capturedAt,
      requests: row.payload.requestBudget?.theOddsApi ?? 0,
      currentRequests: row.payload.requestBudget?.theOddsApiCurrent ?? null,
      historicalRequests: row.payload.requestBudget?.theOddsApiHistorical ?? null,
      credits: row.payload.requestBudget?.theOddsApiCredits ?? 0,
      remaining: row.payload.requestBudget?.theOddsApiRemainingCredits ?? null,
    };
  });

  const marketCoverage = Object.fromEntries(MARKETS.map((market) => [market, {
    anyBook: latest.filter((row) => row.payload.market.currentBooks.some((book) => book[market] !== null)).length,
    theOddsApi: providerRows.filter((row) => row.payload.market.currentBooks.some((book) => book.provider === "theoddsapi" && book[market] !== null)).length,
  }]));
  const deficient = latest.flatMap((row) => {
    const missing = MARKETS.filter((market) => !row.payload.market.currentBooks.some((book) => book[market] !== null));
    return missing.length ? [{
      gameId: row.providerGameId,
      matchup: `${row.payload.game.away.abbreviation}@${row.payload.game.home.abbreviation}`,
      startsAt: row.gameStartAt,
      fcsOnly: !row.payload.game.away.fbs && !row.payload.game.home.fbs,
      missing,
      providers: [...new Set(row.payload.market.currentBooks.map((book) => book.provider ?? "balldontlie"))].sort(),
      books: row.payload.market.currentBooks.map((book) => ({
        sportsbook: book.sportsbook,
        provider: book.provider ?? "balldontlie",
        observedAt: book.observedAt,
        markets: MARKETS.filter((market) => book[market] !== null),
      })),
      holds: row.payload.decisions.heldMarkets,
    }] : [];
  });

  const theOddsApiGames = providerRows.map((row) => {
    const allRows = marketHistory
      .filter((candidate) => candidate.providerGameId === row.providerGameId)
      .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
    const providerHistory = allRows.flatMap((candidate) => candidate.payload.market.currentBooks
      .filter((book) => book.provider === "theoddsapi")
      .map((book) => ({
        capturedAt: candidate.capturedAt,
        sportsbook: book.sportsbook,
        observedAt: book.observedAt,
        moneyline: book.moneyline,
        spread: book.spread,
        total: book.total,
      })));
    const distinct = new Set(providerHistory.map((entry) => JSON.stringify({
      sportsbook: entry.sportsbook,
      moneyline: entry.moneyline,
      spread: entry.spread,
      total: entry.total,
    })));
    return {
      gameId: row.providerGameId,
      matchup: `${row.payload.game.away.abbreviation}@${row.payload.game.home.abbreviation}`,
      startsAt: row.gameStartAt,
      latestCapturedAt: row.capturedAt,
      latestProviderBooks: row.payload.market.currentBooks.filter((book) => book.provider === "theoddsapi").map((book) => ({
        sportsbook: book.sportsbook,
        observedAt: book.observedAt,
        markets: MARKETS.filter((market) => book[market] !== null),
      })),
      operationalOpening: row.payload.market.operationalOpening,
      providerObservations: providerHistory.length,
      distinctQuoteStates: distinct.size,
      firstObservedAt: providerHistory.at(0)?.observedAt ?? null,
      lastObservedAt: providerHistory.at(-1)?.observedAt ?? null,
    };
  });
  const nowMs = Date.parse(now);
  const providerBookAges = providerRows.flatMap((row) => row.payload.market.currentBooks
    .filter((book) => book.provider === "theoddsapi")
    .map((book) => (nowMs - Date.parse(book.observedAt)) / 3_600_000)
    .filter(Number.isFinite));

  const { data: refreshRows, error: refreshError } = await client
    .from("data_refresh_log")
    .select("id,refresh_started_at,refresh_completed_at,refresh_status,records_updated,api_calls_made,error_message,scheduled_next_refresh")
    .eq("data_source", "cfb_forward_evidence")
    .order("refresh_started_at", { ascending: false })
    .limit(16);
  if (refreshError) throw new Error(`Refresh-log read failed: ${refreshError.message}`);

  console.log(JSON.stringify({
    readOnly: true,
    now,
    window,
    games: latest.length,
    marketCoverage,
    fullyPricedGames: latest.filter((row) => MARKETS.every((market) => row.payload.market.currentBooks.some((book) => book[market] !== null))).length,
    marketHistory: {
      rows: marketHistory.length,
      games: new Set(marketHistory.map((row) => row.providerGameId)).size,
    },
    deficient,
    theOddsApi: {
      games: providerRows.length,
      latestAttemptAt: latestAttempt?.capturedAt ?? null,
      latestAttemptRequests: latestAttempt?.payload.requestBudget?.theOddsApi ?? 0,
      latestAttemptCredits: latestAttempt?.payload.requestBudget?.theOddsApiCredits ?? 0,
      latestRemainingCredits: latestAttempt?.payload.requestBudget?.theOddsApiRemainingCredits ?? null,
      recentAttempts,
      latestProviderObservationAt: providerRows.flatMap((row) => row.payload.market.currentBooks
        .filter((book) => book.provider === "theoddsapi")
        .map((book) => book.observedAt)).sort().at(-1) ?? null,
      oldestProviderQuoteAgeHours: providerBookAges.length ? Math.max(...providerBookAges) : null,
      newestProviderQuoteAgeHours: providerBookAges.length ? Math.min(...providerBookAges) : null,
      gamesWithOneProviderBook: theOddsApiGames.filter((game) => game.latestProviderBooks.length === 1).length,
      gamesWithMultipleQuoteStates: theOddsApiGames.filter((game) => game.distinctQuoteStates >= 2).length,
      gamesWithOperationalOpening: providerRows.filter((row) => row.payload.market.operationalOpening !== null).length,
      openingProviders: Object.fromEntries([...new Set(providerRows.map((row) => row.payload.market.operationalOpening?.quote.provider ?? "none"))].sort().map((provider) => [
        provider,
        providerRows.filter((row) => (row.payload.market.operationalOpening?.quote.provider ?? "none") === provider).length,
      ])),
      ...(process.argv.includes("--detail") ? { gamesDetail: theOddsApiGames } : {}),
    },
    refreshes: refreshRows ?? [],
  }, null, 2));
}

function attemptedAt(row: { capturedAt: string; payload: { requestBudget?: { theOddsApiCurrentAttemptedAt?: string | null; theOddsApiHistoricalAttemptedAt?: string | null } } }): string {
  return row.payload.requestBudget?.theOddsApiCurrentAttemptedAt ??
    row.payload.requestBudget?.theOddsApiHistoricalAttemptedAt ??
    row.capturedAt;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
