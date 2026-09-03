/** SELECT-only replay of the NFL props r10 structural forecast-authority correction. */
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
  nflPlayerPropsPassingYardsWatchlistEligible,
  nflPlayerPropsProductionMarketLane,
  nflPlayerPropsRawMarketDivergenceImplausible,
  nflPlayerPropsRuntimeMarketPolicy,
  nflPlayerPropsRuntimePolicy,
  type NflPlayerPropsGrade,
  type NflPlayerPropsRuntimeDecision,
} from "../../lib/services/football/nflPlayerPropsRuntime";
import { NFL_PLAYER_PROPS_PRODUCTION_CANDIDATE_RELEASE } from "../../lib/services/football/nflPlayerPropsProductionContract";
import { NFL_PLAYER_PROPS_WRITER_RELEASE } from "../../lib/services/football/nflPlayerPropsProductionWriter";
import { NFL_PLAYER_PROPS_TRACKING_RELEASE } from "../../lib/services/football/nflPlayerPropsTrackingStore";
import { readNflPlayerPropsSnapshotRecord } from "../../lib/services/football/nflPlayerPropsSnapshotStore";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase read credentials are required.");

type Candidate = Pick<NflPlayerPropsRuntimeDecision,
  "projection" | "rawModelProbability" | "marketProbability" | "finalProbability"
  | "probabilityEdge" | "expectedValue" | "grade" | "side"
>;
type Change = { row: NflPlayerPropsRuntimeDecision; candidate: Candidate; delta: ReturnType<typeof delta> };

async function main(): Promise<void> {
  const client = createClient(url!, key!, { auth: { persistSession: false } });
  const record = await readNflPlayerPropsSnapshotRecord({ client, season: 2026, week: 1 });
  if (!record) throw new Error("NFL props snapshot unavailable.");
  const snapshot = record.snapshot;
  const changes: Change[] = snapshot.board.decisions.map((row) => {
    const candidate = replay(row);
    return { row, candidate, delta: delta(row, candidate) };
  });
  const categories = [
    "anytime_td", "passing_attempts", "passing_completions", "passing_yards",
    "receiving_yards", "receptions", "rushing_attempts", "rushing_yards",
  ];
  const byCategory = Object.fromEntries(categories.map((market) => [
    market, summarize(changes.filter(({ row }) => row.market === market)),
  ]));
  const locked = changes.filter(({ row }) => row.state === "locked");
  const promotions = changes.filter(({ row, candidate }) => !actionable(row.grade) && actionable(candidate.grade));
  const demotions = changes.filter(({ row, candidate }) => actionable(row.grade) && !actionable(candidate.grade));
  const candidateContradictions = changes.filter(({ row, candidate }) => actionable(candidate.grade)
    && row.market !== "anytime_td" && candidate.projection !== null
    && (row.side === "over" ? candidate.projection <= row.line : candidate.projection >= row.line));
  const targetFallback = changes.filter(({ row }) => row.healthHolds.includes("independent_same_line_confirmation_missing"));
  const selfValidatedFallback = targetFallback.filter(({ candidate }) =>
    candidate.marketProbability !== candidate.rawModelProbability
    || candidate.finalProbability !== candidate.rawModelProbability);
  const flattened = categories.filter((market) => {
    const value = byCategory[market] as ReturnType<typeof summarize>;
    return value.incumbentActionable > 0 && value.candidateActionable === 0;
  });
  const violations = [
    ...(locked.some(({ delta: value }) => value.behaviorChanged) ? ["locked_record_changed"] : []),
    ...(selfValidatedFallback.length ? ["evaluated_offer_self_validation_remains"] : []),
    ...(candidateContradictions.length ? ["actionable_projection_side_contradiction"] : []),
    ...(flattened.length ? ["actionable_category_flattened"] : []),
  ];
  console.log(JSON.stringify({
    auditRelease: "nfl_player_props_forecast_authority_audit_2026_09_03_r1",
    readOnly: true, databaseSelects: 1, providerCalls: 0, writes: 0,
    incumbent: {
      generatedAt: record.generatedAt, memberRelease: snapshot.release,
      boardRelease: snapshot.board.release, rows: changes.length,
      memberRows: snapshot.memberDecisions.length, counts: snapshot.board.counts,
    },
    candidateReleases: {
      runtime: NFL_PLAYER_PROPS_RUNTIME_RELEASE, board: NFL_PLAYER_PROPS_BOARD_RELEASE,
      decision: NFL_PLAYER_PROPS_DECISION_RELEASE, model: NFL_PLAYER_PROPS_MODEL_RELEASE,
      calibration: NFL_PLAYER_PROPS_CALIBRATION_RELEASE,
      member: NFL_PLAYER_PROPS_PRODUCTION_CANDIDATE_RELEASE,
      writer: NFL_PLAYER_PROPS_WRITER_RELEASE, tracking: NFL_PLAYER_PROPS_TRACKING_RELEASE,
    },
    total: summarize(changes), byCategory,
    authority: {
      evaluationOnlyRows: targetFallback.length,
      evaluationOnlySelfValidatedRows: selfValidatedFallback.length,
      qbPointEvidenceRows: changes.filter(({ row }) => row.market === "passing_yards"
        && row.projectionEvidence?.source === "market_dominant_expected_starter").length,
      qbResidualReapplications: 0,
      incumbentActionableProjectionSideContradictions: changes.filter(({ row }) => actionable(row.grade)
        && row.market !== "anytime_td" && row.projection !== null
        && (row.side === "over" ? row.projection <= row.line : row.projection >= row.line)).length,
      candidateActionableProjectionSideContradictions: candidateContradictions.length,
      evaluatedQuoteRole: "exact_price_ev_and_grade_only",
    },
    actionability: { promotions: promotions.length, demotions: demotions.length, flattenedCategories: flattened },
    locks: { rows: locked.length, changedRows: locked.filter(({ delta: value }) => value.behaviorChanged).length },
    budgets: { providerCallsChanged: 0, queryCountChanged: 0, writesChanged: 0, leaseChanged: false },
    qualification: { status: violations.length ? "held" : "qualified_local_source_candidate", violations },
    ...(process.argv.includes("--summary") ? {} : {
      changedRows: changes.filter(({ delta: value }) => value.behaviorChanged).map(({ row, candidate, delta: value }) => ({
        gameId: row.gameId, player: row.playerName, market: row.market, line: row.line,
        side: row.side, book: row.sportsbook, incumbent: pick(row), candidate, delta: value,
      })),
    }),
  }, null, process.argv.includes("--compact") ? 0 : 2));
  if (violations.length) throw new Error(`NFL props r10 replay held: ${violations.join(", ")}`);
}

function replay(row: NflPlayerPropsRuntimeDecision): Candidate {
  if (row.state === "locked") return pick(row);
  const missingAlternative = row.healthHolds.includes("independent_same_line_confirmation_missing");
  if (row.market === "anytime_td") {
    if (!missingAlternative) return pick(row);
    const finalProbability = row.rawModelProbability;
    return { ...pick(row), marketProbability: finalProbability, finalProbability,
      probabilityEdge: 0, expectedValue: nflPlayerPropsExpectedValue(finalProbability, row.americanPrice) };
  }
  const overRow = row.side === "over";
  const incumbentRawOver = overRow ? row.rawModelProbability : 1 - row.rawModelProbability;
  const incumbentMarketOver = overRow ? row.marketProbability : 1 - row.marketProbability;
  const qbPointApplied = row.market === "passing_yards"
    && row.projectionEvidence?.source === "market_dominant_expected_starter";
  const finalOver = missingAlternative || qbPointApplied
    ? incumbentRawOver
    : overRow ? row.finalProbability : 1 - row.finalProbability;
  const marketOver = missingAlternative ? incumbentRawOver : incumbentMarketOver;
  const finalProbability = overRow ? finalOver : 1 - finalOver;
  const marketProbability = overRow ? marketOver : 1 - marketOver;
  const rawModelProbability = overRow ? incumbentRawOver : 1 - incumbentRawOver;
  const projectionEvidence = row.projectionEvidence as { source?: string; independentProjection?: number } | undefined;
  const projectionSource = projectionEvidence?.source;
  const independentProjection = projectionSource === "probability_inverse_market_calibrated"
    || projectionSource === "single_posterior_distribution"
    ? projectionEvidence?.independentProjection ?? row.projection ?? row.line
    : row.projection ?? row.line;
  const projection = missingAlternative && !qbPointApplied
    ? row.projection
    : nflPlayerPropsCoherentPosteriorDistribution({
        market: row.market, line: row.line,
        calibratedOverProbability: finalOver, independentProjection,
      }).projection;
  const probabilityEdge = finalProbability - marketProbability;
  const expectedValue = nflPlayerPropsExpectedValue(finalProbability, row.americanPrice);
  const policy = nflPlayerPropsRuntimeMarketPolicy(row.market);
  const lane = nflPlayerPropsProductionMarketLane(row.market);
  if (!policy || !lane) return pick(row);
  const independentBooks = new Set(row.bookEvidence.map((book) => normalizeBook(book.sportsbook))
    .filter((book) => book !== normalizeBook(row.sportsbook))).size;
  const commonHolds = row.healthHolds.filter((reason) => ![
    "independent_same_line_confirmation_missing", "model_market_divergence_implausible",
  ].includes(reason));
  const divergenceImplausible = nflPlayerPropsRawMarketDivergenceImplausible(rawModelProbability, marketProbability);
  const runtime = nflPlayerPropsRuntimePolicy();
  const leanThresholds = row.marketMovement === "support"
    ? runtime.volumeAndYardage.movementSupportedLean
    : lane.leanThresholds ?? runtime.volumeAndYardage.lean;
  const bestAngleThresholds = row.marketMovement === "support"
    ? runtime.volumeAndYardage.movementSupportedBestAngle
    : runtime.volumeAndYardage.bestAngle;
  const baseGrade = gradeNflPlayerPropsCrossMarketCandidate({
    commonHolds, independentBooks, divergenceImplausible,
    eligibleSide: lane.eligibleSides.includes(row.side as "over" | "under"),
    marketResidualQualified: policy.qualified || runtime.releaseEvidence.ownerApprovedForwardException === true,
    bestAngleEnabled: lane.bestAngle, leanEnabled: lane.lean, watchlistEnabled: lane.watchlist,
    expectedValue, probabilityEdge, participationProbability: row.participationProbability,
    movement: row.marketMovement, leanThresholds, bestAngleThresholds,
  });
  const bridged = baseGrade === "No Play" && row.market === "passing_yards" && row.grade === "Watchlist"
    && nflPlayerPropsPassingYardsWatchlistEligible({
      market: row.market, commonHolds, primaryTarget: true, independentMarketBooks: independentBooks,
      divergenceImplausible, movement: row.marketMovement, expectedValue, probabilityEdge,
    }) ? "Watchlist" : baseGrade;
  const forecastSide = finalOver >= 0.5 ? "over" : "under";
  const grade: NflPlayerPropsGrade = actionable(bridged) && row.side !== forecastSide ? "Watchlist" : bridged;
  return { projection, rawModelProbability, marketProbability, finalProbability,
    probabilityEdge, expectedValue, grade, side: row.side };
}

function pick(row: NflPlayerPropsRuntimeDecision): Candidate {
  return { projection: row.projection, rawModelProbability: row.rawModelProbability,
    marketProbability: row.marketProbability, finalProbability: row.finalProbability,
    probabilityEdge: row.probabilityEdge, expectedValue: row.expectedValue, grade: row.grade, side: row.side };
}
function delta(row: NflPlayerPropsRuntimeDecision, candidate: Candidate) {
  const projection = numericDelta(row.projection, candidate.projection);
  const rawProbability = clean(candidate.rawModelProbability - row.rawModelProbability);
  const marketProbability = clean(candidate.marketProbability - row.marketProbability);
  const finalProbability = clean(candidate.finalProbability - row.finalProbability);
  return { projection, rawProbability, marketProbability, finalProbability,
    sideChanged: row.side !== candidate.side, gradeChanged: row.grade !== candidate.grade,
    behaviorChanged: projection !== 0 || rawProbability !== 0 || marketProbability !== 0
      || finalProbability !== 0 || row.side !== candidate.side || row.grade !== candidate.grade };
}
function summarize(values: Change[]) {
  return { rows: values.length,
    incumbentGrades: counts(values.map(({ row }) => row.grade)),
    candidateGrades: counts(values.map(({ candidate }) => candidate.grade)),
    incumbentActionable: values.filter(({ row }) => actionable(row.grade)).length,
    candidateActionable: values.filter(({ candidate }) => actionable(candidate.grade)).length,
    projectionChanges: values.filter(({ delta: value }) => value.projection !== 0).length,
    rawProbabilityChanges: values.filter(({ delta: value }) => value.rawProbability !== 0).length,
    marketProbabilityChanges: values.filter(({ delta: value }) => value.marketProbability !== 0).length,
    finalProbabilityChanges: values.filter(({ delta: value }) => value.finalProbability !== 0).length,
    sideChanges: values.filter(({ delta: value }) => value.sideChanged).length,
    gradeChanges: values.filter(({ delta: value }) => value.gradeChanged).length,
    promotions: values.filter(({ row, candidate }) => !actionable(row.grade) && actionable(candidate.grade)).length,
    demotions: values.filter(({ row, candidate }) => actionable(row.grade) && !actionable(candidate.grade)).length,
    maxAbsProjectionDelta: maximum(values.map(({ delta: value }) => Math.abs(value.projection))),
    maxAbsFinalProbabilityDelta: maximum(values.map(({ delta: value }) => Math.abs(value.finalProbability))),
  };
}
function counts(values: string[]): Record<string, number> { return Object.fromEntries([...new Set(values)].sort().map((value) => [value, values.filter((item) => item === value).length])); }
function actionable(grade: NflPlayerPropsGrade): boolean { return grade === "Best Angle" || grade === "Lean"; }
function normalizeBook(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function numericDelta(a: number | null, b: number | null): number { return a === null || b === null ? a === b ? 0 : Number.NaN : clean(b - a); }
function clean(value: number): number { return Number.isFinite(value) && Math.abs(value) <= 1e-12 ? 0 : value; }
function maximum(values: number[]): number { return values.length ? Math.max(...values) : 0; }

void main();
