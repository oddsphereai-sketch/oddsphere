#!/usr/bin/env tsx

/** SELECT-only current CFB comparison for the r20 data-quality/reader candidate. */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readCfbForwardEvidence } from "../../lib/services/football/cfbForwardEvidenceStore";
import { buildCfbMemberFixture } from "../../lib/services/football/cfbMemberFixture";
import {
  CFB_FORWARD_EVIDENCE_COLLECTOR_RELEASE,
  CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  CFB_FORWARD_MEMBER_RELEASE,
  type CfbForwardStoredEvidence,
} from "../../lib/services/football/cfbForwardEvidence";
import { activeCfbWeeklyWindow, isGameInCfbWeeklyWindow } from "../../lib/services/football/cfbWeeklyWindow";
import { buildCfbV1DecisionBundle, getCfbV1Forecast, type CfbV1ExactPriceDecision } from "../../lib/services/football/cfbV1Decision";
import { auditFootballCrossMarketCoherence } from "../../lib/services/football/footballCrossMarketCoherence";

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
    const previous = latest.get(row.providerGameId);
    if (!previous || Date.parse(row.capturedAt) > Date.parse(previous.capturedAt)) latest.set(row.providerGameId, row);
  }

  const candidateFixtureRows: CfbForwardStoredEvidence[] = [];
  const games = [...latest.values()].sort((first, second) => first.gameStartAt.localeCompare(second.gameStartAt)).map((row) => {
    const payload = row.payload;
    const candidate = buildCfbV1DecisionBundle({
      providerGameId: payload.game.providerGameId,
      awayTeam: payload.game.away.abbreviation,
      homeTeam: payload.game.home.abbreviation,
      gameStartsAt: payload.game.scheduledStart,
      comparableCurrentBooks: payload.market.currentBooks,
      stage: payload.stage === "t60" && payload.coverage.healthHolds.length === 0 ? "t60_locked" : "unlocked",
      evaluatedAt: payload.capturedAt,
      lockedAt: payload.stage === "t60" && payload.coverage.healthHolds.length === 0 ? payload.capturedAt : null,
      healthHolds: payload.coverage.healthHolds,
      forecast: { ...payload.decisions.forecast, pmf: getCfbV1Forecast(payload.game.providerGameId).pmf },
      contextLines: {
        homeSpread: payload.market.playbookLine?.homeSpread ?? null,
        totalLine: payload.market.playbookLine?.total ?? null,
      },
    });
    const previous = new Map(payload.decisions.evaluatedBets.map((decision) => [decision.market, decision]));
    const current = new Map(candidate.evaluatedBets.map((decision) => [decision.market, decision]));
    const markets = ["moneyline", "spread", "total"] as const;
    const comparisons = markets.map((market) => compareDecision(market, previous.get(market), current.get(market)));
    const primary = payload.outcomeForecast ?? payload.decisions.forecast;
    const { pmf: _pmf, ...publishedForecast } = candidate.forecast;
    void _pmf;
    candidateFixtureRows.push({
      ...row,
      payload: {
        ...payload,
        schemaRelease: CFB_FORWARD_EVIDENCE_SCHEMA_RELEASE,
        collectorRelease: CFB_FORWARD_EVIDENCE_COLLECTOR_RELEASE,
        memberRelease: CFB_FORWARD_MEMBER_RELEASE,
        decisions: {
          ...candidate,
          forecast: publishedForecast,
          marketOutlooks: payload.decisions.marketOutlooks,
        },
      },
    });
    const coherence = auditFootballCrossMarketCoherence({
      sport: "cfb",
      providerGameId: payload.game.providerGameId,
      awayTeam: payload.game.away.abbreviation,
      homeTeam: payload.game.home.abbreviation,
      forecast: {
        expectedAwayPoints: primary.expectedAwayPoints,
        expectedHomePoints: primary.expectedHomePoints,
        representativeScore: primary.representativeScore,
        awayWinProbability: 1 - primary.homeWinProbability,
        homeWinProbability: primary.homeWinProbability,
      },
      decisions: candidate.evaluatedBets,
      unavailableMarkets: candidate.heldMarkets.map((held) => held.market),
    });
    return {
      game: `${payload.game.away.abbreviation}@${payload.game.home.abbreviation}`,
      comparisons,
      previousHeld: payload.decisions.heldMarkets,
      candidateHeld: candidate.heldMarkets,
      coherence,
    };
  });

  const comparisons = games.flatMap((game) => game.comparisons);
  const fixture = buildCfbMemberFixture(candidateFixtureRows, now);
  const hawaii = fixture.snapshot.games.find((game) => game.awayTeam === "HAW" && game.homeTeam === "STAN");
  const sjsu = fixture.snapshot.games.find((game) => game.awayTeam === "SJSU" && game.homeTeam === "USC");
  const previousDecisions = comparisons.filter((row) => row.previous !== null);
  const candidateDecisions = comparisons.filter((row) => row.candidate !== null);
  const tupleChanges = comparisons.filter((row) => row.tupleChanged);
  const promotions = comparisons.filter((row) => gradeRank(row.candidate?.grade) > gradeRank(row.previous?.grade));
  const demotions = comparisons.filter((row) => gradeRank(row.candidate?.grade) < gradeRank(row.previous?.grade));
  console.log(JSON.stringify({
    release: "cfb_review_reconciliation_2026_08_28_r20",
    readOnly: true,
    providerCalls: 0,
    writes: 0,
    evidenceRowsRead: rows.length,
    games: games.length,
    markets: comparisons.length,
    previousExactPriceDecisions: previousDecisions.length,
    candidateExactPriceDecisions: candidateDecisions.length,
    previousGradeCounts: gradeCounts(previousDecisions.map((row) => row.previous!)),
    candidateGradeCounts: gradeCounts(candidateDecisions.map((row) => row.candidate!)),
    tupleChanges: tupleChanges.length,
    promotions: promotions.length,
    demotions: demotions.length,
    coherencePassedGames: games.filter((game) => game.coherence.passed).length,
    memberExplanationChecks: {
      hawaiiPredictionFollowsPrimaryPmf: hawaii?.markets.moneyline.marketPrediction?.label === "STAN" &&
        Math.abs((hawaii.markets.moneyline.marketPrediction.probability ?? 0) - 0.605) < 0.001,
      hawaiiBetSelectionRemainsSeparate: hawaii?.markets.moneyline.pick === "HAW" &&
        (hawaii.markets.moneyline.modelProb ?? 1) < 0.5,
      hawaiiValueNotWinner: hawaii?.markets.moneyline.displayReason?.includes("price-value evaluation, not the predicted winner") ?? false,
      hawaiiCrossMarketExactPriceReason: hawaii?.markets.moneyline.displayReason?.includes("Moneyline and Spread grade differently because they are separate exact-price contracts") ?? false,
      sjsuMoneylineSpecificUnavailableReason: sjsu?.markets.moneyline.displayReason?.includes("no complete target-book quote pair is currently available") ?? false,
    },
    changedRows: tupleChanges,
    heldReasonChanges: games.filter((game) => JSON.stringify(game.previousHeld) !== JSON.stringify(game.candidateHeld)).map((game) => ({
      game: game.game,
      previous: game.previousHeld,
      candidate: game.candidateHeld,
    })),
  }, null, 2));
}

function compareDecision(
  market: "moneyline" | "spread" | "total",
  previous: CfbV1ExactPriceDecision | undefined,
  candidate: CfbV1ExactPriceDecision | undefined,
) {
  const compact = (decision: CfbV1ExactPriceDecision | undefined) => decision ? {
    market: decision.market,
    side: decision.side,
    grade: decision.grade,
    independentProbability: decision.independentProbability,
    calibratedProbability: decision.calibratedProbability,
    modelProbability: decision.modelProbability,
    marketFairProbability: decision.marketFairProbability,
    edgePercentagePoints: decision.edgePercentagePoints,
    expectedValue: decision.expectedValue,
    quote: decision.evaluatedQuote,
  } : null;
  const before = compact(previous);
  const after = compact(candidate);
  return { market, previous: before, candidate: after, tupleChanged: stableStringify(before) !== stableStringify(after) };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function gradeCounts(decisions: Array<{ grade: string }>): Record<string, number> {
  return decisions.reduce<Record<string, number>>((result, decision) => {
    result[decision.grade] = (result[decision.grade] ?? 0) + 1;
    return result;
  }, {});
}

function gradeRank(grade: string | undefined): number {
  return grade === "Best Angle" ? 4 : grade === "Lean" ? 3 : grade === "Watchlist" ? 2 : grade === "No Play" ? 1 : 0;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
