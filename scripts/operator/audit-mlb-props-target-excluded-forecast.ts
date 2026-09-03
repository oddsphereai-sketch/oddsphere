/**
 * SELECT-only replay of the MLB props r41 target-excluded forecast release.
 * It uses the immutable r38 board plus its retained forward-evidence tuples.
 */
import { createHash } from "node:crypto";
import type { PlayerPropPreviewRow } from "../../app/mlb/props/components/PlayerPropsDashboard";
import {
  loadLatestMlbPropsBoardSnapshot,
  loadMlbPropsBoardSnapshotById,
} from "../../lib/mlb/props/boardSnapshotStore";
import { MLB_PROP_MARKET_KEYS, type MlbPropMarketKey } from "../../lib/mlb/props/config";
import { calibrateMlbPropsDisplayProjection } from "../../lib/mlb/props/displayProjectionCalibration";
import {
  applyMlbPropMarketAwareForecast,
  mlbPropProjectionForPosterior,
  qualifiesMlbPropMarketAwareWatchlist,
  resolveMlbPropForecastSide,
  type MlbPropMarketContext,
} from "../../lib/mlb/props/marketAwareContext";
import type {
  MlbPropsMarketEvidenceBook,
  MlbPropsMarketEvidenceIdentity,
} from "../../lib/mlb/props/marketEvidenceCapture";
import { mlbPropsMarketEvidenceId } from "../../lib/mlb/props/marketEvidenceCapture";
import { MLB_PROPS_MODEL_RELEASE_ID } from "../../lib/mlb/props/marketModelVersions";
import { american_to_implied_probability, expected_value, remove_vig_two_way } from "../../lib/mlb/props/oddsMath";
import { projectBatterDoublesResidual } from "../../lib/mlb/props/batterDoublesResidualModel";
import { projectBatterHitsPa } from "../../lib/mlb/props/batterHitsPaModel";
import { projectBatterHrr } from "../../lib/mlb/props/batterHrrCountModel";
import {
  BATTER_HOME_RUNS_COMPLEMENT_POLICY,
  BATTER_HOME_RUNS_PORTFOLIO_POLICY,
  projectBatterHomeRunsPortfolio,
} from "../../lib/mlb/props/batterHomeRunsResidualModel";
import { poissonProbabilityOver } from "../../lib/models/props/distributions/poisson";
import {
  BATTER_RBI_VALUE_PORTFOLIO_POLICY,
  qualifiesBatterDoublesResidualPromotion,
  qualifiesHitsUnderPriceEdge,
  qualifiesValidatedUnderPromotion,
  scoreBatterDoublesUnderAccuracyCandidate,
  scoreBatterStrikeoutsOverAccuracyCandidate,
  scoreHrrUnderAccuracyCandidate,
} from "../../lib/mlb/props/actionabilityPolicy";

const INCUMBENT_RELEASE = "mlb_props_2026_09_01_r38";
const FROZEN_SNAPSHOT_ID = "1d1b9446-f245-414b-a1b7-44381a5ef2e6";
const ACTIONABLE = new Set(["BEST_ANGLE", "LEAN"]);
const HEALTH = new Set(["PENDING_DATA", "RESEARCH"]);
const UNSUPPORTED_ACTIONABLE = new Set([
  "batter_hits|over", "batter_hits|under", "batter_hits_runs_rbis|over", "batter_hits_runs_rbis|under",
  "batter_singles|over", "batter_total_bases|over", "batter_total_bases|under", "batter_walks|over",
  "pitcher_earned_runs|over", "pitcher_earned_runs|under", "pitcher_outs|under", "pitcher_strikeouts|under",
]);
type AuditRow = PlayerPropPreviewRow & { marketEvidenceId?: string };
type Quote = {
  key: string;
  evidenceId: string;
  identity: MlbPropsMarketEvidenceIdentity | null;
  rows: AuditRow[];
  targetBook: string;
  exact: boolean;
  referenceOver: number | null;
  referenceBooks: number;
  movementOver: number;
  splitOver: number;
  currentOver: number | null;
  completePairBooks: number;
  openingBooks: number;
  splitEvidenceRows: number;
  independentProjection: number | null;
  independentOver: number | null;
  modelWeight: number | null;
};
type CandidateRow = {
  row: AuditRow;
  measurable: boolean;
  projectionExact: boolean;
  forecastSide: "over" | "under";
  projection: number;
  finalProbability: number | null;
  overProbability: number | null;
  independentProbability: number | null;
  marketProbability: number | null;
  targetExcludedBooks: number;
  grade: string;
  edge: number | null;
  ev: number | null;
};

async function main(): Promise<void> {
  if (MLB_PROPS_MODEL_RELEASE_ID !== "mlb_props_2026_09_02_r41") {
    throw new Error(`Candidate runtime moved to ${MLB_PROPS_MODEL_RELEASE_ID}.`);
  }
  const date = option("date") ?? easternDate();
  const snapshotId = option("snapshot-id") ?? FROZEN_SNAPSHOT_ID;
  const snapshot = snapshotId === "latest"
    ? await loadLatestMlbPropsBoardSnapshot(date)
    : await loadMlbPropsBoardSnapshotById(date, snapshotId);
  if (!snapshot) throw new Error(`No MLB props snapshot exists for ${date}.`);
  if (snapshot.modelContext?.modelReleaseId !== INCUMBENT_RELEASE) {
    throw new Error(`Expected ${INCUMBENT_RELEASE}; received ${snapshot.modelContext?.modelReleaseId ?? "missing"}.`);
  }
  const capture = snapshot.marketEvidence;
  if (!capture) throw new Error("The frozen snapshot has no forward-evidence capture.");
  const rows = (snapshot.data.props as AuditRow[]).map((row) => {
    const evidence = row.researchKey ? snapshot.data.research?.[row.researchKey] : null;
    return evidence ? {
      ...row,
      recentForm: row.recentForm ?? evidence.recentForm,
      opponentProfile: row.opponentProfile ?? evidence.opponentProfile,
      pitchArsenal: row.pitchArsenal ?? evidence.pitchArsenal,
      pitchMatchup: row.pitchMatchup ?? evidence.pitchMatchup,
      matchupHistory: row.matchupHistory ?? evidence.matchupHistory,
      environment: row.environment ?? evidence.environment,
    } : row;
  });
  const identities = new Map(capture.i.map((identity) => [identity[0], identity]));
  const identityGroups = groupBy(rows, mlbPropsMarketEvidenceId);
  const quoteGroups = groupBy(rows, (row) =>
    `${mlbPropsMarketEvidenceId(row)}|${normalizeBook(row.book)}`);
  const quotes: Quote[] = [...quoteGroups.entries()].flatMap(([key, quoteRows]) => {
    const evidenceId = mlbPropsMarketEvidenceId(quoteRows[0]!);
    const identity = identities.get(evidenceId) ?? null;
    const targetBook = normalizeBook(quoteRows[0]!.book);
    const identityRows = identityGroups.get(evidenceId) ?? quoteRows;
    const reference = identity
      ? targetExcludedOver(identity[2], targetBook)
      : targetExcludedOverFromRows(identityRows, targetBook);
    const independent = independentOverForRows(quoteRows);
    const movement = identity
      ? {
        adjustment: targetExcludedMovement(identity[2], targetBook, quoteRows[0]!.line),
        openingBooks: identity[2].filter((book) => normalizeBook(book[0]) !== targetBook && book[6] !== null).length,
      }
      : targetExcludedMovementFromRows(identityRows, targetBook);
    const rowBreadth = bookBreadth(identityRows);
    return [{
      key,
      evidenceId,
      identity,
      rows: quoteRows,
      targetBook,
      exact: identity ? identity[3][0] === identity[3][1] : true,
      referenceOver: reference?.probability ?? null,
      referenceBooks: reference?.books ?? 0,
      movementOver: movement.adjustment,
      splitOver: identity ? targetExcludedSplits(identity[2], targetBook) : 0,
      currentOver: identity?.[4][0] ?? currentOverFromRows(identityRows),
      completePairBooks: identity?.[3][0] ?? rowBreadth.completePairs,
      openingBooks: movement.openingBooks,
      splitEvidenceRows: identity
        ? identity[2].filter((book) => normalizeBook(book[0]) !== targetBook).reduce((sum, book) => sum + book[12].length, 0)
        : 0,
      independentProjection: identity?.[5][0] ?? reconstructIndependentHitterProjection(quoteRows[0]!),
      independentOver: identity?.[5][3] ?? independent,
      modelWeight: identity?.[5][2] ?? quoteRows[0]!.shrinkageWeight,
    }];
  });
  const quoteByRow = new Map(quotes.flatMap((quote) => quote.rows.map((row) => [row.id, quote] as const)));
  const reconstructionErrors = quotes.flatMap((quote) => {
    const expected = quote.identity?.[5][0];
    const independentOver = quote.identity?.[5][3];
    if (expected === null || expected === undefined || independentOver === null || independentOver === undefined) return [];
    return [Math.abs(recoverIndependentProjection(quote.rows, independentOver) - expected)];
  });
  const deterministicReconstruction = quotes.flatMap((quote) => {
    const expected = quote.identity?.[5][0];
    const reconstructed = reconstructIndependentHitterProjection(quote.rows[0]!);
    if (expected === null || expected === undefined || reconstructed === null) return [];
    return [{
      market: quote.rows[0]!.market,
      error: Math.abs(reconstructed - expected),
    }];
  });
  const candidateRows = applyCandidateGradePolicies(
    rows.map((row) => replayRow(row, quoteByRow.get(row.id) ?? null, quotes)),
  );
  const retainedCandidates = candidateRows.filter((row) => row.measurable && Boolean(row.row.marketEvidenceId));
  const categories = Object.fromEntries(MLB_PROP_MARKET_KEYS.map((market) => [market,
    summarize(candidateRows.filter((candidate) => candidate.row.market === market))]));
  const measurable = candidateRows.filter((row) => row.measurable);
  const crossings = uniqueCrossings(measurable);
  const projectionContradictions = uniqueProjectionContradictions(measurable);
  const actionableProjectionContradictions = projectionContradictions.filter((contradiction) => contradiction.actionable);
  const locked = candidateRows.filter((candidate) => candidate.row.lockStatus?.status === "locked");
  const promotions = candidateRows.filter((candidate) =>
    !ACTIONABLE.has(candidate.row.playGrade) && ACTIONABLE.has(candidate.grade));
  const demotions = candidateRows.filter((candidate) =>
    ACTIONABLE.has(candidate.row.playGrade) && !ACTIONABLE.has(candidate.grade));
  const actionableCrossingsWithoutExactComplement = crossings.filter((crossing) => candidateRows.some((candidate) =>
    mlbPropsMarketEvidenceId(candidate.row) === crossing.evidenceId
    && normalizeBook(candidate.row.book) === normalizeBook(crossing.book)
    && candidate.row.side === crossing.candidateSide
    && ACTIONABLE.has(candidate.grade)
    && !crossing.exactComplementaryCycle));
  const newlyFlatCategories = Object.entries(categories).flatMap(([market, summary]) =>
    summary.incumbentActionable > 0 && summary.candidateActionable === 0 ? [market] : []);
  const changedLockedRows = locked.filter(changed);
  if (actionableProjectionContradictions.length) {
    throw new Error(
      `Candidate has ${actionableProjectionContradictions.length} actionable projection/side contradictions: `
      + `${JSON.stringify(counts(actionableProjectionContradictions.map((row) => row.market)))}; examples=`
      + `incumbentActionable=${actionableProjectionContradictions.filter((row) => row.incumbentActionable).length}; `
      + JSON.stringify(actionableProjectionContradictions.slice(0, 10)),
    );
  }
  if (actionableCrossingsWithoutExactComplement.length) {
    throw new Error(`Candidate has ${actionableCrossingsWithoutExactComplement.length} actionable flips without an exact complementary quote.`);
  }
  if (newlyFlatCategories.length) {
    throw new Error(`Candidate flattens previously actionable categories: ${newlyFlatCategories.join(", ")}.`);
  }
  if (changedLockedRows.length) {
    throw new Error(`Candidate changes ${changedLockedRows.length} locked rows.`);
  }
  if (demotions.length && !promotions.length) {
    throw new Error("Candidate demotes actionable rows without exercising an actionable promotion path.");
  }
  if (process.argv.includes("--actions-only")) {
    console.log(JSON.stringify({
      snapshotId: snapshot.snapshotId,
      candidateRelease: MLB_PROPS_MODEL_RELEASE_ID,
      promotions: promotions.map(actionChange),
      demotions: demotions.map(actionChange),
    }, null, process.argv.includes("--compact") ? 0 : 2));
    return;
  }
  const report = {
    auditRelease: "mlb_props_target_excluded_forecast_audit_2026_09_02_r3_post_calibration_coherence",
    candidateRelease: MLB_PROPS_MODEL_RELEASE_ID,
    readOnly: true,
    databaseSelects: 2,
    providerCalls: 0,
    writes: 0,
    snapshot: {
      id: snapshot.snapshotId,
      at: snapshot.asOfTimestamp,
      release: snapshot.modelContext?.modelReleaseId,
      rows: rows.length,
      grades: counts(rows.map((row) => row.playGrade)),
      actionable: rows.filter((row) => ACTIONABLE.has(row.playGrade)).length,
    },
    evidence: {
      observedIdentities: capture.n,
      retainedIdentities: capture.k,
      omittedIdentities: capture.o,
      referencedRows: rows.filter((row) => row.marketEvidenceId).length,
      unreferencedRows: rows.filter((row) => !row.marketEvidenceId).length,
      exactEvaluatedQuotes: quotes.filter((quote) => quote.exact).length,
      evaluatedQuoteBreadth: counts(quotes.filter((quote) => quote.exact).map((quote) => breadth(quote.referenceBooks))),
      identityMinimumTargetExcludedBreadth: counts([...identityGroups.keys()].map((evidenceId) => {
        const identityQuotes = quotes.filter((quote) => quote.evidenceId === evidenceId && quote.exact);
        return breadth(identityQuotes.length ? Math.min(...identityQuotes.map((quote) => quote.referenceBooks)) : 0);
      })),
      retainedIdentityMinimumBreadth: counts(capture.i.map((identity) => breadth(identity[3][7]))),
      missingSplitsNeutral: capture.sp === "n",
      evaluatedQuoteForecastConsensusReferences: 0,
      independentProjectionReconstruction: {
        samples: reconstructionErrors.length,
        medianAbsoluteError: median(reconstructionErrors),
        maximumAbsoluteError: reconstructionErrors.length ? Math.max(...reconstructionErrors) : null,
        withinOneMicroUnit: reconstructionErrors.filter((error) => error <= 1e-6).length,
        withinOneMilliUnit: reconstructionErrors.filter((error) => error <= 1e-3).length,
        withinOneHundredth: reconstructionErrors.filter((error) => error <= 1e-2).length,
      },
      deterministicIndependentProjectionReconstruction: Object.fromEntries(
        [...groupBy(deterministicReconstruction, (value) => value.market)].map(([market, values]) => [market, {
          samples: values.length,
          medianAbsoluteError: median(values.map((value) => value.error)),
          maximumAbsoluteError: Math.max(...values.map((value) => value.error)),
          exact: values.filter((value) => value.error <= 1e-9).length,
          withinOneMicroUnit: values.filter((value) => value.error <= 1e-6).length,
          withinOneHundredth: values.filter((value) => value.error <= 1e-2).length,
        }]),
      ),
    },
    fullFrozenBoard: summarize(candidateRows),
    exactRetainedCohort: summarize(retainedCandidates),
    ...(process.argv.includes("--summary") ? {} : {
      crossings,
      projectionContradictionExamples: projectionContradictions.slice(0, 20),
      actionChanges: {
        promotions: promotions.map(actionChange),
        demotions: demotions.map(actionChange),
      },
    }),
    categories,
    locks: {
      rows: locked.length,
      changed: changedLockedRows.length,
      incumbentHash: hash(locked.map((candidate) => incumbentTuple(candidate.row))),
      candidateHash: hash(locked.map(candidateTuple)),
    },
    exactPriceSafety: {
      crossingsWithoutComplementaryRow: crossings.filter((crossing) => !crossing.complementaryOfferAvailable).length,
      crossingsWithoutExactComplementaryCycle: crossings.filter((crossing) => !crossing.exactComplementaryCycle).length,
      actionableCrossingsWithoutExactComplementaryCycle: actionableCrossingsWithoutExactComplement.length,
      actionableProjectionSideContradictions: actionableProjectionContradictions.length,
      actionableRowsWithoutTargetExcludedReference: candidateRows.filter((candidate) =>
        ACTIONABLE.has(candidate.grade) && candidate.measurable && candidate.edge === null).length,
    },
    limitations: {
      unretainedRowsReplayedFromCanonicalEmbeddedEvidence: candidateRows.filter((row) => row.measurable && !row.row.marketEvidenceId).length,
      unmeasuredRows: candidateRows.filter((row) => !row.measurable).length,
      deterministicProjectionReconstructionIsNotExactForEveryRetainedIdentity: deterministicReconstruction.some((value) => value.error > 1e-9),
      exactProductionImpactRequiresNaturalR41Writer: true,
      outcomesJoined: false,
    },
  };
  console.log(JSON.stringify(report, null, process.argv.includes("--compact") ? 0 : 2));
}

function reconstructIndependentHitterProjection(row: AuditRow): number | null {
  if (row.marketFamily !== "batter") return null;
  const recent = row.recentForm;
  const logs = recent?.logs ?? [];
  if (logs.length < 5) return null;
  if (row.market === "batter_hits") {
    return projectBatterHitsPa({
      line: row.line,
      battingOrder: row.lineupStatus?.battingOrder ?? null,
      recentLogs: logs,
      pitchMixBattingAverage: row.pitchMatchup?.weighted.battingAverage ?? null,
      pitchMixPitchesSeen: row.pitchMatchup?.hitterPitchesSeen ?? null,
    })?.projectedHits ?? null;
  }
  if (row.market === "batter_hits_runs_rbis") {
    return projectBatterHrr({
      line: row.line,
      battingOrder: row.lineupStatus?.battingOrder ?? null,
      recentValues: logs.map((log) => log.value),
    })?.projectedMean ?? null;
  }
  if (row.market === "batter_doubles") {
    const projection = average(logs.slice(0, 10).map((log) => log.value));
    return projection === null ? null : roundTo(projection, 2);
  }
  if (row.market === "batter_home_runs") {
    return projectBatterHomeRunsPortfolio({
      marketOverProbability: 0.5,
      battingOrder: row.lineupStatus?.battingOrder ?? null,
      recentLogs: logs.map((log) => ({ homeRuns: log.value, plateAppearances: log.plateAppearances ?? 0 })),
      parkHomeRunFactor: row.environment?.park.status === "available" ? row.environment.park.homeRunFactor : null,
      temperatureF: row.environment?.weather.status === "available" ? row.environment.weather.temperatureF : null,
      outdoor: row.environment?.roofStatus === "outdoor",
    })?.projectedHomeRuns ?? null;
  }
  const l5 = recent?.samples?.last5.average ?? average(logs.slice(0, 5).map((log) => log.value));
  const l10 = recent?.samples?.last10.average ?? average(logs.slice(0, 10).map((log) => log.value));
  const season = recent?.samples?.season.average ?? average(logs.map((log) => log.value));
  if (l5 === null || l10 === null || season === null) return null;
  let projection = Math.max(0.02, season * 0.45 + l10 * 0.35 + l5 * 0.2);
  projection *= 1 + hitterPitchMixAdjustment(row.market, row.pitchMatchup ?? null);
  projection *= 1 + hitterHistoryAdjustment(row.market, row.matchupHistory ?? null);
  projection *= 1 + hitterEnvironmentAdjustment(row.market, row.environment ?? null);
  return roundTo(Math.max(0.02, projection), 2);
}

function hitterPitchMixAdjustment(market: string, pitchMix: AuditRow["pitchMatchup"]): number {
  if (!pitchMix) return 0;
  const coverageWeight = pitchMix.coverageStatus === "available" ? 1 : 0.45;
  if (market === "batter_strikeouts") {
    const whiff = pitchMix.weighted.whiffPercent;
    if (whiff === null) return 0;
    if (whiff >= 30) return 0.1 * coverageWeight;
    if (whiff >= 25) return 0.05 * coverageWeight;
    if (whiff <= 18) return -0.07 * coverageWeight;
    return 0;
  }
  const xwoba = pitchMix.weighted.xwoba;
  const slug = pitchMix.weighted.slugging;
  let edge = 0;
  if (xwoba !== null) edge += xwoba >= 0.390 ? 0.08 : xwoba >= 0.350 ? 0.04 : xwoba <= 0.285 ? -0.06 : 0;
  if (slug !== null && ["batter_total_bases", "batter_home_runs", "batter_doubles", "batter_triples"].includes(market)) {
    edge += slug >= 0.520 ? 0.05 : slug <= 0.350 ? -0.04 : 0;
  }
  return Math.max(-0.1, Math.min(0.13, edge * coverageWeight));
}

function hitterHistoryAdjustment(market: string, history: AuditRow["matchupHistory"]): number {
  if (!history || history.status !== "available" || history.plateAppearances < 6) return 0;
  const games = Math.max(1, history.gamesPlayed);
  if (market === "batter_hits") return clampAdjustment(history.hits / games - 0.9, 0.07);
  if (market === "batter_total_bases") return clampAdjustment(history.totalBases / games - 1.4, 0.08);
  if (market === "batter_strikeouts") return clampAdjustment(history.strikeouts / Math.max(1, history.plateAppearances) - 0.22, 0.08);
  if (market === "batter_walks") return clampAdjustment(history.walks / Math.max(1, history.plateAppearances) - 0.08, 0.06);
  if (market === "batter_home_runs") return history.homeRuns > 0 ? 0.06 : 0;
  if (market === "batter_rbis") return clampAdjustment(history.rbis / games - 0.45, 0.05);
  return 0;
}

function hitterEnvironmentAdjustment(market: string, environment: AuditRow["environment"]): number {
  if (!environment) return 0;
  const runFactor = environment.park.status === "available" ? environment.park.runFactor : null;
  const homeRunFactor = environment.park.status === "available" ? environment.park.homeRunFactor : null;
  if (["batter_home_runs", "batter_total_bases", "batter_doubles", "batter_triples"].includes(market) && homeRunFactor !== null) {
    return Math.max(-0.06, Math.min(0.08, (homeRunFactor - 100) / 100 * 0.5));
  }
  if (["batter_hits", "batter_rbis", "batter_runs_scored", "batter_hits_runs_rbis"].includes(market) && runFactor !== null) {
    return Math.max(-0.04, Math.min(0.05, (runFactor - 100) / 100 * 0.35));
  }
  return 0;
}

function clampAdjustment(delta: number, cap: number): number {
  return Math.max(-cap, Math.min(cap, delta * 0.2));
}

function average(values: readonly number[]): number | null {
  const present = values.filter(Number.isFinite);
  return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : null;
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function actionChange(candidate: CandidateRow) {
  return {
    id: candidate.row.id,
    player: candidate.row.player,
    market: candidate.row.market,
    side: candidate.row.side,
    line: candidate.row.line,
    book: candidate.row.book,
    odds: candidate.row.odds,
    incumbentGrade: candidate.row.playGrade,
    candidateGrade: candidate.grade,
    forecastSide: candidate.forecastSide,
    probability: candidate.finalProbability,
    projection: candidate.projection,
    targetExcludedBooks: candidate.targetExcludedBooks,
    exactPriceEv: candidate.ev,
  };
}

function replayRow(row: AuditRow, quote: Quote | null, quotes: Quote[]): CandidateRow {
  if (row.lockStatus?.status === "locked" || !quote || !quote.exact) return incumbent(row, false);
  const independentProjection = quote.independentProjection;
  let independentOver = quote.independentOver;
  if (independentProjection === null || independentOver === null) return incumbent(row, false);
  const overRow = quote.rows.find((candidate) => candidate.side === "over") ?? quote.rows[0]!;
  if (row.market === "batter_home_runs") {
    const residual = projectBatterHomeRunsPortfolio({
      marketOverProbability: quote.referenceOver ?? 0.5,
      battingOrder: overRow.lineupStatus?.battingOrder ?? null,
      recentLogs: (overRow.recentForm?.logs ?? []).map((log) => ({
        homeRuns: log.value,
        plateAppearances: log.plateAppearances ?? 0,
      })),
      parkHomeRunFactor: overRow.environment?.park.status === "available"
        ? overRow.environment.park.homeRunFactor : null,
      temperatureF: overRow.environment?.weather.status === "available"
        ? overRow.environment.weather.temperatureF : null,
      outdoor: overRow.environment?.roofStatus === "outdoor",
    });
    if (residual) independentOver = quote.referenceOver === null
      ? residual.independentOverProbability : residual.overProbability;
  } else if (row.market === "batter_doubles") {
    const features = overRow.recentForm?.doublesResidualFeatures;
    if (quote.referenceOver !== null && features && features.doublesLast20.length >= 10) {
      independentOver = projectBatterDoublesResidual({
        marketOverProbability: quote.referenceOver,
        plateAppearancesLast5: features.plateAppearancesLast5,
        rbisLast5: features.rbisLast5,
        rbisSeason: features.rbisSeason,
        runsLast10: features.runsLast10,
        walksLast20: features.walksLast20,
        walksSeason: features.walksSeason,
        doublesOverRateLast20: features.doublesLast20.filter((value) => value > row.line).length / features.doublesLast20.length,
      })?.overProbability ?? independentOver;
    } else if (quote.referenceOver === null) {
      independentOver = poissonProbabilityOver(independentProjection, Math.floor(row.line) + 1);
    }
  } else if (row.marketFamily === "batter"
    && !["batter_hits", "batter_hits_runs_rbis"].includes(row.market)) {
    const directMovement = (overRow.oddsMovement?.impliedProbabilityDelta ?? 0) * 0.35;
    independentOver = clamp(independentOver - clamp(directMovement, 0.025), 0.01, 0.99);
  }
  const related = relatedAdjustments(quote, quotes);
  const context: MlbPropMarketContext = {
    currentOverProbability: quote.currentOver,
    targetExcludedOverProbability: quote.referenceOver,
    completePairBooks: quote.completePairBooks,
    targetExcludedBooks: quote.referenceBooks,
    movementAdjustmentOver: quote.movementOver,
    relatedMovementAdjustmentOver: coherentRelated(related),
    splitAdjustmentOver: quote.splitOver,
    openingBooks: quote.openingBooks,
    relatedMarkets: related.length,
    splitEvidenceRows: quote.splitEvidenceRows,
  };
  const forecast = applyMlbPropMarketAwareForecast({
    marketKey: row.market as MlbPropMarketKey,
    line: row.line,
    independentOverProbability: independentOver,
    independentProjection,
    modelWeight: row.market === "batter_home_runs" || row.market === "batter_doubles"
      ? 1 : quote.modelWeight ?? row.shrinkageWeight,
    context,
  });
  const forecastSide = resolveMlbPropForecastSide({
    marketKey: row.market as MlbPropMarketKey,
    offerContract: row.offerContract ?? "two_way",
    offeredSide: row.side,
    overProbability: forecast.overProbability,
    underProbability: forecast.underProbability,
  });
  const probability = row.side === "over" ? forecast.overProbability : forecast.underProbability;
  const reference = quote.referenceOver === null ? null
    : row.side === "over" ? quote.referenceOver : 1 - quote.referenceOver;
  const edge = reference === null ? null : probability - reference;
  const ev = safeEv(probability, row.odds);
  const projection = calibrateMlbPropsDisplayProjection({
    market: row.market,
    side: forecastSide,
    line: row.line,
    projection: forecast.projection,
  });
  return {
    row,
    measurable: true,
    projectionExact: quote.identity !== null || Math.abs(forecast.overProbability - independentOver) >= 1e-12,
    forecastSide,
    projection,
    finalProbability: probability,
    overProbability: forecast.overProbability,
    independentProbability: row.side === "over" ? independentOver : 1 - independentOver,
    marketProbability: reference,
    targetExcludedBooks: quote.referenceBooks,
    grade: replayGrade({ row, quote, forecastSide, projection, probability, edge, ev, context }),
    edge,
    ev,
  };
}

function replayGrade(args: {
  row: AuditRow; quote: Quote; forecastSide: "over" | "under"; projection: number; probability: number;
  edge: number | null; ev: number | null; context: MlbPropMarketContext;
}): string {
  if (HEALTH.has(args.row.playGrade)) return args.row.playGrade;
  if (args.row.side !== args.forecastSide) return "NO_PLAY";
  if (!(args.row.market === "batter_home_runs" && args.row.offerContract === "milestone")
    && (args.forecastSide === "over" ? args.projection <= args.row.line : args.projection >= args.row.line)) {
    return "WATCHLIST";
  }
  const incumbentOver = args.quote.identity?.[5][5]
    ?? args.quote.rows[0]!.overProbability
    ?? (args.quote.rows[0]!.side === "over"
      ? args.quote.rows[0]!.finalProbability
      : args.quote.rows[0]!.finalProbability === null ? null : 1 - args.quote.rows[0]!.finalProbability)
    ?? 0.5;
  const incumbentSide = incumbentOver >= 0.5 ? "over" : "under";
  const incumbentSelected = args.quote.rows.find((row) => row.side === incumbentSide);
  let grade = args.row.market === "batter_home_runs"
    ? "WATCHLIST"
    : incumbentSide === args.forecastSide
    ? args.row.playGrade
    : incumbentSelected && (ACTIONABLE.has(incumbentSelected.playGrade) || incumbentSelected.playGrade === "WATCHLIST")
      ? "WATCHLIST" : args.row.playGrade;
  if (ACTIONABLE.has(grade) && UNSUPPORTED_ACTIONABLE.has(`${args.row.market}|${args.row.side}`)) grade = "WATCHLIST";
  if (ACTIONABLE.has(grade) && ((args.edge !== null && args.edge < 0) || args.ev === null || args.ev < 0)) grade = "WATCHLIST";
  if (grade === "NO_PLAY" && qualifiesMlbPropMarketAwareWatchlist({
    side: args.row.side,
    americanOdds: args.row.odds,
    overProbability: args.row.side === "over" ? args.probability : 1 - args.probability,
    context: args.context,
  })) grade = "WATCHLIST";
  const complement = args.quote.rows.find((row) => row.side === args.forecastSide);
  if (!complement || complement.lastUpdated !== args.row.lastUpdated) {
    if (ACTIONABLE.has(grade)) grade = "WATCHLIST";
  }
  return grade;
}

function applyCandidateGradePolicies(input: CandidateRow[]): CandidateRow[] {
  const rows = input.map((row) => ({ ...row }));
  const underEligible = rows.filter((candidate) => {
    const row = candidate.row;
    if (!candidate.measurable || row.side !== "under" || !["WATCHLIST", "LEAN"].includes(candidate.grade)
      || !candidateProjectionSupportsForecastSide(candidate)
      || candidate.independentProbability === null || candidate.marketProbability === null
      || candidate.edge === null || candidate.ev === null) return false;
    const values = row.recentForm?.samples?.season.values ?? [];
    const hrr = row.market === "batter_hits_runs_rbis"
      ? scoreHrrUnderAccuracyCandidate({ line: row.line, seasonValues: values, marketProbability: candidate.marketProbability, americanOdds: row.odds }) : null;
    const doubles = row.market === "batter_doubles"
      ? scoreBatterDoublesUnderAccuracyCandidate({ line: row.line, seasonValues: values, marketProbability: candidate.marketProbability, americanOdds: row.odds }) : null;
    Reflect.set(candidate, "accuracyScore", hrr?.eligible ? hrr : doubles?.eligible ? doubles : null);
    return qualifiesHitsUnderPriceEdge({ marketProbability: candidate.marketProbability, americanOdds: row.odds }) && row.market === "batter_hits"
      || row.market === "batter_doubles" && row.reasonCodes.includes("DOUBLES_MARKET_RESIDUAL_READ")
        && qualifiesBatterDoublesResidualPromotion({
          modelProbability: candidate.independentProbability,
          marketProbability: candidate.marketProbability,
          expectedValue: candidate.ev,
          americanOdds: row.odds,
        })
      || Boolean(hrr?.eligible || doubles?.eligible)
      || candidate.grade === "WATCHLIST" && qualifiesValidatedUnderPromotion({
        market: row.market,
        line: row.line,
        modelProbability: candidate.independentProbability,
        marketProbability: candidate.marketProbability,
        finalEdge: candidate.edge,
        expectedValue: candidate.ev,
        americanOdds: row.odds,
      });
  });
  for (const candidate of bestPerOffer(underEligible)) {
    const score = Reflect.get(candidate, "accuracyScore") as ReturnType<typeof scoreHrrUnderAccuracyCandidate> | null;
    if (score) applyAccuracyScore(candidate, score.independentProbability, score.finalProbability, score.finalEdge, score.expectedValue);
    candidate.grade = "BEST_ANGLE";
  }

  const strikeoutEligible = rows.filter((candidate) => {
    const row = candidate.row;
    if (!candidate.measurable || row.market !== "batter_strikeouts" || row.side !== "over"
      || !candidateProjectionSupportsForecastSide(candidate)
      || !["WATCHLIST", "LEAN"].includes(candidate.grade) || candidate.marketProbability === null
      || row.lineupStatus?.status === "not_in_lineup" || blocked(row)) return false;
    const score = scoreBatterStrikeoutsOverAccuracyCandidate({
      line: row.line,
      seasonValues: row.recentForm?.samples?.season.values ?? [],
      marketProbability: candidate.marketProbability,
      americanOdds: row.odds,
    });
    Reflect.set(candidate, "accuracyScore", score.eligible ? score : null);
    return score.eligible;
  });
  for (const candidate of bestPerOffer(strikeoutEligible)) {
    const score = Reflect.get(candidate, "accuracyScore") as ReturnType<typeof scoreBatterStrikeoutsOverAccuracyCandidate>;
    applyAccuracyScore(candidate, score.independentProbability, score.finalProbability, score.finalEdge, score.expectedValue);
    candidate.grade = "BEST_ANGLE";
  }

  const rbi = bestPerOffer(rows.filter((candidate) => candidate.measurable
    && candidate.row.market === "batter_rbis" && candidate.grade === "WATCHLIST"
    && candidateProjectionSupportsForecastSide(candidate)
    && candidate.independentProbability !== null && candidate.edge !== null
    && candidate.edge >= BATTER_RBI_VALUE_PORTFOLIO_POLICY.minimumFinalEdge
    && candidate.ev !== null && candidate.ev >= BATTER_RBI_VALUE_PORTFOLIO_POLICY.minimumExpectedValue
    && candidate.row.odds >= BATTER_RBI_VALUE_PORTFOLIO_POLICY.minimumAmericanOdds
    && candidate.row.odds <= BATTER_RBI_VALUE_PORTFOLIO_POLICY.maximumAmericanOdds
    && !blocked(candidate.row)))
    .sort(compareCandidate).slice(0, BATTER_RBI_VALUE_PORTFOLIO_POLICY.playsPerSlate);
  for (const candidate of rbi) candidate.grade = "LEAN";

  const homeRuns = bestPerOffer(rows.filter((candidate) => candidate.measurable
    && candidate.row.market === "batter_home_runs" && candidate.row.side === "over"
    && candidate.row.line === 0.5 && candidate.grade === "WATCHLIST"
    && (candidate.edge === null || candidate.edge >= 0)
    && candidate.ev !== null && candidate.ev >= 0 && !blocked(candidate.row)))
    .sort(compareCandidate);
  const promotedGames = new Set<string>();
  let primary = 0;
  let complement = 0;
  for (const candidate of homeRuns) {
    const game = candidate.row.providerIds?.gameId ?? candidate.row.gameStartTime;
    if (promotedGames.has(game)) continue;
    if (primary < BATTER_HOME_RUNS_PORTFOLIO_POLICY.playsPerSlate
      && candidate.row.odds >= BATTER_HOME_RUNS_PORTFOLIO_POLICY.minimumAmericanOdds
      && candidate.row.odds <= BATTER_HOME_RUNS_PORTFOLIO_POLICY.maximumAmericanOdds) {
      candidate.grade = "LEAN"; primary++; promotedGames.add(game); continue;
    }
    if (complement < BATTER_HOME_RUNS_COMPLEMENT_POLICY.playsPerSlate
      && candidate.row.odds >= BATTER_HOME_RUNS_COMPLEMENT_POLICY.minimumAmericanOdds
      && candidate.row.odds <= BATTER_HOME_RUNS_COMPLEMENT_POLICY.maximumAmericanOdds
      && (candidate.independentProbability ?? -1) >= BATTER_HOME_RUNS_COMPLEMENT_POLICY.minimumModelProbability
      && (candidate.edge ?? -1) >= BATTER_HOME_RUNS_COMPLEMENT_POLICY.minimumModelEdge
      && (candidate.ev ?? -1) >= BATTER_HOME_RUNS_COMPLEMENT_POLICY.minimumExpectedValue) {
      candidate.grade = "LEAN"; complement++; promotedGames.add(game);
    }
  }

  const actions = rows.filter((row) => ACTIONABLE.has(row.grade));
  for (const group of groupBy(actions, signalKey).values()) {
    const [best, ...duplicates] = [...group].sort(compareCandidate);
    if (!best) continue;
    for (const duplicate of duplicates) duplicate.grade = "WATCHLIST";
  }
  for (const candidate of rows) {
    if (ACTIONABLE.has(candidate.grade)
      && !(candidate.row.market === "batter_home_runs" && candidate.row.offerContract === "milestone")
      && !candidateProjectionSupportsForecastSide(candidate)) {
      candidate.grade = "WATCHLIST";
    }
  }
  return rows;
}

function candidateProjectionSupportsForecastSide(candidate: CandidateRow): boolean {
  return candidate.forecastSide === "over"
    ? candidate.projection > candidate.row.line
    : candidate.projection < candidate.row.line;
}

function applyAccuracyScore(candidate: CandidateRow, independent: number, final: number, edge: number, ev: number): void {
  const previousOver = candidate.overProbability ?? (candidate.row.side === "over" ? final : 1 - final);
  const finalOver = candidate.row.side === "over" ? final : 1 - final;
  const accuracySide = candidate.row.side;
  candidate.projection = calibrateMlbPropsDisplayProjection({
    market: candidate.row.market,
    side: accuracySide,
    line: candidate.row.line,
    projection: mlbPropProjectionForPosterior({
      marketKey: candidate.row.market as MlbPropMarketKey,
      line: candidate.row.line,
      independentProjection: candidate.projection,
      independentOverProbability: previousOver,
      authoritativeOverProbability: finalOver,
    }),
  });
  candidate.projectionExact = true;
  candidate.independentProbability = independent;
  candidate.finalProbability = final;
  candidate.overProbability = finalOver;
  candidate.edge = edge;
  candidate.ev = ev;
  candidate.forecastSide = accuracySide;
}

function bestPerOffer(rows: CandidateRow[]): CandidateRow[] {
  return [...groupBy(rows, signalKey).values()].flatMap((group) => [...group].sort(compareCandidate).slice(0, 1));
}
function signalKey(candidate: CandidateRow): string {
  const row = candidate.row;
  return [row.providerIds?.gameId ?? row.gameStartTime, row.providerIds?.bdlPlayerId ?? row.player, row.market, row.side, row.line].join("|");
}
function compareCandidate(left: CandidateRow, right: CandidateRow): number {
  return (right.ev ?? -99) - (left.ev ?? -99)
    || (right.edge ?? -99) - (left.edge ?? -99)
    || (right.independentProbability ?? -99) - (left.independentProbability ?? -99)
    || right.row.odds - left.row.odds;
}
function blocked(row: AuditRow): boolean {
  return row.reasonCodes.includes("STALE_ODDS")
    || row.reasonCodes.includes("MODEL_CONTEXT_NOT_INTEGRATED")
    || row.reasonCodes.includes("INVALID_PRICE_FORMAT");
}

function incumbent(row: AuditRow, measurable: boolean): CandidateRow {
  const over = row.overProbability ?? (row.side === "over" ? row.finalProbability : row.finalProbability === null ? null : 1 - row.finalProbability);
  return { row, measurable, forecastSide: (over ?? 0.5) >= 0.5 ? "over" : "under", projection: row.projection,
    projectionExact: true,
    finalProbability: row.finalProbability, overProbability: over, independentProbability: row.independentProbability,
    marketProbability: row.marketProbability, targetExcludedBooks: 0,
    grade: row.playGrade, edge: row.modelEdge, ev: row.expectedValue };
}

function recoverIndependentProjection(rows: readonly AuditRow[], independentOver: number): number {
  const representative = rows.find((row) => row.side === "over") ?? rows[0]!;
  const finalOver = representative.overProbability
    ?? (representative.side === "over"
      ? representative.finalProbability
      : representative.finalProbability === null ? null : 1 - representative.finalProbability);
  if (finalOver === null) return representative.projection;
  const target = representative.projection;
  const upperBound = representative.market === "pitcher_outs" ? 48 : Math.max(16, representative.line + 12);
  let best = { projection: target, error: Number.POSITIVE_INFINITY };
  const evaluate = (independentProjection: number) => {
    const raw = incumbentMarketProjection({
      market: representative.market as MlbPropMarketKey,
      line: representative.line,
      independentProjection,
      independentOver,
      finalOver,
    });
    const displayed = calibrateMlbPropsDisplayProjection({
      market: representative.market,
      side: representative.side,
      line: representative.line,
      projection: raw,
    });
    const error = Math.abs(displayed - target);
    if (error < best.error) best = { projection: independentProjection, error };
  };
  for (let index = 0; index <= 400; index++) evaluate(upperBound * index / 400);
  let lower = Math.max(0, best.projection - upperBound / 400);
  let upper = Math.min(upperBound, best.projection + upperBound / 400);
  for (let iteration = 0; iteration < 80; iteration++) {
    const left = lower + (upper - lower) / 3;
    const right = upper - (upper - lower) / 3;
    const leftError = reconstructionError(left, representative, independentOver, finalOver, target);
    const rightError = reconstructionError(right, representative, independentOver, finalOver, target);
    if (leftError <= rightError) upper = right;
    else lower = left;
  }
  evaluate((lower + upper) / 2);
  return best.projection;
}

function reconstructionError(
  independentProjection: number,
  row: AuditRow,
  independentOver: number,
  finalOver: number,
  target: number,
): number {
  const raw = incumbentMarketProjection({
    market: row.market as MlbPropMarketKey,
    line: row.line,
    independentProjection,
    independentOver,
    finalOver,
  });
  const displayed = calibrateMlbPropsDisplayProjection({
    market: row.market,
    side: row.side,
    line: row.line,
    projection: raw,
  });
  return Math.abs(displayed - target);
}

function incumbentMarketProjection(args: {
  market: MlbPropMarketKey;
  line: number;
  independentProjection: number;
  independentOver: number;
  finalOver: number;
}): number {
  const probabilityDistance = Math.max(0.08, Math.abs(args.independentOver - 0.5));
  const observedScale = Math.abs(args.independentProjection - args.line) / probabilityDistance;
  const fallbackScale = incumbentProjectionShiftCap(args.market) * 4;
  const scale = clamp(observedScale || fallbackScale, fallbackScale * 2);
  const shift = clamp(
    (args.finalOver - args.independentOver) * scale,
    incumbentProjectionShiftCap(args.market),
  );
  return Math.max(0, args.independentProjection + shift);
}

function incumbentProjectionShiftCap(market: MlbPropMarketKey): number {
  if (market === "pitcher_outs") return 1.5;
  if (["pitcher_strikeouts", "pitcher_hits_allowed", "pitcher_walks", "pitcher_earned_runs"].includes(market)) return 0.75;
  if (["batter_total_bases", "batter_hits_runs_rbis"].includes(market)) return 0.75;
  if (["batter_home_runs", "batter_doubles", "batter_triples", "batter_stolen_bases"].includes(market)) return 0.12;
  return 0.35;
}

function summarize(rows: CandidateRow[]) {
  const projectionDeltas = rows.flatMap((row) => row.measurable ? [Math.abs(row.projection - row.row.projection)] : []);
  const probabilityDeltas = rows.flatMap((row) => row.measurable && row.finalProbability !== null && row.row.finalProbability !== null
    ? [Math.abs(row.finalProbability - row.row.finalProbability)] : []);
  return {
    rows: rows.length,
    measuredRows: rows.filter((row) => row.measurable).length,
    incumbentGrades: counts(rows.map((row) => row.row.playGrade)),
    candidateGrades: counts(rows.map((row) => row.grade)),
    incumbentActionable: rows.filter((row) => ACTIONABLE.has(row.row.playGrade)).length,
    candidateActionable: rows.filter((row) => ACTIONABLE.has(row.grade)).length,
    projectionChanges: rows.filter((row) => row.measurable && different(row.projection, row.row.projection)).length,
    exactProjectionRows: rows.filter((row) => row.measurable && row.projectionExact).length,
    uncertainProjectionRows: rows.filter((row) => row.measurable && !row.projectionExact).length,
    exactProjectionChanges: rows.filter((row) => row.measurable && row.projectionExact && different(row.projection, row.row.projection)).length,
    uncertainProjectionChanges: rows.filter((row) => row.measurable && !row.projectionExact && different(row.projection, row.row.projection)).length,
    probabilityChanges: rows.filter((row) => row.measurable && different(row.finalProbability, row.row.finalProbability)).length,
    maximumAbsoluteProjectionChange: projectionDeltas.length ? Math.max(...projectionDeltas) : 0,
    meanAbsoluteProjectionChange: projectionDeltas.length ? projectionDeltas.reduce((sum, value) => sum + value, 0) / projectionDeltas.length : 0,
    maximumAbsoluteProbabilityChange: probabilityDeltas.length ? Math.max(...probabilityDeltas) : 0,
    meanAbsoluteProbabilityChange: probabilityDeltas.length ? probabilityDeltas.reduce((sum, value) => sum + value, 0) / probabilityDeltas.length : 0,
    sideChanges: uniqueCrossings(rows.filter((row) => row.measurable)).length,
    projectionSideContradictions: uniqueProjectionContradictions(rows.filter((row) => row.measurable)).length,
    promotions: rows.filter((row) => !ACTIONABLE.has(row.row.playGrade) && ACTIONABLE.has(row.grade)).length,
    demotions: rows.filter((row) => ACTIONABLE.has(row.row.playGrade) && !ACTIONABLE.has(row.grade)).length,
    zeroCategory: rows.length > 0 && rows.filter((row) => ACTIONABLE.has(row.grade)).length === 0,
    healthRows: rows.filter((row) => HEALTH.has(row.row.playGrade)).length,
    lockedRows: rows.filter((row) => row.row.lockStatus?.status === "locked").length,
  };
}

function uniqueCrossings(rows: CandidateRow[]) {
  const groups = groupBy(rows, (candidate) => `${mlbPropsMarketEvidenceId(candidate.row)}|${normalizeBook(candidate.row.book)}`);
  return [...groups.values()].flatMap((group) => {
    const first = group[0]!;
    const incumbentOver = first.row.overProbability ?? (first.row.side === "over" ? first.row.finalProbability : first.row.finalProbability === null ? null : 1 - first.row.finalProbability);
    const incumbentSide = first.row.market === "batter_home_runs" && first.row.offerContract === "milestone"
      ? first.row.side
      : incumbentOver === null ? null : incumbentOver >= 0.5 ? "over" : "under";
    if (incumbentSide === null || incumbentSide === first.forecastSide) return [];
    return [{
      evidenceId: mlbPropsMarketEvidenceId(first.row),
      player: first.row.player,
      market: first.row.market,
      book: first.row.book,
      incumbentSide,
      candidateSide: first.forecastSide,
      candidateOverProbability: first.overProbability,
      complementaryOfferAvailable: group.some((candidate) => candidate.row.side === first.forecastSide),
      exactComplementaryCycle: group.some((candidate) =>
        candidate.row.side === first.forecastSide
        && candidate.row.line === first.row.line
        && candidate.row.lastUpdated === first.row.lastUpdated),
    }];
  });
}

function uniqueProjectionContradictions(rows: CandidateRow[]) {
  const groups = groupBy(rows, (candidate) => `${mlbPropsMarketEvidenceId(candidate.row)}|${normalizeBook(candidate.row.book)}`);
  return [...groups.values()].flatMap((group) => {
    const first = group[0]!;
    if (first.row.market === "batter_home_runs" && first.row.offerContract === "milestone") return [];
    const selected = group.find((candidate) => candidate.row.side === first.forecastSide) ?? first;
    const supports = first.forecastSide === "over"
      ? selected.projection > selected.row.line
      : selected.projection < selected.row.line;
    return supports ? [] : [{
      evidenceId: mlbPropsMarketEvidenceId(first.row),
      market: first.row.market,
      book: first.row.book,
      side: first.forecastSide,
      line: selected.row.line,
      projection: selected.projection,
      overProbability: first.overProbability,
      actionable: ACTIONABLE.has(selected.grade),
      incumbentActionable: ACTIONABLE.has(selected.row.playGrade),
    }];
  });
}

function targetExcludedOver(books: readonly MlbPropsMarketEvidenceBook[], target: string) {
  const alternatives = books.filter((book) => normalizeBook(book[0]) !== target);
  const paired = alternatives.flatMap((book) => book[8] === null || book[9] === null ? [] : [safeDevig(book[8], book[9])]).filter((value): value is number => value !== null);
  if (paired.length) return { probability: median(paired)!, books: paired.length };
  const oneSided = alternatives.flatMap((book) => book[8] === null ? [] : [safeImplied(book[8])]).filter((value): value is number => value !== null);
  return oneSided.length ? { probability: median(oneSided)!, books: oneSided.length } : null;
}

function independentOverForRows(rows: readonly AuditRow[]): number | null {
  const over = rows.find((row) => row.side === "over" && row.independentProbability !== null);
  if (over?.independentProbability !== null && over?.independentProbability !== undefined) return over.independentProbability;
  const under = rows.find((row) => row.side === "under" && row.independentProbability !== null);
  return under?.independentProbability === null || under?.independentProbability === undefined
    ? null
    : 1 - under.independentProbability;
}

function targetExcludedOverFromRows(rows: readonly AuditRow[], target: string) {
  const alternatives = [...groupBy(rows.filter((row) => normalizeBook(row.book) !== target), (row) => normalizeBook(row.book)).values()];
  const paired = alternatives.flatMap((bookRows) => {
    const over = latestRow(bookRows.filter((row) => row.side === "over"));
    const under = latestRow(bookRows.filter((row) => row.side === "under"));
    if (!over || !under || over.line !== under.line) return [];
    const probability = safeDevig(over.odds, under.odds);
    return probability === null ? [] : [probability];
  });
  if (paired.length) return { probability: median(paired)!, books: paired.length };
  const oneSided = alternatives.flatMap((bookRows) => {
    const over = latestRow(bookRows.filter((row) => row.side === "over"));
    const probability = over ? safeImplied(over.odds) : null;
    return probability === null ? [] : [probability];
  });
  return oneSided.length ? { probability: median(oneSided)!, books: oneSided.length } : null;
}

function currentOverFromRows(rows: readonly AuditRow[]): number | null {
  return targetExcludedOverFromRows(rows, "__no_evaluated_book__")?.probability ?? null;
}

function bookBreadth(rows: readonly AuditRow[]): { completePairs: number } {
  let completePairs = 0;
  for (const bookRows of groupBy(rows, (row) => normalizeBook(row.book)).values()) {
    const over = latestRow(bookRows.filter((row) => row.side === "over"));
    const under = latestRow(bookRows.filter((row) => row.side === "under"));
    if (over && under && over.line === under.line) completePairs++;
  }
  return { completePairs };
}

function targetExcludedMovementFromRows(
  rows: readonly AuditRow[],
  target: string,
): { adjustment: number; openingBooks: number } {
  const adjustments: number[] = [];
  let openingBooks = 0;
  for (const [book, bookRows] of groupBy(rows, (row) => normalizeBook(row.book))) {
    if (book === target) continue;
    const over = latestRow(bookRows.filter((row) => row.side === "over"));
    const under = latestRow(bookRows.filter((row) => row.side === "under"));
    const representative = over ?? under;
    const opening = representative?.oddsMovement;
    if (!representative || !opening) continue;
    openingBooks++;
    if (Math.abs(representative.line - opening.openingLine) >= 0.25) {
      adjustments.push(clamp((representative.line - opening.openingLine) * 0.01, 0.015));
      continue;
    }
    let current: number | null = null;
    let opened: number | null = null;
    if (over && under && over.oddsMovement && under.oddsMovement) {
      current = safeDevig(over.odds, under.odds);
      opened = safeDevig(over.oddsMovement.openingOdds, under.oddsMovement.openingOdds);
    } else if (over?.oddsMovement) {
      current = safeImplied(over.odds);
      opened = safeImplied(over.oddsMovement.openingOdds);
    } else if (under?.oddsMovement) {
      const currentUnder = safeImplied(under.odds);
      const openedUnder = safeImplied(under.oddsMovement.openingOdds);
      current = currentUnder === null ? null : 1 - currentUnder;
      opened = openedUnder === null ? null : 1 - openedUnder;
    }
    const delta = current === null || opened === null ? 0 : current - opened;
    adjustments.push(Math.abs(delta) >= 0.015 ? clamp(delta * 0.35, 0.015) : 0);
  }
  return { adjustment: clamp(median(adjustments) ?? 0, 0.015), openingBooks };
}

function latestRow(rows: readonly AuditRow[]): AuditRow | null {
  return [...rows].sort((left, right) => Date.parse(right.lastUpdated) - Date.parse(left.lastUpdated))[0] ?? null;
}

function targetExcludedMovement(books: readonly MlbPropsMarketEvidenceBook[], target: string, line: number): number {
  return clamp(median(books.filter((book) => normalizeBook(book[0]) !== target).flatMap((book) => {
    if (book[7] === null) return [];
    if (Math.abs(line - book[7]) >= 0.25) return [clamp((line - book[7]) * 0.01, 0.015)];
    const current = book[8] !== null && book[9] !== null ? safeDevig(book[8], book[9]) : book[8] === null ? null : safeImplied(book[8]);
    const opened = book[10] !== null && book[11] !== null ? safeDevig(book[10], book[11]) : book[10] === null ? null : safeImplied(book[10]);
    if (current === null || opened === null) return [0];
    const delta = current - opened;
    return [Math.abs(delta) >= 0.015 ? clamp(delta * 0.35, 0.015) : 0];
  })) ?? 0, 0.015);
}

function targetExcludedSplits(books: readonly MlbPropsMarketEvidenceBook[], target: string): number {
  const values = books.filter((book) => normalizeBook(book[0]) !== target).flatMap((book) => book[12].map((split) => {
    const divergence = split[4] - split[3];
    if (Math.abs(divergence) < 0.05) return 0;
    const selected = clamp(divergence * 0.05, 0.005);
    return split[0] === "o" ? selected : -selected;
  }));
  return clamp(median(values) ?? 0, 0.005);
}

function relatedAdjustments(quote: Quote, quotes: Quote[]): number[] {
  const representative = quote.rows[0]!;
  const byMarket = new Map<string, number[]>();
  for (const candidate of quotes) {
    const row = candidate.rows[0]!;
    if (row.providerIds?.gameId !== representative.providerIds?.gameId
      || row.providerIds?.bdlPlayerId !== representative.providerIds?.bdlPlayerId
      || row.market === representative.market
      || cluster(row.market) !== cluster(representative.market)
      || candidate.targetBook !== quote.targetBook) continue;
    const adjustment = candidate.movementOver;
    if (Math.abs(adjustment) < 1e-9) continue;
    byMarket.set(row.market, [...(byMarket.get(row.market) ?? []), adjustment]);
  }
  return [...byMarket.values()].flatMap((values) => median(values) ?? []);
}

function coherentRelated(values: number[]): number {
  const material = values.filter((value) => Math.abs(value) >= 0.0025);
  if (material.length < 2 || material.some((value) => Math.sign(value) !== Math.sign(material[0]!))) return 0;
  return clamp((median(material) ?? 0) * 0.5, 0.0075);
}

function cluster(market: string): string {
  if (["pitcher_hits_allowed", "pitcher_walks", "pitcher_earned_runs"].includes(market)) return "pitcher_damage";
  if (["pitcher_outs", "pitcher_strikeouts"].includes(market)) return "pitcher_workload";
  if (market === "batter_strikeouts") return "batter_strikeouts";
  return "batter_production";
}

function breadth(value: number): string { return value >= 3 ? "3+" : String(value); }
function changed(row: CandidateRow): boolean { return different(row.projection, row.row.projection) || different(row.finalProbability, row.row.finalProbability) || row.grade !== row.row.playGrade; }
function different(left: number | null, right: number | null): boolean { return left === null || right === null ? left !== right : Math.abs(left - right) > 1e-9; }
function safeDevig(over: number, under: number): number | null { try { return remove_vig_two_way(over, under).over; } catch { return null; } }
function safeImplied(price: number): number | null { try { return american_to_implied_probability(price); } catch { return null; } }
function safeEv(probability: number, price: number): number | null { try { return expected_value(probability, price); } catch { return null; } }
function normalizeBook(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function clamp(value: number, maximum: number, upper = maximum): number { return upper === maximum ? Math.max(-maximum, Math.min(maximum, value)) : Math.max(maximum, Math.min(upper, value)); }
function median(values: readonly number[]): number | null { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2; }
function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> { const out = new Map<string, T[]>(); for (const row of rows) out.set(key(row), [...(out.get(key(row)) ?? []), row]); return out; }
function counts(values: readonly string[]): Record<string, number> { const out: Record<string, number> = {}; for (const value of values) out[value] = (out[value] ?? 0) + 1; return out; }
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function incumbentTuple(row: AuditRow): unknown { return [row.id, row.side, row.projection, row.finalProbability, row.playGrade, row.odds, row.units, row.lockStatus]; }
function candidateTuple(row: CandidateRow): unknown { return row.row.lockStatus?.status === "locked" ? incumbentTuple(row.row) : [row.row.id, row.row.side, row.projection, row.finalProbability, row.grade, row.row.odds, ACTIONABLE.has(row.grade) ? row.row.units : 0, row.row.lockStatus]; }
function option(name: string): string | null { const prefix = `--${name}=`; return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null; }
function easternDate(): string { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }

void main();
