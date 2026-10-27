import { marketBrainSha256 } from "./marketBrainCanonical";

import {
  MARKET_BRAIN_CONTRACT_RELEASE,
  assertMarketBrainPrior,
  assertMarketBrainEvaluatedTarget,
  type MarketBrainCase,
  type MarketBrainExpectedInput,
  type MarketBrainIncumbentComparator,
  type MarketBrainMarket,
  type MarketBrainObservation,
  type MarketBrainObservedRole,
  type MarketBrainPrior,
} from "./marketBrainContract";
import { assertNflMarketBrainPriorInputLineageQualified } from "./nflMarketBrainPriorLineage";

export const NFL_MARKET_BRAIN_SEQUENCE_MATERIALIZER_RELEASE =
  "nfl_market_brain_sequence_materializer_2026_10_27_r21_frozen_decision_envelopes" as const;

type FullGameMarket = Extract<MarketBrainMarket, "moneyline" | "spread" | "total">;
type PriceSelection = "away" | "home" | "over" | "under";

export type NflMarketBrainMaterializedObservation = {
  observation: MarketBrainObservation;
  eligible: boolean;
  exclusionReasons: Array<
    "after_cutoff" | "evaluated_target" | "same_target_family" | "superseded_prior" |
    "target_composition_unknown" | "unavailable" | "incomplete" | "unsupported"
  >;
};

export type NflMarketBrainMaterializedExpectedInput = {
  input: MarketBrainExpectedInput;
  capturedAt: string;
  eligible: boolean;
  exclusionReasons: Array<"same_target_family">;
};

export type NflMarketBrainQuotePoint = {
  observedAt: string;
  availableAt: string;
  providerFetchedAt: [string | null, string | null];
  ingestedAt: [string, string];
  phase: string;
  line: number | null;
  firstPrice: number;
  secondPrice: number;
  firstFairProbability: number;
  hold: number;
  observationIds: [string, string];
};

export type NflMarketBrainQuotePath = {
  provider: string;
  participant: string;
  /** Audit-only provider event identity; stripped before trainer export. */
  providerEventId: string;
  sourcePrior: MarketBrainObservation["sourcePrior"];
  market: FullGameMarket;
  observedRole: MarketBrainObservedRole;
  wasFirstMover: boolean;
  directionConflict: boolean;
  directionConflictCount: number;
  firstDirectionConflictAt: string | null;
  points: NflMarketBrainQuotePoint[];
  opening: NflMarketBrainQuotePoint;
  current: NflMarketBrainQuotePoint;
  lineDelta: number | null;
  firstFairProbabilityDelta: number;
  holdDelta: number;
  moveCount: number;
  reversalCount: number;
  buybackDistance: number;
  lineBuybackDistance: number;
  fairProbabilityBuybackDistance: number;
  firstEconomicChangeAt: string | null;
  lastEconomicChangeAt: string | null;
  crossedNflKeyNumbers: number[];
};

export type NflMarketBrainCrossMarket = {
  marketDirection: Record<FullGameMarket, "first_side" | "second_side" | "static" | "conflicted" | "unavailable">;
  firstChangeAt: Record<FullGameMarket, string | null>;
  sideRelationship: "aligned" | "opposed" | "static" | "conflicted" | "unavailable";
  sideLeader: "moneyline" | "spread" | "simultaneous" | null;
  sideLeadLagMinutes: number | null;
};

export type NflMarketBrainSequence = {
  release: typeof NFL_MARKET_BRAIN_SEQUENCE_MATERIALIZER_RELEASE;
  contractRelease: typeof MARKET_BRAIN_CONTRACT_RELEASE;
  sport: "nfl";
  eventId: string;
  startsAt: string;
  cutoffAt: string;
  captureWindow: { firstCapturedAt: string; lastCapturedAt: string };
  captureMembership: Array<{ evaluatedAt: string; caseSha256: string }>;
  prior: MarketBrainPrior;
  incumbentComparator: MarketBrainIncumbentComparator | null;
  targetFamilyByMarket: Record<FullGameMarket, string | null>;
  /** Target-safe scoring metadata. This is never exported to trainer input. */
  evaluationEnvelope: MarketBrainCase["evaluatedTargets"];
  observations: NflMarketBrainMaterializedObservation[];
  expectedInputs: NflMarketBrainMaterializedExpectedInput[];
  sourceManifests: MarketBrainCase["sourceManifests"];
  quotePaths: NflMarketBrainQuotePath[];
  crossMarket: NflMarketBrainCrossMarket;
  sourceAvailability: {
    regime: "complete" | "degraded" | "unavailable";
    targetSafeExpectedInputs: number;
    failed: number;
    evidenceManifestChecksum: string;
    snapshots: Array<{
      capturedAt: string;
      regime: "complete" | "degraded" | "unavailable";
      targetSafeExpectedInputs: number;
      observed: number;
      failed: number;
      incomplete: number;
      duplicate: number;
      stale: number;
      manifestChecksum: string;
    }>;
  };
  accounting: {
    inputCases: number;
    eligibleCases: number;
    inputObservations: number;
    deduplicatedObservations: number;
    eligibleObservations: number;
    afterCutoff: number;
    targetExcluded: number;
    targetExcludedExpectedInputs: number;
    unavailableOrUnsupported: number;
    pairedQuotePoints: number;
  };
  invariants: {
    outcomesUnavailableToMaterializer: true;
    cutoffAppliedBeforeFeatures: true;
    evaluatedTargetFamilyExcludedBeforeRoles: true;
    missingValuesNeverZeroFilled: true;
    reputationNeverDefinesObservedRole: true;
    productionInfluenceAllowed: false;
  };
  checksum: string;
};

export function materializeNflMarketBrainSequence(args: {
  cases: MarketBrainCase[];
  cutoffAt: string;
}): NflMarketBrainSequence {
  const cutoff = timestampRequired(args.cutoffAt, "cutoffAt");
  if (args.cases.length === 0) throw new Error("NFL Market Brain materializer requires at least one case.");
  if (args.cases.some((item) => item.release !== MARKET_BRAIN_CONTRACT_RELEASE)) {
    throw new Error("NFL Market Brain materializer refuses mixed or superseded contract releases.");
  }
  if (args.cases.some((item) => item.sport !== "nfl")) throw new Error("NFL Market Brain materializer accepts NFL cases only.");
  for (const item of args.cases) assertMarketBrainPrior(item.prior, item.eventId, item.evaluatedAt);
  const eventIds = new Set(args.cases.map((item) => item.eventId));
  if (eventIds.size !== 1) throw new Error("NFL Market Brain materializer refuses mixed events.");
  if (args.cases.some((item) => item.subject.kind !== "two_team_game")) {
    throw new Error("NFL Market Brain materializer requires a two-team game subject.");
  }
  const subjectIdentities = new Set(args.cases.map((item) => JSON.stringify(item.subject)));
  if (subjectIdentities.size !== 1) throw new Error("NFL Market Brain materializer refuses conflicting event subjects.");
  const eventId = args.cases[0]!.eventId;
  const eligibleCases = args.cases
    .filter((item) => timestampRequired(item.evaluatedAt, "evaluatedAt") <= cutoff)
    .sort((a, b) => Date.parse(a.evaluatedAt) - Date.parse(b.evaluatedAt));
  if (eligibleCases.length === 0) throw new Error("No NFL Market Brain case was available by the requested cutoff.");
  const latestCase = eligibleCases.at(-1)!;
  for (const [market, target] of Object.entries(latestCase.evaluatedTargets)) {
    if (target) assertMarketBrainEvaluatedTarget(market as MarketBrainMarket, target, new Date(cutoff).toISOString());
  }
  const latestPrior = resolvePrior(latestCase.prior, eligibleCases, cutoff);
  const targetFamilyByMarket = Object.fromEntries(
    (["moneyline", "spread", "total"] as const).map((market) =>
      [market, latestCase.evaluatedTargets[market]?.family ?? null]),
  ) as Record<FullGameMarket, string | null>;
  const targetFamiliesByMarket = Object.fromEntries(
    (["moneyline", "spread", "total"] as const).map((market) => [market, new Set(eligibleCases
      .flatMap((marketCase) => marketCase.evaluatedTargets[market]?.family
        ? [canonical(marketCase.evaluatedTargets[market]!.family)] : []))]),
  ) as Record<FullGameMarket, Set<string>>;

  const inputObservations = eligibleCases.flatMap((item) => item.observations);
  const deduplicated = deduplicate(inputObservations);
  const latestPriorAvailable = latestPrior.kind !== "unavailable";
  const latestPriorArtifactSha256 = latestPrior.kind === "margin_total_distribution"
    ? latestPrior.artifact.sha256 : null;
  const observations = deduplicated.map((observation): NflMarketBrainMaterializedObservation => {
    const reasons: NflMarketBrainMaterializedObservation["exclusionReasons"] = [];
    if (Date.parse(observation.timing.availableAt) > cutoff) reasons.push("after_cutoff");
    if (isMarketEvidence(observation) && observation.targetRelation === "evaluated") {
      reasons.push("evaluated_target");
    } else if (isMarketEvidence(observation) && observation.targetRelation === "same_family_as_evaluated") {
      reasons.push("same_target_family");
    } else if (isMarketEvidence(observation) && isFullGameMarket(observation.market) &&
      targetFamiliesByMarket[observation.market].has(canonical(observation.source.participant))) {
      reasons.push("same_target_family");
    }
    if (observation.modality === "public_split" && observation.targetRelation === "unknown") {
      reasons.push("target_composition_unknown");
    }
    if (observation.modality === "model_prior" &&
      (!latestPriorAvailable || observation.categorical.artifactSha256 !== latestPriorArtifactSha256)) {
      reasons.push("superseded_prior");
    }
    // Stale, incomplete, duplicate and unavailable observations remain masked
    // evidence tokens. They are excluded from paired quote paths below, but
    // their presence/failure timing must not disappear from the reader.
    if (observation.availability === "future") reasons.push("unavailable");
    return { observation, eligible: reasons.length === 0, exclusionReasons: [...new Set(reasons)] };
  });
  const expectedInputs = eligibleCases.flatMap((marketCase) => marketCase.expectedInputs.map(
    (input): NflMarketBrainMaterializedExpectedInput => {
      const exclusionReasons: NflMarketBrainMaterializedExpectedInput["exclusionReasons"] =
        input.participant !== null && isFullGameMarket(input.market) &&
          targetFamiliesByMarket[input.market].has(canonical(input.participant))
          ? ["same_target_family"] : [];
      return { input, capturedAt: marketCase.evaluatedAt, eligible: exclusionReasons.length === 0, exclusionReasons };
    },
  ));

  const quotePaths = buildQuotePaths(observations);
  assignObservedRoles(quotePaths);
  const crossMarket = buildCrossMarket(quotePaths);
  const manifests = eligibleCases.flatMap((marketCase) => marketCase.sourceManifests);
  const targetSafeInputs = expectedInputs.filter((row) => row.eligible && row.input.expectation !== "unsupported");
  const failed = targetSafeInputs.filter((row) =>
    ["unavailable", "identity_mismatch", "future"].includes(row.input.availability)).length;
  const observed = targetSafeInputs.filter((row) => row.input.availability === "observed").length;
  const availabilitySnapshots = eligibleCases.map((marketCase) =>
    availabilitySnapshot(marketCase, targetFamiliesByMarket));
  const sourceAvailability = {
    regime: availabilitySnapshots.at(-1)!.regime,
    targetSafeExpectedInputs: targetSafeInputs.length,
    failed,
    evidenceManifestChecksum: sha256(manifests),
    snapshots: availabilitySnapshots,
  };
  const withoutChecksum = {
    release: NFL_MARKET_BRAIN_SEQUENCE_MATERIALIZER_RELEASE,
    contractRelease: MARKET_BRAIN_CONTRACT_RELEASE,
    sport: "nfl" as const,
    eventId,
    startsAt: latestCase.subject.startsAt,
    cutoffAt: new Date(cutoff).toISOString(),
    captureWindow: {
      firstCapturedAt: eligibleCases[0]!.evaluatedAt,
      lastCapturedAt: latestCase.evaluatedAt,
    },
    captureMembership: eligibleCases.map((marketCase) => ({
      evaluatedAt: marketCase.evaluatedAt,
      caseSha256: marketBrainSha256(marketCase),
    })),
    prior: latestPrior,
    incumbentComparator: structuredClone(latestCase.incumbentComparator ?? null),
    targetFamilyByMarket,
    evaluationEnvelope: structuredClone(latestCase.evaluatedTargets),
    observations,
    expectedInputs,
    sourceManifests: structuredClone(manifests),
    quotePaths,
    crossMarket,
    sourceAvailability,
    accounting: {
      inputCases: args.cases.length,
      eligibleCases: eligibleCases.length,
      inputObservations: inputObservations.length,
      deduplicatedObservations: deduplicated.length,
      eligibleObservations: observations.filter((row) => row.eligible).length,
      afterCutoff: observations.filter((row) => row.exclusionReasons.includes("after_cutoff")).length,
      targetExcluded: observations.filter((row) => row.exclusionReasons.includes("evaluated_target") || row.exclusionReasons.includes("same_target_family")).length,
      targetExcludedExpectedInputs: expectedInputs.filter((row) => !row.eligible).length,
      unavailableOrUnsupported: observations.filter((row) =>
        ["unavailable", "identity_mismatch", "stale", "future", "incomplete", "unsupported", "duplicate"]
          .includes(row.observation.availability)).length,
      pairedQuotePoints: quotePaths.reduce((sum, path) => sum + path.points.length, 0),
    },
    invariants: {
      outcomesUnavailableToMaterializer: true as const,
      cutoffAppliedBeforeFeatures: true as const,
      evaluatedTargetFamilyExcludedBeforeRoles: true as const,
      missingValuesNeverZeroFilled: true as const,
      reputationNeverDefinesObservedRole: true as const,
      productionInfluenceAllowed: false as const,
    },
  };
  return { ...withoutChecksum, checksum: sha256(withoutChecksum) };
}

export function assertNflMarketBrainSequence(sequence: NflMarketBrainSequence): void {
  const { checksum, ...withoutChecksum } = sequence;
  if (sequence.release !== NFL_MARKET_BRAIN_SEQUENCE_MATERIALIZER_RELEASE ||
    sequence.contractRelease !== MARKET_BRAIN_CONTRACT_RELEASE || sequence.sport !== "nfl" ||
    !/^[a-f0-9]{64}$/.test(checksum) || sha256(withoutChecksum) !== checksum) {
    throw new Error("NFL Market Brain sequence checksum or release is invalid.");
  }
  const cutoff = timestampRequired(sequence.cutoffAt, "cutoffAt");
  const starts = timestampRequired(sequence.startsAt, "startsAt");
  const firstCapture = timestampRequired(sequence.captureWindow.firstCapturedAt, "firstCapturedAt");
  const lastCapture = timestampRequired(sequence.captureWindow.lastCapturedAt, "lastCapturedAt");
  if (firstCapture > lastCapture || lastCapture > cutoff || cutoff >= starts) {
    throw new Error("NFL Market Brain sequence capture chronology is invalid.");
  }
  assertMarketBrainPrior(sequence.prior, sequence.eventId, sequence.cutoffAt);
  assertNflMarketBrainPriorInputLineageQualified(sequence.prior);
  for (const [market, target] of Object.entries(sequence.evaluationEnvelope)) {
    if (target) assertMarketBrainEvaluatedTarget(market as MarketBrainMarket, target, sequence.cutoffAt);
  }
}

function availabilitySnapshot(
  marketCase: MarketBrainCase,
  targetFamiliesByMarket: Record<FullGameMarket, Set<string>>,
): NflMarketBrainSequence["sourceAvailability"]["snapshots"][number] {
  const safe = marketCase.expectedInputs.filter((input) => {
    if (input.expectation === "unsupported") return false;
    return input.participant === null || !isFullGameMarket(input.market) ||
      !targetFamiliesByMarket[input.market].has(canonical(input.participant));
  });
  const count = (availability: MarketBrainExpectedInput["availability"]) =>
    safe.filter((input) => input.availability === availability).length;
  const observed = count("observed");
  const failed = safe.filter((input) =>
    ["unavailable", "identity_mismatch", "future"].includes(input.availability)).length;
  const regime = observed === 0 ? "unavailable" : failed > 0 || observed < safe.length ? "degraded" : "complete";
  return {
    capturedAt: marketCase.evaluatedAt,
    regime,
    targetSafeExpectedInputs: safe.length,
    observed,
    failed,
    incomplete: count("incomplete"),
    duplicate: count("duplicate"),
    stale: count("stale"),
    manifestChecksum: sha256(marketCase.sourceManifests),
  };
}

function isMarketEvidence(observation: MarketBrainObservation): boolean {
  return observation.modality === "price_quote" || observation.modality === "public_split" ||
    observation.modality === "identified_book_split";
}

function canonical(value: string | null): string {
  return value?.toLowerCase().replace(/[^a-z0-9]+/g, "") ?? "";
}

function resolvePrior(prior: MarketBrainPrior, cases: MarketBrainCase[], cutoff: number): MarketBrainPrior {
  if (prior.kind !== "margin_total_distribution_ref") return prior;
  const artifactCase = cases.find((item) => Date.parse(item.evaluatedAt) <= cutoff &&
    item.prior.kind === "margin_total_distribution" && item.prior.artifact.sha256 === prior.artifactSha256);
  if (!artifactCase || artifactCase.prior.kind !== "margin_total_distribution") {
    throw new Error("NFL Market Brain materializer could not resolve the content-addressed prior artifact.");
  }
  const artifactPrior = artifactCase.prior;
  if (artifactPrior.release !== prior.release ||
    artifactPrior.marginDistributionSha256 !== prior.marginDistributionSha256 ||
    artifactPrior.totalDistributionSha256 !== prior.totalDistributionSha256 ||
    artifactPrior.artifact.inputLineage.sha256 !== prior.inputLineageSha256 ||
    artifactPrior.artifact.inputLineage.qualification !== prior.inputQualification ||
    Math.abs(artifactPrior.marginMean - prior.marginMean) > 1e-9 ||
    Math.abs(artifactPrior.totalMean - prior.totalMean) > 1e-9) {
    throw new Error("NFL Market Brain prior reference diverged from its content-addressed artifact.");
  }
  return artifactPrior;
}

function buildCrossMarket(paths: NflMarketBrainQuotePath[]): NflMarketBrainCrossMarket {
  const summaries = Object.fromEntries((["moneyline", "spread", "total"] as const).map((market) => {
    const marketPaths = paths.filter((path) => path.market === market);
    const directions = marketPaths.map(netDirection).filter((direction) => direction !== 0);
    const direction = marketPaths.length === 0 ? "unavailable" :
      marketPaths.some((path) => path.observedRole === "conflicted") ? "conflicted" :
      directions.length === 0 ? "static" :
      new Set(directions).size > 1 ? "conflicted" : directions[0] === 1 ? "first_side" : "second_side";
    const changes = marketPaths.flatMap((path) => path.firstEconomicChangeAt ? [path.firstEconomicChangeAt] : [])
      .sort((a, b) => Date.parse(a) - Date.parse(b));
    return [market, { direction, firstChangeAt: changes[0] ?? null }];
  })) as Record<FullGameMarket, {
    direction: NflMarketBrainCrossMarket["marketDirection"][FullGameMarket];
    firstChangeAt: string | null;
  }>;
  const moneyline = summaries.moneyline.direction;
  const spread = summaries.spread.direction;
  const sideRelationship: NflMarketBrainCrossMarket["sideRelationship"] =
    moneyline === "unavailable" || spread === "unavailable" ? "unavailable" :
    moneyline === "conflicted" || spread === "conflicted" ? "conflicted" :
    moneyline === "static" || spread === "static" ? "static" :
    moneyline === spread ? "aligned" : "opposed";
  const moneylineAt = summaries.moneyline.firstChangeAt;
  const spreadAt = summaries.spread.firstChangeAt;
  const deltaMinutes = moneylineAt && spreadAt ? (Date.parse(spreadAt) - Date.parse(moneylineAt)) / 60_000 : null;
  return {
    marketDirection: {
      moneyline: summaries.moneyline.direction,
      spread: summaries.spread.direction,
      total: summaries.total.direction,
    },
    firstChangeAt: {
      moneyline: moneylineAt,
      spread: spreadAt,
      total: summaries.total.firstChangeAt,
    },
    sideRelationship,
    sideLeader: deltaMinutes === null ? null : deltaMinutes === 0 ? "simultaneous" : deltaMinutes > 0 ? "moneyline" : "spread",
    sideLeadLagMinutes: deltaMinutes === null ? null : Math.abs(deltaMinutes),
  };
}

function deduplicate(observations: MarketBrainObservation[]): MarketBrainObservation[] {
  const rows = new Map<string, MarketBrainObservation>();
  for (const observation of observations) {
    const key = [
      observation.market,
      observation.modality,
      observation.source.provider,
      observation.source.participant ?? "",
      observation.audit.sourceObservationId,
    ].join("|");
    const prior = rows.get(key);
    if (!prior) {
      rows.set(key, observation);
      continue;
    }
    if (sha256(immutableObservation(prior)) !== sha256(immutableObservation(observation))) {
      throw new Error(`Conflicting Market Brain observation identity: ${key}`);
    }
    if (prior.availability === "future" && observation.availability !== "future") {
      rows.set(key, observation);
    } else if (prior.availability === observation.availability &&
      Date.parse(observation.timing.availableAt) < Date.parse(prior.timing.availableAt)) {
      rows.set(key, observation);
    }
  }
  return [...rows.values()].sort((a, b) =>
    Date.parse(a.timing.availableAt) - Date.parse(b.timing.availableAt) ||
    nullableTimestamp(a.observedAt) - nullableTimestamp(b.observedAt) || a.id.localeCompare(b.id));
}

function immutableObservation(observation: MarketBrainObservation) {
  return {
    eventId: observation.eventId,
    sport: observation.sport,
    market: observation.market,
    modality: observation.modality,
    source: observation.source,
    sourcePrior: observation.sourcePrior,
    observedAt: observation.observedAt,
    values: observation.values,
    categorical: observation.categorical,
    sourceRelease: observation.audit.sourceRelease,
  };
}

function buildQuotePaths(rows: NflMarketBrainMaterializedObservation[]): NflMarketBrainQuotePath[] {
  const eligible = rows.filter((row) => row.eligible && row.observation.availability === "observed" &&
    row.observation.modality === "price_quote" &&
    isFullGameMarket(row.observation.market) && row.observation.observedAt !== null &&
    isSelection(row.observation.categorical.selection) && row.observation.values.price?.observed === 1);
  const pointGroups = new Map<string, MarketBrainObservation[]>();
  for (const { observation } of eligible) {
    const line = observation.values.line?.observed === 1 ? observation.values.line.value : null;
    const normalizedLine = observation.market === "spread" && line !== null ? Math.abs(line) : line;
    const key = [observation.source.provider, observation.source.participant,
      observation.categorical.providerEventId ?? "", observation.market,
      observation.observedAt, normalizedLine, observation.categorical.phase].join("|");
    pointGroups.set(key, [...(pointGroups.get(key) ?? []), observation]);
  }
  const byPath = new Map<string, NflMarketBrainQuotePoint[]>();
  for (const group of pointGroups.values()) {
    const firstRows = group.filter((row) => row.categorical.selection === (row.market === "total" ? "over" : "away"));
    const secondRows = group.filter((row) => row.categorical.selection === (row.market === "total" ? "under" : "home"));
    if (firstRows.length !== 1 || secondRows.length !== 1) continue;
    const first = firstRows[0]!;
    const second = secondRows[0]!;
    if (!first || !second || first.market !== second.market || first.source.participant === null) continue;
    const firstPrice = first.values.price!.value;
    const secondPrice = second.values.price!.value;
    if (firstPrice === null || secondPrice === null) continue;
    const firstImplied = americanImplied(firstPrice);
    const secondImplied = americanImplied(secondPrice);
    const sum = firstImplied + secondImplied;
    if (!(sum > 0)) continue;
    const firstLine = first.values.line?.observed === 1 ? first.values.line.value : null;
    const secondLine = second.values.line?.observed === 1 ? second.values.line.value : null;
    if (first.market !== "moneyline" && (firstLine === null || secondLine === null)) continue;
    if (first.market === "spread" && Math.abs(firstLine! + secondLine!) > 0.000_001) continue;
    if (first.market === "total" && Math.abs(firstLine! - secondLine!) > 0.000_001) continue;
    const point: NflMarketBrainQuotePoint = {
      observedAt: first.observedAt!,
      availableAt: newest(first.timing.availableAt, second.timing.availableAt),
      providerFetchedAt: [first.timing.providerFetchedAt, second.timing.providerFetchedAt],
      ingestedAt: [first.timing.ingestedAt, second.timing.ingestedAt],
      phase: String(first.categorical.phase ?? "unknown"),
      line: first.market === "spread" ? secondLine : firstLine,
      firstPrice,
      secondPrice,
      firstFairProbability: firstImplied / sum,
      hold: sum - 1,
      observationIds: [first.id, second.id],
    };
    const providerEventId = String(first.categorical.providerEventId ?? "");
    const pathKey = [first.source.provider, first.source.participant, providerEventId, first.market].join("|");
    byPath.set(pathKey, [...(byPath.get(pathKey) ?? []), point]);
  }
  const paths = [...byPath.entries()].flatMap(([key, unsorted]) => {
    const [provider, participant, providerEventId, market] = key.split("|") as [string, string, string, FullGameMarket];
    const points = deduplicatePoints(unsorted);
    if (points.length === 0) return [];
    const opening = points[0]!;
    const current = points.at(-1)!;
    const directions = movementDirections(points);
    const conflictPoints = points.slice(1).filter((point, index) =>
      stepDirectionConflict(points[index]!, point));
    const changeTimes = points.slice(1).flatMap((point, index) => economicallyEqual(points[index]!, point) ? [] : [point.observedAt]);
    const lineDelta = opening.line === null || current.line === null ? null : current.line - opening.line;
    return [{
      provider,
      participant,
      providerEventId,
      sourcePrior: groupSourcePrior(points, eligible),
      market,
      observedRole: "unknown" as const,
      wasFirstMover: false,
      directionConflict: conflictPoints.length > 0 || directionConflict(opening.line, current.line,
        opening.firstFairProbability, current.firstFairProbability),
      directionConflictCount: conflictPoints.length,
      firstDirectionConflictAt: conflictPoints[0]?.observedAt ?? null,
      points,
      opening,
      current,
      lineDelta,
      firstFairProbabilityDelta: current.firstFairProbability - opening.firstFairProbability,
      holdDelta: current.hold - opening.hold,
      moveCount: directions.length,
      reversalCount: directions.slice(1).filter((direction, index) => direction !== directions[index]).length,
      buybackDistance: legacyBuybackDistance(points),
      lineBuybackDistance: buybackDistance(points.flatMap((point) => point.line === null ? [] : [point.line])),
      fairProbabilityBuybackDistance: buybackDistance(points.map((point) => point.firstFairProbability)),
      firstEconomicChangeAt: changeTimes[0] ?? null,
      lastEconomicChangeAt: changeTimes.at(-1) ?? null,
      crossedNflKeyNumbers: market === "spread" ? crossedPathKeys(points, [3, 6, 7, 10, 14]) :
        market === "total" ? crossedPathKeys(points, [37, 41, 44, 47, 51]) : [],
    }];
  });
  const identities = new Map<string, Set<string>>();
  for (const path of paths) {
    const key = [path.provider, path.participant, path.market].join("|");
    const values = identities.get(key) ?? new Set<string>();
    values.add(path.providerEventId);
    identities.set(key, values);
  }
  const conflict = [...identities.entries()].find(([, values]) => values.size > 1);
  if (conflict) throw new Error(`NFL Market Brain quote path contains multiple provider event identities: ${conflict[0]}`);
  return paths.sort((a, b) => a.market.localeCompare(b.market) ||
    a.provider.localeCompare(b.provider) || a.participant.localeCompare(b.participant));
}

function groupSourcePrior(
  points: NflMarketBrainQuotePoint[],
  rows: NflMarketBrainMaterializedObservation[],
): MarketBrainObservation["sourcePrior"] {
  const observationIds = new Set(points.flatMap((point) => point.observationIds));
  const priors = new Set(rows.filter((row) => observationIds.has(row.observation.id))
    .map((row) => row.observation.sourcePrior));
  return priors.size === 1 ? [...priors][0]! : "unknown";
}

function assignObservedRoles(paths: NflMarketBrainQuotePath[]) {
  for (const market of ["moneyline", "spread", "total"] as const) {
    const moving = paths.filter((path) => path.market === market && path.firstEconomicChangeAt !== null)
      .sort((a, b) => Date.parse(a.firstEconomicChangeAt!) - Date.parse(b.firstEconomicChangeAt!) || a.participant.localeCompare(b.participant));
    const firstMoveAt = moving[0]?.firstEconomicChangeAt ?? null;
    const leaders = new Set(moving.filter((path) => path.firstEconomicChangeAt === firstMoveAt));
    const leaderDirections = new Set([...leaders].map(netDirection).filter((direction) => direction !== 0));
    const leaderDirection = leaderDirections.size === 1 ? [...leaderDirections][0]! : 0;
    for (const path of paths.filter((item) => item.market === market)) {
      path.wasFirstMover = leaders.has(path);
      const directions = movementDirections(path.points);
      if (path.directionConflict || leaderDirections.size > 1) path.observedRole = "conflicted";
      else if (directions.length === 0) path.observedRole = "static";
      else if (new Set(directions).size > 1) path.observedRole = "reversal";
      else if (path.wasFirstMover) path.observedRole = "leader";
      else if (leaderDirection === 0 || netDirection(path) === 0) path.observedRole = "conflicted";
      else path.observedRole = netDirection(path) === leaderDirection ? "follower" : "resistor";
    }
  }
}

function movementDirections(points: NflMarketBrainQuotePoint[]): Array<-1 | 1> {
  return points.slice(1).flatMap((point, index) => {
    const prior = points[index]!;
    if (economicallyEqual(prior, point)) return [];
    const lineDelta = prior.line !== null && point.line !== null ? point.line - prior.line : 0;
    const probabilityDelta = point.firstFairProbability - prior.firstFairProbability;
    if (stepDirectionConflict(prior, point)) return [];
    const direction = Math.abs(lineDelta) > 0 ? Math.sign(lineDelta) : Math.sign(probabilityDelta);
    return direction === 0 ? [] : [direction as -1 | 1];
  });
}

function stepDirectionConflict(first: NflMarketBrainQuotePoint, second: NflMarketBrainQuotePoint): boolean {
  return directionConflict(first.line, second.line, first.firstFairProbability, second.firstFairProbability);
}

function netDirection(path: NflMarketBrainQuotePath): -1 | 0 | 1 {
  const line = path.lineDelta ?? 0;
  const probability = path.firstFairProbabilityDelta;
  // When the number moves, its direction owns the path; the new attached
  // price is compensation at that different number, not an opposing signal.
  return Math.sign(line !== 0 ? line : probability) as -1 | 0 | 1;
}

function directionConflict(
  _openingLine: number | null,
  _currentLine: number | null,
  _openingProbability: number,
  _currentProbability: number,
): boolean {
  // A line and its attached price are one economic quote. Their raw numeric
  // signs are not comparable when the line changes (for example 44.5/-110 to
  // 45.5/+100), and a price-only move has no second axis to contradict it.
  // Cross-provider and cross-market disagreement is resolved separately.
  return false;
}

function legacyBuybackDistance(points: NflMarketBrainQuotePoint[]): number {
  const lineMoved = points.some((point, index) => index > 0 && point.line !== points[index - 1]!.line);
  const values = points.map((point) => lineMoved && point.line !== null ? point.line : point.firstFairProbability);
  return buybackDistance(values);
}

function buybackDistance(values: number[]): number {
  if (values.length < 2) return 0;
  const first = values[0]!;
  const peak = values.reduce((winner, value) => Math.abs(value - first) > Math.abs(winner - first) ? value : winner, first);
  return Math.abs(peak - values.at(-1)!);
}

function deduplicatePoints(points: NflMarketBrainQuotePoint[]): NflMarketBrainQuotePoint[] {
  const unique = new Map<string, NflMarketBrainQuotePoint>();
  for (const point of points) {
    const key = sha256([point.observedAt, point.line, point.firstPrice, point.secondPrice, point.phase]);
    const prior = unique.get(key);
    if (!prior || Date.parse(point.availableAt) < Date.parse(prior.availableAt)) unique.set(key, point);
  }
  return [...unique.values()].sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt) || Date.parse(a.availableAt) - Date.parse(b.availableAt));
}

function crossedKeys(first: number | null, last: number | null, keys: number[]): number[] {
  if (first === null || last === null || first === last) return [];
  const low = Math.min(Math.abs(first), Math.abs(last));
  const high = Math.max(Math.abs(first), Math.abs(last));
  return keys.filter((key) => key > low && key <= high);
}

function crossedPathKeys(points: NflMarketBrainQuotePoint[], keys: number[]): number[] {
  return [...new Set(points.slice(1).flatMap((point, index) =>
    crossedKeys(points[index]!.line, point.line, keys)))].sort((a, b) => a - b);
}

function economicallyEqual(first: NflMarketBrainQuotePoint, second: NflMarketBrainQuotePoint): boolean {
  return first.line === second.line && first.firstPrice === second.firstPrice && first.secondPrice === second.secondPrice;
}

function americanImplied(price: number): number {
  return price < 0 ? -price / (-price + 100) : 100 / (price + 100);
}

function isSelection(value: unknown): value is PriceSelection {
  return value === "away" || value === "home" || value === "over" || value === "under";
}

function isFullGameMarket(value: MarketBrainMarket): value is FullGameMarket {
  return value === "moneyline" || value === "spread" || value === "total";
}

function newest(first: string, second: string): string {
  return Date.parse(first) >= Date.parse(second) ? first : second;
}

function timestampRequired(value: string, name: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid NFL Market Brain ${name}.`);
  return parsed;
}

function nullableTimestamp(value: string | null): number {
  return value === null ? Number.POSITIVE_INFINITY : Date.parse(value);
}

function sha256(value: unknown): string {
  return marketBrainSha256(value);
}
