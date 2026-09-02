import {
  nflPlayerPropsRuntimePolicy,
  type NflPlayerPropsRuntimeBoard,
  type NflPlayerPropsRuntimeDecision,
} from "./nflPlayerPropsRuntime";
import {
  mergeNflPlayerPropsMarketEvidenceCaptures,
  subsetNflPlayerPropsMarketEvidenceCapture,
  withoutUnretainedNflPlayerPropsEvidenceReference,
  type NflPlayerPropsMarketEvidenceCapture,
} from "./nflPlayerPropsMarketEvidenceCapture";

export const NFL_PLAYER_PROPS_PRODUCTION_CANDIDATE_RELEASE =
  "nfl_player_props_member_2026_09_02_r15_qb_target_exclusion" as const;
export const NFL_PLAYER_PROPS_WRITER_LEASE_GROUP = "prediction_pipeline:nfl" as const;

export type NflPlayerPropsProductionSnapshot = {
  release: typeof NFL_PLAYER_PROPS_PRODUCTION_CANDIDATE_RELEASE;
  season: number; week: number; generatedAt: string;
  writerLeaseGroup: typeof NFL_PLAYER_PROPS_WRITER_LEASE_GROUP;
  publicationEligible: true; trackingEligible: true; riskLabel: "forward_monitoring_2025_exact_price_confirmation";
  board: Omit<NflPlayerPropsRuntimeBoard, "publicationEnabled" | "trackingEnabled"> & {
    publicationEnabled: true;
    trackingEnabled: true;
  };
  memberDecisions: NflPlayerPropsRuntimeDecision[];
  lifecycle: {
    recomputedUnlocked: number;
    retainedStillFreshUnlocked: number;
    frozenAtLock: number;
    retainedPreviouslyLocked: number;
  };
};

export type NflPlayerPropsMemberGrade = "Best Angle" | "Lean" | "Watchlist" | "No Play";
export type NflPlayerPropsMemberDecision = NflPlayerPropsRuntimeDecision & { grade: NflPlayerPropsMemberGrade };
export type NflPlayerPropsMemberSnapshot = {
  season: number; week: number; generatedAt: string;
  board: {
    evaluatedAt: string;
    counts: Record<NflPlayerPropsMemberGrade, number> & { actionable: number };
    marketEvidence?: NflPlayerPropsMarketEvidenceCapture;
    diagnostics: Pick<NflPlayerPropsRuntimeBoard["diagnostics"],
      "inputOffers" | "completedEvaluations" | "completeExactOffers" | "incompleteExactOffers"
      | "unavailableNoIndependentBenchmark" | "unavailableStaleQuotes" | "unavailableFeatureContext">;
  };
  memberDecisions: NflPlayerPropsMemberDecision[];
};

export function deriveNflPlayerPropsMemberDecisions(
  board: Pick<NflPlayerPropsRuntimeBoard, "decisions">,
): NflPlayerPropsMemberDecision[] {
  return board.decisions.filter(isMemberDecision);
}

export type NflPlayerPropsTrackedDecision = {
  trackingKey: string; gameId: string; providerPlayerId: string | null; playerName: string; market: string; line: number;
  side: NflPlayerPropsRuntimeDecision["side"]; sportsbook: string; lockedPrice: number;
  lockedProbability: number; lockedExpectedValue: number; grade: "Best Angle" | "Lean";
  lockedAt: string; result: "pending" | "win" | "loss" | "push";
  closingPrice: number | null; closingImpliedProbability: number | null; clvProbabilityPoints: number | null;
  modelRelease: string; calibrationRelease: string; decisionRelease: string;
};

export function reconcileNflPlayerPropsProductionSnapshot(args: {
  season: number; week: number; evaluatedAt: string;
  nextBoard: NflPlayerPropsRuntimeBoard;
  previous?: NflPlayerPropsProductionSnapshot | null;
}): NflPlayerPropsProductionSnapshot {
  const evaluatedAt = Date.parse(args.evaluatedAt);
  if (!Number.isFinite(evaluatedAt)) throw new Error("NFL props production evaluatedAt is invalid.");
  const previous = new Map((args.previous?.board.decisions ?? []).map((row) => [decisionKey(row), row]));
  let frozenAtLock = 0;
  let retainedPreviouslyLocked = 0;
  let retainedStillFreshUnlocked = 0;
  let recomputedUnlocked = 0;
  const decisions = args.nextBoard.decisions.map((next) => {
    const prior = previous.get(decisionKey(next));
    if (prior?.state === "locked") { retainedPreviouslyLocked += 1; return prior; }
    if (evaluatedAt >= Date.parse(next.lockAt)) {
      frozenAtLock += 1;
      // The market-board adapter has already selected the latest observation
      // at or before T-60. Freeze that authorized boundary row, not an older
      // unlocked row retained from the previous writer cycle.
      return { ...next, state: "locked" as const };
    }
    recomputedUnlocked += 1;
    return next;
  });
  const nextKeys = new Set(decisions.map(decisionKey));
  const nextOutcomeScopes = new Set(args.nextBoard.decisions.map(outcomeScopeKey));
  for (const prior of args.previous?.board.decisions ?? []) {
    if (prior.state === "locked" && !nextKeys.has(decisionKey(prior))) {
      decisions.push(prior);
      retainedPreviouslyLocked += 1;
    } else if (!nextKeys.has(decisionKey(prior)) && evaluatedAt >= Date.parse(prior.lockAt)
      && isFreshAtLock(prior)) {
      // Sportsbooks commonly remove props near kickoff. If the first cycle at
      // or after T-60 no longer receives the offer, freeze the last complete,
      // still-fresh pre-lock tuple retained in the prior coherent snapshot.
      decisions.push({ ...prior, state: "locked" as const });
      frozenAtLock += 1;
    } else if (!nextKeys.has(decisionKey(prior))
      && !nextOutcomeScopes.has(outcomeScopeKey(prior))
      && prior.state === "unlocked"
      && evaluatedAt < Date.parse(prior.lockAt)
      && evaluatedAt < Date.parse(prior.scheduledStart)
      && isFreshAt(prior, evaluatedAt)) {
      // A provider request can succeed with only part of the scheduled slate.
      // Preserve a missing outcome only while its exact quote remains inside
      // the existing production freshness window. A current row in the same
      // game/player/market/side scope always wins, including a changed line.
      decisions.push(prior);
      retainedStillFreshUnlocked += 1;
    }
  }
  const mergedEvidence = mergeNflPlayerPropsMarketEvidenceCaptures({
    current: args.nextBoard.marketEvidence,
    previous: args.previous?.board.marketEvidence,
    decisions,
  });
  const capturedDecisions = mergedEvidence.capture
    ? decisions.map((row) => withoutUnretainedNflPlayerPropsEvidenceReference(row, mergedEvidence.retainedIds))
    : decisions;
  const board = {
    ...args.nextBoard,
    publicationEnabled: true as const,
    trackingEnabled: true as const,
    decisions: capturedDecisions,
    counts: recount(capturedDecisions),
    diagnostics: recountOperationalDiagnostics(args.nextBoard.diagnostics, capturedDecisions),
    ...(mergedEvidence.capture ? { marketEvidence: mergedEvidence.capture } : {}),
  };
  return {
    release: NFL_PLAYER_PROPS_PRODUCTION_CANDIDATE_RELEASE, season: args.season, week: args.week,
    generatedAt: new Date(evaluatedAt).toISOString(), writerLeaseGroup: NFL_PLAYER_PROPS_WRITER_LEASE_GROUP,
    publicationEligible: true, trackingEligible: true, riskLabel: "forward_monitoring_2025_exact_price_confirmation",
    board,
    // Held rows remain in the audit payload, but genuine role/identity
    // ambiguity is not useful as a default member recommendation list.
    memberDecisions: deriveNflPlayerPropsMemberDecisions(board),
    lifecycle: { recomputedUnlocked, retainedStillFreshUnlocked, frozenAtLock, retainedPreviouslyLocked },
  };
}

export function buildNflPlayerPropsTrackingRows(snapshot: NflPlayerPropsProductionSnapshot): NflPlayerPropsTrackedDecision[] {
  return snapshot.board.decisions.filter((row): row is NflPlayerPropsRuntimeDecision & { grade: "Best Angle" | "Lean" } =>
    row.state === "locked" && (row.grade === "Best Angle" || row.grade === "Lean"))
    .map((row) => ({
      trackingKey: decisionKey(row), gameId: row.gameId, providerPlayerId: row.providerPlayerId, playerName: row.playerName, market: row.market,
      line: row.line, side: row.side, sportsbook: row.sportsbook, lockedPrice: row.americanPrice,
      lockedProbability: row.finalProbability, lockedExpectedValue: row.expectedValue, grade: row.grade,
      lockedAt: row.lockAt, result: "pending", closingPrice: null, closingImpliedProbability: null,
      clvProbabilityPoints: null, modelRelease: row.modelRelease, calibrationRelease: row.calibrationRelease,
      decisionRelease: row.decisionRelease,
    }));
}

export function buildNflPlayerPropsMemberSnapshot(snapshot: NflPlayerPropsProductionSnapshot): NflPlayerPropsMemberSnapshot {
  const eligibleMemberDecisions = snapshot.memberDecisions.filter(isMemberDecision);
  const memberEvidence = subsetNflPlayerPropsMarketEvidenceCapture({
    capture: snapshot.board.marketEvidence,
    decisions: eligibleMemberDecisions,
  });
  const memberDecisions = memberEvidence.capture
    ? eligibleMemberDecisions.map((row) => withoutUnretainedNflPlayerPropsEvidenceReference(row, memberEvidence.retainedIds))
    : eligibleMemberDecisions;
  const count = (grade: NflPlayerPropsMemberGrade) => memberDecisions.filter((row) => row.grade === grade).length;
  const diagnostics = snapshot.board.diagnostics;
  return {
    season: snapshot.season,
    week: snapshot.week,
    generatedAt: snapshot.generatedAt,
    board: {
      evaluatedAt: snapshot.board.evaluatedAt,
      counts: {
        "Best Angle": count("Best Angle"),
        Lean: count("Lean"),
        Watchlist: count("Watchlist"),
        "No Play": count("No Play"),
        actionable: count("Best Angle") + count("Lean"),
      },
      ...(memberEvidence.capture ? { marketEvidence: memberEvidence.capture } : {}),
      diagnostics: {
        inputOffers: diagnostics.inputOffers,
        completedEvaluations: memberDecisions.length,
        completeExactOffers: diagnostics.completeExactOffers,
        incompleteExactOffers: diagnostics.incompleteExactOffers,
        unavailableNoIndependentBenchmark: diagnostics.unavailableNoIndependentBenchmark,
        unavailableStaleQuotes: diagnostics.unavailableStaleQuotes,
        unavailableFeatureContext: diagnostics.unavailableFeatureContext,
      },
    },
    memberDecisions,
  };
}

export function attachNflPlayerPropsClosingPrice(
  tracked: NflPlayerPropsTrackedDecision,
  closingPrice: number,
): NflPlayerPropsTrackedDecision {
  if (!Number.isInteger(closingPrice) || closingPrice === 0) throw new Error("NFL props closing price is invalid.");
  const closingImpliedProbability = implied(closingPrice);
  return {
    ...tracked, closingPrice, closingImpliedProbability,
    clvProbabilityPoints: 100 * (closingImpliedProbability - implied(tracked.lockedPrice)),
  };
}

function recount(rows: NflPlayerPropsRuntimeDecision[]): NflPlayerPropsRuntimeBoard["counts"] {
  const count = (grade: NflPlayerPropsRuntimeDecision["grade"]) => rows.filter((row) => row.grade === grade).length;
  return { "Best Angle": count("Best Angle"), Lean: count("Lean"), Watchlist: count("Watchlist"), "No Play": count("No Play"), Held: count("Held"), actionable: count("Best Angle") + count("Lean") };
}
function recountOperationalDiagnostics(
  diagnostics: NflPlayerPropsRuntimeBoard["diagnostics"],
  rows: NflPlayerPropsRuntimeDecision[],
): NflPlayerPropsRuntimeBoard["diagnostics"] {
  const operationalExceptions = rows.filter((row) => row.grade === "Held");
  return {
    ...diagnostics,
    completedEvaluations: rows.length - operationalExceptions.length,
    operationalExceptions: operationalExceptions.length,
    recoveryEligibleOperationalExceptions: operationalExceptions.filter((row) => row.state === "unlocked").length,
    roleOrIdentityHeld: operationalExceptions.length,
  };
}
function isMemberDecision(row: NflPlayerPropsRuntimeDecision): row is NflPlayerPropsMemberDecision {
  return row.grade === "Best Angle" || row.grade === "Lean" || row.grade === "Watchlist" || row.grade === "No Play";
}
function decisionKey(row: NflPlayerPropsRuntimeDecision): string {
  return [row.gameId, row.playerName.toLowerCase().replace(/[^a-z0-9]/g, ""), row.market, row.line, row.side].join("|");
}
function outcomeScopeKey(row: NflPlayerPropsRuntimeDecision): string {
  return [row.gameId, row.playerName.toLowerCase().replace(/[^a-z0-9]/g, ""), row.market, row.side].join("|");
}
function isFreshAt(row: NflPlayerPropsRuntimeDecision, evaluatedAt: number): boolean {
  const age = evaluatedAt - Date.parse(row.observedAt);
  return Number.isFinite(age) && age >= 0
    && age <= nflPlayerPropsRuntimePolicy().maximumQuoteAgeHours * 3_600_000;
}
function isFreshAtLock(row: NflPlayerPropsRuntimeDecision): boolean {
  const age = Date.parse(row.lockAt) - Date.parse(row.observedAt);
  return Number.isFinite(age) && age >= 0
    && age <= nflPlayerPropsRuntimePolicy().maximumQuoteAgeHours * 3_600_000;
}
function implied(price: number): number { return price < 0 ? -price / (-price + 100) : 100 / (price + 100); }
