import { marketBrainSha256 } from "./marketBrainCanonical";

export const MARKET_BRAIN_CONTRACT_RELEASE =
  "market_brain_contract_2026_10_27_r14_source_manifest_release_identity" as const;

export type MarketBrainSport = "nfl" | "cfb" | "nba" | "wnba" | "mlb" | "nhl" | "soccer" | "other";
export type MarketBrainMarket = "moneyline" | "spread" | "total" | "player_prop" | "match_result" | "btts" | "other";
export type MarketBrainModality = "model_prior" | "price_quote" | "public_split" | "identified_book_split" | "availability" | "weather" | "other_context";
export type MarketBrainAvailability = "observed" | "incomplete" | "duplicate" | "stale" | "future" | "unavailable" | "identity_mismatch" | "unsupported";
export type MarketBrainObservedRole = "leader" | "follower" | "resistor" | "reversal" | "static" | "conflicted" | "unknown";
export type MarketBrainSourcePrior = "professional_book" | "retail_book" | "public_aggregate" | "independent_model" | "context_provider" | "unknown";

export type MarketBrainNumericFeature = { value: number | null; observed: 0 | 1 };

export type MarketBrainSubject =
  | { kind: "two_team_game"; awayId: string; homeId: string; startsAt: string }
  | { kind: "three_way_fixture"; awayId: string; homeId: string; startsAt: string }
  | { kind: "player_market"; playerId: string; teamId: string | null; opponentId: string | null; startsAt: string; stat: string };

export type MarketBrainDiscreteDistribution = {
  values: number[];
  probabilities: number[];
};

export type MarketBrainMarginTotalArtifact = {
  schema: "market_brain_margin_total_artifact_v1";
  eventId: string;
  release: string;
  availableAt: string;
  sha256: string;
  marginDistribution: MarketBrainDiscreteDistribution;
  totalDistribution: MarketBrainDiscreteDistribution;
};

export type MarketBrainPrior =
  | {
      kind: "margin_total_distribution";
      release: string;
      marginMean: number;
      totalMean: number;
      marginDistributionSha256: string;
      totalDistributionSha256: string;
      artifact: MarketBrainMarginTotalArtifact;
    }
  | {
      kind: "margin_total_distribution_ref";
      release: string;
      marginMean: number;
      totalMean: number;
      marginDistributionSha256: string;
      totalDistributionSha256: string;
      artifactSha256: string;
    }
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
  /** Provider event time retained for convenient ordering. See `timing` for availability-safe replay. */
  observedAt: string | null;
  timing: {
    providerObservedAt: string | null;
    providerFetchedAt: string | null;
    ingestedAt: string;
    /** Earliest time this row was available to Oddsphere inference. */
    availableAt: string;
  };
  availability: MarketBrainAvailability;
  targetRelation: "evaluated" | "same_family_as_evaluated" | "target_excluded" | "not_applicable" | "unknown";
  values: Record<string, MarketBrainNumericFeature>;
  categorical: Record<string, string | boolean | null>;
  audit: { sourceRelease: string; sourceObservationId: string; notes: string[] };
};

export type MarketBrainExpectedInput = {
  id: string;
  market: MarketBrainMarket;
  modality: MarketBrainModality;
  provider: string;
  participant: string | null;
  expectation: "required" | "opportunistic" | "unsupported";
  availability: MarketBrainAvailability;
  observationIds: string[];
  reason: string | null;
};

export type MarketBrainSourceManifest = {
  id: string;
  release: string;
  provider: string;
  feed: string;
  participant: string | null;
  providerFetchedAt: string;
  /** Wall-clock receipt boundary; never earlier than the provider fetch timestamp. */
  receivedAt: string;
  rawResponseSha256: string | null;
  rawParserInputSchemaRelease: string | null;
  rawParserInputSha256: string | null;
  returnedRows: number;
  matchedRows: number;
  unmatchedRows: number;
  ambiguousRows: number;
  ledgerScope: "full_response" | "event_rows_with_response_digest";
  ledgerRows: number;
  omittedRows: number;
  rows: Array<{
    rowIndex: number;
    rawRowSha256: string;
    disposition: "matched" | "unmatched" | "ambiguous";
    providerGameId: string | null;
    retainedObservationIds: string[];
  }>;
  retainedObservationIds: string[];
  status: "observed" | "failed";
  failureReason: string | null;
};

export type MarketBrainEvaluatedTarget = {
  identity: string;
  family: string;
  selection: "away" | "home" | "draw" | "over" | "under" | "yes" | "no";
  line: number | null;
  price: number;
  observedAt: string;
};

export function assertMarketBrainEvaluatedTarget(
  market: MarketBrainMarket,
  target: MarketBrainEvaluatedTarget,
  availableBy: string,
): void {
  const availableByMs = Date.parse(availableBy);
  const observedAtMs = Date.parse(target.observedAt);
  const validAmericanPrice = Number.isFinite(target.price) && target.price !== 0 &&
    (target.price <= -100 || target.price >= 100);
  const sideSelection = target.selection === "away" || target.selection === "home";
  const totalSelection = target.selection === "over" || target.selection === "under";
  const validLine = market === "moneyline" || market === "match_result" || market === "btts"
    ? target.line === null
    : market === "spread" || market === "total" || market === "player_prop" ? Number.isFinite(target.line)
    : target.line === null || Number.isFinite(target.line);
  const validSelection = market === "moneyline" || market === "spread" ? sideSelection
    : market === "total" || market === "player_prop" ? totalSelection
    : market === "match_result" ? sideSelection || target.selection === "draw"
    : market === "btts" ? target.selection === "yes" || target.selection === "no"
    : true;
  if (!target.identity.trim() || !target.family.trim() || !validAmericanPrice ||
    !Number.isFinite(observedAtMs) || !Number.isFinite(availableByMs) || observedAtMs > availableByMs ||
    !validLine || !validSelection) {
    throw new Error(`Invalid Market Brain evaluated target: ${market}`);
  }
}

export type MarketBrainBlindSpot = {
  id: "absolute_handle" | "ticket_count" | "bet_size_distribution" | "book_limits" | "move_origin" | "suspension_lifecycle" | "private_order_flow";
  status: "unobservable_by_current_feeds";
};

export type MarketBrainIncumbentComparator = {
  kind: "released_semantic_reader";
  availableAt: string;
  releases: {
    model: string | null;
    calibration: string | null;
    decision: string | null;
  };
  awayWinProbability: number;
  homeWinProbability: number;
  tieProbability: number;
  marginMean: number;
  totalMean: number;
  marginDistribution: MarketBrainDiscreteDistribution;
  totalDistribution: MarketBrainDiscreteDistribution;
  marginDistributionSha256: string;
  totalDistributionSha256: string;
};

export type MarketBrainCase = {
  release: typeof MARKET_BRAIN_CONTRACT_RELEASE;
  sport: MarketBrainSport;
  eventId: string;
  evaluatedAt: string;
  visibility: "internal_only";
  mode: "shadow_capture";
  temporalScope: "point_in_time_snapshot";
  captureBoundary: "raw_provider_response" | "normalized_provider_observation";
  captureLimitations: string[];
  subject: MarketBrainSubject;
  prior: MarketBrainPrior;
  incumbentComparator?: MarketBrainIncumbentComparator | null;
  evaluatedTargets: Partial<Record<MarketBrainMarket, MarketBrainEvaluatedTarget>>;
  observations: MarketBrainObservation[];
  sourceManifests: MarketBrainSourceManifest[];
  expectedInputs: MarketBrainExpectedInput[];
  blindSpots: MarketBrainBlindSpot[];
  accounting: {
    providedObservations: number;
    retainedObservations: number;
    sourceManifests: number;
    expectedInputs: number;
    expectedInputsAccounted: number;
    observed: number;
    unavailableOrUnsupported: number;
  };
  invariants: {
    missingValuesAreMasked: true;
    allProvidedObservationsRetained: true;
    allReturnedSourceRowsAccounted: true;
    allExpectedInputsAccounted: true;
    sourceReputationSeparatedFromObservedRole: true;
    providerFetchIngestAvailabilityTimesSeparated: true;
    targetQuoteSeparatedFromEvidence: true;
    displayContractAuthority: false;
    lockedRecordMutationAllowed: false;
    productionInfluenceAllowed: false;
  };
};

export const MARKET_BRAIN_BLIND_SPOTS: MarketBrainBlindSpot[] = [
  "absolute_handle", "ticket_count", "bet_size_distribution", "book_limits",
  "move_origin", "suspension_lifecycle", "private_order_flow",
].map((id) => ({ id: id as MarketBrainBlindSpot["id"], status: "unobservable_by_current_feeds" as const }));

export function numericFeature(value: number | null | undefined): MarketBrainNumericFeature {
  return typeof value === "number" && Number.isFinite(value) ? { value, observed: 1 } : { value: null, observed: 0 };
}

export function bindMarketBrainMarginTotalPrior(args: {
  eventId: string;
  release: string;
  availableAt: string;
  marginDistribution: MarketBrainDiscreteDistribution;
  totalDistribution: MarketBrainDiscreteDistribution;
}): Extract<MarketBrainPrior, { kind: "margin_total_distribution" }> {
  const artifactWithoutHash = {
    schema: "market_brain_margin_total_artifact_v1" as const,
    eventId: args.eventId,
    release: args.release,
    availableAt: args.availableAt,
    marginDistribution: cloneDistribution(args.marginDistribution),
    totalDistribution: cloneDistribution(args.totalDistribution),
  };
  const artifact: MarketBrainMarginTotalArtifact = {
    ...artifactWithoutHash,
    sha256: marketBrainSha256(artifactWithoutHash),
  };
  const prior = {
    kind: "margin_total_distribution" as const,
    release: args.release,
    marginMean: distributionMean(artifact.marginDistribution),
    totalMean: distributionMean(artifact.totalDistribution),
    marginDistributionSha256: marketBrainSha256(artifact.marginDistribution),
    totalDistributionSha256: marketBrainSha256(artifact.totalDistribution),
    artifact,
  };
  assertMarketBrainPrior(prior, args.eventId, args.availableAt);
  return prior;
}

export function referenceMarketBrainMarginTotalPrior(
  prior: Extract<MarketBrainPrior, { kind: "margin_total_distribution" }>,
): Extract<MarketBrainPrior, { kind: "margin_total_distribution_ref" }> {
  return {
    kind: "margin_total_distribution_ref",
    release: prior.release,
    marginMean: prior.marginMean,
    totalMean: prior.totalMean,
    marginDistributionSha256: prior.marginDistributionSha256,
    totalDistributionSha256: prior.totalDistributionSha256,
    artifactSha256: prior.artifact.sha256,
  };
}

export function marketBrainPriorArtifactSha256(prior: MarketBrainPrior): string | null {
  return prior.kind === "margin_total_distribution" ? prior.artifact.sha256
    : prior.kind === "margin_total_distribution_ref" ? prior.artifactSha256 : null;
}

export function assertMarketBrainPrior(prior: MarketBrainPrior, eventId: string, evaluatedAt: string): void {
  if (!prior.release.trim()) throw new Error("Market Brain prior release is required.");
  if (prior.kind === "margin_total_distribution_ref") {
    if (![prior.marginMean, prior.totalMean].every(Number.isFinite) ||
      ![prior.marginDistributionSha256, prior.totalDistributionSha256, prior.artifactSha256]
        .every((value) => /^[a-f0-9]{64}$/.test(value)) ||
      !Number.isFinite(Date.parse(evaluatedAt))) {
      throw new Error(`Market Brain prior artifact reference is invalid for ${eventId}.`);
    }
    return;
  }
  if (prior.kind !== "margin_total_distribution") return;
  const artifact = prior.artifact;
  if (artifact.schema !== "market_brain_margin_total_artifact_v1" || artifact.eventId !== eventId ||
    artifact.release !== prior.release) {
    throw new Error("Market Brain prior artifact identity diverged from its case.");
  }
  if (!Number.isFinite(Date.parse(artifact.availableAt)) || Date.parse(artifact.availableAt) > Date.parse(evaluatedAt)) {
    throw new Error("Market Brain prior artifact was unavailable at case evaluation.");
  }
  assertDistribution(artifact.marginDistribution, "margin");
  assertDistribution(artifact.totalDistribution, "total");
  const artifactWithoutHash = {
    schema: artifact.schema,
    eventId: artifact.eventId,
    release: artifact.release,
    availableAt: artifact.availableAt,
    marginDistribution: artifact.marginDistribution,
    totalDistribution: artifact.totalDistribution,
  };
  if (artifact.sha256 !== marketBrainSha256(artifactWithoutHash) ||
    prior.marginDistributionSha256 !== marketBrainSha256(artifact.marginDistribution) ||
    prior.totalDistributionSha256 !== marketBrainSha256(artifact.totalDistribution)) {
    throw new Error("Market Brain prior artifact checksum mismatch.");
  }
  if (Math.abs(prior.marginMean - distributionMean(artifact.marginDistribution)) > 1e-9 ||
    Math.abs(prior.totalMean - distributionMean(artifact.totalDistribution)) > 1e-9) {
    throw new Error("Market Brain prior artifact mean mismatch.");
  }
}

export function buildMarketBrainCase(args: Omit<MarketBrainCase,
  "release" | "visibility" | "mode" | "temporalScope" | "accounting" | "invariants">): MarketBrainCase {
  if (!args.eventId.trim()) throw new Error("Market Brain eventId is required.");
  if (!Number.isFinite(Date.parse(args.evaluatedAt))) throw new Error("Market Brain evaluatedAt is invalid.");
  if (!Number.isFinite(Date.parse(args.subject.startsAt))) throw new Error("Market Brain startsAt is invalid.");
  assertMarketBrainPrior(args.prior, args.eventId, args.evaluatedAt);
  if (args.incumbentComparator) {
    const comparator = args.incumbentComparator;
    const probabilityMass = comparator.awayWinProbability + comparator.homeWinProbability +
      comparator.tieProbability;
    if (comparator.kind !== "released_semantic_reader" ||
      !Number.isFinite(Date.parse(comparator.availableAt)) ||
      Date.parse(comparator.availableAt) > Date.parse(args.evaluatedAt) ||
      ![comparator.awayWinProbability, comparator.homeWinProbability, comparator.tieProbability]
        .every((value) => Number.isFinite(value) && value >= 0 && value <= 1) ||
      Math.abs(probabilityMass - 1) > 1e-9 ||
      ![comparator.marginMean, comparator.totalMean].every(Number.isFinite) ||
      ![comparator.marginDistributionSha256, comparator.totalDistributionSha256]
        .every((value) => /^[a-f0-9]{64}$/.test(value))) {
      throw new Error("Market Brain incumbent comparator is invalid or unavailable at evaluation.");
    }
    assertDistribution(comparator.marginDistribution, "incumbent margin");
    assertDistribution(comparator.totalDistribution, "incumbent total");
    const incumbentWin = comparator.marginDistribution.values.reduce((result, margin, index) => {
      const probability = comparator.marginDistribution.probabilities[index]!;
      if (margin < 0) result.away += probability;
      else if (margin > 0) result.home += probability;
      else result.tie += probability;
      return result;
    }, { away: 0, home: 0, tie: 0 });
    if (comparator.marginDistributionSha256 !== marketBrainSha256(comparator.marginDistribution) ||
      comparator.totalDistributionSha256 !== marketBrainSha256(comparator.totalDistribution) ||
      Math.abs(comparator.marginMean - distributionMean(comparator.marginDistribution)) > 1e-9 ||
      Math.abs(comparator.totalMean - distributionMean(comparator.totalDistribution)) > 1e-9 ||
      Math.abs(comparator.awayWinProbability - incumbentWin.away) > 1e-9 ||
      Math.abs(comparator.homeWinProbability - incumbentWin.home) > 1e-9 ||
      Math.abs(comparator.tieProbability - incumbentWin.tie) > 1e-9) {
      throw new Error("Market Brain incumbent comparator distributions are incoherent.");
    }
  }
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
    for (const [name, value] of Object.entries(observation.timing)) {
      if (value !== null && !Number.isFinite(Date.parse(value))) {
        throw new Error(`Invalid Market Brain ${name}: ${observation.id}`);
      }
    }
    if (observation.observedAt !== observation.timing.providerObservedAt) {
      throw new Error(`Market Brain provider observation time alias diverged: ${observation.id}`);
    }
    const evaluatedAt = Date.parse(args.evaluatedAt);
    const observedAt = observation.timing.providerObservedAt === null
      ? null : Date.parse(observation.timing.providerObservedAt);
    const fetchedAt = observation.timing.providerFetchedAt === null
      ? null : Date.parse(observation.timing.providerFetchedAt);
    const ingestedAt = Date.parse(observation.timing.ingestedAt);
    const availableAt = Date.parse(observation.timing.availableAt);
    if (availableAt < ingestedAt ||
      (observation.timing.providerFetchedAt !== null &&
        availableAt < Date.parse(observation.timing.providerFetchedAt)) ||
      (observedAt !== null && fetchedAt !== null && fetchedAt < observedAt) ||
      (observedAt !== null && observedAt > availableAt) ||
      (observation.availability !== "future" &&
        (availableAt > evaluatedAt || ingestedAt > evaluatedAt ||
          (fetchedAt !== null && fetchedAt > evaluatedAt) || (observedAt !== null && observedAt > evaluatedAt)))) {
      throw new Error(`Market Brain observation was available before fetch or ingestion: ${observation.id}`);
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
  for (const [market, target] of Object.entries(args.evaluatedTargets)) {
    if (target) assertMarketBrainEvaluatedTarget(market as MarketBrainMarket, target, args.evaluatedAt);
  }
  const manifestIds = new Set<string>();
  for (const manifest of args.sourceManifests) {
    if (manifestIds.has(manifest.id)) throw new Error(`Duplicate Market Brain source manifest: ${manifest.id}`);
    manifestIds.add(manifest.id);
    if (!manifest.release.trim()) {
      throw new Error(`Market Brain source manifest release is required: ${manifest.id}`);
    }
    if (!Number.isFinite(Date.parse(manifest.providerFetchedAt))) {
      throw new Error(`Invalid Market Brain source manifest fetch time: ${manifest.id}`);
    }
    if (!Number.isFinite(Date.parse(manifest.receivedAt)) ||
      Date.parse(manifest.receivedAt) < Date.parse(manifest.providerFetchedAt) ||
      Date.parse(manifest.receivedAt) > Date.parse(args.evaluatedAt)) {
      throw new Error(`Invalid Market Brain source manifest receipt time: ${manifest.id}`);
    }
    if (Date.parse(manifest.providerFetchedAt) > Date.parse(args.evaluatedAt)) {
      throw new Error(`Market Brain source manifest was fetched after case evaluation: ${manifest.id}`);
    }
    for (const [name, value] of Object.entries({
      returnedRows: manifest.returnedRows,
      matchedRows: manifest.matchedRows,
      unmatchedRows: manifest.unmatchedRows,
      ambiguousRows: manifest.ambiguousRows,
      ledgerRows: manifest.ledgerRows,
      omittedRows: manifest.omittedRows,
    })) {
      if (!Number.isInteger(value) || value < 0) throw new Error(`Invalid Market Brain source manifest ${name}: ${manifest.id}`);
    }
    if (manifest.returnedRows !== manifest.matchedRows + manifest.unmatchedRows + manifest.ambiguousRows) {
      throw new Error(`Market Brain source manifest row accounting diverged: ${manifest.id}`);
    }
    if (manifest.rows.length !== manifest.ledgerRows ||
      manifest.returnedRows !== manifest.ledgerRows + manifest.omittedRows) {
      throw new Error(`Market Brain source manifest row ledger diverged: ${manifest.id}`);
    }
    const dispositions = {
      matched: manifest.rows.filter((row) => row.disposition === "matched").length,
      unmatched: manifest.rows.filter((row) => row.disposition === "unmatched").length,
      ambiguous: manifest.rows.filter((row) => row.disposition === "ambiguous").length,
    };
    if (manifest.ledgerScope === "full_response" &&
      (dispositions.matched !== manifest.matchedRows || dispositions.unmatched !== manifest.unmatchedRows ||
      dispositions.ambiguous !== manifest.ambiguousRows)) {
      throw new Error(`Market Brain source manifest disposition accounting diverged: ${manifest.id}`);
    }
    if (manifest.rows.some((row) => !Number.isInteger(row.rowIndex) || row.rowIndex < 0 ||
      !/^[a-f0-9]{64}$/.test(row.rawRowSha256) || row.retainedObservationIds.some((id) => !observationIds.has(id)))) {
      throw new Error(`Market Brain source manifest row ledger is invalid: ${manifest.id}`);
    }
    if (manifest.status === "observed" && (manifest.rawResponseSha256 === null ||
      !/^[a-f0-9]{64}$/.test(manifest.rawResponseSha256) || manifest.failureReason !== null)) {
      throw new Error(`Observed Market Brain source manifest is incomplete: ${manifest.id}`);
    }
    if (manifest.status === "failed" && (manifest.rawResponseSha256 !== null || manifest.failureReason === null)) {
      throw new Error(`Failed Market Brain source manifest is inconsistent: ${manifest.id}`);
    }
    if (manifest.retainedObservationIds.some((id) => !observationIds.has(id))) {
      throw new Error(`Market Brain source manifest ${manifest.id} references an unknown observation.`);
    }
  }
  const observations = [...args.observations].sort((a, b) =>
    timestamp(a.timing.availableAt) - timestamp(b.timing.availableAt) ||
    timestamp(a.observedAt) - timestamp(b.observedAt) || a.id.localeCompare(b.id));
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
      sourceManifests: args.sourceManifests.length,
      expectedInputs: args.expectedInputs.length,
      expectedInputsAccounted: args.expectedInputs.length,
      observed: observations.filter((row) => row.availability === "observed").length,
      unavailableOrUnsupported: args.expectedInputs.filter((row) => ["unavailable", "unsupported", "identity_mismatch"].includes(row.availability)).length,
    },
    invariants: {
      missingValuesAreMasked: true,
      allProvidedObservationsRetained: true,
      allReturnedSourceRowsAccounted: true,
      allExpectedInputsAccounted: true,
      sourceReputationSeparatedFromObservedRole: true,
      providerFetchIngestAvailabilityTimesSeparated: true,
      targetQuoteSeparatedFromEvidence: true,
      displayContractAuthority: false,
      lockedRecordMutationAllowed: false,
      productionInfluenceAllowed: false,
    },
  };
}

export function assertMarketBrainCase(value: unknown): asserts value is MarketBrainCase {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("case is not an object");
    }
    const candidate = value as MarketBrainCase;
    const rebuilt = buildMarketBrainCase({
      sport: candidate.sport,
      eventId: candidate.eventId,
      evaluatedAt: candidate.evaluatedAt,
      captureBoundary: candidate.captureBoundary,
      captureLimitations: candidate.captureLimitations,
      subject: candidate.subject,
      prior: candidate.prior,
      evaluatedTargets: candidate.evaluatedTargets,
      observations: candidate.observations,
      sourceManifests: candidate.sourceManifests,
      expectedInputs: candidate.expectedInputs,
      blindSpots: candidate.blindSpots,
      ...("incumbentComparator" in candidate
        ? { incumbentComparator: candidate.incumbentComparator }
        : {}),
    });
    if (marketBrainSha256(candidate) !== marketBrainSha256(rebuilt)) {
      throw new Error("derived fields or contract identity diverged");
    }
  } catch (error) {
    throw new Error(`Invalid Market Brain case: ${error instanceof Error ? error.message : "unknown shape"}`);
  }
}

function cloneDistribution(distribution: MarketBrainDiscreteDistribution): MarketBrainDiscreteDistribution {
  return { values: [...distribution.values], probabilities: [...distribution.probabilities] };
}

function assertDistribution(distribution: MarketBrainDiscreteDistribution, name: string): void {
  if (distribution.values.length === 0 || distribution.values.length !== distribution.probabilities.length ||
    distribution.values.some((value) => !Number.isFinite(value)) ||
    distribution.probabilities.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error(`Market Brain ${name} prior distribution is invalid.`);
  }
  const mass = distribution.probabilities.reduce((sum, value) => sum + value, 0);
  if (Math.abs(mass - 1) > 1e-6) throw new Error(`Market Brain ${name} prior distribution mass is invalid.`);
}

function distributionMean(distribution: MarketBrainDiscreteDistribution): number {
  return distribution.values.reduce((sum, value, index) => sum + value * distribution.probabilities[index]!, 0);
}


function timestamp(value: string | null): number {
  if (value === null) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}
