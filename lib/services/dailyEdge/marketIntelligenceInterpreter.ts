import type { PredictionEvidenceObject } from "@/lib/services/dailyEdge/predictionEvidenceBuilder";

export type ConsensusSharpRelationship =
  | "both_support"
  | "consensus_support_sharp_resist"
  | "sharp_support_consensus_resist"
  | "both_resist"
  | "consensus_only"
  | "sharp_only"
  | "unavailable";

export type MarketFrictionLevel = "none" | "low" | "medium" | "high";
export type ModelMarketRelationship =
  | "model_confirmed_by_market"
  | "model_vs_market"
  | "market_warns_against_model"
  | "market_neutral"
  | "unavailable";

export type MarketIntelligenceInterpretation = {
  openerToCurrentMove: number | null;
  movementTowardPick: boolean | null;
  movementMagnitude: number | null;
  priceMovementDirection: "toward_pick" | "against_pick" | "neutral" | "unknown";
  earlyMoveDetected: boolean | null;
  lateMoveDetected: boolean | null;
  buybackDetected: boolean | null;
  priceExhaustionDetected: boolean;
  splitMovementAgreement: "agree" | "disagree" | "unknown";
  consensusVsSharpRelationship: ConsensusSharpRelationship;
  publicHeavySide: string | null;
  sharpBookSide: string | null;
  reverseLineMovementCandidate: boolean;
  noMoveDespiteLopsidedSplits: boolean;
  currentNumberPlayable: boolean | null;
  marketReadThesis: string;
  marketReadConfidence: "high" | "medium" | "low";
  marketFrictionLevel: MarketFrictionLevel;
  modelMarketRelationship: ModelMarketRelationship;
};

function americanMove(row: PredictionEvidenceObject): number | null {
  const movement = row.marketEvidence.lineMovement;
  const open = movement.openAmerican ?? movement.firstTrackedLine;
  const current = movement.currentAmerican ?? movement.displayCurrentAmerican ?? movement.lockedAmerican;
  if (typeof open !== "number" || typeof current !== "number") return null;
  return +(current - open).toFixed(1);
}

function americanToImpliedProbability(american: number | null | undefined): number | null {
  if (typeof american !== "number" || !Number.isFinite(american) || american === 0) return null;
  if (american > 0) return 100 / (american + 100);
  return Math.abs(american) / (Math.abs(american) + 100);
}

function movementDirection(row: PredictionEvidenceObject): MarketIntelligenceInterpretation["priceMovementDirection"] {
  const raw = row.marketEvidence.lineMovement.movementTowardAgainstPick ?? row.marketEvidence.lineMovement.directionRelativeToPick;
  if (typeof raw === "string") {
    if (/toward|with|support/i.test(raw)) return "toward_pick";
    if (/against|oppose|resist/i.test(raw)) return "against_pick";
    if (/neutral|flat/i.test(raw)) return "neutral";
  }
  const move = americanMove(row);
  if (move === null || Math.abs(move) < 2) return move === null ? "unknown" : "neutral";
  const movement = row.marketEvidence.lineMovement;
  const open = movement.openAmerican ?? movement.firstTrackedLine;
  const current = movement.currentAmerican ?? movement.displayCurrentAmerican ?? movement.lockedAmerican;
  const openImplied = americanToImpliedProbability(open);
  const currentImplied = americanToImpliedProbability(current);
  if (openImplied === null || currentImplied === null) return "unknown";
  const delta = currentImplied - openImplied;
  if (Math.abs(delta) < 0.005) return "neutral";
  return delta > 0 ? "toward_pick" : "against_pick";
}

function consensusSharpRelationship(row: PredictionEvidenceObject): ConsensusSharpRelationship {
  switch (row.marketEvidence.sourceAgreement) {
    case "both_align": return "both_support";
    case "both_oppose": return "both_resist";
    case "consensus_supports_sharp_opposes": return "consensus_support_sharp_resist";
    case "sharp_supports_consensus_opposes": return "sharp_support_consensus_resist";
    case "consensus_only": return "consensus_only";
    case "sharp_only": return "sharp_only";
    default: return "unavailable";
  }
}

function friction(row: PredictionEvidenceObject, direction: MarketIntelligenceInterpretation["priceMovementDirection"], relation: ConsensusSharpRelationship): MarketFrictionLevel {
  let score = 0;
  if (direction === "against_pick") score += 2;
  if (relation === "both_resist") score += 3;
  if (relation === "consensus_support_sharp_resist" || relation === "sharp_support_consensus_resist") score += 2;
  if (relation === "unavailable") score += row.identity.marketType === "FI" ? 0 : 1;
  if (row.priceValueEvidence.heavyJuiceWarning) score += 1;
  if (row.modelStatsEvidence.dataQualityWarnings.length > 0) score += 1;
  if (score >= 4) return "high";
  if (score >= 2) return "medium";
  if (score >= 1) return "low";
  return "none";
}

function playable(row: PredictionEvidenceObject): boolean | null {
  if (row.priceValueEvidence.priceAmerican === null || row.modelStatsEvidence.marketImpliedProbability === null) return null;
  if (row.priceValueEvidence.priceBecameUnplayable) return false;
  if (row.priceValueEvidence.heavyJuiceWarning && (row.modelStatsEvidence.edge ?? 0) < 4) return false;
  if ((row.modelStatsEvidence.edge ?? 0) < -1) return false;
  return true;
}

function modelMarketRelationship(row: PredictionEvidenceObject, direction: MarketIntelligenceInterpretation["priceMovementDirection"], relation: ConsensusSharpRelationship): ModelMarketRelationship {
  const edge = row.modelStatsEvidence.edge;
  if (edge === null) return "unavailable";
  if (edge > 3 && (direction === "toward_pick" || relation === "both_support" || relation === "consensus_only")) return "model_confirmed_by_market";
  if (edge > 3 && (direction === "against_pick" || relation === "both_resist")) return "model_vs_market";
  if (edge <= 1 && (direction === "against_pick" || relation === "both_resist")) return "market_warns_against_model";
  return "market_neutral";
}

export function interpretMarketIntelligence(row: PredictionEvidenceObject): MarketIntelligenceInterpretation {
  const move = americanMove(row);
  const direction = movementDirection(row);
  const relation = row.identity.marketType === "FI" ? "unavailable" : consensusSharpRelationship(row);
  const movementMagnitude = move === null ? null : Math.abs(move);
  const currentNumberPlayable = playable(row);
  const marketFrictionLevel = friction(row, direction, relation);
  const relationship = modelMarketRelationship(row, direction, relation);
  const noMoveDespiteLopsidedSplits = row.marketEvidence.consensusSplitsAvailable && direction === "neutral";
  const reverseLineMovementCandidate = direction === "against_pick" &&
    (relation === "consensus_only" || relation === "both_support" || relation === "consensus_support_sharp_resist");
  const priceExhaustionDetected = Boolean(row.priceValueEvidence.heavyJuiceWarning && direction === "toward_pick");
  const splitMovementAgreement =
    relation === "unavailable" || direction === "unknown" ? "unknown" :
    (relation === "both_support" || relation === "consensus_only") && direction === "toward_pick" ? "agree" :
    (relation === "both_resist" && direction === "against_pick") ? "agree" :
    "disagree";
  const thesisParts = [
    currentNumberPlayable === false ? "current number is not clearly playable" : "current number is playable or monitorable",
    direction === "toward_pick" ? "movement supports the pick" : direction === "against_pick" ? "movement is against the pick" : "movement is neutral/unknown",
    relation === "unavailable" ? "split context is unavailable/unknown" : `source relationship is ${relation}`,
    relationship.replaceAll("_", " "),
  ];
  return {
    openerToCurrentMove: move,
    movementTowardPick: direction === "unknown" ? null : direction === "toward_pick",
    movementMagnitude,
    priceMovementDirection: direction,
    earlyMoveDetected: null,
    lateMoveDetected: null,
    buybackDetected: null,
    priceExhaustionDetected,
    splitMovementAgreement,
    consensusVsSharpRelationship: relation,
    publicHeavySide: row.marketEvidence.consensusSplitsAvailable ? "consensus_available" : null,
    sharpBookSide: row.marketEvidence.sharpBookSplitsAvailable || row.marketEvidence.sharpBookSignalAvailable ? "sharp_context_available" : null,
    reverseLineMovementCandidate,
    noMoveDespiteLopsidedSplits,
    currentNumberPlayable,
    marketReadThesis: thesisParts.join("; "),
    marketReadConfidence: marketFrictionLevel === "none" ? "high" : marketFrictionLevel === "low" ? "medium" : "low",
    marketFrictionLevel,
    modelMarketRelationship: relationship,
  };
}
