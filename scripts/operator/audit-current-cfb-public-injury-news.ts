#!/usr/bin/env tsx

/** Live-provider, zero-write audit of the bounded public CFB injury-news fallback. */

import { fetchBalldontlieNcaafSlate } from "../../lib/services/football/balldontlieNcaafSlate";
import { fetchCfbEspnInjuryNewsAvailability } from "../../lib/services/football/cfbEspnInjuryNewsAvailability";
import { activeCfbWeeklyWindow, eligibleCfbWeeklyGames } from "../../lib/services/football/cfbWeeklyWindow";

async function main(): Promise<void> {
  const apiKey = process.env.BALLDONTLIE_API_KEY;
  if (!apiKey) throw new Error("BALLDONTLIE_API_KEY is required for the current CFB slate.");
  const now = new Date().toISOString();
  const window = activeCfbWeeklyWindow(now);
  const slate = await fetchBalldontlieNcaafSlate({
    season: Number(window.boardStartDate.slice(0, 4)),
    startDate: window.providerQueryStartDate,
    endDate: window.providerQueryEndDate,
    apiKey,
  });
  const games = eligibleCfbWeeklyGames(slate.games, window);
  const result = await fetchCfbEspnInjuryNewsAvailability({ games, capturedAt: now });
  const reports = Object.values(result.reportsByGame).map((report) => ({
    eventId: report.eventId,
    matchup: `${report.awayTeam}@${report.homeTeam}`,
    source: report.sourceLabel,
    reportUpdatedAt: report.reportUpdatedAt,
    players: report.teams.flatMap((team) => team.players.map((player) => ({
      team: team.abbreviation,
      name: player.name,
      position: player.position,
      status: player.status,
      reportedAt: player.reportedAt,
    }))),
  }));
  console.log(JSON.stringify({
    audit: "cfb_public_injury_news_live_zero_write_2026_10_21_r1",
    apply: false,
    writes: 0,
    now,
    window,
    slateGames: games.length,
    slateProviderRequests: slate.providerRequests,
    newsRequests: result.requests,
    articlesRead: result.articlesRead,
    acceptedPlayers: result.acceptedPlayers,
    matchedGames: reports.length,
    reports,
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
