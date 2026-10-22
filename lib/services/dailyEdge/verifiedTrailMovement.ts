export type VerifiedTrailMovementDirection = "support" | "resistance" | "neutral";

type TrailStop = {
  american?: number | null;
  line?: number | null;
  observedAt?: string | null;
  sportsbook?: string | null;
};

function impliedProbability(american: number): number {
  return american > 0
    ? 100 / (american + 100)
    : Math.abs(american) / (Math.abs(american) + 100);
}

function normalizedBook(value: string | null | undefined): string {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Resolve movement relative to the displayed pick from the exact same-book
 * trail shown to members. A material line move owns the read; price movement
 * is used only when the line is unchanged. Invalid, cross-book, inverted, or
 * one-point trails fail neutral instead of inventing a signal.
 */
export function verifiedTrailMovementDirection(args: {
  market: "moneyline" | "spread" | "total";
  pick: string | null | undefined;
  trail: TrailStop[] | null | undefined;
}): VerifiedTrailMovementDirection {
  const trail = Array.isArray(args.trail) ? args.trail : [];
  if (trail.length < 2) return "neutral";
  const first = trail[0]!;
  const current = trail[trail.length - 1]!;
  const firstAt = Date.parse(first.observedAt ?? "");
  const currentAt = Date.parse(current.observedAt ?? "");
  const firstBook = normalizedBook(first.sportsbook);
  const currentBook = normalizedBook(current.sportsbook);
  if (
    !Number.isFinite(firstAt) || !Number.isFinite(currentAt) || firstAt > currentAt ||
    !firstBook || !currentBook || firstBook !== currentBook
  ) return "neutral";

  const firstLine = typeof first.line === "number" && Number.isFinite(first.line) ? first.line : null;
  const currentLine = typeof current.line === "number" && Number.isFinite(current.line) ? current.line : null;
  if (firstLine !== null && currentLine !== null && Math.abs(currentLine - firstLine) >= 0.01) {
    if (args.market === "spread") return currentLine < firstLine ? "support" : "resistance";
    if (args.market === "total") {
      const pick = String(args.pick ?? "").trim().toLowerCase();
      if (pick.startsWith("over")) return currentLine > firstLine ? "support" : "resistance";
      if (pick.startsWith("under")) return currentLine < firstLine ? "support" : "resistance";
      return "neutral";
    }
  }

  const firstPrice = typeof first.american === "number" && Number.isFinite(first.american) ? first.american : null;
  const currentPrice = typeof current.american === "number" && Number.isFinite(current.american) ? current.american : null;
  if (firstPrice === null || currentPrice === null) return "neutral";
  const delta = impliedProbability(currentPrice) - impliedProbability(firstPrice);
  return delta >= 0.01 ? "support" : delta <= -0.01 ? "resistance" : "neutral";
}
