import { canonicalNhlSportsbookFamily } from "./nhlSportsbookFamily";

export type NhlEpisodeMarket = "moneyline" | "spread" | "total";
export type NhlEpisodeDirection = "home" | "away" | "over" | "under";
export type NhlEpisodePathState =
  | "stable"
  | "flat"
  | "buyback"
  | "reversal"
  | "incomplete"
  | "unavailable";

export type NhlBookPathReceipt = {
  market: NhlEpisodeMarket;
  sportsbook: string;
  sportsbookFamily: string;
  sourceClass: "named" | "broad";
  contractKey: string;
  complete: boolean;
  state: NhlEpisodePathState;
  openingValue: number;
  currentValue: number;
  openingObservedAt: string;
  firstMaterialMoveAt: string | null;
  currentObservedAt: string;
  /** Complete same-contract economic coordinates in source-time order. */
  observations: Array<{ at: string; value: number }>;
};

export type NhlSplitPressureReceipt = {
  market: NhlEpisodeMarket;
  source: string;
  sourceClass: "public" | "sharp";
  sourceBook?: string | null;
  pressureSide: NhlEpisodeDirection;
  ticketsPct: number;
  moneyPct: number;
  confidence: "high" | "medium" | "low" | "none";
  completePair: boolean;
  observedAt: string;
  receivedAt: string | null;
};

export type NhlRejectedPathReceipt = {
  sportsbook: string;
  sportsbookFamily: string;
  market: NhlEpisodeMarket;
  reason:
    | "market_mismatch"
    | "contract_mismatch"
    | "execution_book_excluded"
    | "non_named_source"
    | "incomplete_pair"
    | "flat"
    | "buyback"
    | "reversal"
    | "unavailable"
    | "invalid_value"
    | "invalid_clock"
    | "future_observation"
    | "stale_observation"
    | "submaterial_move"
    | "duplicate_book_family";
};

export type NhlRejectedPressureReceipt = {
  source: string;
  reason:
    | "market_mismatch"
    | "side_mismatch"
    | "incomplete_pair"
    | "low_confidence"
    | "invalid_percentage"
    | "invalid_clock"
    | "future_observation"
    | "stale_observation";
};

export type NhlMarketEpisodeDecision = {
  market: NhlEpisodeMarket;
  contractKey: string;
  state: "confirmation" | "resistance" | "discovery" | "disagreement" | "unresolved" | "unavailable";
  direction: NhlEpisodeDirection | null;
  innovation: number;
  /** The exact move clock that won this episode after causal reclassification. */
  selectedMoveAt: string | null;
  author: NhlBookPathReceipt | null;
  followers: NhlBookPathReceipt[];
  pressure: NhlSplitPressureReceipt | null;
  rejectedPaths: NhlRejectedPathReceipt[];
  rejectedPressure: NhlRejectedPressureReceipt | null;
  counts: {
    receivedForMarket: number;
    completeForContract: number;
    eligibleNamedFamilies: number;
    excludedExecutionFamilies: number;
    alignedNamedFamilies: number;
    opposedNamedFamilies: number;
  };
  reason:
    | "qualified_split_response"
    | "qualified_named_discovery"
    | "opposed_named_paths"
    | "indistinguishable_leader"
    | "insufficient_named_breadth"
    | "no_causal_split_response"
    | "no_eligible_named_path";
};

export type ArbitrateNhlMarketEpisodeOptions = {
  market: NhlEpisodeMarket;
  contractKey: string;
  decisionAt: string;
  executionSportsbookFamily: string | null;
  paths: readonly NhlBookPathReceipt[];
  pressure?: NhlSplitPressureReceipt | null;
  materialMove: number;
  maximumPathAgeMs: number;
  maximumPressureAgeMs: number;
  followerWindowMs: number;
};

type EligiblePath = NhlBookPathReceipt & {
  family: string;
  openingMs: number;
  firstMoveMs: number;
  currentMs: number;
  innovation: number;
  direction: NhlEpisodeDirection;
};

type ValidNamedPath = NhlBookPathReceipt & {
  family: string;
  openingMs: number;
  currentMs: number;
  points: Array<{ at: string; value: number; ms: number }>;
};

function normalizedFamily(value: string): string {
  return canonicalNhlSportsbookFamily(value);
}

function classifySequence(values: readonly number[], materialMove: number): NhlEpisodePathState {
  if (values.length < 2) return "unavailable";
  const opening = values[0]!;
  const current = values.at(-1)!;
  const net = current - opening;
  const deviations = values.map((value) => value - opening);
  if (Math.abs(net) < materialMove) {
    const positiveExcursion = Math.max(...deviations);
    const negativeExcursion = Math.min(...deviations);
    if (positiveExcursion >= materialMove && negativeExcursion <= -materialMove) return "reversal";
    if (positiveExcursion >= materialMove || negativeExcursion <= -materialMove) return "buyback";
    return "flat";
  }
  const direction = Math.sign(net);
  const directed = values.map((value) => (value - opening) * direction);
  const peak = Math.max(...directed);
  const opposingExcursion = Math.min(...directed);
  const retracement = peak - Math.abs(net);
  const latestLeg = current - values.at(-2)!;
  if (opposingExcursion <= -materialMove) return "reversal";
  if (retracement >= Math.max(materialMove, peak * 0.35)
    || (Math.sign(latestLeg) === -direction && Math.abs(latestLeg) >= materialMove / 2)) return "buyback";
  return "stable";
}

function parsedTime(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validDirection(market: NhlEpisodeMarket, direction: NhlEpisodeDirection): boolean {
  return market === "total"
    ? direction === "over" || direction === "under"
    : direction === "home" || direction === "away";
}

function directionForInnovation(market: NhlEpisodeMarket, innovation: number): NhlEpisodeDirection {
  if (market === "total") return innovation > 0 ? "over" : "under";
  return innovation > 0 ? "home" : "away";
}

function rejectedPath(path: NhlBookPathReceipt, reason: NhlRejectedPathReceipt["reason"]): NhlRejectedPathReceipt {
  return {
    sportsbook: path.sportsbook,
    sportsbookFamily: path.sportsbookFamily,
    market: path.market,
    reason,
  };
}

function validatePressure(args: {
  pressure: NhlSplitPressureReceipt | null | undefined;
  market: NhlEpisodeMarket;
  decisionMs: number;
  maximumAgeMs: number;
}): { pressure: NhlSplitPressureReceipt | null; availableMs: number | null; rejected: NhlRejectedPressureReceipt | null } {
  const pressure = args.pressure;
  if (!pressure) return { pressure: null, availableMs: null, rejected: null };
  const reject = (reason: NhlRejectedPressureReceipt["reason"]) => ({
    pressure: null,
    availableMs: null,
    rejected: { source: pressure.source, reason },
  });
  if (pressure.market !== args.market) return reject("market_mismatch");
  if (!validDirection(args.market, pressure.pressureSide)) return reject("side_mismatch");
  if (!pressure.completePair) return reject("incomplete_pair");
  if (pressure.confidence !== "high" && pressure.confidence !== "medium") return reject("low_confidence");
  if (![pressure.ticketsPct, pressure.moneyPct].every((value) => Number.isFinite(value) && value >= 0 && value <= 100)) {
    return reject("invalid_percentage");
  }
  const observedMs = parsedTime(pressure.observedAt);
  const receivedMs = pressure.receivedAt === null ? observedMs : parsedTime(pressure.receivedAt);
  if (observedMs === null || receivedMs === null || receivedMs < observedMs) return reject("invalid_clock");
  const availableMs = Math.max(observedMs, receivedMs);
  if (availableMs > args.decisionMs) return reject("future_observation");
  if (args.decisionMs - availableMs > args.maximumAgeMs) return reject("stale_observation");
  return { pressure, availableMs, rejected: null };
}

/**
 * Select one observed NHL market episode as the sole numerical author.
 *
 * A pressure response must occur after a complete split receipt became
 * available. Without causal pressure, price discovery requires a unique named
 * leader plus a later independent named follower. Followers establish breadth
 * but never add amplitude. The execution sportsbook family is excluded from
 * authorship and corroboration, and current market levels are never consumed.
 */
export function arbitrateNhlMarketEpisode(
  options: ArbitrateNhlMarketEpisodeOptions,
): NhlMarketEpisodeDecision {
  if (!Number.isFinite(options.materialMove) || options.materialMove <= 0) {
    throw new Error("NHL episode materialMove must be positive.");
  }
  for (const [name, value] of [
    ["maximumPathAgeMs", options.maximumPathAgeMs],
    ["maximumPressureAgeMs", options.maximumPressureAgeMs],
    ["followerWindowMs", options.followerWindowMs],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`NHL episode ${name} must be non-negative.`);
  }
  const decisionMs = parsedTime(options.decisionAt);
  if (decisionMs === null) throw new Error("NHL episode decisionAt must be a valid timestamp.");
  const executionFamily = options.executionSportsbookFamily === null
    ? null
    : normalizedFamily(options.executionSportsbookFamily);
  const rejectedPaths: NhlRejectedPathReceipt[] = [];
  const preliminarilyEligible: EligiblePath[] = [];
  const validNamedPaths: ValidNamedPath[] = [];
  const contradictoryNamedPaths: ValidNamedPath[] = [];
  let receivedForMarket = 0;
  let completeForContract = 0;
  let excludedExecutionFamilies = 0;

  for (const path of options.paths) {
    if (path.market !== options.market) {
      rejectedPaths.push(rejectedPath(path, "market_mismatch"));
      continue;
    }
    receivedForMarket += 1;
    if (path.contractKey !== options.contractKey) {
      rejectedPaths.push(rejectedPath(path, "contract_mismatch"));
      continue;
    }
    if (!path.complete || path.state === "incomplete") {
      rejectedPaths.push(rejectedPath(path, "incomplete_pair"));
      continue;
    }
    completeForContract += 1;
    const family = normalizedFamily(path.sportsbookFamily || path.sportsbook);
    if (executionFamily !== null && family === executionFamily) {
      excludedExecutionFamilies += 1;
      rejectedPaths.push(rejectedPath(path, "execution_book_excluded"));
      continue;
    }
    if (path.sourceClass !== "named") {
      rejectedPaths.push(rejectedPath(path, "non_named_source"));
      continue;
    }
    if (!Number.isFinite(path.openingValue) || !Number.isFinite(path.currentValue)) {
      rejectedPaths.push(rejectedPath(path, "invalid_value"));
      continue;
    }
    const openingMs = parsedTime(path.openingObservedAt);
    const currentMs = parsedTime(path.currentObservedAt);
    const points = path.observations
      .map((point) => ({ ...point, ms: parsedTime(point.at) }))
      .filter((point): point is { at: string; value: number; ms: number } => point.ms !== null && Number.isFinite(point.value))
      .sort((left, right) => left.ms - right.ms);
    if (openingMs === null || currentMs === null || openingMs > currentMs || points.length < 2
      || points[0]!.ms !== openingMs || points.at(-1)!.ms !== currentMs) {
      rejectedPaths.push(rejectedPath(path, "invalid_clock"));
      continue;
    }
    if (currentMs > decisionMs) {
      rejectedPaths.push(rejectedPath(path, "future_observation"));
      continue;
    }
    if (decisionMs - currentMs > options.maximumPathAgeMs) {
      rejectedPaths.push(rejectedPath(path, "stale_observation"));
      continue;
    }
    const validPath: ValidNamedPath = { ...path, family, openingMs, currentMs, points };
    validNamedPaths.push(validPath);
    if (path.state === "buyback" || path.state === "reversal") {
      contradictoryNamedPaths.push(validPath);
      rejectedPaths.push(rejectedPath(path, path.state));
      continue;
    }
    if (path.state === "flat") {
      rejectedPaths.push(rejectedPath(path, "flat"));
      continue;
    }
    if (path.state !== "stable") {
      rejectedPaths.push(rejectedPath(path, "unavailable"));
      continue;
    }
    const innovation = path.currentValue - path.openingValue;
    if (Math.abs(innovation) < options.materialMove) {
      rejectedPaths.push(rejectedPath(path, "submaterial_move"));
      continue;
    }
    const firstMoveMs = parsedTime(path.firstMaterialMoveAt);
    if (firstMoveMs === null || openingMs > firstMoveMs || firstMoveMs > currentMs) {
      rejectedPaths.push(rejectedPath(path, "invalid_clock"));
      continue;
    }
    preliminarilyEligible.push({
      ...path,
      family,
      openingMs,
      firstMoveMs,
      currentMs,
      innovation,
      direction: directionForInnovation(options.market, innovation),
    });
  }

  const familyCounts = new Map<string, number>();
  for (const path of preliminarilyEligible) familyCounts.set(path.family, (familyCounts.get(path.family) ?? 0) + 1);
  const eligible = preliminarilyEligible.filter((path) => {
    if (familyCounts.get(path.family) === 1) return true;
    rejectedPaths.push(rejectedPath(path, "duplicate_book_family"));
    return false;
  });
  const validFamilyCounts = new Map<string, number>();
  for (const path of validNamedPaths) validFamilyCounts.set(path.family, (validFamilyCounts.get(path.family) ?? 0) + 1);
  for (const path of validNamedPaths) {
    if ((validFamilyCounts.get(path.family) ?? 0) > 1
      && !rejectedPaths.some((rejected) => rejected.sportsbook === path.sportsbook && rejected.reason === "duplicate_book_family")) {
      rejectedPaths.push(rejectedPath(path, "duplicate_book_family"));
    }
  }
  const uniqueValidNamedPaths = validNamedPaths.filter((path) => validFamilyCounts.get(path.family) === 1);
  const uniqueContradictoryNamedPaths = contradictoryNamedPaths.filter((path) => validFamilyCounts.get(path.family) === 1);
  const pressureResult = validatePressure({
    pressure: options.pressure,
    market: options.market,
    decisionMs,
    maximumAgeMs: options.maximumPressureAgeMs,
  });
  const directions = new Set(eligible.map((path) => path.direction));
  const baseCounts = {
    receivedForMarket,
    completeForContract,
    eligibleNamedFamilies: eligible.length,
    excludedExecutionFamilies,
    alignedNamedFamilies: directions.size <= 1 ? eligible.length : 0,
    opposedNamedFamilies: directions.size > 1 ? eligible.length : 0,
  };
  const finish = (partial: Omit<NhlMarketEpisodeDecision,
    "market" | "contractKey" | "rejectedPaths" | "rejectedPressure" | "counts" | "selectedMoveAt"
  > & { selectedMoveAt?: string | null }): NhlMarketEpisodeDecision => ({
    market: options.market,
    contractKey: options.contractKey,
    rejectedPaths,
    rejectedPressure: pressureResult.rejected,
    counts: baseCounts,
    selectedMoveAt: null,
    ...partial,
  });

  if (options.pressure?.source === "identified_professional_conflict") {
    return finish({
      state: "disagreement", direction: null, innovation: 0, author: null, followers: [], pressure: null,
      reason: "opposed_named_paths",
    });
  }

  if (eligible.length === 0 && (pressureResult.pressure === null || uniqueValidNamedPaths.length === 0)) {
    if (pressureResult.pressure === null && uniqueContradictoryNamedPaths.length > 0) {
      return finish({
        state: "disagreement", direction: null, innovation: 0, author: null, followers: [], pressure: pressureResult.pressure,
        reason: "opposed_named_paths",
      });
    }
    return finish({
      state: "unavailable", direction: null, innovation: 0, author: null, followers: [], pressure: null,
      reason: "no_eligible_named_path",
    });
  }
  if (directions.size > 1 && pressureResult.pressure === null) {
    return finish({
      state: "disagreement", direction: null, innovation: 0, author: null, followers: [], pressure: pressureResult.pressure,
      reason: "opposed_named_paths",
    });
  }

  if (pressureResult.pressure !== null && pressureResult.availableMs !== null) {
    const causal = uniqueValidNamedPaths.flatMap((path) => {
      const baseline = [...path.points].reverse().find((point) => point.ms <= pressureResult.availableMs!);
      if (!baseline) return [];
      const post = path.points.filter((point) => point.ms > pressureResult.availableMs!);
      if (post.length === 0) return [];
      const values = [baseline.value, ...post.map((point) => point.value)];
      const state = classifySequence(values, options.materialMove);
      const innovation = values.at(-1)! - values[0]!;
      const first = post.find((point) => Math.abs(point.value - baseline.value) >= options.materialMove);
      return [{ path, state, innovation, firstMoveMs: first?.ms ?? null }];
    });
    if (causal.some((row) => row.state === "buyback" || row.state === "reversal")) {
      return finish({
        state: "disagreement", direction: null, innovation: 0, author: null, followers: [], pressure: pressureResult.pressure,
        reason: "opposed_named_paths",
      });
    }
    const responders = causal
      .filter((row): row is typeof row & { firstMoveMs: number } => row.state === "stable" && row.firstMoveMs !== null)
      .map((row) => ({
        ...row.path,
        family: row.path.family,
        openingMs: row.path.openingMs,
        currentMs: row.path.currentMs,
        firstMoveMs: row.firstMoveMs,
        innovation: row.innovation,
        direction: directionForInnovation(options.market, row.innovation),
      }))
      .sort((left, right) => left.firstMoveMs - right.firstMoveMs || left.family.localeCompare(right.family));
    const flatResponders = causal.filter((row) => row.state === "flat");
    const heldDirection: NhlEpisodeDirection = options.market === "total"
      ? pressureResult.pressure.pressureSide === "over" ? "under" : "over"
      : pressureResult.pressure.pressureSide === "home" ? "away" : "home";
    if (responders.length > 0 && flatResponders.length > 0
      && responders.some((path) => path.direction !== heldDirection)) {
      return finish({
        state: "disagreement", direction: null, innovation: 0, author: null, followers: [], pressure: pressureResult.pressure,
        reason: "opposed_named_paths",
      });
    }
    if (new Set(responders.map((path) => path.direction)).size > 1) {
      return finish({
        state: "disagreement", direction: null, innovation: 0, author: null, followers: [], pressure: pressureResult.pressure,
        reason: "opposed_named_paths",
      });
    }
    if (responders.length === 0 && flatResponders.length > 0) {
      return finish({
        state: "resistance", direction: heldDirection, innovation: 0,
        author: flatResponders[0]!.path, followers: flatResponders.slice(1).map((row) => row.path),
        pressure: pressureResult.pressure, reason: "qualified_split_response",
      });
    }
    if (responders.length > 0) {
      const firstAt = responders[0]!.firstMoveMs;
      const leaders = responders.filter((path) => path.firstMoveMs === firstAt);
      if (leaders.length !== 1) {
        return finish({
          state: "unresolved", direction: null, innovation: 0, author: null, followers: [], pressure: pressureResult.pressure,
          reason: "indistinguishable_leader",
        });
      }
      const author = leaders[0]!;
      const followers = responders.filter((path) => (
        path.family !== author.family
        && path.firstMoveMs > author.firstMoveMs
        && path.firstMoveMs - author.firstMoveMs <= options.followerWindowMs
      ));
      return finish({
        state: author.direction === pressureResult.pressure.pressureSide ? "confirmation" : "resistance",
        direction: author.direction,
        innovation: author.innovation,
        selectedMoveAt: new Date(author.firstMoveMs).toISOString(),
        author,
        followers,
        pressure: pressureResult.pressure,
        reason: "qualified_split_response",
      });
    }
  }

  if (eligible.length < 2) {
    return finish({
      state: "unresolved", direction: null, innovation: 0, author: null, followers: [], pressure: pressureResult.pressure,
      reason: pressureResult.pressure === null ? "insufficient_named_breadth" : "no_causal_split_response",
    });
  }
  const ordered = [...eligible].sort((left, right) => left.firstMoveMs - right.firstMoveMs || left.family.localeCompare(right.family));
  const firstAt = ordered[0]!.firstMoveMs;
  const leaders = ordered.filter((path) => path.firstMoveMs === firstAt);
  if (leaders.length !== 1) {
    return finish({
      state: "unresolved", direction: null, innovation: 0, author: null, followers: [], pressure: pressureResult.pressure,
      reason: "indistinguishable_leader",
    });
  }
  const author = leaders[0]!;
  const followers = ordered.filter((path) => (
    path.family !== author.family
    && path.firstMoveMs > author.firstMoveMs
    && path.firstMoveMs - author.firstMoveMs <= options.followerWindowMs
  ));
  if (followers.length === 0) {
    return finish({
      state: "unresolved", direction: null, innovation: 0, author: null, followers: [], pressure: pressureResult.pressure,
      reason: "insufficient_named_breadth",
    });
  }
  return finish({
    state: "discovery",
    direction: author.direction,
    innovation: author.innovation,
    selectedMoveAt: author.firstMaterialMoveAt,
    author,
    followers,
    pressure: null,
    reason: "qualified_named_discovery",
  });
}

