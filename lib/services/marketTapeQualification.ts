/**
 * Outcome-blind market-tape qualification primitives.
 *
 * This module does not choose picks, probabilities, grades, or stakes. Each
 * sport/model owns its thresholds and decides whether a qualified state has
 * any authority. The shared job here is narrower: prove chronology, distinguish
 * an endpoint from a path, detect follower adoption and buyback, and prevent a
 * percentage-only split from being mislabeled as verified professional money.
 */

export type MarketTapePoint = {
  eventId: string;
  market: string;
  side: string;
  sportsbook: string;
  sourceFamily: string;
  observedAt: string;
  /**
   * Model/market-specific pressure toward `side`, expressed in percentage
   * points. Adapters must derive this from a coherent same-book pair and may
   * incorporate point-line movement using their own sport-specific mapping.
   */
  pressurePp: number;
};

export type MarketSplitPoint = {
  eventId: string;
  market: string;
  side: string;
  source: string;
  observedAt: string;
  ticketsPct: number;
  moneyPct: number;
  /** Optional denominators. Most current feeds do not provide them. */
  ticketCount?: number | null;
  handleAmount?: number | null;
};

export type MarketTapePolicy = {
  materialMovePp: number;
  minimumFollowerFamilies: number;
  followerWindowMinutes: number;
  minimumPeakRetention: number;
  splitDivergencePp: number;
  requireSplitCorroboration: boolean;
};

export type MarketTapeQualification = {
  pathState:
    | "unavailable"
    | "flat"
    | "isolated_move"
    | "followed_move"
    | "persistent_discovery"
    | "buyback"
    | "reversal"
    | "conflict";
  direction: "toward_side" | "away_from_side" | "none";
  originator: { sportsbook: string; sourceFamily: string; observedAt: string } | null;
  followerFamilies: string[];
  peakMovePp: number | null;
  retainedMovePp: number | null;
  peakRetention: number | null;
  splitState:
    | "unavailable"
    | "snapshot_only"
    | "stable"
    | "conflict"
    | "divergence_precedes_move"
    | "divergence_follows_move";
  splitDivergencePp: number | null;
  splitVolumeKnown: boolean;
  /** Percentage splits never prove bettor identity, even with denominators. */
  professionalBettorIdentityKnown: false;
  sequenceQualified: boolean;
  reasons: string[];
};

function validIso(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function completeSplit(point: MarketSplitPoint): boolean {
  return validIso(point.observedAt) &&
    Number.isFinite(point.ticketsPct) && point.ticketsPct >= 0 && point.ticketsPct <= 100 &&
    Number.isFinite(point.moneyPct) && point.moneyPct >= 0 && point.moneyPct <= 100;
}

function identity(points: readonly MarketTapePoint[]): string | null {
  const identities = new Set(points.map((point) => [point.eventId, point.market, point.side].join("|")));
  return identities.size === 1 ? [...identities][0]! : null;
}

function empty(reason: string): MarketTapeQualification {
  return {
    pathState: "unavailable",
    direction: "none",
    originator: null,
    followerFamilies: [],
    peakMovePp: null,
    retainedMovePp: null,
    peakRetention: null,
    splitState: "unavailable",
    splitDivergencePp: null,
    splitVolumeKnown: false,
    professionalBettorIdentityKnown: false,
    sequenceQualified: false,
    reasons: [reason],
  };
}

export function qualifyMarketTape(args: {
  points: readonly MarketTapePoint[];
  splits?: readonly MarketSplitPoint[];
  decisionAt: string;
  policy: MarketTapePolicy;
}): MarketTapeQualification {
  const decisionMs = Date.parse(args.decisionAt);
  if (!Number.isFinite(decisionMs)) return empty("invalid_decision_timestamp");
  if (!(args.policy.materialMovePp > 0) || args.policy.minimumFollowerFamilies < 0 ||
      !(args.policy.followerWindowMinutes > 0) ||
      !(args.policy.minimumPeakRetention >= 0 && args.policy.minimumPeakRetention <= 1) ||
      !(args.policy.splitDivergencePp >= 0)) {
    return empty("invalid_model_policy");
  }

  const points = args.points
    .filter((point) => validIso(point.observedAt) && Date.parse(point.observedAt) <= decisionMs && Number.isFinite(point.pressurePp))
    .sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt));
  if (points.length < 2) return empty("fewer_than_two_predecision_price_observations");
  if (identity(points) === null) return empty("mixed_event_market_or_side_identity");

  const byBook = new Map<string, MarketTapePoint[]>();
  for (const point of points) {
    const key = `${point.sourceFamily}|${point.sportsbook}`;
    byBook.set(key, [...(byBook.get(key) ?? []), point]);
  }

  type BookMove = {
    first: MarketTapePoint;
    trigger: MarketTapePoint;
    current: MarketTapePoint;
    triggerDelta: number;
    currentDelta: number;
    peakDelta: number;
  };
  const moves: BookMove[] = [];
  for (const series of byBook.values()) {
    if (series.length < 2) continue;
    const first = series[0]!;
    const deltas = series.slice(1).map((point) => ({ point, delta: point.pressurePp - first.pressurePp }));
    const trigger = deltas.find(({ delta }) => Math.abs(delta) >= args.policy.materialMovePp);
    if (!trigger) continue;
    const sign = Math.sign(trigger.delta);
    const sameDirection = deltas.filter(({ delta }) => Math.sign(delta) === sign);
    const peak = sameDirection.reduce((best, row) => Math.abs(row.delta) > Math.abs(best.delta) ? row : best, trigger);
    const current = series.at(-1)!;
    moves.push({
      first,
      trigger: trigger.point,
      current,
      triggerDelta: trigger.delta,
      currentDelta: current.pressurePp - first.pressurePp,
      peakDelta: peak.delta,
    });
  }
  if (moves.length === 0) {
    return { ...empty("no_material_predecision_move"), pathState: "flat", reasons: ["no_material_predecision_move"] };
  }

  moves.sort((left, right) => Date.parse(left.trigger.observedAt) - Date.parse(right.trigger.observedAt));
  const originator = moves[0]!;
  const directionSign = Math.sign(originator.triggerDelta);
  const originatorMs = Date.parse(originator.trigger.observedAt);
  const followerDeadline = originatorMs + args.policy.followerWindowMinutes * 60_000;
  const followers = moves.filter((move) =>
    move !== originator &&
    move.first.sourceFamily !== originator.first.sourceFamily &&
    Math.sign(move.triggerDelta) === directionSign &&
    Date.parse(move.trigger.observedAt) >= originatorMs &&
    Date.parse(move.trigger.observedAt) <= followerDeadline,
  );
  const followerFamilies = [...new Set(followers.map((move) => move.first.sourceFamily))].sort();
  const conflictingMove = moves.some((move) =>
    move !== originator && Math.sign(move.triggerDelta) !== directionSign,
  );
  const peakMovePp = originator.peakDelta;
  const retainedMovePp = originator.currentDelta;
  const peakRetention = Math.sign(retainedMovePp) === directionSign
    ? Math.abs(retainedMovePp) / Math.abs(peakMovePp)
    : 0;

  let pathState: MarketTapeQualification["pathState"];
  if (Math.sign(retainedMovePp) === -directionSign && Math.abs(retainedMovePp) >= args.policy.materialMovePp) {
    pathState = "reversal";
  } else if (peakRetention < args.policy.minimumPeakRetention) {
    pathState = "buyback";
  } else if (conflictingMove) {
    pathState = "conflict";
  } else if (followerFamilies.length >= args.policy.minimumFollowerFamilies) {
    pathState = "persistent_discovery";
  } else if (followerFamilies.length > 0) {
    pathState = "followed_move";
  } else {
    pathState = "isolated_move";
  }

  const relevantSplits = (args.splits ?? [])
    .filter((split) => completeSplit(split) && Date.parse(split.observedAt) <= decisionMs &&
      split.eventId === originator.first.eventId && split.market === originator.first.market && split.side === originator.first.side)
    .sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt));
  const latestSplit = relevantSplits.at(-1) ?? null;
  const splitDivergencePp = latestSplit ? latestSplit.moneyPct - latestSplit.ticketsPct : null;
  const splitVolumeKnown = relevantSplits.some((split) =>
    typeof split.ticketCount === "number" && split.ticketCount > 0 &&
    typeof split.handleAmount === "number" && split.handleAmount > 0,
  );
  let splitState: MarketTapeQualification["splitState"] = "unavailable";
  if (latestSplit) {
    if (relevantSplits.length === 1) {
      splitState = "snapshot_only";
    } else {
      const materialSplits = relevantSplits.filter((split) =>
        Math.abs(split.moneyPct - split.ticketsPct) >= args.policy.splitDivergencePp,
      );
      const firstCorroboratingSplit = materialSplits.find((split) =>
        Math.sign(split.moneyPct - split.ticketsPct) === directionSign,
      );
      splitState = materialSplits.length === 0
        ? "stable"
        : !firstCorroboratingSplit
          ? "conflict"
          : Date.parse(firstCorroboratingSplit.observedAt) <= originatorMs
          ? "divergence_precedes_move"
          : "divergence_follows_move";
    }
  }

  const splitCorroborates = !args.policy.requireSplitCorroboration ||
    (splitState === "divergence_precedes_move" && splitDivergencePp !== null &&
      Math.sign(splitDivergencePp) === directionSign && Math.abs(splitDivergencePp) >= args.policy.splitDivergencePp);
  const sequenceQualified = pathState === "persistent_discovery" && splitCorroborates;
  const reasons: string[] = [];
  if (pathState !== "persistent_discovery") reasons.push(`price_path_${pathState}`);
  if (args.policy.requireSplitCorroboration && !splitCorroborates) reasons.push(`split_${splitState}`);
  if (!splitVolumeKnown && latestSplit) reasons.push("split_percentages_without_volume_denominators");
  reasons.push("bettor_identity_unverified");

  return {
    pathState,
    direction: directionSign > 0 ? "toward_side" : "away_from_side",
    originator: {
      sportsbook: originator.first.sportsbook,
      sourceFamily: originator.first.sourceFamily,
      observedAt: originator.trigger.observedAt,
    },
    followerFamilies,
    peakMovePp,
    retainedMovePp,
    peakRetention,
    splitState,
    splitDivergencePp,
    splitVolumeKnown,
    professionalBettorIdentityKnown: false,
    sequenceQualified,
    reasons,
  };
}
