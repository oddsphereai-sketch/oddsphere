import type { MarketEdgeDto } from "@/app/lab/lib/labTypes";
import type {
  MarketSplitDisplaySection,
  SplitSideDisplay,
} from "@/lib/types/domain/RecommendationDecision";

const SPLIT_DISPLAY_ORDER: Record<SplitSideDisplay["side"], number> = {
  away: 0,
  draw: 1,
  home: 2,
  over: 0,
  under: 1,
  yes: 0,
  no: 1,
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

export function splitDirectionalMeasure(signal:SplitSectionSignal):"Money"|"Tickets"|null {
  return signal.direction===null?null:signal.moneyLeader!==null?"Money":"Tickets";
}

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

export function splitLeader(
  section: MarketSplitDisplaySection | null,
  valueKey: "moneyPct" | "betsPct",
): string | null {
  if (!section) return null;
  const rows = section.rows.filter((row) => row[valueKey] !== null && Number.isFinite(row[valueKey]));
  if (!rows.length) return null;
  const maximum = Math.max(...rows.map((row) => row[valueKey]!));
  const leaders = rows.filter((row) => row[valueKey] === maximum);
  // Equal published values carry no directional lead. Provider row order must
  // never turn a tie into money/ticket support for its first participant.
  return leaders.length === 1 ? leaders[0].label : null;
}

export function splitSourceComparison(metric:"Money"|"Tickets",publicLeader:string|null,sharpLeader:string|null,sourceName="Sharp"):string|null {
  if (!publicLeader && !sharpLeader) return null;
  if (publicLeader && sharpLeader) return publicLeader.toLowerCase() === sharpLeader.toLowerCase()
    ? `${metric} agrees on ${publicLeader}` : `${metric}: Public ${publicLeader} · ${sourceName} ${sharpLeader}`;
  return `${metric}: ${publicLeader ? `Public ${publicLeader}` : `${sourceName} ${sharpLeader}`}`;
}

export function splitSourcesConflict(consensus:MarketSplitDisplaySection|null,sharp:MarketSplitDisplaySection|null):boolean {
  const publicSignal=splitSectionSignal(consensus),sharpSignal=splitSectionSignal(sharp);
  const disagrees=(a:string|null,b:string|null)=>a!==null&&b!==null&&a.toLowerCase()!==b.toLowerCase();
  return disagrees(publicSignal.moneyLeader,sharpSignal.moneyLeader)||disagrees(publicSignal.ticketLeader,sharpSignal.ticketLeader);
}

function sideMatchesPick(label: string, pick: string): boolean {
  const normalizedLabel = label.toLowerCase();
  const normalizedPick = pick.toLowerCase();
  return normalizedLabel === normalizedPick || normalizedLabel.includes(normalizedPick) || normalizedPick.includes(normalizedLabel);
}
