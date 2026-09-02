/** SELECT-only Week 1 replay for the NFL actionable-grade candidate. */

import { createClient } from "@supabase/supabase-js";
import {
  NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
  type NflForwardEvidencePayload,
  type NflForwardStoredEvidence,
} from "../../lib/services/football/nflForwardEvidence";
import {
  readNflForwardEvidence,
  readPreviousNflForwardEvidence,
} from "../../lib/services/football/nflForwardEvidenceStore";
import {
  buildNflV1ActionableGradeBundle,
  NFL_V1_ACTIONABLE_GRADE_DECISION_RELEASE,
  NFL_V1_ACTIONABLE_GRADE_POLICY_RELEASE,
} from "../../lib/services/football/nflV1ActionableGradeCandidate";
import { buildNflR6ShadowMoneylineDecision } from "../../lib/services/football/nflR6MoneylineShadow";
import { buildNflWeekOneHeldMemberFixture } from "../../lib/services/football/nflWeekOneHeldMemberFixture";
import {
  buildNflMarketEvidenceOutcomeForecast,
  getNflV1WeekOneOutcomeForecast,
} from "../../lib/services/football/nflV1WeekOneOutcome";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Supabase read credentials are required.");
  const client = createClient(url, serviceKey, { auth: { persistSession: false } });
  const stored = [
    ...await readPreviousNflForwardEvidence({ client, season: 2026, week: 1 }),
    ...await readNflForwardEvidence({ client, season: 2026, week: 1 }),
  ];
  const capturedAt = argumentValue("--captured-at");
  if (capturedAt && !Number.isFinite(Date.parse(capturedAt))) {
    throw new Error(`Invalid --captured-at value: ${capturedAt}.`);
  }
  const selected = capturedAt
    ? stored.filter((row) => row.capturedAt === capturedAt)
      .sort((first, second) => first.payload.game.scheduledStart.localeCompare(second.payload.game.scheduledStart))
    : latestRows(stored);
  if (selected.length !== 16) {
    throw new Error(`Expected 16 Week 1 games${capturedAt ? ` at ${capturedAt}` : ""}; received ${selected.length}.`);
  }

  const candidateFixtureRows: NflForwardStoredEvidence[] = [];
  const projectionChanges: Array<{
    game: string;
    previousAway: number;
    previousHome: number;
    candidateAway: number;
    candidateHome: number;
    awayChange: number;
    homeChange: number;
    movementStatus: string;
  }> = [];
  const rows = selected.flatMap((row) => {
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
    const baseOutcome = getNflV1WeekOneOutcomeForecast({
      providerGameId: payload.game.providerGameId,
      awayTeam: payload.game.away.abbreviation,
      homeTeam: payload.game.home.abbreviation,
      weeklyFallback: shadow.footballProjection && payload.market.current.total
        ? {
            projectedHomeMargin: shadow.footballProjection.projectedHomeMargin,
            marketTotal: payload.market.current.total.line,
          }
        : undefined,
    });
    const outcome = shadow.footballProjection
      ? buildNflMarketEvidenceOutcomeForecast({
          baseForecast: baseOutcome,
          footballHomeMargin: shadow.footballProjection.projectedHomeMargin,
          current: payload.market.current,
          operationalOpening: payload.market.operationalOpening,
          playbookLine: payload.market.playbookLine,
          playbookSplits: payload.market.playbookSplits,
          sharpSplits: payload.market.sharpApiSplits,
          evaluatedAt: payload.capturedAt,
        })
      : baseOutcome;
    const marketOnlyOutcome = shadow.footballProjection
      ? buildNflMarketEvidenceOutcomeForecast({
          baseForecast: baseOutcome,
          footballHomeMargin: shadow.footballProjection.projectedHomeMargin,
          current: payload.market.current,
          operationalOpening: null,
          playbookLine: null,
          playbookSplits: null,
          sharpSplits: null,
          evaluatedAt: payload.capturedAt,
        })
      : baseOutcome;
    const splitOutcome = shadow.footballProjection
      ? buildNflMarketEvidenceOutcomeForecast({
          baseForecast: baseOutcome,
          footballHomeMargin: shadow.footballProjection.projectedHomeMargin,
          current: payload.market.current,
          operationalOpening: null,
          playbookLine: payload.market.playbookLine,
          playbookSplits: payload.market.playbookSplits,
          sharpSplits: payload.market.sharpApiSplits,
          evaluatedAt: payload.capturedAt,
        })
      : baseOutcome;
    const candidate = buildNflV1ActionableGradeBundle({
      providerGameId: payload.game.providerGameId,
      awayTeam: payload.game.away.abbreviation,
      homeTeam: payload.game.home.abbreviation,
      gameStartsAt: payload.game.scheduledStart,
      current: payload.market.current,
      comparableCurrentBooks: payload.market.comparableCurrentBooks,
      shadowMoneyline: shadow,
      outcomeForecast: outcome,
    });
    const stagedBundle = (forecast: typeof outcome) => buildNflV1ActionableGradeBundle({
      providerGameId: payload.game.providerGameId,
      awayTeam: payload.game.away.abbreviation,
      homeTeam: payload.game.home.abbreviation,
      gameStartsAt: payload.game.scheduledStart,
      current: payload.market.current,
      comparableCurrentBooks: payload.market.comparableCurrentBooks,
      shadowMoneyline: shadow,
      outcomeForecast: forecast,
    });
    const structuralByMarket = new Map(stagedBundle(baseOutcome).evaluatedBets.map((decision) => [decision.market, decision]));
    const marketOnlyByMarket = new Map(stagedBundle(marketOnlyOutcome).evaluatedBets.map((decision) => [decision.market, decision]));
    const splitByMarket = new Map(stagedBundle(splitOutcome).evaluatedBets.map((decision) => [decision.market, decision]));
    projectionChanges.push({
      game: `${payload.game.away.abbreviation}@${payload.game.home.abbreviation}`,
      previousAway: payload.outcomeForecast.expectedAwayScore,
      previousHome: payload.outcomeForecast.expectedHomeScore,
      candidateAway: outcome.expectedAwayScore,
      candidateHome: outcome.expectedHomeScore,
      awayChange: outcome.expectedAwayScore - payload.outcomeForecast.expectedAwayScore,
      homeChange: outcome.expectedHomeScore - payload.outcomeForecast.expectedHomeScore,
      movementStatus: outcome.marketEvidence?.movement.status ?? "unavailable",
    });
    if (!candidate.publicationEnabled || candidate.trackingEnabled ||
        candidate.evaluatedBets.length !== 3) {
      throw new Error(
        `NFL production bundle boundary failed for ${row.providerGameId}: ` +
        `${JSON.stringify({
          stage: payload.stage,
          capturedAt: payload.capturedAt,
          health: shadow.health,
          shadowGrade: shadow.grade,
          shadowTeam: shadow.team,
          shadowProbability: shadow.modelProbability,
          shadowQuote: shadow.evaluatedQuote,
          candidateDecisions: candidate.evaluatedBets.length,
          books: payload.market.comparableCurrentBooks.map((book) => ({
            sportsbook: book.sportsbook,
            spread: book.spread,
            total: book.total,
          })),
        })}.`,
      );
    }
    candidateFixtureRows.push({
      ...row,
      payload: {
        ...payload,
        schemaRelease: NFL_FORWARD_EVIDENCE_SCHEMA_RELEASE,
        outcomeForecast: outcome,
        decisions: {
          ...candidate,
          shadowEvaluatedBets: shadow ? [shadow] : [],
        },
      } as NflForwardEvidencePayload,
    });
    const baseline = new Map(payload.decisions.evaluatedBets.map((decision) => [decision.market, decision]));
    return candidate.evaluatedBets.map((decision) => {
      const previous = baseline.get(decision.market);
      const structural = structuralByMarket.get(decision.market);
      const marketOnly = marketOnlyByMarket.get(decision.market);
      const split = splitByMarket.get(decision.market);
      const marginMarket = decision.market !== "total";
      const evidence = outcome.marketEvidence;
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
      predictionSide: decision.market === "moneyline"
        ? outcome.homeWinProbability >= outcome.awayWinProbability
          ? payload.game.home.abbreviation
          : payload.game.away.abbreviation
        : null,
      previousPredictionSide: decision.market === "moneyline"
        ? payload.outcomeForecast.homeWinProbability >= payload.outcomeForecast.awayWinProbability
          ? payload.game.home.abbreviation
          : payload.game.away.abbreviation
        : null,
      structuralSide: structural?.side ?? null,
      structuralProbability: structural?.modelProbability ?? null,
      marketOnlySide: marketOnly?.side ?? null,
      sharpPublicSide: split?.side ?? null,
      sharpState: evidence
        ? (marginMarket ? evidence.sharp.homeMarginGapPp : evidence.sharp.overTotalGapPp) === null ? "missing_or_stale" : "available"
        : "missing_or_stale",
      publicState: evidence
        ? (marginMarket ? evidence.publicConsensus.homeMarginGapPp : evidence.publicConsensus.overTotalGapPp) === null ? "missing_or_stale" : "available"
        : "missing_or_stale",
      movementState: evidence?.movement.status ?? "unavailable",
      sharpShiftPoints: evidence
        ? marginMarket ? evidence.sharp.homeMarginShiftPoints : evidence.sharp.totalShiftPoints
        : 0,
      publicShiftPoints: evidence
        ? marginMarket ? evidence.publicConsensus.homeMarginShiftPoints : evidence.publicConsensus.totalShiftPoints
        : 0,
      movementShiftPoints: evidence
        ? marginMarket ? evidence.movement.homeMarginShiftPoints : evidence.movement.totalShiftPoints
        : 0,
      appliedEvidenceShiftPoints: evidence
        ? marginMarket ? evidence.appliedHomeMarginShiftPoints : evidence.appliedTotalShiftPoints
        : 0,
      weakEvidenceReversalRejected: evidence
        ? marginMarket ? evidence.weakHomeMarginReversalRejected : evidence.weakTotalReversalRejected
        : false,
      calibratedCoreState: evidence?.calibratedCore.source ?? "unavailable",
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
  const sideChangesByMarket = Object.fromEntries(["moneyline", "spread", "total"].map((market) => [
    market,
    rows.filter((row) => row.market === market && row.sideChanged).length,
  ]));
  const sideTransitionCounts = {
    previousToStructural: rows.filter((row) => row.previousSide !== row.structuralSide).length,
    structuralToMarketOnly: rows.filter((row) => row.structuralSide !== row.marketOnlySide).length,
    previousToMarketOnly: rows.filter((row) => row.previousSide !== row.marketOnlySide).length,
    marketOnlyToSharpPublic: rows.filter((row) => row.marketOnlySide !== row.sharpPublicSide).length,
    sharpPublicToMovement: rows.filter((row) => row.sharpPublicSide !== row.side).length,
  };
  const sideChangesByEvidenceState = count(rows.filter((row) => row.sideChanged).map((row) =>
    `${row.market}:${row.sharpState}:${row.publicState}:${row.movementState}`));
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
    latestGames: selected.length,
    sourceCapturedAt: selected[0]!.capturedAt,
    decisionRelease: NFL_V1_ACTIONABLE_GRADE_DECISION_RELEASE,
    policyRelease: NFL_V1_ACTIONABLE_GRADE_POLICY_RELEASE,
    previousGrades,
    grades,
    previousByMarket,
    byMarket,
    promotions: promotions.length,
    demotions: demotions.length,
    promotionsByMarket: Object.fromEntries(["moneyline", "spread", "total"].map((market) => [
      market,
      promotions.filter((row) => row.market === market).length,
    ])),
    demotionsByMarket: Object.fromEntries(["moneyline", "spread", "total"].map((market) => [
      market,
      demotions.filter((row) => row.market === market).length,
    ])),
    netActionableChange: rows.filter((row) => rank(row.grade) >= rank("Lean")).length -
      rows.filter((row) => rank(row.previousGrade) >= rank("Lean")).length,
    sideChanges: rows.filter((row) => row.sideChanged).length,
    sideChangesByMarket,
    moneylineForecastSideChanges: rows.filter((row) => row.market === "moneyline" &&
      row.predictionSide !== row.previousPredictionSide).length,
    actionableMoneylineValuesOpposingPrediction: rows.filter((row) => row.market === "moneyline" &&
      row.side !== row.predictionSide && rank(row.grade) >= rank("Lean")).length,
    nonactionableMoneylineValuesOpposingPrediction: rows.filter((row) => row.market === "moneyline" &&
      row.side !== row.predictionSide && rank(row.grade) < rank("Lean")).length,
    actionableMoneylineValueRows: rows.filter((row) => row.market === "moneyline" &&
      row.side !== row.predictionSide && rank(row.grade) >= rank("Lean")).map((row) => ({
      game: row.game,
      predictedWinner: row.predictionSide,
      valueSide: row.side,
      probability: row.probability,
      marketFairProbability: row.marketFairProbability,
      edgePercentagePoints: row.edgePercentagePoints,
      expectedValue: row.expectedValue,
      price: row.price,
      grade: row.grade,
      sharpState: row.sharpState,
      publicState: row.publicState,
      movementState: row.movementState,
      appliedEvidenceShiftPoints: row.appliedEvidenceShiftPoints,
    })),
    sideTransitionCounts,
    sideChangesByEvidenceState,
    evidenceStateCounts: count(rows.map((row) =>
      `${row.market}:${row.sharpState}:${row.publicState}:${row.movementState}`)),
    nonzeroEvidenceShiftMarkets: {
      sharp: rows.filter((row) => Math.abs(row.sharpShiftPoints) > 1e-12).length,
      public: rows.filter((row) => Math.abs(row.publicShiftPoints) > 1e-12).length,
      movement: rows.filter((row) => Math.abs(row.movementShiftPoints) > 1e-12).length,
      applied: rows.filter((row) => Math.abs(row.appliedEvidenceShiftPoints) > 1e-12).length,
    },
    calibratedCoreMarkets: rows.filter((row) => row.calibratedCoreState !== "unavailable").length,
    weakEvidenceReversalsRejected: rows.filter((row) => row.weakEvidenceReversalRejected).length,
    weakEvidenceReversalsRejectedByMarket: Object.fromEntries(["moneyline", "spread", "total"].map((market) => [
      market,
      rows.filter((row) => row.market === market && row.weakEvidenceReversalRejected).length,
    ])),
    probabilityChanges: rows.filter((row) => row.probabilityChanged).length,
    fairProbabilityChanges: rows.filter((row) => row.marketFairProbabilityChanged).length,
    expectedValueChanges: rows.filter((row) => row.expectedValueChanged).length,
    quoteChanges: rows.filter((row) => row.quoteChanged).length,
    projectionChangedGames: projectionChanges.filter((row) =>
      Math.abs(row.awayChange) > 1e-12 || Math.abs(row.homeChange) > 1e-12).length,
    maximumAbsoluteTeamScoreChange: Math.max(...projectionChanges.flatMap((row) =>
      [Math.abs(row.awayChange), Math.abs(row.homeChange)])),
    movementAvailableGames: projectionChanges.filter((row) => row.movementStatus === "available").length,
    primaryPredictionCoherenceGames: primaryPredictionChecks.filter((row) =>
      row.scoreWinner === row.predictedWinner && row.predictedWinner === row.moneylinePrediction).length,
    predictionMarkets: fixture.snapshot.games.reduce((sum, game) => sum +
      [game.markets.moneyline, game.markets.first_inning, game.markets.total]
        .filter((market) => market.marketPrediction?.status === "available").length, 0),
    predictionBetSelectionDifferences,
    ...(process.argv.includes("--summary") ? {} : {
      projectionChanges,
      changedRows: [...promotions, ...demotions],
      tupleChangedRows: rows.filter((row) => row.sideChanged || row.probabilityChanged ||
        row.marketFairProbabilityChanged || row.expectedValueChanged || row.quoteChanged),
      sideChangedRows: rows.filter((row) => row.sideChanged),
      probabilityChangedRows: rows.filter((row) => row.probabilityChanged),
      rows,
    }),
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

function argumentValue(name: string): string | null {
  const prefix = `${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? null;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
