import type { MarketEdgeDto } from "./labTypes";

export type NflSelectedBetGrade = {
  label: string;
  className: string;
};

export function nflSelectedBetGrade(
  market: Pick<MarketEdgeDto, "held" | "verdict">,
): NflSelectedBetGrade {
  if (market.held) return { label: "Held", className: "text-amber-200" };
  if (market.verdict.key === "lean") return { label: "Lean", className: "text-sky-300" };
  if (market.verdict.key === "watchlist") return { label: "Watchlist", className: "text-amber-300" };
  if (market.verdict.key === "no_play") return { label: "No Play", className: "text-gray-400" };
  return { label: market.verdict.label, className: "text-gray-400" };
}
