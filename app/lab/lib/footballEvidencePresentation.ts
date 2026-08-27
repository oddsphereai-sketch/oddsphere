import type { MarketEdgeDto } from "./labTypes";
import type { DailyEdgeMarketKey as MarketKey } from "./dailyEdgeReaderState";

export const FOOTBALL_PRIMARY_EVIDENCE_LIMIT = 5;

export type FootballEvidenceFocus = {
  eyebrow: string;
  title: string;
  description: string;
};

function footballEvidencePriority(label: string, marketKey: MarketKey): number {
  const priorities = marketKey === "moneyline"
    ? [
        /expected quarterback|starting quarterback/i,
        /epa\/play/i,
        /^(?!.*red-zone).*success rate|early-down/i,
        /team strength/i,
        /weather|injur/i,
        /frozen sample/i,
        /projected winner|expected points/i,
      ]
    : marketKey === "first_inning"
      ? [
          /model scoring margin|current two-sided spread|spread.*line/i,
          /epa\/play/i,
          /line yards|sack rate|trench/i,
          /prior scoring margin/i,
          /team strength/i,
          /explosive/i,
          /expected quarterback|starting quarterback/i,
          /margin range/i,
          /weather|injur/i,
          /frozen sample/i,
        ]
      : [
          /model expected total|current two-sided total/i,
          /offensive plays|pace/i,
          /explosive/i,
          /red-zone/i,
          /scoring profile|pass tendency/i,
          /expected quarterback|starting quarterback/i,
          /weather|injur/i,
          /expected points|total range/i,
          /frozen sample/i,
        ];
  const index = priorities.findIndex((pattern) => pattern.test(label));
  return index === -1 ? priorities.length : index;
}

export function prioritizeFootballEvidenceStats(
  stats: MarketEdgeDto["keyStats"],
  marketKey: MarketKey,
): MarketEdgeDto["keyStats"] {
  return stats
    .map((stat, index) => ({ stat, index, priority: footballEvidencePriority(stat.label, marketKey) }))
    .sort((first, second) => first.priority - second.priority || first.index - second.index)
    .map(({ stat }) => stat);
}

export function footballEvidenceFocus(marketKey: MarketKey): FootballEvidenceFocus {
  if (marketKey === "moneyline") return {
    eyebrow: "Win-probability evidence",
    title: "Which team has the stronger path to win?",
    description: "Quarterback context, opponent-adjusted efficiency and team strength prioritized for the game result.",
  };
  if (marketKey === "first_inning") return {
    eyebrow: "Spread evidence",
    title: "What drives the expected margin?",
    description: "Scoring margin, efficiency and line-of-scrimmage inputs prioritized for the side against the spread.",
  };
  return {
    eyebrow: "Total evidence",
    title: "What shapes the scoring environment?",
    description: "Pace, explosiveness, red-zone performance and scoring profile prioritized for the game total.",
  };
}
