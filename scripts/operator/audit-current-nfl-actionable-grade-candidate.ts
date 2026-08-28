/** SELECT-only Week 1 replay for the NFL actionable-grade candidate. */

import { createClient } from "@supabase/supabase-js";
import {
  NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  type NflForwardEvidencePayload,
  type NflForwardStoredEvidence,
} from "../../lib/services/football/nflForwardEvidence";
import { readNflForwardEvidence } from "../../lib/services/football/nflForwardEvidenceStore";
import {
  buildNflV1ActionableGradeBundle,
  NFL_V1_ACTIONABLE_GRADE_DECISION_RELEASE,
  NFL_V1_ACTIONABLE_GRADE_POLICY_RELEASE,
} from "../../lib/services/football/nflV1ActionableGradeCandidate";
import { buildNflR6ShadowMoneylineDecision } from "../../lib/services/football/nflR6MoneylineShadow";
import { buildNflWeekOneHeldMemberFixture } from "../../lib/services/football/nflWeekOneHeldMemberFixture";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Supabase read credentials are required.");
  const client = createClient(url, serviceKey, { auth: { persistSession: false } });
  const stored = await readNflForwardEvidence({ client, season: 2026, week: 1 });
  const latest = latestRows(stored);
  if (latest.length !== 16) throw new Error(`Expected 16 Week 1 games; received ${latest.length}.`);

  const candidateFixtureRows: NflForwardStoredEvidence[] = [];
  const rows = latest.flatMap((row) => {
    if (row.payload.schemaRelease !== NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE) {
      throw new Error(`Latest NFL row ${row.id} is not the current evidence schema.`);
    }
    const payload = row.payload as NflForwardEvidencePayload;
    const shadow = payload.decisions.shadowEvaluatedBets?.[0] ?? buildNflR6ShadowMoneylineDecision({
      game: payload.game,
      opening: payload.market.operationalOpening,
      comparableCurrentBooks: payload.market.comparableCurrentBooks,
      startersAndDepth: payload.startersAndDepth,
      injuries: payload.injuries,
      stage: payload.stage,
      capturedAt: payload.capturedAt,
      t60LagMinutes: payload.t60LagMinutes,
      coverageHealthHolds: payload.coverage.healthHolds,
    });
    const candidate = buildNflV1ActionableGradeBundle({
      providerGameId: payload.game.providerGameId,
      awayTeam: payload.game.away.abbreviation,
      homeTeam: payload.game.home.abbreviation,
      gameStartsAt: payload.game.scheduledStart,
      current: payload.market.current,
      comparableCurrentBooks: payload.market.comparableCurrentBooks,
      shadowMoneyline: shadow,
    });
    if (!candidate.publicationEnabled || candidate.trackingEnabled ||
        candidate.evaluatedBets.length !== 3) {
      throw new Error(`NFL production bundle boundary failed for ${row.providerGameId}.`);
    }
    candidateFixtureRows.push({
      ...row,
      payload: {
        ...payload,
        decisions: {
          ...candidate,
          shadowEvaluatedBets: shadow ? [shadow] : [],
        },
      },
    });
    const baseline = new Map(payload.decisions.evaluatedBets.map((decision) => [decision.market, decision]));
    return candidate.evaluatedBets.map((decision) => {
      const previous = baseline.get(decision.market);
      return {
      game: `${payload.game.away.abbreviation}@${payload.game.home.abbreviation}`,
      providerGameId: row.providerGameId,
      market: decision.market,
      side: decision.side,
      probability: decision.modelProbability,
      marketFairProbability: decision.marketFairProbability,
      edgePercentagePoints: 100 * (decision.modelProbability - decision.marketFairProbability),
      expectedValue: decision.expectedValue,
      sportsbook: decision.evaluatedQuote.sportsbook,
      line: decision.evaluatedQuote.line,
      price: decision.evaluatedQuote.price,
      grade: decision.grade,
      previousGrade: previous?.grade ?? "Held",
      previousSide: previous?.side ?? null,
      previousProbability: previous?.modelProbability ?? null,
      previousMarketFairProbability: previous?.marketFairProbability ?? null,
      previousExpectedValue: previous?.expectedValue ?? null,
      previousQuote: previous?.evaluatedQuote ?? null,
      gradeChanged: decision.grade !== previous?.grade,
      sideChanged: decision.side !== previous?.side,
      probabilityChanged: Math.abs(decision.modelProbability - (previous?.modelProbability ?? decision.modelProbability)) > 1e-12,
      marketFairProbabilityChanged: Math.abs(decision.marketFairProbability - (previous?.marketFairProbability ?? decision.marketFairProbability)) > 1e-12,
      expectedValueChanged: Math.abs(decision.expectedValue - (previous?.expectedValue ?? decision.expectedValue)) > 1e-12,
      quoteChanged: !previous || decision.evaluatedQuote.sportsbook !== previous.evaluatedQuote.sportsbook ||
        decision.evaluatedQuote.line !== previous.evaluatedQuote.line ||
        decision.evaluatedQuote.price !== previous.evaluatedQuote.price ||
        decision.evaluatedQuote.observedAt !== previous.evaluatedQuote.observedAt,
      evaluatedAt: decision.evaluatedAt,
    };
    });
  });
  if (rows.length !== 48) throw new Error(`NFL candidate produced ${rows.length}/48 decisions.`);
  const previousGrades = count(rows.map((row) => row.previousGrade));
  const grades = count(rows.map((row) => row.grade));
  const previousByMarket = Object.fromEntries(["moneyline", "spread", "total"].map((market) => [
    market,
    count(rows.filter((row) => row.market === market).map((row) => row.previousGrade)),
  ]));
  const byMarket = Object.fromEntries(["moneyline", "spread", "total"].map((market) => [
    market,
    count(rows.filter((row) => row.market === market).map((row) => row.grade)),
  ]));
  const promotions = rows.filter((row) => rank(row.grade) > rank(row.previousGrade));
  const demotions = rows.filter((row) => rank(row.grade) < rank(row.previousGrade));
  const fixture = buildNflWeekOneHeldMemberFixture(candidateFixtureRows);
  const primaryPredictionChecks = fixture.snapshot.games.map((game) => {
    const predictedWinner = game.footballProjection!.homeWinProbability >= game.footballProjection!.awayWinProbability
      ? game.homeTeam
      : game.awayTeam;
    return {
      game: `${game.awayTeam}@${game.homeTeam}`,
      scoreWinner: game.projected.home > game.projected.away ? game.homeTeam : game.awayTeam,
      predictedWinner,
      moneylinePrediction: game.markets.moneyline.marketPrediction?.label ?? null,
    };
  });
  const predictionBetSelectionDifferences = fixture.snapshot.games.flatMap((game) => ([
    ["moneyline", game.markets.moneyline] as const,
    ["spread", game.markets.first_inning] as const,
    ["total", game.markets.total] as const,
  ]).flatMap(([market, value]) => value.marketPrediction?.label && value.marketPrediction.label !== value.pick
    ? [{ game: `${game.awayTeam}@${game.homeTeam}`, market, prediction: value.marketPrediction.label, evaluatedBetSide: value.pick, grade: value.verdict.label }]
    : []));
  console.log(JSON.stringify({
    readOnly: true,
    productionRelease: true,
    sourceRowsRead: stored.length,
    latestGames: latest.length,
    sourceCapturedAt: latest[0]!.capturedAt,
    decisionRelease: NFL_V1_ACTIONABLE_GRADE_DECISION_RELEASE,
    policyRelease: NFL_V1_ACTIONABLE_GRADE_POLICY_RELEASE,
    previousGrades,
    grades,
    previousByMarket,
    byMarket,
    promotions: promotions.length,
    demotions: demotions.length,
    netActionableChange: rows.filter((row) => rank(row.grade) >= rank("Lean")).length -
      rows.filter((row) => rank(row.previousGrade) >= rank("Lean")).length,
    sideChanges: rows.filter((row) => row.sideChanged).length,
    probabilityChanges: rows.filter((row) => row.probabilityChanged).length,
    fairProbabilityChanges: rows.filter((row) => row.marketFairProbabilityChanged).length,
    expectedValueChanges: rows.filter((row) => row.expectedValueChanged).length,
    quoteChanges: rows.filter((row) => row.quoteChanged).length,
    primaryPredictionCoherenceGames: primaryPredictionChecks.filter((row) =>
      row.scoreWinner === row.predictedWinner && row.predictedWinner === row.moneylinePrediction).length,
    predictionMarkets: fixture.snapshot.games.reduce((sum, game) => sum +
      [game.markets.moneyline, game.markets.first_inning, game.markets.total]
        .filter((market) => market.marketPrediction?.status === "available").length, 0),
    predictionBetSelectionDifferences,
    changedRows: [...promotions, ...demotions],
    tupleChangedRows: rows.filter((row) => row.sideChanged || row.probabilityChanged ||
      row.marketFairProbabilityChanged || row.expectedValueChanged || row.quoteChanged),
    sideChangedRows: rows.filter((row) => row.sideChanged),
    probabilityChangedRows: rows.filter((row) => row.probabilityChanged),
    ...(process.argv.includes("--summary") ? {} : { rows }),
  }, null, 2));
}

function count(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((result, value) => {
    result[value] = (result[value] ?? 0) + 1;
    return result;
  }, {});
}

function rank(grade: string): number {
  return grade === "Best Angle" ? 4 : grade === "Lean" ? 3 : grade === "Watchlist" ? 2 :
    grade === "No Play" ? 1 : 0;
}

function latestRows(rows: NflForwardStoredEvidence[]): NflForwardStoredEvidence[] {
  const latest = new Map<string, NflForwardStoredEvidence>();
  for (const row of rows) {
    const previous = latest.get(row.providerGameId);
    if (!previous || Date.parse(row.capturedAt) > Date.parse(previous.capturedAt)) {
      latest.set(row.providerGameId, row);
    }
  }
  return [...latest.values()].sort((first, second) =>
    first.payload.game.scheduledStart.localeCompare(second.payload.game.scheduledStart));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
