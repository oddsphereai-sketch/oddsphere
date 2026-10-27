export const MARKET_BRAIN_CONTRACT_RELEASE =
  "market_brain_contract_2026_10_26_r4_raw_manifests_and_target_boundary" as const;

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
  provider: string;
  feed: string;
  participant: string | null;
  providerFetchedAt: string;
  rawResponseSha256: string | null;
  returnedRows: number;
  matchedRows: number;
  unmatchedRows: number;
  ambiguousRows: number;
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
  selection: "away" | "home" | "over" | "under";
  line: number | null;
  price: number;
  observedAt: string;
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
  captureBoundary: "raw_provider_response" | "normalized_provider_observation";
  captureLimitations: string[];
  subject: MarketBrainSubject;
  prior: MarketBrainPrior;
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
    for (const [name, value] of Object.entries(observation.timing)) {
      if (value !== null && !Number.isFinite(Date.parse(value))) {
        throw new Error(`Invalid Market Brain ${name}: ${observation.id}`);
      }
    }
    if (observation.observedAt !== observation.timing.providerObservedAt) {
      throw new Error(`Market Brain provider observation time alias diverged: ${observation.id}`);
    }
    if (Date.parse(observation.timing.availableAt) < Date.parse(observation.timing.ingestedAt) ||
      (observation.timing.providerFetchedAt !== null &&
        Date.parse(observation.timing.availableAt) < Date.parse(observation.timing.providerFetchedAt))) {
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
    if (!target || !target.identity.trim() || !target.family.trim() || !Number.isFinite(target.price) ||
      !Number.isFinite(Date.parse(target.observedAt))) {
      throw new Error(`Invalid Market Brain evaluated target: ${market}`);
    }
  }
  const manifestIds = new Set<string>();
  for (const manifest of args.sourceManifests) {
    if (manifestIds.has(manifest.id)) throw new Error(`Duplicate Market Brain source manifest: ${manifest.id}`);
    manifestIds.add(manifest.id);
    if (!Number.isFinite(Date.parse(manifest.providerFetchedAt))) {
      throw new Error(`Invalid Market Brain source manifest fetch time: ${manifest.id}`);
    }
    if (Date.parse(manifest.providerFetchedAt) > Date.parse(args.evaluatedAt)) {
      throw new Error(`Market Brain source manifest was fetched after case evaluation: ${manifest.id}`);
    }
    for (const [name, value] of Object.entries({
      returnedRows: manifest.returnedRows,
      matchedRows: manifest.matchedRows,
      unmatchedRows: manifest.unmatchedRows,
      ambiguousRows: manifest.ambiguousRows,
    })) {
      if (!Number.isInteger(value) || value < 0) throw new Error(`Invalid Market Brain source manifest ${name}: ${manifest.id}`);
    }
    if (manifest.returnedRows !== manifest.matchedRows + manifest.unmatchedRows + manifest.ambiguousRows) {
      throw new Error(`Market Brain source manifest row accounting diverged: ${manifest.id}`);
    }
    if (manifest.rows.length !== manifest.returnedRows) {
      throw new Error(`Market Brain source manifest row ledger diverged: ${manifest.id}`);
    }
    const dispositions = {
      matched: manifest.rows.filter((row) => row.disposition === "matched").length,
      unmatched: manifest.rows.filter((row) => row.disposition === "unmatched").length,
      ambiguous: manifest.rows.filter((row) => row.disposition === "ambiguous").length,
    };
    if (dispositions.matched !== manifest.matchedRows || dispositions.unmatched !== manifest.unmatchedRows ||
      dispositions.ambiguous !== manifest.ambiguousRows) {
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

function timestamp(value: string | null): number {
  if (value === null) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}
