import { canonicalCbbTeamName } from "./dataset";

export const CBB_SHARP_SPLIT_MAPPING_RELEASE =
  "cbb_sharp_split_mapping_2026_10_30_r1_exact_institution_neutral_orientation" as const;

export type CbbSplitTeamIdentity = {
  homeTeamDisplayName?: string | null;
  awayTeamDisplayName?: string | null;
  cbbHomeCollege?: string | null;
  cbbAwayCollege?: string | null;
};

function names(college: string | null | undefined, fullName: string | null | undefined): Set<string> {
  return new Set([college, fullName]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map(canonicalCbbTeamName));
}

/** Exact institutional/full-name identity; nickname and abbreviation alone never authorize a join. */
export function cbbSplitTeamMatches(
  sourceName: string,
  game: CbbSplitTeamIdentity,
  side: "home" | "away",
): boolean {
  const normalized = canonicalCbbTeamName(sourceName.replace(/^\s*(?:\(\d+\)|#\d+)\s*/, ""));
  if (!normalized) return false;
  return side === "home"
    ? names(game.cbbHomeCollege, game.homeTeamDisplayName).has(normalized)
    : names(game.cbbAwayCollege, game.awayTeamDisplayName).has(normalized);
}

/** Neutral-site feeds may reverse home/away. Reject a pair that fits both orientations. */
export function cbbSplitOrientation(
  sourceAway: string,
  sourceHome: string,
  game: CbbSplitTeamIdentity,
): "direct" | "reversed" | null {
  const direct = cbbSplitTeamMatches(sourceAway, game, "away") &&
    cbbSplitTeamMatches(sourceHome, game, "home");
  const reversed = cbbSplitTeamMatches(sourceAway, game, "home") &&
    cbbSplitTeamMatches(sourceHome, game, "away");
  return direct === reversed ? null : direct ? "direct" : "reversed";
}
