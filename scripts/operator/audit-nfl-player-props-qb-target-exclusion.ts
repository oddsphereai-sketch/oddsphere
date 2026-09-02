/**
 * SELECT-only replay of the narrow NFL QB passing target-exclusion candidate.
 * It reads one immutable snapshot, calls no provider, and writes nothing.
 */
import { createHash } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import type {
  NflPlayerPropsMarketEvidenceBook,
  NflPlayerPropsMarketEvidenceIdentity,
} from "../../lib/services/football/nflPlayerPropsMarketEvidenceCapture";
import type { NflPlayerPropsRuntimeDecision } from "../../lib/services/football/nflPlayerPropsRuntime";
import {
  NFL_PLAYER_PROPS_BOARD_RELEASE,
  NFL_PLAYER_PROPS_CALIBRATION_RELEASE,
  NFL_PLAYER_PROPS_DECISION_RELEASE,
  NFL_PLAYER_PROPS_MODEL_RELEASE,
  NFL_PLAYER_PROPS_QB_PASSING_PROJECTION,
  NFL_PLAYER_PROPS_RUNTIME_RELEASE,
  gradeNflPlayerPropsCrossMarketCandidate,
  nflPlayerPropsExpectedValue,
  nflPlayerPropsMarketImpliedCenter,
  nflPlayerPropsOverProbability,
  nflPlayerPropsPassingYardsWatchlistEligible,
  nflPlayerPropsProductionMarketLane,
  nflPlayerPropsRawMarketDivergenceImplausible,
  nflPlayerPropsResidualProbability,
  nflPlayerPropsRuntimeMarketPolicy,
  nflPlayerPropsRuntimePolicy,
  nflPlayerPropsTransportedMarketProbability,
} from "../../lib/services/football/nflPlayerPropsRuntime";
import { NFL_PLAYER_PROPS_PRODUCTION_CANDIDATE_RELEASE } from "../../lib/services/football/nflPlayerPropsProductionContract";
import { NFL_PLAYER_PROPS_WRITER_RELEASE } from "../../lib/services/football/nflPlayerPropsProductionWriter";
import { NFL_PLAYER_PROPS_TRACKING_RELEASE } from "../../lib/services/football/nflPlayerPropsTrackingStore";
import { readNflPlayerPropsSnapshotRecord } from "../../lib/services/football/nflPlayerPropsSnapshotStore";

loadEnvConfig(process.cwd());

const season = integerOption("season", 2026);
const week = integerOption("week", 1);
const expectedIncumbentRelease = {
  member: "nfl_player_props_member_2026_09_01_r14_market_coherent_projection",
  board: "nfl_player_props_board_2026_09_01_r11_market_coherent_projection",
  decision: "nfl_player_props_decision_2026_09_01_r8_market_coherent_projection",
} as const;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase read credentials are required.");

type Grade = NflPlayerPropsRuntimeDecision["grade"];
type Candidate = Pick<NflPlayerPropsRuntimeDecision,
  "projection" | "rawModelProbability" | "marketProbability" | "finalProbability"
  | "probabilityEdge" | "expectedValue" | "grade" | "side"
>;
type PassingBook = { book: string; line: number; over: number; observedAt: string; identityId: string };

async function main(): Promise<void> {
  const client = createClient(url!, key!, { auth: { persistSession: false } });
  const record = await readNflPlayerPropsSnapshotRecord({ client, season, week });
  if (!record) throw new Error(`NFL props snapshot unavailable for ${season} Week ${week}.`);
  const snapshot = record.snapshot;
  const capture = snapshot.board.marketEvidence;
  if (!capture) throw new Error("NFL props snapshot has no market-evidence capture.");
  const evidence = new Map(capture.i.map((identity) => [identity[0], identity]));
  const rowsByEvidence = new Map<string, NflPlayerPropsRuntimeDecision[]>();
  for (const row of snapshot.board.decisions) {
    if (!row.marketEvidenceId) continue;
    rowsByEvidence.set(row.marketEvidenceId, [...(rowsByEvidence.get(row.marketEvidenceId) ?? []), row]);
  }
  const passingBooks = new Map<string, PassingBook[]>();
  for (const identity of capture.i) {
    if (identity[1] !== "py") continue;
    const representative = rowsByEvidence.get(identity[0])?.[0];
    if (!representative) continue;
    const group = playerKey(representative);
    for (const book of identity[2]) {
      const over = noVigOver(book);
      if (over === null) continue;
      passingBooks.set(group, [...(passingBooks.get(group) ?? []), {
        book: normalizeBook(book[0]), line: representative.line, over,
        observedAt: book[3], identityId: identity[0],
      }]);
    }
  }
  for (const [group, books] of passingBooks) passingBooks.set(group, selectPrimaryBooks(books));

  const changes = snapshot.board.decisions.map((row) => {
    const candidate = replayRow(row, evidence, passingBooks);
    return { row, candidate, delta: delta(row, candidate) };
  });
  const categories = [
    "anytime_td", "passing_attempts", "passing_completions", "passing_yards",
    "receiving_yards", "receptions", "rushing_attempts", "rushing_yards",
  ];
  const byCategory = Object.fromEntries(categories.map((market) => {
    const selected = changes.filter(({ row }) => row.market === market);
    return [market, summarize(selected)];
  }));
  const locked = changes.filter(({ row }) => row.state === "locked");
  const nonPassing = changes.filter(({ row }) => row.market !== "passing_yards");
  const passing = changes.filter(({ row }) => row.market === "passing_yards");
  const passingAlternativeBreadth = passing.map(({ row }) => {
    const target = normalizeBook(row.sportsbook);
    return (passingBooks.get(playerKey(row)) ?? []).filter((book) => book.book !== target).length;
  });
  const promotions = changes.filter(({ row, candidate }) => !actionable(row.grade) && actionable(candidate.grade));
  const demotions = changes.filter(({ row, candidate }) => actionable(row.grade) && !actionable(candidate.grade));
  const zeroAlternativeActionableRows = passing.filter(({ row, candidate }) => {
    const target = normalizeBook(row.sportsbook);
    const alternatives = (passingBooks.get(playerKey(row)) ?? []).filter((book) => book.book !== target);
    return alternatives.length === 0 && actionable(candidate.grade);
  });
  const flattenedActionableCategories = categories.filter((market) => {
    const summary = byCategory[market];
    return summary.incumbentActionable > 0 && summary.candidateActionable === 0;
  });
  const unlockedDecisionReleases = counts(changes
    .filter(({ row }) => row.state !== "locked")
    .map(({ row }) => row.decisionRelease));
  const releasePure = String(snapshot.release) === expectedIncumbentRelease.member
    && String(snapshot.board.release) === expectedIncumbentRelease.board
    && Object.keys(unlockedDecisionReleases).length === 1
    && unlockedDecisionReleases[expectedIncumbentRelease.decision] === changes.filter(({ row }) => row.state !== "locked").length;
  const violations = [
    ...(!releasePure ? ["incumbent_release_mismatch"] : []),
    ...(nonPassing.some(({ delta: value }) => value.behaviorChanged) ? ["non_passing_behavior_changed"] : []),
    ...(locked.some(({ delta: value }) => value.behaviorChanged) ? ["locked_record_changed"] : []),
    ...(zeroAlternativeActionableRows.length > 0 ? ["evaluation_only_passing_row_actionable"] : []),
    ...(demotions.length > 0 && promotions.length === 0 ? ["actionable_demotions_without_promotion_path"] : []),
    ...(flattenedActionableCategories.length > 0 ? ["previously_actionable_category_flattened"] : []),
  ];
  const output = {
    auditRelease: "nfl_player_props_qb_target_exclusion_audit_2026_09_02_r1",
    readOnly: true,
    databaseSelects: 1,
    providerCalls: 0,
    writes: 0,
    baseSnapshot: {
      generatedAt: record.generatedAt,
      release: snapshot.release,
      boardRelease: snapshot.board.release,
      rows: changes.length,
      memberRows: snapshot.memberDecisions.length,
      counts: snapshot.board.counts,
    },
    incumbentReleasePurity: {
      expected: expectedIncumbentRelease,
      unlockedDecisionReleases,
      releasePure,
    },
    candidateReleases: {
      runtime: NFL_PLAYER_PROPS_RUNTIME_RELEASE,
      board: NFL_PLAYER_PROPS_BOARD_RELEASE,
      decision: NFL_PLAYER_PROPS_DECISION_RELEASE,
      model: NFL_PLAYER_PROPS_MODEL_RELEASE,
      calibration: NFL_PLAYER_PROPS_CALIBRATION_RELEASE,
      qbProjection: NFL_PLAYER_PROPS_QB_PASSING_PROJECTION.release,
      member: NFL_PLAYER_PROPS_PRODUCTION_CANDIDATE_RELEASE,
      writer: NFL_PLAYER_PROPS_WRITER_RELEASE,
      tracking: NFL_PLAYER_PROPS_TRACKING_RELEASE,
    },
    total: summarize(changes),
    byCategory,
    nonPassingBehaviorIdentity: {
      rows: nonPassing.length,
      changedRows: nonPassing.filter(({ delta: value }) => value.behaviorChanged).length,
      incumbentHash: behaviorHash(nonPassing.map(({ row }) => row)),
      candidateHash: behaviorHash(nonPassing.map(({ row, candidate }) => ({ ...row, ...candidate }))),
    },
    qbConsensusIndependence: {
      rows: passing.length,
      evaluatedOfferConsensusReferences: 0,
      zeroAlternativeRows: passingAlternativeBreadth.filter((value) => value === 0).length,
      oneAlternativeRows: passingAlternativeBreadth.filter((value) => value === 1).length,
      twoOrMoreAlternativeRows: passingAlternativeBreadth.filter((value) => value >= 2).length,
      zeroAlternativeFallback: "existing_independent_role_projection",
      exactEvaluatedQuoteRole: "grade_economics_only",
      zeroAlternativeActionableRows: zeroAlternativeActionableRows.length,
    },
    locks: {
      rows: locked.length,
      changedRows: locked.filter(({ delta: value }) => value.behaviorChanged).length,
      incumbentHash: behaviorHash(locked.map(({ row }) => row)),
      candidateHash: behaviorHash(locked.map(({ row, candidate }) => ({ ...row, ...candidate }))),
    },
    actionability: {
      incumbent: changes.filter(({ row }) => actionable(row.grade)).length,
      candidate: changes.filter(({ candidate }) => actionable(candidate.grade)).length,
      promotions: promotions.length,
      demotions: demotions.length,
      pairedPromotionPathPresent: demotions.length === 0 || promotions.length > 0,
      flattenedActionableCategories,
    },
    qualification: {
      status: violations.length === 0 ? "qualified_local_source_candidate" : "held",
      violations,
    },
    ...(process.argv.includes("--summary") ? {} : {
      changedRows: changes.filter(({ delta: value }) => value.behaviorChanged).map(({ row, candidate, delta: value }) => ({
        gameId: row.gameId, player: row.playerName, market: row.market, line: row.line,
        side: row.side, book: row.sportsbook, state: row.state, incumbent: pick(row), candidate, delta: value,
      })),
    }),
  };
  console.log(JSON.stringify(output, null, process.argv.includes("--compact") ? 0 : 2));
  if (violations.length > 0) throw new Error(`NFL QB target-exclusion replay held: ${violations.join(", ")}`);
}

function replayRow(
  row: NflPlayerPropsRuntimeDecision,
  evidence: Map<string, NflPlayerPropsMarketEvidenceIdentity>,
  passingBooks: Map<string, PassingBook[]>,
): Candidate {
  if (row.state === "locked" || row.market !== "passing_yards") return pick(row);
  const identity = row.marketEvidenceId ? evidence.get(row.marketEvidenceId) : undefined;
  if (!identity) throw new Error(`Passing row lacks retained evidence: ${row.gameId}/${row.playerName}/${row.line}.`);
  const target = normalizeBook(row.sportsbook);
  const primary = passingBooks.get(playerKey(row)) ?? [];
  const alternatives = primary.filter((book) => book.book !== target);
  const primaryTarget = primary.some((book) => book.book === target && book.line === row.line);
  const roleProjection = identity[4][2];
  if (roleProjection === null) throw new Error(`Passing row lacks independent role projection: ${row.playerName}.`);
  const centers = alternatives.map((book) => nflPlayerPropsMarketImpliedCenter({
    referenceProjection: roleProjection, line: book.line, overProbability: book.over,
  }));
  const projection = centers.length
    ? NFL_PLAYER_PROPS_QB_PASSING_PROJECTION.marketWeight * median(centers)
      + NFL_PLAYER_PROPS_QB_PASSING_PROJECTION.roleWeight * roleProjection
    : roleProjection;
  const rawOver = nflPlayerPropsOverProbability(row.market, projection, row.line);
  const marketOver = alternatives.length
    ? average(alternatives.map((book) => nflPlayerPropsTransportedMarketProbability({
        projection, sourceLine: book.line, sourceOverProbability: book.over, targetLine: row.line,
      })))
    : rawOver;
  const policy = nflPlayerPropsRuntimeMarketPolicy("passing_yards");
  if (!policy) throw new Error("Passing-yards runtime policy missing.");
  const finalOver = nflPlayerPropsResidualProbability(rawOver, marketOver, policy.weight);
  const raw = row.side === "over" ? rawOver : 1 - rawOver;
  const market = row.side === "over" ? marketOver : 1 - marketOver;
  const final = row.side === "over" ? finalOver : 1 - finalOver;
  const probabilityEdge = final - market;
  const expectedValue = nflPlayerPropsExpectedValue(final, row.americanPrice);
  const divergenceImplausible = nflPlayerPropsRawMarketDivergenceImplausible(raw, market);
  const runtime = nflPlayerPropsRuntimePolicy();
  const lane = nflPlayerPropsProductionMarketLane("passing_yards");
  if (!lane) throw new Error("Passing-yards production lane missing.");
  const healthHolds = row.healthHolds.filter((reason) => ![
    "independent_same_line_confirmation_missing", "model_market_divergence_implausible",
  ].includes(reason));
  const exactAlternatives = identity[2].filter((book) => normalizeBook(book[0]) !== target && noVigOver(book) !== null).length;
  const leanThresholds = row.marketMovement === "support"
    ? runtime.volumeAndYardage.movementSupportedLean
    : lane.leanThresholds ?? runtime.volumeAndYardage.lean;
  const bestAngleThresholds = row.marketMovement === "support"
    ? runtime.volumeAndYardage.movementSupportedBestAngle
    : runtime.volumeAndYardage.bestAngle;
  const baseGrade = gradeNflPlayerPropsCrossMarketCandidate({
    commonHolds: healthHolds,
    independentBooks: exactAlternatives,
    divergenceImplausible,
    eligibleSide: lane.eligibleSides.includes(row.side as "over" | "under"),
    marketResidualQualified: policy.qualified || runtime.releaseEvidence.ownerApprovedForwardException === true,
    bestAngleEnabled: lane.bestAngle,
    leanEnabled: lane.lean,
    watchlistEnabled: lane.watchlist,
    expectedValue,
    probabilityEdge,
    participationProbability: row.participationProbability,
    movement: row.marketMovement,
    leanThresholds,
    bestAngleThresholds,
  });
  const grade: Grade = baseGrade === "No Play" && nflPlayerPropsPassingYardsWatchlistEligible({
    market: row.market,
    commonHolds: healthHolds,
    primaryTarget,
    independentMarketBooks: alternatives.length,
    divergenceImplausible,
    movement: row.marketMovement,
    expectedValue,
    probabilityEdge,
  }) ? "Watchlist" : baseGrade;
  return { projection, rawModelProbability: raw, marketProbability: market,
    finalProbability: final, probabilityEdge, expectedValue, grade, side: row.side };
}

function noVigOver(book: NflPlayerPropsMarketEvidenceBook): number | null {
  if (book[8] === null || book[9] === null) return null;
  const over = implied(book[8]); const under = implied(book[9]);
  return over / (over + under);
}
function implied(price: number): number { return price < 0 ? -price / (-price + 100) : 100 / (price + 100); }
function normalizeBook(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function playerKey(row: Pick<NflPlayerPropsRuntimeDecision, "gameId" | "playerName">): string {
  return `${row.gameId}|${row.playerName.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}
function selectPrimaryBooks(values: PassingBook[]): PassingBook[] {
  const byBook = new Map<string, PassingBook[]>();
  for (const value of values) byBook.set(value.book, [...(byBook.get(value.book) ?? []), value]);
  return [...byBook.values()].map((books) => [...books].sort((a, b) =>
    Math.abs(a.over - 0.5) - Math.abs(b.over - 0.5)
    || Date.parse(b.observedAt) - Date.parse(a.observedAt)
    || a.line - b.line
    || a.identityId.localeCompare(b.identityId))[0]!);
}
function pick(row: NflPlayerPropsRuntimeDecision): Candidate {
  return { projection: row.projection, rawModelProbability: row.rawModelProbability,
    marketProbability: row.marketProbability, finalProbability: row.finalProbability,
    probabilityEdge: row.probabilityEdge, expectedValue: row.expectedValue, grade: row.grade, side: row.side };
}
function delta(row: NflPlayerPropsRuntimeDecision, candidate: Candidate) {
  const projection = clean(numberDelta(row.projection, candidate.projection));
  const raw = clean(candidate.rawModelProbability - row.rawModelProbability);
  const market = clean(candidate.marketProbability - row.marketProbability);
  const final = clean(candidate.finalProbability - row.finalProbability);
  return { projection, rawProbability: raw, marketProbability: market, finalProbability: final,
    sideChanged: row.side !== candidate.side, gradeChanged: row.grade !== candidate.grade,
    behaviorChanged: projection !== 0 || raw !== 0 || market !== 0 || final !== 0
      || row.side !== candidate.side || row.grade !== candidate.grade };
}
function summarize(values: Array<{ row: NflPlayerPropsRuntimeDecision; candidate: Candidate; delta: ReturnType<typeof delta> }>) {
  return {
    rows: values.length,
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
    maximumAbsoluteProjectionDelta: maximum(values.map(({ delta: value }) => Math.abs(value.projection))),
    maximumAbsoluteFinalProbabilityDelta: maximum(values.map(({ delta: value }) => Math.abs(value.finalProbability))),
  };
}
function behaviorHash(rows: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(rows, (_key, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const row = value as Record<string, unknown>;
      return { projection: row.projection, rawModelProbability: row.rawModelProbability,
        marketProbability: row.marketProbability, finalProbability: row.finalProbability,
        probabilityEdge: row.probabilityEdge, expectedValue: row.expectedValue,
        grade: row.grade, side: row.side, state: row.state };
    }
    return value;
  })).digest("hex");
}
function counts(values: string[]): Record<string, number> {
  return Object.fromEntries([...new Set(values)].sort().map((value) => [value, values.filter((item) => item === value).length]));
}
function actionable(grade: Grade): boolean { return grade === "Best Angle" || grade === "Lean"; }
function numberDelta(a: number | null, b: number | null): number { return a === null || b === null ? a === b ? 0 : Number.NaN : b - a; }
function clean(value: number): number { return Number.isFinite(value) && Math.abs(value) <= 1e-12 ? 0 : value; }
function average(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function median(values: number[]): number { const ordered = [...values].sort((a, b) => a - b); const middle = Math.floor(ordered.length / 2); return ordered.length % 2 ? ordered[middle]! : (ordered[middle - 1]! + ordered[middle]!) / 2; }
function maximum(values: number[]): number { return values.length ? Math.max(...values) : 0; }
function integerOption(name: string, fallback: number): number {
  const value = process.argv.find((entry) => entry.startsWith(`--${name}=`))?.split("=")[1];
  const parsed = value ? Number(value) : fallback;
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`--${name} must be a positive integer.`);
  return parsed;
}

void main();
