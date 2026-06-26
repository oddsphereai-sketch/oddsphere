import type {
  MarketSplitLineBasis,
  MarketReadV2DisplayTone,
  MarketReadV2Dto,
  MarketReadValidityStatus,
} from "../../types/domain/MarketIntelligenceV2";
import type { MarketIntelligenceSnapshotV2Row } from "./snapshotSelector";

type EvidenceJson = {
  exactLinePriceEvidence?: {
    status?: string;
  };
  marketMovementEvidence?: {
    directionRelativeToPick?: "support" | "resistance" | "neutral";
    firstTrackedLine?: number | null;
    firstTrackedPrice?: number | null;
    currentLine?: number | null;
    currentPrice?: number | null;
    observedAt?: string | null;
    trackedBooks?: number;
  };
  price?: {
    direction?: string;
    openLine?: number | null;
    openAmerican?: number | null;
    currentLine?: number | null;
    currentAmerican?: number | null;
    booksMovingWithPick?: number;
    booksMovingAgainstPick?: number;
    trackedBooks?: number;
    note?: string;
  };
  playbookConsensus?: {
    betsPct?: number | null;
    moneyPct?: number | null;
    booksUsed?: number | null;
    marketLine?: number | null;
    marketPrice?: number | null;
    lineBasis?: MarketSplitLineBasis;
  };
  sharpApiSourceSpecific?: {
    sources?: Array<{
      sourceBook?: string;
      sourceType?: string;
      betsPct?: number | null;
      moneyPct?: number | null;
    }>;
  };
};

function isValidStatus(status: MarketReadValidityStatus): status is MarketReadV2Dto["validityStatus"] {
  return status === "valid_directional" || status === "valid_nondirectional";
}

function toneForScore(score: number): MarketReadV2DisplayTone {
  if (score > 0) return "emerald";
  if (score < 0) return "amber";
  return "gray";
}

function fmtPct(v: number | null | undefined): string | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return `${Math.round(v * 100)}%`;
}

function fmtLine(v: number | null | undefined): string | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Number.isInteger(v) ? `${v}` : v.toFixed(1);
}

function readEvidence(raw: unknown): EvidenceJson {
  return raw && typeof raw === "object" ? (raw as EvidenceJson) : {};
}

function displayLabel(label: string): string {
  return label === "Model-Led" ? "Projection-Led" : label;
}

function consensusLean(evidence: EvidenceJson): "our_way" | "against" | "mixed" | null {
  const p = evidence.playbookConsensus;
  if (!p) return null;
  const money = typeof p.moneyPct === "number" && Number.isFinite(p.moneyPct) ? p.moneyPct : null;
  const bets = typeof p.betsPct === "number" && Number.isFinite(p.betsPct) ? p.betsPct : null;
  if (money === null && bets === null) return null;
  if (money !== null && bets !== null) {
    if (money >= 0.5 && bets >= 0.5) return "our_way";
    if (money < 0.5 && bets < 0.5) return "against";
    return "mixed";
  }
  return (money ?? bets ?? 0) >= 0.5 ? "our_way" : "against";
}

function priceActionSummary(evidence: EvidenceJson, score: number): string | null {
  const movementEvidence = evidence.marketMovementEvidence;
  const p = movementEvidence ?? evidence.price;
  if (!p) return null;
  const tracked = typeof p.trackedBooks === "number" ? p.trackedBooks : 0;
  if (tracked <= 0) return null;
  if (score === 0) {
    const lean = consensusLean(evidence);
    if (lean === "our_way") {
      return "Consensus leans our way, but the line has not confirmed the move.";
    }
    if (lean === "against" || lean === "mixed") {
      return "The model edge is clear, but betting consensus is not fully aligned.";
    }
    return "No clear market move. This pick is driven by the model edge.";
  }
  const relative = movementEvidence?.directionRelativeToPick ?? (
    evidence.price?.direction === "toward_pick"
      ? "support"
      : evidence.price?.direction === "against_pick"
        ? "resistance"
        : "neutral"
  );
  if (relative === "neutral") {
    const lean = consensusLean(evidence);
    if (lean === "our_way") {
      return "Consensus leans our way, but the line has not confirmed the move.";
    }
    if (lean === "against" || lean === "mixed") {
      return "The model edge is clear, but betting consensus is not fully aligned.";
    }
    return "No clear market move. This pick is driven by the model edge.";
  }
  const lean = consensusLean(evidence);
  if (relative === "support") {
    if (score >= 4) return "The line has clearly moved toward our pick.";
    if (score >= 2) {
      return lean === "mixed"
        ? "The line has moved toward our pick, while consensus is mixed."
        : "The line has moved toward our pick.";
    }
    return "The market is leaning slightly toward our pick.";
  }
  if (score <= -4) return "The market has moved clearly against our pick.";
  if (score <= -2) return "The line has moved against our pick, adding risk.";
  return "The market is leaning slightly against our pick.";
}

function playbookSummary(evidence: EvidenceJson): string | null {
  const p = evidence.playbookConsensus;
  if (!p) return null;
  const money = fmtPct(p.moneyPct);
  const bets = fmtPct(p.betsPct);
  if (!money && !bets) return null;
  const books =
    typeof p.booksUsed === "number" && Number.isFinite(p.booksUsed)
      ? ` across ${p.booksUsed} book${p.booksUsed === 1 ? "" : "s"}`
      : "";
  const parts = [
    money ? `${money} money` : null,
    bets ? `${bets} bets` : null,
  ].filter(Boolean);
  return `Consensus: ${parts.join(" / ")}${books}.`;
}

function sharpApiSourceSummary(evidence: EvidenceJson): string | null {
  // Source-specific SharpAPI rows are retained in evidence_json for validation,
  // but member copy should only describe the resulting price action / movement.
  // Never expose provider conflict or raw DraftKings/Circa provenance here.
  void evidence;
  return null;
}

export function marketReadV2DtoFromSnapshot(
  row: MarketIntelligenceSnapshotV2Row | null,
): MarketReadV2Dto | null {
  if (!row || !isValidStatus(row.validity_status)) return null;
  const evidence = readEvidence(row.evidence_json);
  const priceAction = priceActionSummary(evidence, row.score);
  const movementRaw = evidence.marketMovementEvidence;
  const movement = movementRaw
    ? {
        firstTrackedLine: typeof movementRaw.firstTrackedLine === "number" ? movementRaw.firstTrackedLine : null,
        firstTrackedPrice: typeof movementRaw.firstTrackedPrice === "number" ? movementRaw.firstTrackedPrice : null,
        currentLine: typeof movementRaw.currentLine === "number" ? movementRaw.currentLine : null,
        currentPrice: typeof movementRaw.currentPrice === "number" ? movementRaw.currentPrice : null,
        directionRelativeToPick: movementRaw.directionRelativeToPick ?? "neutral",
        observedAt: typeof movementRaw.observedAt === "string" ? movementRaw.observedAt : null,
      }
    : null;
  const consensusRaw = evidence.playbookConsensus;
  const consensus =
    consensusRaw && (consensusRaw.betsPct !== null || consensusRaw.moneyPct !== null)
      ? {
          betsPct: typeof consensusRaw.betsPct === "number" ? consensusRaw.betsPct : null,
          moneyPct: typeof consensusRaw.moneyPct === "number" ? consensusRaw.moneyPct : null,
          booksUsed: typeof consensusRaw.booksUsed === "number" ? consensusRaw.booksUsed : null,
          lineBasis: consensusRaw.lineBasis ?? "unknown",
        }
      : null;
  return {
    label: displayLabel(row.label),
    score: row.score,
    tone: toneForScore(row.score),
    explanation: priceAction ?? row.explanation,
    copyMode: "context_only_not_pick_changing",
    exactLineEvidenceStatus: evidence.exactLinePriceEvidence?.status ?? "unknown",
    evidenceAsOf: row.evidence_as_of,
    generatedAt: row.generated_at,
    validityStatus: row.validity_status,
    movement,
    consensus,
    sourceSummary: {
      priceAction,
      playbookConsensus: playbookSummary(evidence),
      sharpApiSourceSpecific: sharpApiSourceSummary(evidence),
    },
  };
}
