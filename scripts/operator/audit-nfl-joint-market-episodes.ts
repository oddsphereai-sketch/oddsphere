#!/usr/bin/env tsx

/** SELECT-only comparison of exact named-book episodes against stored upcoming NFL games. */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

import { readNflForwardEvidence } from "../../lib/services/football/nflForwardEvidenceStore";
import { readNflOwlsNamedPriceHistory } from "../../lib/services/football/nflOwlsNamedPriceHistory";
import { readNflPlayerPropsCurrentSeasonState } from "../../lib/services/football/nflPlayerPropsCurrentSeasonState";
import {
  readNflJointMarketEpisodesByBook,
  reconcileNflNamedBookEpisodeReads,
  mergeNflJointEpisodeIntoUntouchedAxes,
} from "../../lib/services/football/nflJointMarketEpisodeRead";
import {
  buildNflIndependentScoreBaseForecast,
  getNflV1WeekOneOutcomeForecast,
  nflV1WeekOneLineProbabilities,
  type NflV1WeekOneOutcomeForecast,
} from "../../lib/services/football/nflV1WeekOneOutcome";
import { resolveNflForwardWeek } from "../../lib/services/football/nflForwardWeekSelection";
import { buildNflR6ShadowMoneylineDecision } from "../../lib/services/football/nflR6MoneylineShadow";
import { buildNflV1ActionableGradeBundle } from "../../lib/services/football/nflV1ActionableGradeCandidate";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase read credentials are required.");
  const now = new Date().toISOString();
  const season = 2026;
  const week = resolveNflForwardWeek({ season, configuredWeek: 1, now: new Date(now) });
  const client = createClient(url, key, { auth: { persistSession: false } });
  const [stored, currentSeason] = await Promise.all([
    readNflForwardEvidence({ client, season, week }),
    readNflPlayerPropsCurrentSeasonState({ client, season }),
  ]);
  const gameIdFilter = process.argv.find((value) => value.startsWith("--game-id="))?.slice(10) ?? null;
  const latest = new Map<string, (typeof stored)[number]>();
  for (const row of stored) {
    if (Date.parse(row.gameStartAt) <= Date.parse(now) ||
        (gameIdFilter && row.providerGameId !== gameIdFilter) ||
        !row.payload.exactProviderScoreShadow || !("outcomeForecast" in row.payload)) continue;
    const previous = latest.get(row.providerGameId);
    if (!previous || Date.parse(previous.capturedAt) < Date.parse(row.capturedAt)) {
      latest.set(row.providerGameId, row);
    }
  }
  const gameIds = [...latest.keys()];
  const tape = await readNflOwlsNamedPriceHistory({ client, gameIds, evaluatedAt: now });
  const rows = [...latest.values()].map((row) => {
    if (!("outcomeForecast" in row.payload)) throw new Error("Latest NFL evidence lacks a stored forecast.");
    const storedForecast = row.payload.outcomeForecast;
    const exact = row.payload.exactProviderScoreShadow!;
    const raw = getNflV1WeekOneOutcomeForecast({
      providerGameId: row.providerGameId,
      awayTeam: row.payload.game.away.abbreviation,
      homeTeam: row.payload.game.home.abbreviation,
      weeklyFallback: {
        projectedHomeMargin: exact.expectedHomeMargin,
        marketTotal: exact.expectedTotal,
      },
    });
    const independent = buildNflIndependentScoreBaseForecast({
      baseForecast: raw, independentScore: exact,
    });
    const history = (tape.historyByGame[row.providerGameId] ?? [])
      .flatMap((receipt) => receipt.books);
    const knowledgeAt = currentSeason?.updatedAt ?? row.capturedAt;
    const evaluatedBook = (market: "moneyline" | "spread" | "total") => row.payload.decisions.evaluatedBets
      .find((bet) => bet.market === market)?.evaluatedQuote.sportsbook ?? "";
    const marginExcluded = [...new Set([evaluatedBook("moneyline"), evaluatedBook("spread")].filter(Boolean))];
    const reads = readNflJointMarketEpisodesByBook({
      statisticalForecast: independent,
      statisticalKnowledgeAt: knowledgeAt,
      evaluatedAt: row.capturedAt,
      history,
      excludedFamiliesByMarket: {
        moneyline: marginExcluded,
        spread: marginExcluded,
        total: [evaluatedBook("total")].filter(Boolean),
      },
    });
    const reconciliation = reconcileNflNamedBookEpisodeReads({
      statisticalForecast: independent, reads,
    });
    const gapFill = mergeNflJointEpisodeIntoUntouchedAxes({
      independentForecast: independent,
      incumbentForecast: storedForecast,
      reconciliation,
    });
    const selections = (forecast: NflV1WeekOneOutcomeForecast) => {
      const spreadLine = row.payload.market.current.spread?.homeLine;
      const totalLine = row.payload.market.current.total?.line;
      const lines = spreadLine === undefined || totalLine === undefined ? null
        : nflV1WeekOneLineProbabilities({ forecast, homeSpread: spreadLine, totalLine });
      return {
        moneyline: forecast.homeWinProbability >= forecast.awayWinProbability ? "home" : "away",
        spread: lines ? lines.spread.homeCoverProbability >= lines.spread.awayCoverProbability ? "home" : "away" : null,
        total: lines ? lines.total.overProbability >= lines.total.underProbability ? "over" : "under" : null,
      };
    };
    const summarize = (book: keyof typeof reads) => ({
      status: reads[book].status,
      reason: reads[book].reason,
      constraints: reads[book].constraints,
      margin: reads[book].outcome.expectedHomeScore - reads[book].outcome.expectedAwayScore,
      total: reads[book].outcome.expectedHomeScore + reads[book].outcome.expectedAwayScore,
      homeWinProbability: reads[book].outcome.homeWinProbability,
      selections: selections(reads[book].outcome),
    });
    const shadow = buildNflR6ShadowMoneylineDecision({
      game: row.payload.game,
      opening: row.payload.market.operationalOpening,
      comparableCurrentBooks: row.payload.market.comparableCurrentBooks,
      startersAndDepth: row.payload.startersAndDepth,
      injuries: row.payload.injuries,
      stage: row.stage,
      capturedAt: row.capturedAt,
      t60LagMinutes: row.payload.t60LagMinutes,
      coverageHealthHolds: row.payload.coverage.healthHolds,
      currentSeasonState: currentSeason,
    });
    const gradeFor = (forecast: NflV1WeekOneOutcomeForecast) => buildNflV1ActionableGradeBundle({
      providerGameId: row.providerGameId,
      awayTeam: row.payload.game.away.abbreviation,
      homeTeam: row.payload.game.home.abbreviation,
      gameStartsAt: row.gameStartAt,
      current: row.payload.market.current,
      comparableCurrentBooks: row.payload.market.comparableCurrentBooks,
      shadowMoneyline: shadow,
      outcomeForecast: forecast,
    }).evaluatedBets.map((bet) => ({ market: bet.market, side: bet.side, grade: bet.grade }));
    const storedGrades = row.payload.decisions.evaluatedBets.map((bet) => ({
      market: bet.market, side: bet.side, grade: bet.grade,
    }));
    const independentGrades = gradeFor(independent);
    const baselineGradeParity = JSON.stringify(storedGrades) === JSON.stringify(independentGrades);
    return {
      gameId: row.providerGameId,
      matchup: `${row.payload.game.away.abbreviation}@${row.payload.game.home.abbreviation}`,
      storedAt: row.capturedAt,
      startsAt: row.gameStartAt,
      statisticalKnowledgeAt: knowledgeAt,
      independentMargin: independent.expectedHomeScore - independent.expectedAwayScore,
      independentTotal: independent.expectedHomeScore + independent.expectedAwayScore,
      incumbentMarginPmfChanged: independent.marginDistribution.probabilities.some((value, index) =>
        Math.abs(value - (storedForecast.marginDistribution.probabilities[index] ?? 0)) > 1e-9),
      incumbentTotalPmfChanged: independent.totalDistribution.probabilities.some((value, index) =>
        Math.abs(value - (storedForecast.totalDistribution.probabilities[index] ?? 0)) > 1e-9),
      independentSelections: selections(independent),
      storedFinalMargin: storedForecast.expectedHomeScore - storedForecast.expectedAwayScore,
      storedFinalTotal: storedForecast.expectedHomeScore + storedForecast.expectedAwayScore,
      storedSelections: selections(storedForecast),
      baselineGradeParity,
      storedGrades,
      independentGrades,
      ...(baselineGradeParity ? {
        circaGrades: gradeFor(reads.circa.outcome),
        pinnacleGrades: gradeFor(reads.pinnacle.outcome),
      } : {}),
      storedArbitration: row.payload.fullGameEvidenceInterpretation
        ? {
            runtimeRelease: row.payload.fullGameEvidenceInterpretation.runtimeRelease,
            arbiterRelease: row.payload.fullGameEvidenceInterpretation.arbiterRelease,
            status: row.payload.fullGameEvidenceInterpretation.status,
            sideStory: row.payload.fullGameEvidenceInterpretation.sideStory,
            totalStory: row.payload.fullGameEvidenceInterpretation.totalStory,
            accounting: row.payload.fullGameEvidenceInterpretation.interpretationAccounting,
            roleCounts: row.payload.fullGameEvidenceInterpretation.signalInterpretations
              .reduce<Record<string, number>>((counts, item) => {
                for (const role of item.roles) {
                  const key = `${item.market}:${role}`;
                  counts[key] = (counts[key] ?? 0) + 1;
                }
                return counts;
              }, {}),
          }
        : null,
      circa: summarize("circa"),
      pinnacle: summarize("pinnacle"),
      reconciliation: {
        status: reconciliation.status,
        marginSource: reconciliation.marginSource,
        totalSource: reconciliation.totalSource,
        marginReason: reconciliation.marginReason,
        totalReason: reconciliation.totalReason,
        margin: reconciliation.outcome.expectedHomeScore - reconciliation.outcome.expectedAwayScore,
        total: reconciliation.outcome.expectedHomeScore + reconciliation.outcome.expectedAwayScore,
        selections: selections(reconciliation.outcome),
      },
      gapFill: {
        margin: gapFill.margin,
        total: gapFill.total,
        marginMean: gapFill.outcome.expectedHomeScore - gapFill.outcome.expectedAwayScore,
        totalMean: gapFill.outcome.expectedHomeScore + gapFill.outcome.expectedAwayScore,
        selections: selections(gapFill.outcome),
      },
    };
  });
  console.log(JSON.stringify({
    readOnly: true, writes: 0, providerRequests: 0,
    now, season, week, storedRows: stored.length, upcomingExactGames: rows.length,
    namedPriceRows: tape.rows, rejectedPairs: tape.rejectedPairs, rows,
  }, null, 2));
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
