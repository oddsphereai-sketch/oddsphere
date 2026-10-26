export const MARKET_BRAIN_CONTRACT_RELEASE =
  "market_brain_contract_2026_10_26_r1_masked_joint_state" as const;

export type MarketBrainSport =
  | "nfl"
  | "cfb"
  | "nba"
  | "wnba"
  | "mlb"
  | "nhl"
  | "soccer"
  | "other";

export type MarketBrainMarket = "moneyline" | "spread" | "total" | "player_prop" | "game";
export type MarketBrainAxis = "margin" | "total" | "player_outcome" | "context";
export type MarketBrainAvailability =
  | "observed"
  | "stale"
  | "future"
  | "unavailable"
  | "identity_mismatch";
export type MarketBrainModality =
  | "forecast"
  | "target_excluded_consensus"
  | "book_path"
  | "split"
  | "availability"
  | "weather"
  | "other_context";
export type MarketBrainSourceRole =
  | "independent_model"
  | "player_aware_model"
  | "originating_book"
  | "retail_book"
  | "public_consensus"
  | "identified_sportsbook"
  | "target_excluded_consensus"
  | "context_provider"
  | "unknown";

export type MarketBrainNumericFeature = {
  /** Null means missing. Missing values must never be coerced to zero. */
  value: number | null;
  /** One means observed and finite; zero means unavailable for this observation. */
  observed: 0 | 1;
};

export type MarketBrainObservation = {
  id: string;
  sport: MarketBrainSport;
  eventId: string;
  market: MarketBrainMarket;
  axis: MarketBrainAxis;
  modality: MarketBrainModality;
  source: string;
  sourceRole: MarketBrainSourceRole;
  observedAt: string | null;
  availability: MarketBrainAvailability;
  /** Home/over/first-listed participant is positive; away/under/second-listed is negative. */
  direction: -1 | 0 | 1 | null;
  targetExcluded: boolean | null;
  exactLineMatched: boolean | null;
  denominatorKnown: boolean | null;
  features: Record<string, MarketBrainNumericFeature>;
  /** Categorical facts are retained as facts, not converted into directional points. */
  tags: string[];
  provenance: {
    sourceRelease: string;
    sourceObservationId: string;
  };
};

export type MarketBrainCoverageCell = {
  observed: number;
  stale: number;
  future: number;
  unavailable: number;
  identityMismatch: number;
};

export type MarketBrainCase = {
  release: typeof MARKET_BRAIN_CONTRACT_RELEASE;
  sport: MarketBrainSport;
  eventId: string;
  evaluatedAt: string;
  visibility: "internal_only";
  mode: "shadow";
  jointPrior: {
    homeMargin: number;
    total: number;
  };
  targetMarket: {
    homeSpread: number | null;
    total: number | null;
    homeMoneylineFairProbability: number | null;
  };
  targetExcludedMarket: {
    homeMargin: number | null;
    total: number | null;
    homeMoneylineFairProbability: number | null;
  };
  observations: MarketBrainObservation[];
  coverage: Record<MarketBrainModality, MarketBrainCoverageCell>;
  invariants: {
    missingValuesAreMasked: true;
    allObservationsRetained: true;
    jointMarginTotalState: true;
    targetBookSeparatedFromEvidence: true;
    lockedRecordMutationAllowed: false;
    productionInfluenceAllowed: false;
  };
};

export type MarketBrainArtifact = {
  release: string;
  sport: MarketBrainSport;
  architecture:
    | "masked_set_encoder_joint_margin_total"
    | "masked_sequence_encoder_joint_margin_total";
  featureContractRelease: typeof MARKET_BRAIN_CONTRACT_RELEASE;
  trainedThrough: string;
  chronologicalValidation: {
    selectionStartsAt: string;
    confirmationStartsAt: string;
    confirmationEndsAt: string;
    games: number;
  };
  calibration: {
    marginCalibrated: boolean;
    totalCalibrated: boolean;
    flipProbabilityCalibrated: boolean;
  };
  missingnessRegimesEvaluated: string[];
  sourceAblationsEvaluated: string[];
  immutableChecksum: string;
};

export type MarketBrainShadowDecision = {
  release: typeof MARKET_BRAIN_CONTRACT_RELEASE;
  status: "capture_only" | "artifact_rejected" | "shadow_inference";
  productionApplied: false;
  reason:
    | "validated_artifact_not_supplied"
    | "artifact_contract_mismatch"
    | "artifact_validation_incomplete"
    | "shadow_inference_only";
  baseline: {
    homeMargin: number;
    total: number;
  };
  candidate: {
    homeMargin: number;
    total: number;
    moneylineAction: "retain" | "confirm" | "recenter" | "flip" | "fade_market" | "stand_down";
    spreadAction: "retain" | "confirm" | "recenter" | "flip" | "fade_market" | "stand_down";
    totalAction: "retain" | "confirm" | "recenter" | "flip" | "fade_market" | "stand_down";
  } | null;
};

const MODALITIES: MarketBrainModality[] = [
  "forecast",
  "target_excluded_consensus",
  "book_path",
  "split",
  "availability",
  "weather",
  "other_context",
];

export function numericFeature(value: number | null | undefined): MarketBrainNumericFeature {
  return typeof value === "number" && Number.isFinite(value)
    ? { value, observed: 1 }
    : { value: null, observed: 0 };
}

export function buildMarketBrainCase(args: Omit<MarketBrainCase,
  "release" | "visibility" | "mode" | "coverage" | "invariants">): MarketBrainCase {
  if (!args.eventId.trim()) throw new Error("Market Brain eventId is required.");
  if (!Number.isFinite(Date.parse(args.evaluatedAt))) throw new Error("Market Brain evaluatedAt is invalid.");
  if (!Number.isFinite(args.jointPrior.homeMargin) || !Number.isFinite(args.jointPrior.total)) {
    throw new Error("Market Brain joint prior must be finite.");
  }
  const ids = new Set<string>();
  for (const observation of args.observations) {
    if (observation.eventId !== args.eventId || observation.sport !== args.sport) {
      throw new Error(`Market Brain observation ${observation.id} has the wrong event or sport identity.`);
    }
    if (ids.has(observation.id)) throw new Error(`Duplicate Market Brain observation: ${observation.id}`);
    ids.add(observation.id);
    for (const [name, feature] of Object.entries(observation.features)) {
      const valid = feature.observed === 0
        ? feature.value === null
        : typeof feature.value === "number" && Number.isFinite(feature.value);
      if (!valid) throw new Error(`Invalid Market Brain feature mask: ${observation.id}:${name}`);
    }
  }
  const observations = [...args.observations].sort((first, second) =>
    timestamp(first.observedAt) - timestamp(second.observedAt) || first.id.localeCompare(second.id));
  const coverage = Object.fromEntries(MODALITIES.map((modality) => {
    const rows = observations.filter((observation) => observation.modality === modality);
    return [modality, {
      observed: rows.filter((row) => row.availability === "observed").length,
      stale: rows.filter((row) => row.availability === "stale").length,
      future: rows.filter((row) => row.availability === "future").length,
      unavailable: rows.filter((row) => row.availability === "unavailable").length,
      identityMismatch: rows.filter((row) => row.availability === "identity_mismatch").length,
    }];
  })) as Record<MarketBrainModality, MarketBrainCoverageCell>;
  return {
    release: MARKET_BRAIN_CONTRACT_RELEASE,
    ...args,
    visibility: "internal_only",
    mode: "shadow",
    observations,
    coverage,
    invariants: {
      missingValuesAreMasked: true,
      allObservationsRetained: true,
      jointMarginTotalState: true,
      targetBookSeparatedFromEvidence: true,
      lockedRecordMutationAllowed: false,
      productionInfluenceAllowed: false,
    },
  };
}

/**
 * A case without an independently validated artifact is evidence collection,
 * not a prediction. This is deliberately fail-closed instead of disguising
 * hand-authored weights or source-count gates as a learned market brain.
 */
export function buildMarketBrainCaptureOnlyDecision(input: MarketBrainCase): MarketBrainShadowDecision {
  return {
    release: MARKET_BRAIN_CONTRACT_RELEASE,
    status: "capture_only",
    productionApplied: false,
    reason: "validated_artifact_not_supplied",
    baseline: { ...input.jointPrior },
    candidate: null,
  };
}

export function validateMarketBrainArtifact(artifact: MarketBrainArtifact): string[] {
  const failures: string[] = [];
  if (artifact.featureContractRelease !== MARKET_BRAIN_CONTRACT_RELEASE) failures.push("feature_contract_mismatch");
  const validation = artifact.chronologicalValidation;
  const times = [validation.selectionStartsAt, validation.confirmationStartsAt, validation.confirmationEndsAt]
    .map(Date.parse);
  if (times.some((value) => !Number.isFinite(value)) || !(times[0]! < times[1]! && times[1]! <= times[2]!)) {
    failures.push("invalid_chronological_validation");
  }
  const trainedThrough = Date.parse(artifact.trainedThrough);
  if (!Number.isFinite(trainedThrough) || !Number.isFinite(times[0]) || trainedThrough >= times[0]!) {
    failures.push("training_overlaps_selection");
  }
  if (!Number.isInteger(validation.games) || validation.games <= 0) failures.push("empty_confirmation_partition");
  if (!artifact.calibration.marginCalibrated || !artifact.calibration.totalCalibrated ||
      !artifact.calibration.flipProbabilityCalibrated) failures.push("incomplete_calibration");
  if (artifact.missingnessRegimesEvaluated.length === 0) failures.push("missingness_not_evaluated");
  if (artifact.sourceAblationsEvaluated.length === 0) failures.push("source_ablation_not_evaluated");
  if (!artifact.immutableChecksum.trim()) failures.push("artifact_checksum_missing");
  return failures;
}

function timestamp(value: string | null) {
  if (value === null) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}
