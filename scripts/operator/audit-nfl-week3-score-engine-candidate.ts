/** Read-only current-board audit for the bounded NFL score-engine candidate. */

import { supabase } from "@/lib/db/supabase";
import { readNflForwardEvidence } from "@/lib/services/football/nflForwardEvidenceStore";
import { readNflPlayerPropsCurrentSeasonState } from "@/lib/services/football/nflPlayerPropsCurrentSeasonState";
import { buildNflWeeklyPossessionMargin } from "@/lib/services/football/nflWeeklyPossessionMargin";

async function main() {
  const summaryOnly = process.argv.includes("--summary");
  const state = await readNflPlayerPropsCurrentSeasonState({ client: supabase, season: 2026 });
  if (!state || state.completeThroughWeek < 2) throw new Error("NFL current-season team state is incomplete through Week 2.");
  const evidence = await readNflForwardEvidence({ client: supabase, season: 2026, week: 3 });
  const latest = new Map<string, (typeof evidence)[number]>();
  for (const row of evidence) {
    const previous = latest.get(row.providerGameId);
    if (!previous || Date.parse(row.capturedAt) > Date.parse(previous.capturedAt)) latest.set(row.providerGameId, row);
  }
  const rows = [...latest.values()].flatMap((row) => {
    const payload = row.payload;
    if (!("outcomeForecast" in payload) || !payload.market.current.spread || !payload.market.current.total) return [];
    const marketMargin = -payload.market.current.spread.homeLine;
    const incumbentMargin = payload.outcomeForecast.expectedHomeScore - payload.outcomeForecast.expectedAwayScore;
    const incumbentTotal = payload.outcomeForecast.expectedHomeScore + payload.outcomeForecast.expectedAwayScore;
    const possession = buildNflWeeklyPossessionMargin({
      currentSeasonState: state,
      homeTeam: payload.game.home.abbreviation,
      awayTeam: payload.game.away.abbreviation,
      marketHomeMargin: marketMargin,
    });
    const marketEvidence = payload.outcomeForecast.marketEvidence;
    const candidateMargin = possession.calibratedHomeMargin + (marketEvidence?.appliedHomeMarginShiftPoints ?? 0);
    const candidateTotal = marketEvidence
      ? marketEvidence.calibratedCore.calibratedTotal + marketEvidence.movement.totalShiftPoints
      : incumbentTotal;
    const incumbent = {
      moneyline: incumbentMargin >= 0 ? "home" : "away",
      spread: incumbentMargin >= marketMargin ? "home" : "away",
      total: incumbentTotal >= payload.market.current.total.line ? "over" : "under",
    } as const;
    const candidate = {
      moneyline: candidateMargin >= 0 ? "home" : "away",
      spread: candidateMargin >= marketMargin ? "home" : "away",
      total: candidateTotal >= payload.market.current.total.line ? "over" : "under",
    } as const;
    return [{
      gameId: row.providerGameId,
      matchup: `${payload.game.away.abbreviation}@${payload.game.home.abbreviation}`,
      stage: row.stage,
      capturedAt: row.capturedAt,
      marketMargin,
      marketTotal: payload.market.current.total.line,
      incumbentMargin,
      incumbentTotal,
      candidateMargin,
      candidateTotal,
      incumbent,
      candidate,
      changes: {
        moneyline: incumbent.moneyline !== candidate.moneyline,
        spread: incumbent.spread !== candidate.spread,
        total: incumbent.total !== candidate.total,
      },
    }];
  }).sort((a, b) => a.matchup.localeCompare(b.matchup));
  const count = (market: "moneyline" | "spread" | "total", side: string, version: "incumbent" | "candidate") =>
    rows.filter((row) => row[version][market] === side).length;
  console.log(JSON.stringify({
    readOnly: true,
    productionChanged: false,
    games: rows.length,
    completeThroughWeek: state.completeThroughWeek,
    directionCounts: {
      incumbent: {
        moneyline: { home: count("moneyline", "home", "incumbent"), away: count("moneyline", "away", "incumbent") },
        spread: { home: count("spread", "home", "incumbent"), away: count("spread", "away", "incumbent") },
        total: { over: count("total", "over", "incumbent"), under: count("total", "under", "incumbent") },
      },
      candidate: {
        moneyline: { home: count("moneyline", "home", "candidate"), away: count("moneyline", "away", "candidate") },
        spread: { home: count("spread", "home", "candidate"), away: count("spread", "away", "candidate") },
        total: { over: count("total", "over", "candidate"), under: count("total", "under", "candidate") },
      },
    },
    sideChanges: {
      moneyline: rows.filter((row) => row.changes.moneyline).length,
      spread: rows.filter((row) => row.changes.spread).length,
      total: rows.filter((row) => row.changes.total).length,
    },
    ...(summaryOnly ? {} : { rows }),
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
