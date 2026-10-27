import { createHash } from "node:crypto";

import {
  MARKET_BRAIN_CONTRACT_RELEASE,
  assertMarketBrainPrior,
  type MarketBrainCase,
  type MarketBrainExpectedInput,
  type MarketBrainMarket,
  type MarketBrainObservation,
  type MarketBrainObservedRole,
  type MarketBrainPrior,
} from "./marketBrainContract";

export const NFL_MARKET_BRAIN_SEQUENCE_MATERIALIZER_RELEASE =
  "nfl_market_brain_sequence_materializer_2026_10_27_r4_target_safe_inputs" as const;

type FullGameMarket = Extract<MarketBrainMarket, "moneyline" | "spread" | "total">;
type PriceSelection = "away" | "home" | "over" | "under";

export type NflMarketBrainMaterializedObservation = {
  observation: MarketBrainObservation;
  eligible: boolean;
  exclusionReasons: Array<
    "after_cutoff" | "evaluated_target" | "same_target_family" | "superseded_prior" |
    "unavailable" | "incomplete" | "unsupported"
  >;
};

export type NflMarketBrainMaterializedExpectedInput = {
  input: MarketBrainExpectedInput;
  eligible: boolean;
  exclusionReasons: Array<"same_target_family">;
};

export type NflMarketBrainQuotePoint = {
  observedAt: string;
  availableAt: string;
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
  market: FullGameMarket;
  observedRole: MarketBrainObservedRole;
  points: NflMarketBrainQuotePoint[];
  opening: NflMarketBrainQuotePoint;
  current: NflMarketBrainQuotePoint;
  lineDelta: number | null;
  firstFairProbabilityDelta: number;
  holdDelta: number;
  moveCount: number;
  reversalCount: number;
  buybackDistance: number;
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
  prior: MarketBrainPrior;
  targetFamilyByMarket: Record<FullGameMarket, string | null>;
  observations: NflMarketBrainMaterializedObservation[];
  expectedInputs: NflMarketBrainMaterializedExpectedInput[];
  quotePaths: NflMarketBrainQuotePath[];
  crossMarket: NflMarketBrainCrossMarket;
  sourceAvailability: {
    regime: "complete" | "degraded" | "unavailable";
    manifests: number;
    failed: number;
    returnedRows: number;
    unmatchedRows: number;
    ambiguousRows: number;
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
  const latestPrior = resolvePrior(latestCase.prior, eligibleCases, cutoff);
  const targetFamilyByMarket = Object.fromEntries(
    (["moneyline", "spread", "total"] as const).map((market) =>
      [market, latestCase.evaluatedTargets[market]?.family ?? null]),
  ) as Record<FullGameMarket, string | null>;

  const inputObservations = eligibleCases.flatMap((item) => item.observations);
  const deduplicated = deduplicate(inputObservations);
  const latestPriorAvailable = latestPrior.kind !== "unavailable";
  const currentPriorObservations = deduplicated.filter((observation) =>
    latestPriorAvailable && observation.modality === "model_prior" && observation.audit.sourceRelease === latestPrior.release &&
    Date.parse(observation.timing.availableAt) <= cutoff);
  if (currentPriorObservations.length > 1) {
    throw new Error("NFL Market Brain materializer found multiple current prior artifacts for one cutoff.");
  }
  const observations = deduplicated.map((observation): NflMarketBrainMaterializedObservation => {
    const reasons: NflMarketBrainMaterializedObservation["exclusionReasons"] = [];
    if (Date.parse(observation.timing.availableAt) > cutoff) reasons.push("after_cutoff");
    const targetFamily = isFullGameMarket(observation.market) ? targetFamilyByMarket[observation.market] : null;
    if (isMarketEvidence(observation) && targetFamily !== null && canonical(observation.source.participant) === canonical(targetFamily)) {
      reasons.push(observation.targetRelation === "evaluated" ? "evaluated_target" : "same_target_family");
    }
    if (observation.modality === "model_prior" &&
      (!latestPriorAvailable || observation.audit.sourceRelease !== latestPrior.release)) {
      reasons.push("superseded_prior");
    }
    if (["unavailable", "identity_mismatch", "stale", "future"].includes(observation.availability)) reasons.push("unavailable");
    if (observation.availability === "incomplete") reasons.push("incomplete");
    if (observation.availability === "unsupported") reasons.push("unsupported");
    return { observation, eligible: reasons.length === 0, exclusionReasons: [...new Set(reasons)] };
  });
  const targetFamilies = new Set(Object.values(targetFamilyByMarket).filter((value): value is string => value !== null).map(canonical));
  const expectedInputs = latestCase.expectedInputs.map((input): NflMarketBrainMaterializedExpectedInput => {
    const exclusionReasons: NflMarketBrainMaterializedExpectedInput["exclusionReasons"] =
      input.participant !== null && targetFamilies.has(canonical(input.participant)) ? ["same_target_family"] : [];
    return { input, eligible: exclusionReasons.length === 0, exclusionReasons };
  });

  const quotePaths = buildQuotePaths(observations);
  assignObservedRoles(quotePaths);
  const crossMarket = buildCrossMarket(quotePaths);
  const manifests = latestCase.sourceManifests;
  const failed = manifests.filter((manifest) => manifest.status === "failed").length;
  const observed = manifests.length - failed;
  const sourceAvailability = {
    regime: (observed === 0 ? "unavailable" : failed > 0 ? "degraded" : "complete") as "complete" | "degraded" | "unavailable",
    manifests: manifests.length,
    failed,
    returnedRows: manifests.reduce((sum, manifest) => sum + manifest.returnedRows, 0),
    unmatchedRows: manifests.reduce((sum, manifest) => sum + manifest.unmatchedRows, 0),
    ambiguousRows: manifests.reduce((sum, manifest) => sum + manifest.ambiguousRows, 0),
  };
  const withoutChecksum = {
    release: NFL_MARKET_BRAIN_SEQUENCE_MATERIALIZER_RELEASE,
    contractRelease: MARKET_BRAIN_CONTRACT_RELEASE,
    sport: "nfl" as const,
    eventId,
    startsAt: latestCase.subject.startsAt,
    cutoffAt: new Date(cutoff).toISOString(),
    prior: latestPrior,
    targetFamilyByMarket,
    observations,
    expectedInputs,
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
      unavailableOrUnsupported: observations.filter((row) => row.exclusionReasons.some((reason) => ["unavailable", "incomplete", "unsupported"].includes(reason))).length,
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
    const direction = marketPaths.length === 0 ? "unavailable" : directions.length === 0 ? "static" :
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
    if (Date.parse(observation.timing.availableAt) < Date.parse(prior.timing.availableAt)) rows.set(key, observation);
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
  const eligible = rows.filter((row) => row.eligible && row.observation.modality === "price_quote" &&
    isFullGameMarket(row.observation.market) && row.observation.observedAt !== null &&
    isSelection(row.observation.categorical.selection) && row.observation.values.price?.observed === 1);
  const pointGroups = new Map<string, MarketBrainObservation[]>();
  for (const { observation } of eligible) {
    const line = observation.values.line?.observed === 1 ? observation.values.line.value : null;
    const normalizedLine = observation.market === "spread" && line !== null ? Math.abs(line) : line;
    const key = [observation.source.provider, observation.source.participant, observation.market,
      observation.observedAt, normalizedLine, observation.categorical.phase].join("|");
    pointGroups.set(key, [...(pointGroups.get(key) ?? []), observation]);
  }
  const byPath = new Map<string, NflMarketBrainQuotePoint[]>();
  for (const group of pointGroups.values()) {
    const first = group.find((row) => row.categorical.selection === (row.market === "total" ? "over" : "away"));
    const second = group.find((row) => row.categorical.selection === (row.market === "total" ? "under" : "home"));
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
      phase: String(first.categorical.phase ?? "unknown"),
      line: first.market === "spread" ? secondLine : firstLine,
      firstPrice,
      secondPrice,
      firstFairProbability: firstImplied / sum,
      hold: sum - 1,
      observationIds: [first.id, second.id],
    };
    const pathKey = [first.source.provider, first.source.participant, first.market].join("|");
    byPath.set(pathKey, [...(byPath.get(pathKey) ?? []), point]);
  }
  return [...byPath.entries()].flatMap(([key, unsorted]) => {
    const [provider, participant, market] = key.split("|") as [string, string, FullGameMarket];
    const points = deduplicatePoints(unsorted);
    if (points.length === 0) return [];
    const opening = points[0]!;
    const current = points.at(-1)!;
    const directions = movementDirections(points);
    const changeTimes = points.slice(1).flatMap((point, index) => economicallyEqual(points[index]!, point) ? [] : [point.observedAt]);
    const lineDelta = opening.line === null || current.line === null ? null : current.line - opening.line;
    return [{
      provider,
      participant,
      market,
      observedRole: "unknown" as const,
      points,
      opening,
      current,
      lineDelta,
      firstFairProbabilityDelta: current.firstFairProbability - opening.firstFairProbability,
      holdDelta: current.hold - opening.hold,
      moveCount: directions.length,
      reversalCount: directions.slice(1).filter((direction, index) => direction !== directions[index]).length,
      buybackDistance: buybackDistance(points),
      firstEconomicChangeAt: changeTimes[0] ?? null,
      lastEconomicChangeAt: changeTimes.at(-1) ?? null,
      crossedNflKeyNumbers: market === "spread" ? crossedKeys(opening.line, current.line, [3, 6, 7, 10, 14]) :
        market === "total" ? crossedKeys(opening.line, current.line, [37, 41, 44, 47, 51]) : [],
    }];
  }).sort((a, b) => a.market.localeCompare(b.market) || a.provider.localeCompare(b.provider) || a.participant.localeCompare(b.participant));
}

function assignObservedRoles(paths: NflMarketBrainQuotePath[]) {
  for (const market of ["moneyline", "spread", "total"] as const) {
    const moving = paths.filter((path) => path.market === market && path.firstEconomicChangeAt !== null)
      .sort((a, b) => Date.parse(a.firstEconomicChangeAt!) - Date.parse(b.firstEconomicChangeAt!) || a.participant.localeCompare(b.participant));
    const leaderDirection = moving[0] ? netDirection(moving[0]) : 0;
    for (const path of paths.filter((item) => item.market === market)) {
      const directions = movementDirections(path.points);
      if (directions.length === 0) path.observedRole = "static";
      else if (new Set(directions).size > 1) path.observedRole = "reversal";
      else if (path === moving[0]) path.observedRole = "leader";
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
    const direction = Math.abs(lineDelta) > 0 ? Math.sign(lineDelta) : Math.sign(probabilityDelta);
    return direction === 0 ? [] : [direction as -1 | 1];
  });
}

function netDirection(path: NflMarketBrainQuotePath): -1 | 0 | 1 {
  const line = path.lineDelta ?? 0;
  const probability = path.firstFairProbabilityDelta;
  return Math.sign(line !== 0 ? line : probability) as -1 | 0 | 1;
}

function buybackDistance(points: NflMarketBrainQuotePoint[]): number {
  if (points.length < 2) return 0;
  const first = pointSignal(points[0]!);
  const values = points.map(pointSignal);
  const peak = values.reduce((winner, value) => Math.abs(value - first) > Math.abs(winner - first) ? value : winner, first);
  return Math.abs(peak - values.at(-1)!);
}

function pointSignal(point: NflMarketBrainQuotePoint): number {
  return point.line ?? point.firstFairProbability;
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
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
