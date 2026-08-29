export const DAILY_EDGE_ACTION_PROMOTION_STABILITY_CONTRACT_RELEASE =
  "daily_edge_action_promotion_stability_2026_08_29_r1" as const;

export type StableActionGrade = "best_angle" | "lean" | "watchlist" | "no_play";

export type ActionPromotionIdentity = {
  sport: string;
  gameId: string | number;
  market: string;
  selectedSide: string;
  evaluatedLine: number | null;
  forecastRelease: string;
};

export type ActionPromotionCycle = {
  id: string;
  capturedAt: string;
};

export type PersistedActionPromotionState = {
  contractRelease: typeof DAILY_EDGE_ACTION_PROMOTION_STABILITY_CONTRACT_RELEASE;
  canonicalIdentity: string;
  candidateGrade: StableActionGrade;
  qualifyingCycleIds: string[];
  firstQualifiedAt: string | null;
  lastQualifiedAt: string | null;
  status: "not_applicable" | "pending" | "confirmed" | "failed_economics" | "invalid_cycle";
  exactPriceExpectedValue: number | null;
  minimumExpectedValue: number | null;
};

export type ResolveActionPromotionStabilityArgs = {
  identity: ActionPromotionIdentity;
  cycle: ActionPromotionCycle | null;
  candidateGrade: StableActionGrade;
  currentlyPublishedGrade: StableActionGrade;
  currentModelProbability: number | null;
  currentAmericanOdds: number | null;
  exactPriceCoherent: boolean;
  previousState: PersistedActionPromotionState | null;
  requiredDistinctCycles: number;
  minimumElapsedMs: number;
  /** Sport-owned threshold. Null means the upstream validated economics rule is authoritative. */
  minimumExpectedValue: number | null;
};

export type ActionPromotionStabilityResult = {
  finalGrade: StableActionGrade;
  state: PersistedActionPromotionState;
  promotionPending: boolean;
  immediateDemotion: boolean;
  reason:
    | "not_an_actionable_promotion"
    | "promotion_pending_confirmation"
    | "promotion_confirmed"
    | "exact_price_economics_failed"
    | "incoherent_exact_price"
    | "invalid_writer_cycle";
};

const GRADE_RANK: Record<StableActionGrade, number> = {
  no_play: 0,
  watchlist: 1,
  lean: 2,
  best_angle: 3,
};

function normalizeIdentityPart(value: string): string {
  return value.trim().toLowerCase().replaceAll(/\s+/g, "_");
}

function normalizeLine(line: number | null): string {
  if (line === null || !Number.isFinite(line)) return "none";
  return (Math.round(line * 1000) / 1000).toFixed(3);
}

/** Stable across sportsbook rotation; exact current price is validated separately. */
export function canonicalActionPromotionIdentity(identity: ActionPromotionIdentity): string {
  return [
    normalizeIdentityPart(identity.sport),
    String(identity.gameId),
    normalizeIdentityPart(identity.market),
    normalizeIdentityPart(identity.selectedSide),
    normalizeLine(identity.evaluatedLine),
    normalizeIdentityPart(identity.forecastRelease),
  ].join("::");
}

export function expectedValueAtAmericanOdds(
  modelProbability: number | null,
  americanOdds: number | null,
): number | null {
  if (
    modelProbability === null ||
    !Number.isFinite(modelProbability) ||
    modelProbability < 0 ||
    modelProbability > 1 ||
    americanOdds === null ||
    !Number.isFinite(americanOdds) ||
    americanOdds === 0
  ) return null;
  const profit = americanOdds > 0 ? americanOdds / 100 : 100 / Math.abs(americanOdds);
  return modelProbability * profit - (1 - modelProbability);
}

function validCycle(cycle: ActionPromotionCycle | null): cycle is ActionPromotionCycle {
  return cycle !== null &&
    cycle.id.trim().length > 0 &&
    Number.isFinite(Date.parse(cycle.capturedAt));
}

function stateFor(args: ResolveActionPromotionStabilityArgs, input: {
  canonicalIdentity: string;
  qualifyingCycleIds: string[];
  firstQualifiedAt: string | null;
  lastQualifiedAt: string | null;
  status: PersistedActionPromotionState["status"];
  expectedValue: number | null;
}): PersistedActionPromotionState {
  return {
    contractRelease: DAILY_EDGE_ACTION_PROMOTION_STABILITY_CONTRACT_RELEASE,
    canonicalIdentity: input.canonicalIdentity,
    candidateGrade: args.candidateGrade,
    qualifyingCycleIds: input.qualifyingCycleIds,
    firstQualifiedAt: input.firstQualifiedAt,
    lastQualifiedAt: input.lastQualifiedAt,
    status: input.status,
    exactPriceExpectedValue: input.expectedValue,
    minimumExpectedValue: args.minimumExpectedValue,
  };
}

export function resolveActionPromotionStability(
  args: ResolveActionPromotionStabilityArgs,
): ActionPromotionStabilityResult {
  if (!Number.isInteger(args.requiredDistinctCycles) || args.requiredDistinctCycles < 1) {
    throw new Error("requiredDistinctCycles must be a positive integer");
  }
  if (!Number.isFinite(args.minimumElapsedMs) || args.minimumElapsedMs < 0) {
    throw new Error("minimumElapsedMs must be nonnegative");
  }
  const canonicalIdentity = canonicalActionPromotionIdentity(args.identity);
  const expectedValue = expectedValueAtAmericanOdds(
    args.currentModelProbability,
    args.currentAmericanOdds,
  );
  const actionableCandidate = GRADE_RANK[args.candidateGrade] >= GRADE_RANK.lean;
  const promotion = GRADE_RANK[args.candidateGrade] > GRADE_RANK[args.currentlyPublishedGrade];
  const currentlyActionable = GRADE_RANK[args.currentlyPublishedGrade] >= GRADE_RANK.lean;
  const economicsQualify = args.minimumExpectedValue === null ||
    (expectedValue !== null && expectedValue >= args.minimumExpectedValue);

  if (actionableCandidate && !args.exactPriceCoherent) {
    return {
      finalGrade: "no_play",
      state: stateFor(args, {
        canonicalIdentity,
        qualifyingCycleIds: [],
        firstQualifiedAt: null,
        lastQualifiedAt: null,
        status: "failed_economics",
        expectedValue,
      }),
      promotionPending: false,
      immediateDemotion: currentlyActionable,
      reason: "incoherent_exact_price",
    };
  }

  if (actionableCandidate && !economicsQualify) {
    return {
      finalGrade: "no_play",
      state: stateFor(args, {
        canonicalIdentity,
        qualifyingCycleIds: [],
        firstQualifiedAt: null,
        lastQualifiedAt: null,
        status: "failed_economics",
        expectedValue,
      }),
      promotionPending: false,
      immediateDemotion: currentlyActionable,
      reason: "exact_price_economics_failed",
    };
  }

  if (!actionableCandidate || !promotion) {
    return {
      finalGrade: args.candidateGrade,
      state: stateFor(args, {
        canonicalIdentity,
        qualifyingCycleIds: validCycle(args.cycle) && actionableCandidate ? [args.cycle.id] : [],
        firstQualifiedAt: validCycle(args.cycle) && actionableCandidate ? args.cycle.capturedAt : null,
        lastQualifiedAt: validCycle(args.cycle) && actionableCandidate ? args.cycle.capturedAt : null,
        status: "not_applicable",
        expectedValue,
      }),
      promotionPending: false,
      immediateDemotion: GRADE_RANK[args.candidateGrade] < GRADE_RANK[args.currentlyPublishedGrade],
      reason: "not_an_actionable_promotion",
    };
  }

  if (!validCycle(args.cycle)) {
    return {
      finalGrade: args.currentlyPublishedGrade,
      state: stateFor(args, {
        canonicalIdentity,
        qualifyingCycleIds: [],
        firstQualifiedAt: null,
        lastQualifiedAt: null,
        status: "invalid_cycle",
        expectedValue,
      }),
      promotionPending: true,
      immediateDemotion: false,
      reason: "invalid_writer_cycle",
    };
  }

  const continues =
    args.previousState?.contractRelease === DAILY_EDGE_ACTION_PROMOTION_STABILITY_CONTRACT_RELEASE &&
    args.previousState.canonicalIdentity === canonicalIdentity &&
    args.previousState.candidateGrade === args.candidateGrade &&
    (args.previousState.status === "pending" || args.previousState.status === "confirmed") &&
    args.previousState.qualifyingCycleIds.length > 0 &&
    args.previousState.firstQualifiedAt !== null &&
    args.previousState.lastQualifiedAt !== null;
  const priorCycleIds = continues ? args.previousState!.qualifyingCycleIds : [];
  const priorLastMs = continues ? Date.parse(args.previousState!.lastQualifiedAt!) : NaN;
  const currentMs = Date.parse(args.cycle.capturedAt);
  const monotonic = !continues || currentMs > priorLastMs;
  const isDistinctCycle = !priorCycleIds.includes(args.cycle.id);
  const canAdvance = monotonic && isDistinctCycle;
  const qualifyingCycleIds = canAdvance
    ? [...priorCycleIds, args.cycle.id].slice(-args.requiredDistinctCycles)
    : priorCycleIds;
  const firstQualifiedAt = continues
    ? args.previousState!.firstQualifiedAt
    : args.cycle.capturedAt;
  const lastQualifiedAt = canAdvance
    ? args.cycle.capturedAt
    : continues
      ? args.previousState!.lastQualifiedAt
      : args.cycle.capturedAt;
  const elapsedMs = firstQualifiedAt === null ? 0 : currentMs - Date.parse(firstQualifiedAt);
  const confirmed =
    qualifyingCycleIds.length >= args.requiredDistinctCycles &&
    monotonic &&
    elapsedMs >= args.minimumElapsedMs;

  return {
    finalGrade: confirmed ? args.candidateGrade : args.currentlyPublishedGrade,
    state: stateFor(args, {
      canonicalIdentity,
      qualifyingCycleIds,
      firstQualifiedAt,
      lastQualifiedAt,
      status: confirmed ? "confirmed" : "pending",
      expectedValue,
    }),
    promotionPending: !confirmed,
    immediateDemotion: false,
    reason: confirmed ? "promotion_confirmed" : "promotion_pending_confirmation",
  };
}

export function readPersistedActionPromotionState(value: unknown): PersistedActionPromotionState | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Partial<PersistedActionPromotionState>;
  if (
    row.contractRelease !== DAILY_EDGE_ACTION_PROMOTION_STABILITY_CONTRACT_RELEASE ||
    typeof row.canonicalIdentity !== "string" ||
    (row.candidateGrade !== "best_angle" && row.candidateGrade !== "lean" && row.candidateGrade !== "watchlist" && row.candidateGrade !== "no_play") ||
    !Array.isArray(row.qualifyingCycleIds) ||
    row.qualifyingCycleIds.some((id) => typeof id !== "string") ||
    (row.status !== "not_applicable" && row.status !== "pending" && row.status !== "confirmed" && row.status !== "failed_economics" && row.status !== "invalid_cycle") ||
    (row.minimumExpectedValue !== null && typeof row.minimumExpectedValue !== "number")
  ) return null;
  return row as PersistedActionPromotionState;
}
