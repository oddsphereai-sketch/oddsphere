import type { PlayerPropPreviewRow } from "@/app/mlb/props/components/PlayerPropsDashboard";

type BestPriceComparableRow = Pick<PlayerPropPreviewRow, "odds" | "playGrade" | "lastUpdated">;

export function shouldReplaceBestPriceRow(
  current: BestPriceComparableRow,
  candidate: BestPriceComparableRow,
): boolean {
  if (candidate.odds !== current.odds) return candidate.odds > current.odds;
  const signalDifference = propGradeRank(candidate.playGrade) - propGradeRank(current.playGrade);
  if (signalDifference !== 0) return signalDifference > 0;
  return candidate.lastUpdated > current.lastUpdated;
}

function propGradeRank(grade: PlayerPropPreviewRow["playGrade"]): number {
  if (grade === "BEST_ANGLE") return 5;
  if (grade === "LEAN") return 4;
  if (grade === "WATCHLIST") return 3;
  if (grade === "NO_PLAY") return 2;
  if (grade === "PENDING_DATA") return 1;
  return 0;
}
