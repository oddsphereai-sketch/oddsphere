import type { MarketEdgeDto } from "@/app/lab/lib/labTypes";
import type {
  MarketSplitDisplaySection,
  SplitSideDisplay,
} from "@/lib/types/domain/RecommendationDecision";

const SPLIT_DISPLAY_ORDER: Record<SplitSideDisplay["side"], number> = {
  away: 0,
  home: 1,
  over: 0,
  under: 1,
};

/**
 * Keep every split source in the same visual order regardless of the order
 * returned by its provider: away above home for team markets, Over above
 * Under for totals. This is presentation-only and never mutates evidence.
 */
export function canonicalSplitRows(
  section: MarketSplitDisplaySection | null,
): SplitSideDisplay[] {
  if (!section) return [];
  return section.rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) =>
      SPLIT_DISPLAY_ORDER[a.row.side] - SPLIT_DISPLAY_ORDER[b.row.side] ||
      a.index - b.index
    )
    .map(({ row }) => row);
}

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

export type SplitSectionSignal = {
  direction: string | null;
  moneyLeader: string | null;
  ticketLeader: string | null;
  internallySplit: boolean;
};

export function splitSectionSignal(section: MarketSplitDisplaySection | null): SplitSectionSignal {
  const moneyLeader = splitLeader(section, "moneyPct");
  const ticketLeader = splitLeader(section, "betsPct");
  const internallySplit =
    moneyLeader !== null &&
    ticketLeader !== null &&
    moneyLeader.toLowerCase() !== ticketLeader.toLowerCase();
  return {
    direction: internallySplit ? null : moneyLeader ?? ticketLeader,
    moneyLeader,
    ticketLeader,
    internallySplit,
  };
}

function splitLeader(
  section: MarketSplitDisplaySection | null,
  valueKey: "moneyPct" | "betsPct",
): string | null {
  if (!section) return null;
  return section.rows
    .filter((row) => row[valueKey] !== null)
    .sort((a, b) => (b[valueKey] ?? 0) - (a[valueKey] ?? 0))[0]?.label ?? null;
}

function sideMatchesPick(label: string, pick: string): boolean {
  const normalizedLabel = label.toLowerCase();
  const normalizedPick = pick.toLowerCase();
  return normalizedLabel === normalizedPick || normalizedLabel.includes(normalizedPick) || normalizedPick.includes(normalizedLabel);
}
