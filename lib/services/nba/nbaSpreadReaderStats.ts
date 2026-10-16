import type { NbaPointInTimeFeatureRow } from "./nbaPointInTimeFeatures";

export type NbaSpreadReaderTeamStats = {
  adjustedOffense: number | null;
  adjustedDefense: number | null;
  adjustedNetRating: number | null;
};

export type NbaSpreadReaderStats = {
  featureCutoff: string | null;
  away: NbaSpreadReaderTeamStats;
  home: NbaSpreadReaderTeamStats;
};

export type NbaSpreadRatingAssessment = {
  cushion: number;
  status: "support" | "challenge" | "near";
};

/**
 * Compare the selected team's adjusted-net-rating gap with the points it
 * gives or receives. This is reader context, not the professional forecast:
 * the full scorer remains authoritative and the 0.75-point band prevents a
 * tiny simplified difference from being presented as directional evidence.
 */
export function assessNbaNetRatingAgainstSpread(args: {
  awayNetRating: number;
  homeNetRating: number;
  selectedSide: "away" | "home";
  selectedHandicap: number;
}): NbaSpreadRatingAssessment {
  const selectedRatingEdge = args.selectedSide === "away"
    ? args.awayNetRating - args.homeNetRating
    : args.homeNetRating - args.awayNetRating;
  const cushion = selectedRatingEdge + args.selectedHandicap;
  return {
    cushion,
    status: Math.abs(cushion) < 0.75
      ? "near"
      : cushion > 0
        ? "support"
        : "challenge",
  };
}

function finiteFeature(
  row: NbaPointInTimeFeatureRow,
  key: "away_adjusted_offense" | "away_adjusted_defense" | "home_adjusted_offense" | "home_adjusted_defense",
): number | null {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function teamStats(
  adjustedOffense: number | null,
  adjustedDefense: number | null,
): NbaSpreadReaderTeamStats {
  return {
    adjustedOffense,
    adjustedDefense,
    adjustedNetRating: adjustedOffense === null || adjustedDefense === null
      ? null
      : adjustedOffense - adjustedDefense,
  };
}

/**
 * Member-safe explanation inputs for the NBA Spread reader. These are copied
 * from the exact leakage-safe professional feature row used to score the game;
 * this helper never changes the candidate, projection, grade, or market read.
 */
export function buildNbaSpreadReaderStats(
  row: NbaPointInTimeFeatureRow,
): NbaSpreadReaderStats {
  return {
    featureCutoff: row.feature_cutoff,
    away: teamStats(
      finiteFeature(row, "away_adjusted_offense"),
      finiteFeature(row, "away_adjusted_defense"),
    ),
    home: teamStats(
      finiteFeature(row, "home_adjusted_offense"),
      finiteFeature(row, "home_adjusted_defense"),
    ),
  };
}
