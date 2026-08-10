import type { MarketEdgeDto } from "@/app/lab/lib/labTypes";
import type { MarketSplitDisplaySection } from "@/lib/types/domain/RecommendationDecision";

export function displayedConsensusSection(
  market: Pick<MarketEdgeDto, "publicSplits" | "recommendationDecision">,
): MarketSplitDisplaySection | null {
  if (market.publicSplits.length > 0) {
    const lastUpdated = market.publicSplits
      .map((row) => row.observedAt)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
    return { label: "Consensus Splits", rows: market.publicSplits, signal: null, lastUpdated };
  }
  return market.recommendationDecision?.consensusSplits ?? null;
}

export function splitLeanStrength(
  section: MarketSplitDisplaySection | null,
  pick: string,
): "slight" | "meaningful" {
  if (!section) return "slight";
  const row = section.rows.find((candidate) => sideMatchesPick(candidate.label, pick));
  if (!row) return "slight";
  const values = [row.moneyPct, row.betsPct].filter((value): value is number => value !== null);
  if (values.length === 0) return "slight";
  // A bare majority is directionally descriptive, not meaningful support.
  // Require at least one measure to clear 55/45 before coloring the pulse.
  return values.some((value) => value >= 55 || value <= 45) ? "meaningful" : "slight";
}

function sideMatchesPick(label: string, pick: string): boolean {
  const normalizedLabel = label.toLowerCase();
  const normalizedPick = pick.toLowerCase();
  return normalizedLabel === normalizedPick || normalizedLabel.includes(normalizedPick) || normalizedPick.includes(normalizedLabel);
}
