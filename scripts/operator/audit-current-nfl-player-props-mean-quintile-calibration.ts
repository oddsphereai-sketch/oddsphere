#!/usr/bin/env tsx

/** SELECT-only current-board A/B for the market-selective mean-quintile release. */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import {
  NFL_PLAYER_PROPS_BOARD_RELEASE,
  NFL_PLAYER_PROPS_CALIBRATION_RELEASE,
  NFL_PLAYER_PROPS_DECISION_RELEASE,
  NFL_PLAYER_PROPS_MODEL_RELEASE,
  NFL_PLAYER_PROPS_RUNTIME_RELEASE,
  gradeNflPlayerPropsCrossMarketCandidate,
  nflPlayerPropsCoherentPosteriorDistribution,
  nflPlayerPropsExpectedValue,
  nflPlayerPropsOverProbability,
  nflPlayerPropsProductionMarketLane,
  nflPlayerPropsRawMarketDivergenceImplausible,
  nflPlayerPropsResidualProbability,
  nflPlayerPropsRuntimeMarketPolicy,
  nflPlayerPropsRuntimePolicy,
  type NflPlayerPropsGrade,
  type NflPlayerPropsRuntimeDecision,
} from "../../lib/services/football/nflPlayerPropsRuntime";
import { readNflPlayerPropsSnapshotRecord } from "../../lib/services/football/nflPlayerPropsSnapshotStore";

loadEnvConfig(process.cwd());

type Empirical = { family: "empirical_residual"; residualQuantiles: number[] };
type Distribution = Empirical | {
  family: "empirical_residual_mean_bucket";
  buckets: Array<{ lower: number; upper: number; distribution: Empirical }>;
  fallback: Empirical;
};
type RuntimeMarketArtifact = { distribution: Distribution };
type CandidateVariant = { row: NflPlayerPropsRuntimeDecision; independentProjection: number };

const PROMOTED_MARKETS = new Set([
  "passing_attempts", "passing_yards", "rushing_attempts", "rushing_yards", "receiving_yards",
]);
const MARKET_FILES: Record<string, string> = {
  passing_attempts: "nflPlayerPropsRuntimeMarketPassingAttempts.json",
  passing_yards: "nflPlayerPropsRuntimeMarketPassingYards.json",
  rushing_attempts: "nflPlayerPropsRuntimeMarketRushingAttempts.json",
  rushing_yards: "nflPlayerPropsRuntimeMarketRushingYards.json",
  receiving_yards: "nflPlayerPropsRuntimeMarketReceivingYards.json",
};

async function main(): Promise<void> {
  const client = createClient(requiredEnv("NEXT_PUBLIC_SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
  const season = Number(optional("--season") ?? "2026");
  const week = Number(optional("--week") ?? "5");
  const precedingRoot = required("--preceding-artifacts");
  const precedingDistributions = new Map<string, Distribution>();
  const candidateDistributions = new Map<string, Distribution>();
  for (const [market, filename] of Object.entries(MARKET_FILES)) {
    precedingDistributions.set(market, (await json<RuntimeMarketArtifact>(path.join(precedingRoot, filename))).distribution);
    candidateDistributions.set(market, (await json<RuntimeMarketArtifact>(
      path.join(process.cwd(), "lib/services/football/modelArtifacts", filename),
    )).distribution);
  }
  const record = await readNflPlayerPropsSnapshotRecord({ client, season, week });
  if (!record) throw new Error("NFL player-props production snapshot is unavailable.");
  const incumbentRows = record.snapshot.memberDecisions;
  const incumbentOrdinary = incumbentRows.find((row) => row.market !== "anytime_td");
  const selected: NflPlayerPropsRuntimeDecision[] = [];
  const uncertainty: Array<{ row: NflPlayerPropsRuntimeDecision; variants: CandidateVariant[] }> = [];
  let recoveredPassingRows = 0;
  for (const row of incumbentRows) {
    const variants = candidateVariants(
      row,
      precedingDistributions.get(row.market),
      candidateDistributions.get(row.market),
    );
    if (variants.length > 1) recoveredPassingRows += 1;
    const grades = new Set(variants.map((value) => value.row.grade));
    const forecasts = new Set(variants.map((value) => forecastSide(value.row)));
    if (grades.size > 1 || forecasts.size > 1) uncertainty.push({ row, variants });
    selected.push(closestVariant(row, variants).row);
  }
  const changes = incumbentRows.flatMap((before, index) => {
    const after = selected[index]!;
    return before.finalProbability !== after.finalProbability || before.projection !== after.projection || before.grade !== after.grade
      ? [{ before, after }]
      : [];
  });
  const promotions = changes.filter(({ before, after }) => !actionable(before) && actionable(after));
  const demotions = changes.filter(({ before, after }) => actionable(before) && !actionable(after));
  const result = {
    release: "nfl_player_props_current_market_selective_mean_quintile_audit_2026_10_07_r1",
    readOnly: true,
    writes: 0,
    providerCalls: 0,
    season,
    week,
    generatedAt: record.generatedAt,
    rows: incumbentRows.length,
    matchedRows: selected.length,
    lockedRowsPreserved: incumbentRows.filter((row) => row.state === "locked").length,
    independentPointProjectionChanges: 0,
    recoveredPassingRows,
    gradeOrForecastAmbiguousRows: uncertainty.length,
    gradeOrForecastAmbiguousDetails: uncertainty.map(({ row, variants }) => ({
      gameId: row.gameId,
      playerName: row.playerName,
      market: row.market,
      line: row.line,
      side: row.side,
      sportsbook: row.sportsbook,
      incumbentGrade: row.grade,
      variants: variants.map((value) => ({
        independentProjection: value.independentProjection,
        finalProbability: value.row.finalProbability,
        forecast: forecastSide(value.row),
        grade: value.row.grade,
      })),
    })),
    incumbent: {
      snapshotRelease: record.snapshot.release,
      boardRelease: record.snapshot.board.release,
      runtimeRelease: "nfl_player_props_runtime_2026_10_07_r21_discrete_market_arbitration",
      modelRelease: incumbentOrdinary?.modelRelease ?? null,
      calibrationRelease: incumbentOrdinary?.calibrationRelease ?? null,
      decisionRelease: incumbentOrdinary?.decisionRelease ?? null,
      ...summarize(incumbentRows),
    },
    candidate: {
      runtimeRelease: NFL_PLAYER_PROPS_RUNTIME_RELEASE,
      boardRelease: NFL_PLAYER_PROPS_BOARD_RELEASE,
      modelRelease: NFL_PLAYER_PROPS_MODEL_RELEASE,
      calibrationRelease: NFL_PLAYER_PROPS_CALIBRATION_RELEASE,
      decisionRelease: NFL_PLAYER_PROPS_DECISION_RELEASE,
      ...summarize(selected),
      actionableRange: {
        minimum: selected.filter(actionable).length + uncertainty.reduce((sum, value) =>
          sum + Math.min(...value.variants.map((variant) => Number(actionable(variant.row))))
            - Number(actionable(closestVariant(value.row, value.variants).row)), 0),
        maximum: selected.filter(actionable).length + uncertainty.reduce((sum, value) =>
          sum + Math.max(...value.variants.map((variant) => Number(actionable(variant.row))))
            - Number(actionable(closestVariant(value.row, value.variants).row)), 0),
      },
    },
    changedRows: changes.length,
    forecastSideChanges: changes.filter(({ before, after }) => forecastSide(before) !== forecastSide(after)).length,
    gradeChanges: changes.filter(({ before, after }) => before.grade !== after.grade).length,
    promotions: promotions.length,
    demotions: demotions.length,
    nonpositiveEvActionables: selected.filter((row) => actionable(row) && row.expectedValue <= 0).length,
    promotionDetails: promotions.map(transition),
    demotionDetails: demotions.map(transition),
    changeExamples: changes.slice(0, 60).map(transition),
  };
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  const output = optional("--output");
  if (output) await writeFile(output, serialized, "utf8");
  console.log(serialized);
}

function candidateVariants(
  row: NflPlayerPropsRuntimeDecision,
  preceding?: Distribution,
  candidate?: Distribution,
): CandidateVariant[] {
  if (row.state === "locked" || !PROMOTED_MARKETS.has(row.market) || row.side === "yes" || !preceding || !candidate) {
    return [{ row, independentProjection: row.projection ?? 0 }];
  }
  const evidence = row.projectionEvidence;
  if (!evidence) return [{ row, independentProjection: row.projection ?? 0 }];
  const projections = evidence.source === "single_posterior_distribution"
    ? [evidence.independentProjection]
    : recoverProjectionSamples(row, preceding, candidate);
  if (!projections.length) throw new Error(`Cannot recover preceding point projection for ${row.playerName} ${row.market}.`);
  const variants = new Map<string, CandidateVariant>();
  for (const independentProjection of projections) {
    const candidate = scoreCandidate(row, independentProjection);
    const key = `${candidate.finalProbability}|${candidate.projection}|${candidate.grade}|${forecastSide(candidate)}`;
    variants.set(key, { row: candidate, independentProjection });
  }
  return [...variants.values()];
}

function recoverProjectionSamples(
  row: NflPlayerPropsRuntimeDecision,
  preceding: Distribution,
  candidate: Distribution,
): number[] {
  if (preceding.family === "empirical_residual") return [];
  const rawOver = row.side === "over" ? row.rawModelProbability : 1 - row.rawModelProbability;
  const finalOver = row.side === "over" ? row.finalProbability : 1 - row.finalProbability;
  const intervals: Array<[number, number]> = [];
  for (const bucket of preceding.buckets) {
    const residuals = bucket.distribution.residualQuantiles;
    const below = Math.round((1 - rawOver) * residuals.length);
    if (Math.abs(1 - below / residuals.length - rawOver) > 1e-10) continue;
    let lower = bucket.lower;
    let upper = bucket.upper;
    if (below < residuals.length) lower = Math.max(lower, row.line - residuals[below]!);
    if (below > 0) upper = Math.min(upper, row.line - residuals[below - 1]!);
    if (lower > upper) continue;
    const location = row.line - interpolatedQuantile(residuals, 1 - finalOver);
    const published = Math.max(0, location + interpolatedQuantile(residuals, 0.5));
    if (row.projection === null || Math.abs(published - row.projection) > 1e-8) continue;
    intervals.push([lower, upper]);
  }
  const points: number[] = [];
  for (const [lower, upper] of intervals) {
    const boundaries = [lower, upper];
    const candidateBuckets = candidate.family === "empirical_residual"
      ? [{ lower: Number.NEGATIVE_INFINITY, upper: Number.POSITIVE_INFINITY, distribution: candidate }]
      : candidate.buckets;
    for (const bucket of candidateBuckets) {
      if (bucket.lower >= lower && bucket.lower <= upper) boundaries.push(bucket.lower);
      if (bucket.upper >= lower && bucket.upper <= upper) boundaries.push(bucket.upper);
      for (const residual of bucket.distribution.residualQuantiles) {
        const value = row.line - residual;
        if (value >= lower && value <= upper && value >= bucket.lower && value <= bucket.upper) boundaries.push(value);
      }
    }
    const ordered = [...new Set(boundaries)].sort((first, second) => first - second);
    points.push(...ordered);
    for (let index = 1; index < ordered.length; index += 1) {
      points.push((ordered[index - 1]! + ordered[index]!) / 2);
    }
  }
  return [...new Set(points.map((value) => value.toPrecision(15)))].map(Number);
}

function scoreCandidate(row: NflPlayerPropsRuntimeDecision, independentProjection: number): NflPlayerPropsRuntimeDecision {
  const rawOver = nflPlayerPropsOverProbability(row.market, independentProjection, row.line);
  const marketOver = row.side === "over" ? row.marketProbability : 1 - row.marketProbability;
  const independentBooks = new Set(row.bookEvidence
    .filter((book) => normalize(book.sportsbook) !== normalize(row.sportsbook))
    .map((book) => normalize(book.sportsbook))).size;
  const policy = nflPlayerPropsRuntimePolicy();
  const marketPolicy = nflPlayerPropsRuntimeMarketPolicy(row.market);
  const passingWorkload = row.projectionEvidence?.source === "market_dominant_expected_starter";
  const finalOver = passingWorkload
    ? rawOver
    : independentBooks > 0
      ? nflPlayerPropsResidualProbability(rawOver, marketOver, marketPolicy?.weight ?? 0)
      : rawOver;
  const finalProbability = row.side === "over" ? finalOver : 1 - finalOver;
  const marketProbability = row.side === "over" ? marketOver : 1 - marketOver;
  const rawProbability = row.side === "over" ? rawOver : 1 - rawOver;
  const edge = finalProbability - marketProbability;
  const expectedValue = nflPlayerPropsExpectedValue(finalProbability, row.americanPrice);
  const divergenceImplausible = nflPlayerPropsRawMarketDivergenceImplausible(rawProbability, marketProbability);
  const commonHolds = row.healthHolds.filter((reason) =>
    reason !== "model_market_divergence_implausible"
    && reason !== "independent_same_line_confirmation_missing");
  const lane = nflPlayerPropsProductionMarketLane(row.market);
  const leanThresholds = row.marketMovement === "support"
    ? policy.volumeAndYardage.movementSupportedLean
    : lane?.leanThresholds ?? policy.volumeAndYardage.lean;
  const bestAngleThresholds = row.marketMovement === "support"
    ? policy.volumeAndYardage.movementSupportedBestAngle
    : policy.volumeAndYardage.bestAngle;
  const baseGrade = gradeNflPlayerPropsCrossMarketCandidate({
    commonHolds,
    independentBooks,
    divergenceImplausible,
    eligibleSide: lane?.eligibleSides.includes(row.side as "over" | "under") ?? false,
    marketResidualQualified: marketPolicy?.qualified === true || policy.releaseEvidence.ownerApprovedForwardException === true,
    bestAngleEnabled: lane?.bestAngle === true,
    leanEnabled: lane?.lean === true,
    watchlistEnabled: lane?.watchlist === true,
    expectedValue,
    probabilityEdge: edge,
    participationProbability: row.participationProbability,
    movement: row.marketMovement,
    leanThresholds,
    bestAngleThresholds,
  });
  const selectedForecastSide = finalOver >= 0.5 ? "over" : "under";
  let grade: NflPlayerPropsGrade = (baseGrade === "Best Angle" || baseGrade === "Lean") && row.side !== selectedForecastSide
    ? "Watchlist"
    : baseGrade;
  if (row.market === "passing_yards" && grade === "No Play" && row.grade === "Watchlist"
    && commonHolds.length === 0 && !divergenceImplausible && row.marketMovement !== "adverse"
    && expectedValue >= 0 && edge >= 0) grade = "Watchlist";
  const posterior = nflPlayerPropsCoherentPosteriorDistribution({
    market: row.market,
    line: row.line,
    calibratedOverProbability: finalOver,
    independentProjection,
  });
  return {
    ...row,
    projection: posterior.projection,
    projectionRange: posterior.range,
    rawModelProbability: rawProbability,
    finalProbability,
    probabilityEdge: edge,
    expectedValue,
    grade,
    healthHolds: divergenceImplausible ? [...commonHolds, "model_market_divergence_implausible"] : commonHolds,
    modelRelease: NFL_PLAYER_PROPS_MODEL_RELEASE,
    calibrationRelease: NFL_PLAYER_PROPS_CALIBRATION_RELEASE,
    decisionRelease: NFL_PLAYER_PROPS_DECISION_RELEASE,
  };
}

function closestVariant(row: NflPlayerPropsRuntimeDecision, variants: CandidateVariant[]): CandidateVariant {
  const target = row.projectionEvidence?.source === "market_dominant_expected_starter"
    ? row.projectionEvidence.marketConsensus
    : row.projectionEvidence?.source === "single_posterior_distribution"
      ? row.projectionEvidence.independentProjection
      : row.projection ?? 0;
  return variants.reduce((best, value) => Math.abs(value.independentProjection - target) < Math.abs(best.independentProjection - target) ? value : best);
}

function summarize(rows: NflPlayerPropsRuntimeDecision[]): Record<string, unknown> {
  const grades = ["Best Angle", "Lean", "Watchlist", "No Play", "Held"] as const;
  const markets = [...new Set(rows.map((row) => row.market))].sort();
  return {
    grades: Object.fromEntries(grades.map((grade) => [grade, rows.filter((row) => row.grade === grade).length])),
    actionable: rows.filter(actionable).length,
    markets: Object.fromEntries(markets.map((market) => {
      const values = rows.filter((row) => row.market === market);
      return [market, {
        rows: values.length,
        actionable: values.filter(actionable).length,
        actionableOver: values.filter((row) => actionable(row) && forecastSide(row) === "over").length,
        actionableUnder: values.filter((row) => actionable(row) && forecastSide(row) === "under").length,
        actionableYes: values.filter((row) => actionable(row) && forecastSide(row) === "yes").length,
      }];
    })),
  };
}

function transition({ before, after }: { before: NflPlayerPropsRuntimeDecision; after: NflPlayerPropsRuntimeDecision }): Record<string, unknown> {
  return {
    gameId: before.gameId, playerName: before.playerName, market: before.market, line: before.line,
    side: before.side, sportsbook: before.sportsbook,
    beforeProbability: before.finalProbability, afterProbability: after.finalProbability,
    beforeProjection: before.projection, afterProjection: after.projection,
    beforeForecast: forecastSide(before), afterForecast: forecastSide(after),
    beforeGrade: before.grade, afterGrade: after.grade,
  };
}

function interpolatedQuantile(values: number[], probability: number): number {
  const position = Math.max(0, Math.min(1, probability)) * (values.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return values[lower]! * (1 - weight) + values[upper]! * weight;
}
function actionable(row: Pick<NflPlayerPropsRuntimeDecision, "grade">): boolean { return row.grade === "Best Angle" || row.grade === "Lean"; }
function forecastSide(row: Pick<NflPlayerPropsRuntimeDecision, "side" | "finalProbability">): string {
  if (row.side === "yes") return "yes";
  return row.finalProbability >= 0.5 ? row.side : row.side === "over" ? "under" : "over";
}
function normalize(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function optional(flag: string): string | null {
  const prefix = `${flag}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}
function required(flag: string): string { const value = optional(flag); if (!value) throw new Error(`${flag} is required.`); return value; }
function requiredEnv(name: string): string { const value = process.env[name]; if (!value) throw new Error(`${name} is required.`); return value; }
async function json<T>(filename: string): Promise<T> { return JSON.parse(await readFile(filename, "utf8")) as T; }

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
