#!/usr/bin/env tsx

/** Read-only current-board rehearsal for the frozen CFB winner coordinator. */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import {
  fetchCfbCurrentAdvancedState,
  readCfbCurrentAdvancedState,
} from "../../lib/services/football/cfbCurrentAdvancedState";
import {
  readCfbForwardMarketHistory,
  readCfbForwardWriterEvidence,
} from "../../lib/services/football/cfbForwardEvidenceStore";
import {
  applyCfbFinalWinnerCoordinator,
  CFB_FINAL_WINNER_COORDINATOR_RELEASE,
} from "../../lib/services/football/cfbFinalWinnerCoordinator";
import { buildCfbV1DecisionBundle } from "../../lib/services/football/cfbV1Decision";
import {
  applyCfbMarketSharpAwareGrades,
  summarizePmf,
  tiltCfbMarginWithinTotals,
  tiltCfbTotalWithinMargins,
} from "../../lib/services/football/cfbMarketSharpAwareShadow";
import { applyCfbVerifiedAvailabilityGradeCap } from "../../lib/services/football/cfbVerifiedAvailability";
import { currentCfbMovementContextBook } from "../../lib/services/football/cfbForwardEvidenceWriter";
import { getCfbV1WeeklyForecasts } from "../../lib/services/football/cfbV1WeeklyForecast";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase read credentials are required.");
  const now = process.argv.find((value) => value.startsWith("--now="))?.slice(6) ?? new Date().toISOString();
  const client = createClient(url, key, { auth: { persistSession: false } });
  const [{ evidence }, storedAdvancedState] = await Promise.all([
    readCfbForwardWriterEvidence({ client, season: 2026 }),
    readCfbCurrentAdvancedState({ client, season: 2026 }),
  ]);
  const advancedState = storedAdvancedState ?? await fetchCfbCurrentAdvancedState({ season: 2026, now });
  const latest = new Map<string, (typeof evidence)[number]>();
  for (const row of evidence) {
    if (Date.parse(row.gameStartAt) <= Date.parse(now) || Date.parse(row.capturedAt) > Date.parse(now)) continue;
    const incumbent = latest.get(row.providerGameId);
    if (!incumbent || Date.parse(row.capturedAt) > Date.parse(incumbent.capturedAt)) latest.set(row.providerGameId, row);
  }
  const rows = [...latest.values()].sort((first, second) => first.gameStartAt.localeCompare(second.gameStartAt));
  const weeklyForecasts = getCfbV1WeeklyForecasts({
    games: rows.map((row) => row.payload.game),
    advancedGames: advancedState.games,
  });
  const histories = await readCfbForwardMarketHistory({
    client,
    season: 2026,
    providerGameIds: rows.map((row) => row.providerGameId),
  });
  const byGame = new Map<string, typeof histories>();
  for (const history of histories) byGame.set(history.providerGameId, [...(byGame.get(history.providerGameId) ?? []), history]);
  const games = rows.flatMap((row) => {
    const capture = row.payload.contextualEvidenceCapture;
    if (!capture) return [];
    const weekly = weeklyForecasts.get(row.providerGameId)?.forecast;
    if (!weekly) return [];
    const published = row.payload.decisions.forecast;
    const marginPmf = tiltCfbMarginWithinTotals(
      weekly.pmf,
      published.expectedMarginHome - weekly.expectedMarginHome,
    );
    const marginSummary = summarizePmf(marginPmf);
    const alignedPmf = tiltCfbTotalWithinMargins(
      marginPmf,
      published.expectedTotal - marginSummary.expectedTotal,
    );
    const alignedForecast = { ...weekly, ...summarizePmf(alignedPmf), pmf: alignedPmf };
    const evaluatedSportsbookByMarket = Object.fromEntries(row.payload.decisions.evaluatedBets.map((decision) => [
      decision.market,
      decision.evaluatedQuote.sportsbook,
    ]));
    const priorHistories = (byGame.get(row.providerGameId) ?? [])
      .filter((history) => Date.parse(history.capturedAt) < Date.parse(row.capturedAt));
    const coordinator = applyCfbFinalWinnerCoordinator({
      forecast: alignedForecast,
      game: row.payload.game,
      advancedGames: advancedState.games,
      currentBooks: row.payload.market.currentBooks,
      evaluatedSportsbookByMarket,
      histories: priorHistories,
      currentObservation: {
        capturedAt: row.capturedAt,
        markets: {
          moneyline: {
            families: capture.markets.moneyline.families,
            targetExcludedFamilies: capture.markets.moneyline.targetExcludedFamilies,
          },
          spread: {
            families: capture.markets.spread.families,
            targetExcludedFamilies: capture.markets.spread.targetExcludedFamilies,
          },
          total: {
            families: capture.markets.total.families,
            targetExcludedFamilies: capture.markets.total.targetExcludedFamilies,
          },
        },
        playbookSplits: row.payload.market.playbookSplits,
        sharpApiSplits: row.payload.market.sharpApiSplits ?? [],
      },
    });
    const bundleFor = (forecast: typeof alignedForecast) => applyCfbVerifiedAvailabilityGradeCap({
      bundle: applyCfbMarketSharpAwareGrades({
        bundle: buildCfbV1DecisionBundle({
          providerGameId: row.providerGameId,
          awayTeam: row.payload.game.away.abbreviation,
          homeTeam: row.payload.game.home.abbreviation,
          gameStartsAt: row.gameStartAt,
          comparableCurrentBooks: row.payload.market.currentBooks,
          stage: row.stage === "t60" && row.payload.coverage.healthHolds.length === 0 ? "t60_locked" : "unlocked",
          evaluatedAt: row.capturedAt,
          lockedAt: row.stage === "t60" && row.payload.coverage.healthHolds.length === 0 ? row.capturedAt : null,
          healthHolds: row.payload.coverage.healthHolds,
          forecast,
          contextLines: {
            homeSpread: row.payload.market.playbookLine?.homeSpread ?? null,
            totalLine: row.payload.market.playbookLine?.total ?? null,
          },
          fixedEvaluatedSportsbookByMarket: evaluatedSportsbookByMarket,
        }),
        homeTeam: row.payload.game.home.abbreviation,
        sharpSplits: row.payload.market.sharpApiSplits ?? [],
        playbookLine: row.payload.market.playbookLine,
        publicSplits: row.payload.market.playbookSplits,
        operationalOpening: row.payload.market.operationalOpening,
        current: currentCfbMovementContextBook(
          row.payload.market.currentBooks,
          row.payload.market.operationalOpening,
        ),
      }),
      availability: row.payload.availability.verifiedQuarterback ?? null,
    });
    const baselineBundle = bundleFor(alignedForecast);
    const candidateBundle = bundleFor(coordinator.forecast);
    const baselineParity = (["moneyline", "spread", "total"] as const).every((market) => {
      const stored = row.payload.decisions.evaluatedBets.find((decision) => decision.market === market) ?? null;
      const rebuilt = baselineBundle.evaluatedBets.find((decision) => decision.market === market) ?? null;
      return (stored?.side ?? null) === (rebuilt?.side ?? null) &&
        (stored?.grade ?? "Held") === (rebuilt?.grade ?? "Held");
    });
    const decisionChanges = (["moneyline", "spread", "total"] as const).flatMap((market) => {
      const before = baselineBundle.evaluatedBets.find((decision) => decision.market === market) ?? null;
      const after = candidateBundle.evaluatedBets.find((decision) => decision.market === market) ?? null;
      if ((before?.side ?? null) === (after?.side ?? null) && (before?.grade ?? "Held") === (after?.grade ?? "Held")) return [];
      return [{
        market,
        beforeSide: before?.side ?? null,
        afterSide: after?.side ?? null,
        beforeGrade: before?.grade ?? "Held",
        afterGrade: after?.grade ?? "Held",
      }];
    });
    return [{
      providerGameId: row.providerGameId,
      matchup: `${row.payload.game.away.abbreviation}@${row.payload.game.home.abbreviation}`,
      startsAt: row.gameStartAt,
      applied: coordinator.applied,
      reason: coordinator.reason,
      before: {
        away: row.payload.decisions.forecast.expectedAwayPoints,
        home: row.payload.decisions.forecast.expectedHomePoints,
        marginHome: row.payload.decisions.forecast.expectedMarginHome,
      },
      after: {
        away: coordinator.forecast.expectedAwayPoints,
        home: coordinator.forecast.expectedHomePoints,
        marginHome: coordinator.forecast.expectedMarginHome,
        representative: coordinator.forecast.representativeScore,
      },
      authority: coordinator.authority,
      learnedHomeWinProbability: coordinator.learnedHomeWinProbability,
      combinedHomeWinProbability: coordinator.combinedHomeWinProbability,
      baselineParity,
      decisionChanges,
    }];
  });
  const interventions = games.filter((game) => game.applied);
  const actionable = (grade: string) => grade === "Best Angle" || grade === "Lean";
  const decisionChanges = games.flatMap((game) => game.decisionChanges.map((change) => ({ ...change, matchup: game.matchup })));
  console.log(JSON.stringify({
    release: CFB_FINAL_WINNER_COORDINATOR_RELEASE,
    mode: "current_board_read_only_zero_writes",
    capturedAt: now,
    boardGames: games.length,
    exactBaselineReplayGames: games.filter((game) => game.baselineParity).length,
    interventions: interventions.length,
    winnerSideChanges: interventions.length,
    actionablePromotions: decisionChanges.filter((change) => !actionable(change.beforeGrade) && actionable(change.afterGrade)).length,
    actionableDemotions: decisionChanges.filter((change) => actionable(change.beforeGrade) && !actionable(change.afterGrade)).length,
    decisionChanges,
    games: interventions,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
