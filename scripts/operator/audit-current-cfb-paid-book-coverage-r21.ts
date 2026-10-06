#!/usr/bin/env tsx

/** Bounded read-only coverage audit across every configured paid CFB market source. */

import { loadEnvConfig } from "@next/env";
import { PlaybookClient } from "../../lib/providers/playbook/playbookClient";
import { fetchBalldontlieNcaafSlate } from "../../lib/services/football/balldontlieNcaafSlate";
import { matchCfbPlaybookRow, normalizeCfbPlaybookLine } from "../../lib/services/football/cfbPlaybookEvidence";
import { fetchSharpApiNcaafOddsFallback } from "../../lib/services/football/cfbSharpApiOdds";
import { activeCfbWeeklyWindow, eligibleCfbWeeklyGames } from "../../lib/services/football/cfbWeeklyWindow";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const balldontlieApiKey = process.env.BALLDONTLIE_API_KEY;
  const sharpApiKey = process.env.SHARPAPI_KEY;
  const playbookApiKey = process.env.PLAYBOOK_API_KEY;
  if (!balldontlieApiKey || !sharpApiKey || !playbookApiKey) {
    throw new Error("BALLDONTLIE_API_KEY, SHARPAPI_KEY, and PLAYBOOK_API_KEY are required.");
  }
  const now = process.argv.find((value) => value.startsWith("--now="))?.slice(6) ?? new Date().toISOString();
  const matchupArg = process.argv.find((value) => value.startsWith("--matchup="))?.slice(10) ?? "SJSU@USC";
  const matchups = matchupArg.split(",").map((value) => value.trim().toUpperCase()).filter(Boolean);
  const window = activeCfbWeeklyWindow(now);
  const slate = await fetchBalldontlieNcaafSlate({
    season: 2026,
    startDate: window.providerQueryStartDate,
    endDate: window.providerQueryEndDate,
    apiKey: balldontlieApiKey,
  });
  const games = eligibleCfbWeeklyGames(slate.games, window);
  const targets = matchups.map((matchup) => {
    const target = games.find((game) => `${game.away.abbreviation}@${game.home.abbreviation}`.toUpperCase() === matchup);
    if (!target) throw new Error(`Strict ${matchup} game identity was not present in the current weekly slate.`);
    return target;
  });
  const [sharp, playbookResult] = await Promise.all([
    fetchSharpApiNcaafOddsFallback({ games: targets, apiKey: sharpApiKey, maximumRequests: Math.min(64, 8 + targets.length * 5) }),
    new PlaybookClient(playbookApiKey).lines("ncaaf"),
  ]);
  console.log(JSON.stringify({
    release: "cfb_paid_book_coverage_audit_2026_08_28_r21",
    readOnly: true,
    writes: 0,
    configuredProviders: ["balldontlie", "sharpapi", "playbook"],
    requests: {
      balldontlie: slate.providerRequests,
      sharpapi: sharp.requests,
      playbook: 1,
    },
    slate: { games: games.length, markets: games.length * 3 },
    targets: targets.map((target) => {
      const playbookRow = (playbookResult.body.data ?? []).find((row) => matchCfbPlaybookRow(target, row));
      const playbookLine = playbookRow ? normalizeCfbPlaybookLine(playbookRow, now) : null;
      return {
        providerGameId: target.providerGameId,
        matchup: `${target.away.abbreviation}@${target.home.abbreviation}`,
        startsAt: target.scheduledStart,
        balldontlie: summarizeBooks(slate.currentOddsAllBooksByGame[target.providerGameId] ?? []),
        sharpapi: {
          eventId: sharp.eventIdsByGame[target.providerGameId],
          discoveryStatus: sharp.eventDiscoveryStatusByGame[target.providerGameId],
          failure: sharp.failuresByGame[target.providerGameId] ?? null,
          ...summarizeBooks(sharp.displayBooksByGame[target.providerGameId] ?? []),
        },
        playbook: playbookLine,
      };
    }),
  }, null, 2));
}

function summarizeBooks(books: Array<{
  sportsbook: string;
  targetEligible?: boolean;
  moneyline: unknown;
  spread: unknown;
  total: unknown;
  marketQuotes?: Array<{ market: string; side: string; line: number | null; price: number; observedAt: string }>;
}>): Record<string, unknown> {
  return {
    books: books.length,
    names: books.map((book) => book.sportsbook).sort(),
    completePairs: {
      moneyline: books.filter((book) => book.moneyline !== null).map((book) => book.sportsbook).sort(),
      spread: books.filter((book) => book.spread !== null).map((book) => book.sportsbook).sort(),
      total: books.filter((book) => book.total !== null).map((book) => book.sportsbook).sort(),
    },
    oneSidedMainOffers: books.flatMap((book) => (book.marketQuotes ?? [])
      .filter((quote) => quote.market === "moneyline" && book.moneyline === null)
      .map((quote) => ({ sportsbook: book.sportsbook, targetEligible: book.targetEligible !== false, ...quote }))),
  };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
