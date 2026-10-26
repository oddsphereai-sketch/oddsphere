export const MARKET_BRAIN_CONTRACT_RELEASE =
  "market_brain_contract_2026_10_26_r2_observable_evidence_tape" as const;

export type MarketBrainSport = "nfl" | "cfb" | "nba" | "wnba" | "mlb" | "nhl" | "soccer" | "other";
export type MarketBrainMarket = "moneyline" | "spread" | "total" | "player_prop" | "match_result" | "btts" | "other";
export type MarketBrainModality = "model_prior" | "price_quote" | "public_split" | "identified_book_split" | "availability" | "weather" | "other_context";
export type MarketBrainAvailability = "observed" | "incomplete" | "duplicate" | "stale" | "future" | "unavailable" | "identity_mismatch" | "unsupported";
export type MarketBrainObservedRole = "leader" | "follower" | "resistor" | "reversal" | "static" | "unknown";
export type MarketBrainSourcePrior = "professional_book" | "retail_book" | "public_aggregate" | "independent_model" | "context_provider" | "unknown";

export type MarketBrainNumericFeature = { value: number | null; observed: 0 | 1 };

export type MarketBrainSubject =
  | { kind: "two_team_game"; awayId: string; homeId: string; startsAt: string }
  | { kind: "three_way_fixture"; awayId: string; homeId: string; startsAt: string }
  | { kind: "player_market"; playerId: string; teamId: string | null; opponentId: string | null; startsAt: string; stat: string };

export type MarketBrainPrior =
  | { kind: "margin_total_distribution"; release: string; marginMean: number; totalMean: number; marginDistributionSha256: string; totalDistributionSha256: string }
  | { kind: "score_distribution"; release: string; scoreDistributionSha256: string }
  | { kind: "player_outcome_distribution"; release: string; mean: number; distributionSha256: string }
  | { kind: "unavailable"; release: string; reason: string };

export type MarketBrainObservation = {
  id: string;
  eventId: string;
  sport: MarketBrainSport;
  market: MarketBrainMarket;
  modality: MarketBrainModality;
  source: { provider: string; feed: string; participant: string | null };
  /** Reputation/classification known before this event; never asserted as event leadership. */
  sourcePrior: MarketBrainSourcePrior;
  /** Derived only from observed chronology. Brand names do not imply this role. */
  observedRole: MarketBrainObservedRole;
  observedAt: string | null;
  availability: MarketBrainAvailability;
  targetRelation: "evaluated" | "target_excluded" | "not_applicable" | "unknown";
  values: Record<string, MarketBrainNumericFeature>;
  categorical: Record<string, string | boolean | null>;
  audit: { sourceRelease: string; sourceObservationId: string; notes: string[] };
};

export type MarketBrainExpectedInput = {
  id: string;
  modality: MarketBrainModality;
  provider: string;
  participant: string | null;
  expectation: "required" | "opportunistic" | "unsupported";
  availability: MarketBrainAvailability;
  observationIds: string[];
  reason: string | null;
};

export type MarketBrainBlindSpot = {
  id: "absolute_handle" | "ticket_count" | "bet_size_distribution" | "book_limits" | "move_origin" | "suspension_lifecycle" | "private_order_flow";
  status: "unobservable_by_current_feeds";
};

export type MarketBrainCase = {
  release: typeof MARKET_BRAIN_CONTRACT_RELEASE;
  sport: MarketBrainSport;
  eventId: string;
  evaluatedAt: string;
  visibility: "internal_only";
  mode: "shadow_capture";
  temporalScope: "point_in_time_snapshot";
  subject: MarketBrainSubject;
  prior: MarketBrainPrior;
  observations: MarketBrainObservation[];
  expectedInputs: MarketBrainExpectedInput[];
  blindSpots: MarketBrainBlindSpot[];
  accounting: {
    providedObservations: number;
    retainedObservations: number;
    expectedInputs: number;
    expectedInputsAccounted: number;
    observed: number;
    unavailableOrUnsupported: number;
  };
  invariants: {
    missingValuesAreMasked: true;
    allProvidedObservationsRetained: true;
    allExpectedInputsAccounted: true;
    sourceReputationSeparatedFromObservedRole: true;
    targetQuoteSeparatedFromEvidence: true;
    displayContractAuthority: false;
    lockedRecordMutationAllowed: false;
    productionInfluenceAllowed: false;
  };
};

export type MarketBrainShadowDecision = {
  release: typeof MARKET_BRAIN_CONTRACT_RELEASE;
  status: "capture_only";
  productionApplied: false;
  reason: "validated_artifact_not_supplied";
  baseline: { kind: MarketBrainPrior["kind"]; primaryMean: number; secondaryMean: number | null };
  candidate: null;
};

export const MARKET_BRAIN_BLIND_SPOTS: MarketBrainBlindSpot[] = [
  "absolute_handle", "ticket_count", "bet_size_distribution", "book_limits",
  "move_origin", "suspension_lifecycle", "private_order_flow",
].map((id) => ({ id: id as MarketBrainBlindSpot["id"], status: "unobservable_by_current_feeds" as const }));

export function numericFeature(value: number | null | undefined): MarketBrainNumericFeature {
  return typeof value === "number" && Number.isFinite(value) ? { value, observed: 1 } : { value: null, observed: 0 };
}

export function buildMarketBrainCase(args: Omit<MarketBrainCase,
  "release" | "visibility" | "mode" | "temporalScope" | "accounting" | "invariants">): MarketBrainCase {
  if (!args.eventId.trim()) throw new Error("Market Brain eventId is required.");
  if (!Number.isFinite(Date.parse(args.evaluatedAt))) throw new Error("Market Brain evaluatedAt is invalid.");
  if (!Number.isFinite(Date.parse(args.subject.startsAt))) throw new Error("Market Brain startsAt is invalid.");
  const observationIds = new Set<string>();
  for (const observation of args.observations) {
    if (observation.eventId !== args.eventId || observation.sport !== args.sport) {
      throw new Error(`Market Brain observation ${observation.id} has the wrong event or sport identity.`);
    }
    if (observationIds.has(observation.id)) throw new Error(`Duplicate Market Brain observation: ${observation.id}`);
    observationIds.add(observation.id);
    if (observation.observedAt !== null && !Number.isFinite(Date.parse(observation.observedAt))) {
      throw new Error(`Invalid Market Brain observation time: ${observation.id}`);
    }
    for (const [name, feature] of Object.entries(observation.values)) {
      const valid = feature.observed === 0 ? feature.value === null : Number.isFinite(feature.value);
      if (!valid) throw new Error(`Invalid Market Brain feature mask: ${observation.id}:${name}`);
    }
  }
  const expectedIds = new Set<string>();
  for (const expected of args.expectedInputs) {
    if (expectedIds.has(expected.id)) throw new Error(`Duplicate Market Brain expected input: ${expected.id}`);
    expectedIds.add(expected.id);
    if (expected.observationIds.some((id) => !observationIds.has(id))) {
      throw new Error(`Market Brain expected input ${expected.id} references an unknown observation.`);
    }
    if (expected.availability === "observed" && expected.observationIds.length === 0) {
      throw new Error(`Observed Market Brain expected input ${expected.id} has no observation.`);
    }
    if (expected.expectation === "unsupported" && expected.availability !== "unsupported") {
      throw new Error(`Unsupported Market Brain input ${expected.id} has inconsistent availability.`);
    }
  }
  const observations = [...args.observations].sort((a, b) => timestamp(a.observedAt) - timestamp(b.observedAt) || a.id.localeCompare(b.id));
  return {
    release: MARKET_BRAIN_CONTRACT_RELEASE,
    ...args,
    visibility: "internal_only",
    mode: "shadow_capture",
    temporalScope: "point_in_time_snapshot",
    observations,
    accounting: {
      providedObservations: args.observations.length,
      retainedObservations: observations.length,
      expectedInputs: args.expectedInputs.length,
      expectedInputsAccounted: args.expectedInputs.length,
      observed: observations.filter((row) => row.availability === "observed").length,
      unavailableOrUnsupported: args.expectedInputs.filter((row) => ["unavailable", "unsupported", "identity_mismatch"].includes(row.availability)).length,
    },
    invariants: {
      missingValuesAreMasked: true,
      allProvidedObservationsRetained: true,
      allExpectedInputsAccounted: true,
      sourceReputationSeparatedFromObservedRole: true,
      targetQuoteSeparatedFromEvidence: true,
      displayContractAuthority: false,
      lockedRecordMutationAllowed: false,
      productionInfluenceAllowed: false,
    },
  };
}

export function buildMarketBrainCaptureOnlyDecision(input: MarketBrainCase): MarketBrainShadowDecision {
  const means = input.prior.kind === "margin_total_distribution"
    ? [input.prior.marginMean, input.prior.totalMean] as const
    : input.prior.kind === "player_outcome_distribution"
      ? [input.prior.mean, null] as const
      : [0, null] as const;
  return {
    release: MARKET_BRAIN_CONTRACT_RELEASE,
    status: "capture_only",
    productionApplied: false,
    reason: "validated_artifact_not_supplied",
    baseline: { kind: input.prior.kind, primaryMean: means[0], secondaryMean: means[1] },
    candidate: null,
  };
}

function timestamp(value: string | null): number {
  if (value === null) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}
