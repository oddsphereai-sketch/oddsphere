import type {
  NflFullGameEvidenceLedger,
  NflFullGameEvidenceSignal,
} from "./nflFullGameEvidenceLedger";
import type { NflV1ActionableGradeBundle } from "./nflV1ActionableGradeCandidate";
import type { NflV1WeekOneOutcomeForecast } from "./nflV1WeekOneOutcome";

export const NFL_FULL_GAME_EVIDENCE_ARBITER_CANDIDATE_RELEASE =
  "nfl_full_game_evidence_arbiter_candidate_2026_10_31_r20_single_episode_price_corroboration" as const;

type Side = "home" | "away";
type TotalSide = "over" | "under";

export type NflFullGameSideStory =
  | "market_confirms_game"
  | "same_winner_repricing"
  | "winner_regime_change"
  | "tie_resolution"
  | "winner_cover_divergence"
  | "spread_only_repricing"
  | "conflicted_market_story"
  | "market_story_unavailable";

export type NflFullGameTotalStory =
  | "market_confirms_scoring_environment"
  | "scoring_environment_change"
  | "conflicted_market_story"
  | "market_story_unavailable";

export type NflFullGameEvidenceRole =
  | "independent_forecast"
  | "player_aware_forecast"
  | "target_excluded_price_score"
  | "current_market_state"
  | "originating_price_discovery"
  | "retail_follow_through"
  | "price_resistance"
  | "number_price_divergence"
  | "buyback"
  | "reversal"
  | "key_number_transition"
  | "source_flow_confirmation"
  | "source_flow_disagreement"
  | "shared_flow_concentration"
  | "unconfirmed_flow_pressure"
  | "unqualified_flow_context"
  | "availability_context"
  | "availability_precedes_market"
  | "market_precedes_availability"
  | "conflict_or_non_directional"
  | "data_quality";

export type NflFullGameSignalInterpretation = {
  signalId: string;
  market: "moneyline" | "spread" | "total" | "game";
  source: string;
  roles: NflFullGameEvidenceRole[];
  affects: "side_story" | "total_story" | "context_only" | "data_quality";
  stance: "supports_released" | "resists_released" | "non_directional";
  explanation: string;
};

export type NflFullGameEvidenceArbitration = {
  release: typeof NFL_FULL_GAME_EVIDENCE_ARBITER_CANDIDATE_RELEASE;
  status: "applied" | "neutral" | "unavailable";
  reason: "semantic_game_story" | "market_confirms_released_game" |
    "conflicted_or_non_directional_market_story" |
    "coherent_evidence_without_score_authority" | "ledger_not_fully_accounted";
  sideStory: NflFullGameSideStory;
  totalStory: NflFullGameTotalStory;
  moneylineDirection: -1 | 0 | 1;
  spreadDirection: -1 | 0 | 1;
  sideDirection: -1 | 0 | 1;
  totalDirection: -1 | 0 | 1;
  evidenceRoles: string[];
  signalInterpretations: NflFullGameSignalInterpretation[];
  interpretationAccounting: {
    capturedSignals: number;
    interpretedCapturedSignals: number;
    allCapturedInterpreted: boolean;
    usableSignals: number;
    interpretedSignals: number;
    allUsableInterpreted: boolean;
  };
  releasedHomeMargin: number;
  releasedTotal: number;
  finalHomeMargin: number;
  finalTotal: number;
  expectedAwayScore: number;
  expectedHomeScore: number;
};

/**
 * Interprets the evidence as a game story. It does not average the independent
 * score with prices, movements, splits, or a market baseline. A changed score
 * is selected categorically: a coherent existing forecast is preferred; only
 * an explicitly interpreted regime change may mirror the released score across
 * the relevant winner/line boundary.
 */
export function arbitrateNflFullGameEvidence(args: {
  releasedForecast: Pick<NflV1WeekOneOutcomeForecast, "expectedAwayScore" | "expectedHomeScore">;
  ledger: NflFullGameEvidenceLedger;
}): NflFullGameEvidenceArbitration {
  const releasedHomeMargin = args.releasedForecast.expectedHomeScore - args.releasedForecast.expectedAwayScore;
  const releasedTotal = args.releasedForecast.expectedHomeScore + args.releasedForecast.expectedAwayScore;
  const signalInterpretations = interpretEverySignal(args.ledger);
  const usableSignals = args.ledger.signals.filter((signal) => signal.status === "usable");
  const interpretedIds = new Set(signalInterpretations.map((item) => item.signalId));
  const allUsableInterpreted = usableSignals.every((signal) => interpretedIds.has(signal.id)) &&
    signalInterpretations.filter((item) => usableSignals.some((signal) => signal.id === item.signalId)).length ===
      usableSignals.length;
  const allCapturedInterpreted = args.ledger.signals.every((signal) => interpretedIds.has(signal.id)) &&
    signalInterpretations.length === args.ledger.signals.length;
  const interpretationAccounting = {
    capturedSignals: args.ledger.signals.length,
    interpretedCapturedSignals: signalInterpretations.length,
    allCapturedInterpreted,
    usableSignals: usableSignals.length,
    interpretedSignals: signalInterpretations.filter((item) =>
      usableSignals.some((signal) => signal.id === item.signalId)).length,
    allUsableInterpreted,
  };
  if (!args.ledger.accounting.allUsableAccounted || !allUsableInterpreted || !allCapturedInterpreted) {
    return result({
      status: "unavailable",
      reason: "ledger_not_fully_accounted",
      sideStory: "market_story_unavailable",
      totalStory: "market_story_unavailable",
      moneylineDirection: 0,
      spreadDirection: 0,
      sideDirection: 0,
      totalDirection: 0,
      evidenceRoles: [],
      signalInterpretations,
      interpretationAccounting,
      releasedHomeMargin,
      releasedTotal,
      finalHomeMargin: releasedHomeMargin,
      finalTotal: releasedTotal,
    });
  }

  const side = interpretSideStory(args.ledger, releasedHomeMargin, signalInterpretations);
  const total = interpretTotalStory(args.ledger, releasedTotal, signalInterpretations);
  const proposedHomeMargin = resolveMargin({
    ledger: args.ledger,
    releasedHomeMargin,
    story: side.story,
    desiredSide: side.desiredSide,
    totalStory: total.story,
  });
  const proposedTotal = resolveTotal({
    ledger: args.ledger,
    releasedTotal,
    story: total.story,
    desiredSide: total.desiredSide,
  });
  const coherent = reconcileNflFullGameScoreTuple({
    ledger: args.ledger,
    releasedHomeMargin,
    releasedTotal,
    proposedHomeMargin,
    proposedTotal,
  });
  const finalHomeMargin = coherent.homeMargin;
  const finalTotal = coherent.total;
  const changed = Math.abs(finalHomeMargin - releasedHomeMargin) > 1e-9 ||
    Math.abs(finalTotal - releasedTotal) > 1e-9;
  const conflicted = side.story === "conflicted_market_story" || total.story === "conflicted_market_story";
  const directional = side.desiredSide !== null || total.desiredSide !== null;
  const confirms = (side.story === "market_confirms_game" || side.story === "market_story_unavailable") &&
    (total.story === "market_confirms_scoring_environment" || total.story === "market_story_unavailable") &&
    (side.story === "market_confirms_game" || total.story === "market_confirms_scoring_environment");
  return result({
    status: changed ? "applied" : "neutral",
    reason: changed ? "semantic_game_story"
      : conflicted ? "conflicted_or_non_directional_market_story"
        : confirms ? "market_confirms_released_game"
          : directional ? "coherent_evidence_without_score_authority"
            : "conflicted_or_non_directional_market_story",
    sideStory: side.story,
    totalStory: total.story,
    moneylineDirection: side.moneylineDirection,
    spreadDirection: side.spreadDirection,
    sideDirection: side.desiredSide === "home" ? 1 : side.desiredSide === "away" ? -1 : 0,
    totalDirection: total.desiredSide === "over" ? 1 : total.desiredSide === "under" ? -1 : 0,
    evidenceRoles: [...side.evidenceRoles, ...total.evidenceRoles],
    signalInterpretations,
    interpretationAccounting,
    releasedHomeMargin,
    releasedTotal,
    finalHomeMargin,
    finalTotal,
  });
}


/** Keep the two axes one physically possible game, with a single expert when both change. */
export function reconcileNflFullGameScoreTuple(args: {
  ledger: NflFullGameEvidenceLedger;
  releasedHomeMargin: number;
  releasedTotal: number;
  proposedHomeMargin: number;
  proposedTotal: number;
}): { homeMargin: number; total: number } {
  const valid = (margin: number, total: number) =>
    Number.isFinite(margin) && Number.isFinite(total) && total > Math.abs(margin);
  const marginChanged = Math.abs(args.proposedHomeMargin - args.releasedHomeMargin) > 1e-9;
  const totalChanged = Math.abs(args.proposedTotal - args.releasedTotal) > 1e-9;
  if (!marginChanged && !totalChanged) {
    return { homeMargin: args.releasedHomeMargin, total: args.releasedTotal };
  }
  if (!marginChanged || !totalChanged) {
    return valid(args.proposedHomeMargin, args.proposedTotal)
      ? { homeMargin: args.proposedHomeMargin, total: args.proposedTotal }
      : { homeMargin: args.releasedHomeMargin, total: args.releasedTotal };
  }
  const marketMargin = targetExcludedPriceScoreValue(args.ledger, "moneyline");
  const marketTotal = targetExcludedPriceScoreValue(args.ledger, "total");
  const marginBoundary = args.ledger.evaluatedContract.spreadHomeMarginBoundary;
  const totalBoundary = args.ledger.evaluatedContract.totalLine;
  const sameCategory = (candidate: number, proposed: number, boundary: number) =>
    Math.sign(candidate - boundary) === Math.sign(proposed - boundary);
  if (marketMargin !== null && marketTotal !== null && valid(marketMargin, marketTotal) &&
      sameCategory(marketMargin, args.proposedHomeMargin, 0) &&
      (marginBoundary === null || sameCategory(marketMargin, args.proposedHomeMargin, marginBoundary)) &&
      (totalBoundary === null || sameCategory(marketTotal, args.proposedTotal, totalBoundary))) {
    return { homeMargin: marketMargin, total: marketTotal };
  }
  // Two simultaneous changes need a single whole-game source; neither a
  // statistical expert nor one market axis may be stitched to the other.
  return { homeMargin: args.releasedHomeMargin, total: args.releasedTotal };
}

export function applyNflFullGameSemanticGradePolicy(args: {
  baseline: NflV1ActionableGradeBundle;
  candidate: NflV1ActionableGradeBundle;
  arbitration: NflFullGameEvidenceArbitration;
}): NflV1ActionableGradeBundle {
  if (args.arbitration.status !== "applied") return args.baseline;
  const baselineByMarket = new Map(args.baseline.evaluatedBets.map((decision) => [decision.market, decision]));
  const evaluatedBets = args.candidate.evaluatedBets.map((decision) => {
    const baseline = baselineByMarket.get(decision.market);
    if (!baseline) return decision;
    if (decision.market === "total") {
      return Math.abs(args.arbitration.finalTotal - args.arbitration.releasedTotal) > 1e-9
        ? decision
        : baseline;
    }
    if (decision.market === "moneyline") return decision;
    const changedSide = decision.side !== baseline.side;
    const eligibleSemanticPromotion = args.arbitration.sideStory === "spread_only_repricing" &&
      changedSide && baseline.grade === "Watchlist" && decision.grade === "Watchlist" &&
      decision.expectedValue >= 0 && decision.modelProbability >= decision.marketFairProbability;
    return eligibleSemanticPromotion ? { ...decision, grade: "Lean" as const } : decision;
  });
  return { ...args.candidate, evaluatedBets };
}

function interpretSideStory(
  ledger: NflFullGameEvidenceLedger,
  releasedHomeMargin: number,
  interpretations: NflFullGameSignalInterpretation[],
): {
  story: NflFullGameSideStory;
  desiredSide: Side | null;
  moneylineDirection: -1 | 0 | 1;
  spreadDirection: -1 | 0 | 1;
  evidenceRoles: string[];
} {
  const moneyline = ledger.marketContexts.moneyline;
  const spread = ledger.marketContexts.spread;
  const releasedWinner = releasedHomeMargin > 0 ? "home" : releasedHomeMargin < 0 ? "away" : null;
  const currentWinner = currentMarketSide(ledger, "moneyline") as Side | null;
  const moneylineDirection = namedSide(moneyline.namedDirection);
  const spreadDirection = namedSide(spread.namedDirection);
  const directions: { moneylineDirection: -1 | 0 | 1; spreadDirection: -1 | 0 | 1 } = {
    moneylineDirection: moneyline.namedDirection ?? 0,
    spreadDirection: spread.namedDirection ?? 0,
  };
  const evidenceRoles = interpretationRoleLabels(interpretations, ["moneyline", "spread"]);
  if (!moneylineDirection && !spreadDirection) {
    return { story: "market_story_unavailable", desiredSide: null, evidenceRoles, ...directions };
  }
  if (moneylineDirection && spreadDirection && moneylineDirection !== spreadDirection) {
    const marketCover = currentMarketSide(ledger, "spread");
    if (currentWinner === moneylineDirection && marketCover === spreadDirection) {
      // A favorite can become more likely to win while the other side becomes
      // more likely to cover. This is a joint margin story, not contradictory
      // instructions to flip the outright winner in both directions.
      return { story: "winner_cover_divergence", desiredSide: null, evidenceRoles, ...directions };
    }
    return { story: "conflicted_market_story", desiredSide: null, evidenceRoles, ...directions };
  }
  const insufficientStableNamedSide = (["moneyline", "spread"] as const).some((market) => {
    const direction = ledger.marketContexts[market].namedDirection;
    if (direction === null) return false;
    const stable = ledger.signals.filter((signal) =>
      signal.kind === "book_trail" && signal.market === market &&
      signal.sourceClass === "named" && signal.targetExcluded === true &&
      signal.status === "usable" && semanticDirection(signal) === direction &&
      !signal.marketPath?.buybackToOpening &&
      (signal.marketPath?.reversalMagnitude ?? 0) <= 0 &&
      !(signal.marketObservation?.numberDirection !== null &&
        signal.marketObservation?.priceDirection !== null &&
        signal.marketObservation?.numberDirection !== signal.marketObservation?.priceDirection));
    const priceScore = targetExcludedPriceScoreValue(ledger, market);
    const boundary = market === "moneyline" ? 0 : ledger.evaluatedContract.spreadHomeMarginBoundary;
    const currentPriceConfirms = priceScore !== null && boundary !== null &&
      Math.sign(priceScore - boundary) === direction &&
      currentMarketSide(ledger, market) === namedSide(direction);
    return stable.length < 2 && ledger.marketContexts[market].followerSources.length === 0 &&
      !currentPriceConfirms;
  });
  if (insufficientStableNamedSide) {
    // A lone named episode needs a separate target-excluded current-price
    // implication or observed follow-through. A numerical count of named
    // movers alone is not the meaning of the market read.
    return { story: "conflicted_market_story", desiredSide: null, evidenceRoles, ...directions };
  }
  const heldMoneylineFlowSide = moneyline.resistance === "flow_resistance"
    ? ledger.signals.filter((signal) => signal.kind === "split" && signal.market === "moneyline" &&
      signal.splitContext?.qualifiedForDirection && signal.status === "usable")
      .map(semanticDirection).find((direction) => direction !== null) ?? null
    : null;
  if (!moneylineDirection && spreadDirection && heldMoneylineFlowSide === spread.namedDirection) {
    // Money pressure on the spread's proposed side did not move the ML book.
    // The held ML quote is a real cross-market challenge, not corroboration.
    return { story: "conflicted_market_story", desiredSide: null, evidenceRoles, ...directions };
  }
  const desiredSide = moneylineDirection ?? spreadDirection;
  if (!desiredSide) return { story: "market_story_unavailable", desiredSide: null, evidenceRoles, ...directions };
  if (!releasedWinner) {
    return moneylineDirection && spreadDirection && currentWinner === desiredSide
      ? { story: "tie_resolution", desiredSide, evidenceRoles, ...directions }
      : { story: "conflicted_market_story", desiredSide: null, evidenceRoles, ...directions };
  }
  if (desiredSide === releasedWinner) {
    return { story: "market_confirms_game", desiredSide, evidenceRoles, ...directions };
  }
  if (moneylineDirection && spreadDirection && currentWinner === desiredSide) {
    const followedThrough = interpretations.some((item) => item.affects === "side_story" &&
      item.roles.includes("retail_follow_through"));
    const pairedPriceConfirms = Math.sign(targetExcludedPriceScoreValue(ledger, "moneyline") ?? 0) ===
      (desiredSide === "home" ? 1 : -1);
    return followedThrough || pairedPriceConfirms
      ? { story: "winner_regime_change", desiredSide, evidenceRoles, ...directions }
      : { story: "conflicted_market_story", desiredSide: null, evidenceRoles, ...directions };
  }
  if (moneylineDirection && currentWinner === desiredSide &&
      Math.sign(targetExcludedPriceScoreValue(ledger, "moneyline") ?? 0) ===
        (desiredSide === "home" ? 1 : -1)) {
    return { story: "winner_regime_change", desiredSide, evidenceRoles, ...directions };
  }
  if (currentWinner === releasedWinner) {
    return {
      story: moneylineDirection && spreadDirection ? "same_winner_repricing" : "spread_only_repricing",
      desiredSide,
      evidenceRoles,
      ...directions,
    };
  }
  return { story: "conflicted_market_story", desiredSide: null, evidenceRoles, ...directions };
}

function interpretTotalStory(
  ledger: NflFullGameEvidenceLedger,
  releasedTotal: number,
  interpretations: NflFullGameSignalInterpretation[],
): {
  story: NflFullGameTotalStory;
  desiredSide: TotalSide | null;
  evidenceRoles: string[];
} {
  const context = ledger.marketContexts.total;
  const desiredSide = context.namedDirection === 1 ? "over" : context.namedDirection === -1 ? "under" : null;
  const marketTotal = ledger.evaluatedContract.totalLine;
  const releasedSide = marketTotal === null || releasedTotal === marketTotal
    ? null
    : releasedTotal > marketTotal ? "over" : "under";
  const evidenceRoles = interpretationRoleLabels(interpretations, ["total"]);
  if (!desiredSide || !releasedSide) {
    return { story: "market_story_unavailable", desiredSide: null, evidenceRoles };
  }
  if (context.resistance === "book_disagreement") {
    return { story: "conflicted_market_story", desiredSide: null, evidenceRoles };
  }
  return desiredSide === releasedSide
    ? { story: "market_confirms_scoring_environment", desiredSide, evidenceRoles }
    : { story: "scoring_environment_change", desiredSide, evidenceRoles };
}

function interpretEverySignal(ledger: NflFullGameEvidenceLedger): NflFullGameSignalInterpretation[] {
  return ledger.signals.map((signal) => interpretSignal(ledger, signal));
}

function interpretSignal(
  ledger: NflFullGameEvidenceLedger,
  signal: NflFullGameEvidenceSignal,
): NflFullGameSignalInterpretation {
  const affects = signal.market === "total"
    ? "total_story" as const
    : signal.market === "moneyline" || signal.market === "spread"
      ? "side_story" as const
      : "context_only" as const;
  const stance = signal.disposition === "supports"
    ? "supports_released" as const
    : signal.disposition === "resists"
      ? "resists_released" as const
      : "non_directional" as const;
  if (signal.status !== "usable") {
    return interpretation(signal, ["data_quality"], "data_quality", "non_directional",
      `${signal.kind} is ${signal.status}; it is preserved as provenance but cannot direct the game story.`);
  }
  if (signal.kind === "forecast_expert") {
    if (signal.source === "target_excluded_paired_price_score") {
      return interpretation(signal, ["target_excluded_price_score"], affects, stance,
        "An exact target-excluded paired-price forecast supplies a coherent market score candidate; it is not an executable quote or a reflected betting line.");
    }
    const playerAware = signal.source.toLowerCase().includes("player") || signal.source.toLowerCase().includes("availability");
    return interpretation(signal, [playerAware ? "player_aware_forecast" : "independent_forecast"], affects, stance,
      `${signal.source} supplies a coherent score candidate; it may be selected as a whole but is never numerically blended.`);
  }
  if (signal.kind === "target_excluded_market") {
    return interpretation(signal, ["current_market_state"], affects, stance,
      "The target-excluded no-vig market locates the current winner, line, or scoring regime without reusing the target quote.");
  }
  if (signal.kind === "availability") {
    const relative = signal.availabilityContext?.relativeToFirstMarketMove;
    const roles: NflFullGameEvidenceRole[] = ["availability_context"];
    if (relative === "before") roles.push("availability_precedes_market");
    if (relative === "after") roles.push("market_precedes_availability");
    return interpretation(signal, roles, "context_only", "non_directional",
      `${signal.source} is available to explain the game and market path; ` +
      `${relative && relative !== "unknown" ? `its report timestamp is ${relative} the first captured market move` : "its causal sequence is unknown"}. ` +
      "That sequence is context, not proof of causation or an automatic point adjustment.");
  }
  if (signal.kind === "split") {
    const context = signal.splitContext;
    if (!context?.qualifiedForDirection) {
      const majorityDirection = context?.sharedMajoritySide === "home" || context?.sharedMajoritySide === "over" ? 1
        : context?.sharedMajoritySide === "away" || context?.sharedMajoritySide === "under" ? -1 : null;
      const namedDirection = signal.market === "game" ? null : ledger.marketContexts[signal.market].namedDirection;
      const opposed = majorityDirection !== null && namedDirection !== null && majorityDirection === -namedDirection;
      return interpretation(signal,
        context?.sharedMajoritySide
          ? ["shared_flow_concentration", ...(opposed ? ["source_flow_disagreement", "price_resistance"] as const : [])]
          : ["unqualified_flow_context"],
        "context_only", "non_directional",
        context?.sharedMajoritySide
          ? `Money and tickets both favor ${context.sharedMajoritySide}; ${opposed
            ? "the named-book price path opposes that concentration"
            : "that concentration does not by itself identify a directional price reaction"}. ` +
            "The source and timing do not prove bookmaker intent or a sharp bettor's side."
          : "The money-ticket difference is retained, but its identity, line match, freshness, or separation is insufficient to direct a prediction by itself.");
    }
    const namedDirection = signal.market === "game" ? null : ledger.marketContexts[signal.market].namedDirection;
    const signalDirection = semanticDirection(signal);
    if (namedDirection === null && signal.market !== "game" &&
        ledger.marketContexts[signal.market].resistance === "flow_resistance") {
      return interpretation(signal, ["unconfirmed_flow_pressure", "price_resistance"],
        "context_only", "non_directional",
        "Qualified money-ticket pressure met a held book price/number. That is observable resistance, " +
        "not proof that the opposite side is sharp or permission to flip the score by itself.");
    }
    const roles: NflFullGameEvidenceRole[] = namedDirection !== null && signalDirection === namedDirection
      ? ["source_flow_confirmation"]
      : namedDirection !== null && signalDirection === -namedDirection
        ? ["source_flow_disagreement", "price_resistance"]
        : ["source_flow_confirmation"];
    return interpretation(signal, roles, affects, stance,
      roles.includes("source_flow_disagreement")
        ? "Qualified flow points against named-book discovery, so it is treated as disagreement/resistance rather than a command to follow tickets or money."
        : "Qualified flow supplies contextual confirmation; it does not override the price path on its own.");
  }

  const context = ledger.marketContexts[signal.market as "moneyline" | "spread" | "total"];
  const observation = signal.marketObservation;
  const path = signal.marketPath;
  const roles: NflFullGameEvidenceRole[] = [];
  if (path?.buybackToOpening) roles.push("buyback");
  if ((path?.reversalMagnitude ?? 0) > 0) roles.push("reversal");
  if ((path?.crossedKeyNumbers.length ?? 0) > 0) roles.push("key_number_transition");
  if (observation?.numberDirection !== null && observation?.priceDirection !== null &&
      observation?.numberDirection !== observation?.priceDirection) {
    roles.push("number_price_divergence");
  }
  if (signal.side === null) roles.push("conflict_or_non_directional");
  const signalDirection = semanticDirection(signal);
  if (signal.sourceClass === "named" && context.namedDirection !== null && signalDirection === context.namedDirection) {
    roles.push("originating_price_discovery");
  }
  if (signal.sourceClass === "retail" && context.followerSources.includes(signal.source) &&
      context.namedDirection !== null && signalDirection === context.namedDirection) {
    roles.push("retail_follow_through");
  }
  if (context.namedDirection !== null && signalDirection !== null && signalDirection === -context.namedDirection) {
    roles.push("price_resistance");
  }
  if (roles.length === 0) roles.push("conflict_or_non_directional");
  return interpretation(signal, uniqueRoles(roles), affects, stance, describeBookTrail(signal, roles));
}

function interpretation(
  signal: NflFullGameEvidenceSignal,
  roles: NflFullGameEvidenceRole[],
  affects: NflFullGameSignalInterpretation["affects"],
  stance: NflFullGameSignalInterpretation["stance"],
  explanation: string,
): NflFullGameSignalInterpretation {
  return { signalId: signal.id, market: signal.market, source: signal.source, roles, affects, stance, explanation };
}

function semanticDirection(signal: NflFullGameEvidenceSignal): -1 | 1 | null {
  return signal.side === "home" || signal.side === "over" ? 1
    : signal.side === "away" || signal.side === "under" ? -1
    : null;
}

function uniqueRoles(values: NflFullGameEvidenceRole[]) {
  return [...new Set(values)];
}

function describeBookTrail(signal: NflFullGameEvidenceSignal, roles: NflFullGameEvidenceRole[]) {
  const observation = signal.marketObservation;
  const path = signal.marketPath;
  const facts = [
    path?.moveOrder ? `${path.moveOrder.replaceAll("_", " ")}` : null,
    path ? `${Math.round(path.persistenceTimeShare * 100)}% path persistence` : null,
    roles.includes("key_number_transition") ? `crossed ${path?.crossedKeyNumbers.join(", ")}` : null,
    roles.includes("reversal") ? "contained a reversal" : null,
    roles.includes("buyback") ? "bought back to the opener" : null,
  ].filter((value): value is string => value !== null);
  return `${signal.source} is interpreted as ${roles.join(", ")}; ${facts.join("; ") || "the path was non-directional"}.`;
}

function interpretationRoleLabels(
  interpretations: NflFullGameSignalInterpretation[],
  markets: Array<"moneyline" | "spread" | "total">,
) {
  return [...new Set(interpretations
    .filter((item) => markets.includes(item.market as "moneyline" | "spread" | "total"))
    .flatMap((item) => item.roles.map((role) => `${item.market}:${item.source}:${role}`)))];
}

function resolveMargin(args: {
  ledger: NflFullGameEvidenceLedger;
  releasedHomeMargin: number;
  story: NflFullGameSideStory;
  desiredSide: Side | null;
  totalStory: NflFullGameTotalStory;
}) {
  if (args.story === "winner_cover_divergence") {
    const winner = namedSide(args.ledger.marketContexts.moneyline.namedDirection);
    const cover = namedSide(args.ledger.marketContexts.spread.namedDirection);
    if (!winner || !cover || winner === cover) return args.releasedHomeMargin;
    const marketScore = targetExcludedPriceScoreValue(args.ledger, "spread");
    const boundary = args.ledger.evaluatedContract.spreadHomeMarginBoundary;
    return marketScore !== null && boundary !== null &&
      Math.sign(marketScore) === (winner === "home" ? 1 : -1) &&
      Math.sign(marketScore - boundary) === (cover === "home" ? 1 : -1)
      ? marketScore : args.releasedHomeMargin;
  }
  if (!args.desiredSide || args.story === "conflicted_market_story" ||
      args.story === "market_story_unavailable") return args.releasedHomeMargin;
  if (args.story === "spread_only_repricing" && args.totalStory === "conflicted_market_story") {
    return args.releasedHomeMargin;
  }
  const currentSpreadBoundary = args.ledger.evaluatedContract.spreadHomeMarginBoundary;
  if (args.story === "market_confirms_game") {
    const marketScore = targetExcludedPriceScoreValue(args.ledger, "spread");
    return marketScore !== null && Math.sign(marketScore) === Math.sign(args.releasedHomeMargin) &&
      (args.desiredSide === "home" ? marketScore > args.releasedHomeMargin : marketScore < args.releasedHomeMargin)
      ? marketScore : args.releasedHomeMargin;
  }
  if ((args.story === "same_winner_repricing" || args.story === "spread_only_repricing") &&
      currentSpreadBoundary !== null &&
      Math.sign(args.releasedHomeMargin - currentSpreadBoundary) ===
        (args.desiredSide === "home" ? 1 : -1)) {
    return args.releasedHomeMargin;
  }
  if (args.story === "same_winner_repricing" || args.story === "spread_only_repricing") {
    const marketScore = targetExcludedPriceScoreValue(args.ledger, "spread");
    if (marketScore !== null && currentSpreadBoundary !== null &&
        Math.sign(marketScore) === Math.sign(args.releasedHomeMargin) &&
        Math.sign(marketScore - currentSpreadBoundary) === (args.desiredSide === "home" ? 1 : -1)) {
      return marketScore;
    }
    if (args.story === "same_winner_repricing") return args.releasedHomeMargin;
  }
  const candidate = targetExcludedPriceScoreValue(args.ledger, "moneyline");
  if (candidate !== null && Math.sign(candidate) === (args.desiredSide === "home" ? 1 : -1) &&
      (args.story !== "spread_only_repricing" || Math.sign(candidate) === Math.sign(args.releasedHomeMargin))) {
    return candidate;
  }
  if (args.story === "tie_resolution") return args.releasedHomeMargin;
  return args.releasedHomeMargin;
}

function resolveTotal(args: {
  ledger: NflFullGameEvidenceLedger;
  releasedTotal: number;
  story: NflFullGameTotalStory;
  desiredSide: TotalSide | null;
}) {
  if ((args.story !== "scoring_environment_change" &&
       args.story !== "market_confirms_scoring_environment") || !args.desiredSide ||
      args.ledger.marketContexts.total.resistance === "book_disagreement") return args.releasedTotal;
  const line = args.ledger.evaluatedContract.totalLine;
  const marketScore = targetExcludedPriceScoreValue(args.ledger, "total");
  if (line === null || marketScore === null ||
      Math.sign(marketScore - line) !== (args.desiredSide === "over" ? 1 : -1)) {
    return args.releasedTotal;
  }
  // A named-book trail may contain buyback or number/juice divergence; the
  // final target-excluded paired price resolves its net score implication.
  // A player-aware or statistical expert is evidence, not a substitute for
  // that market implication merely because it shares the direction label.
  if (args.story === "market_confirms_scoring_environment" &&
      (args.desiredSide === "over" ? marketScore <= args.releasedTotal : marketScore >= args.releasedTotal)) {
    return args.releasedTotal;
  }
  return marketScore;
}

function targetExcludedPriceScoreValue(
  ledger: NflFullGameEvidenceLedger,
  market: "moneyline" | "spread" | "total",
): number | null {
  const value = ledger.signals.find((signal) => signal.kind === "forecast_expert" &&
    signal.source === "target_excluded_paired_price_score" && signal.market === market &&
    signal.status === "usable")?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function currentMarketSide(
  ledger: NflFullGameEvidenceLedger,
  market: "moneyline" | "spread" | "total",
) {
  return ledger.signals.find((signal) =>
    signal.kind === "target_excluded_market" && signal.market === market && signal.status === "usable")?.side ?? null;
}

function namedSide(value: -1 | 1 | null): Side | null {
  return value === 1 ? "home" : value === -1 ? "away" : null;
}

function result(args: Omit<NflFullGameEvidenceArbitration,
  "release" | "expectedAwayScore" | "expectedHomeScore">): NflFullGameEvidenceArbitration {
  return {
    release: NFL_FULL_GAME_EVIDENCE_ARBITER_CANDIDATE_RELEASE,
    ...args,
    expectedAwayScore: (args.finalTotal - args.finalHomeMargin) / 2,
    expectedHomeScore: (args.finalTotal + args.finalHomeMargin) / 2,
  };
}

function actionable(grade: string) {
  return grade === "Best Angle" || grade === "Lean";
}
