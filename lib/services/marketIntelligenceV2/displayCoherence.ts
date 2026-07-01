import type { MarketReadV2Dto } from "../../types/domain/MarketIntelligenceV2";

type Direction = "support" | "resistance" | "neutral";

function directionFromSharpMoney(summary: string | null | undefined): Direction {
  const lower = (summary ?? "").toLowerCase();
  if (lower.includes("with our pick")) return "support";
  if (lower.includes("against our pick")) return "resistance";
  return "neutral";
}

function bodyForProjectionLed(read: MarketReadV2Dto | null): string {
  const money = read?.consensus?.moneyPct;
  const bets = read?.consensus?.betsPct;
  if (typeof money === "number" && typeof bets === "number") {
    if (money >= 0.5 && bets >= 0.5) {
      return "Consensus leans our way, but the line has not confirmed the move.";
    }
    if (money < 0.5 && bets < 0.5) {
      return "The model edge is clear, but betting consensus is not fully aligned.";
    }
  }
  return "No clear market move. This pick is driven by the model edge.";
}

export function confirmedSharpMoneyForDisplay(
  summary: string | null | undefined,
  finalDirection: Direction,
): string | null {
  if (!summary) return null;
  const sharpDirection = directionFromSharpMoney(summary);
  if (sharpDirection === "neutral" || finalDirection === "neutral") return null;
  return sharpDirection === finalDirection ? summary : null;
}

export function withConfirmedSharpMoney(
  read: MarketReadV2Dto | null,
  finalDirection: Direction,
): MarketReadV2Dto | null {
  if (!read) return null;
  return {
    ...read,
    sourceSummary: {
      ...read.sourceSummary,
      sharpMoney: confirmedSharpMoneyForDisplay(read.sourceSummary.sharpMoney, finalDirection),
    },
  };
}

export function projectionLedMarketRead(
  read: MarketReadV2Dto | null,
  opts: {
    evidenceAsOf: string | null;
    generatedAt: string;
  },
): MarketReadV2Dto | null {
  if (!read) return null;
  const body = bodyForProjectionLed(read);
  return {
    ...read,
    label: "Projection-Led",
    score: 0,
    tone: "gray",
    explanation: body,
    evidenceAsOf: opts.evidenceAsOf ?? read.evidenceAsOf,
    generatedAt: read.generatedAt ?? opts.generatedAt,
    validityStatus: "valid_nondirectional",
    movement: {
      firstTrackedLine: read.movement?.firstTrackedLine ?? null,
      firstTrackedPrice: read.movement?.firstTrackedPrice ?? null,
      currentLine: read.movement?.currentLine ?? null,
      currentPrice: read.movement?.currentPrice ?? null,
      directionRelativeToPick: "neutral",
      observedAt: opts.evidenceAsOf ?? read.movement?.observedAt ?? null,
    },
    sourceSummary: {
      ...read.sourceSummary,
      priceAction: body,
      sharpMoney: null,
    },
  };
}
