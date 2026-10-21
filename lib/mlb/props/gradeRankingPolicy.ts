import type { PlayerPropPreviewRow } from "@/app/mlb/props/components/PlayerPropsDashboard";
import { MLB_PROPS_BEST_ANGLE_PRICE_FLOOR } from "./priceConfidencePolicy";

export const MLB_PROPS_GRADE_RANKING_RELEASE =
  "mlb_props_grade_ranking_2026_10_21_r1_release_pure_market_lanes" as const;

const RUNS_SCORED_UNDER_PROMOTION_REASON =
  "VALIDATED_RUNS_SCORED_UNDER_BEST_ANGLE" as const;
const RETAINED_ACTION_RERANK_REASON =
  "VALIDATED_RELEASE_PURE_GRADE_RERANK" as const;

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * Rerank already-actionable future rows without changing the selected side,
 * forecast, economics, or stake. Immutable locks always retain their stored
 * grade and evidence exactly.
 */
export function applyMlbPropsReleasePureGradeRanking(
  rows: readonly PlayerPropPreviewRow[],
): PlayerPropPreviewRow[] {
  return rows.map((row) => {
    if (row.lockStatus?.status === "locked") return row;

    const promoteRunsScoredUnder = row.playGrade === "LEAN"
      && row.market === "batter_runs_scored"
      && row.side === "under"
      && row.offerContract !== "milestone"
      && row.odds >= MLB_PROPS_BEST_ANGLE_PRICE_FLOOR;
    if (promoteRunsScoredUnder) {
      return {
        ...row,
        playGrade: "BEST_ANGLE",
        reasonCodes: uniqueStrings([
          ...row.reasonCodes,
          RUNS_SCORED_UNDER_PROMOTION_REASON,
        ]),
      };
    }

    const rerankHrrUnder = row.playGrade === "BEST_ANGLE"
      && row.market === "batter_hits_runs_rbis"
      && row.side === "under";
    const rerankPitcherStrikeoutsOver = row.playGrade === "BEST_ANGLE"
      && row.market === "pitcher_strikeouts"
      && row.side === "over";
    if (!rerankHrrUnder && !rerankPitcherStrikeoutsOver) return row;
    return {
      ...row,
      playGrade: "LEAN",
      reasonCodes: uniqueStrings([
        ...row.reasonCodes,
        RETAINED_ACTION_RERANK_REASON,
      ]),
    };
  });
}
