import type { Sport } from "@/lib/types/domain/Sport";

export type PlayerPropsLeagueKey = "mlb" | "nfl" | "nba";

export type PlayerPropsLeagueActivity = Readonly<{
  gameCount: number;
  propCount: number;
  checkedAt: string;
}>;

export type PlayerPropsLeagueActivityMap = Partial<
  Record<PlayerPropsLeagueKey, PlayerPropsLeagueActivity>
>;

export type PlayerPropsLeagueDefinition = Readonly<{
  key: Sport;
  label: string;
  href?: string;
}>;

/**
 * Stable product hierarchy. A league with a populated current board moves in
 * front of every empty/coming-soon league, while this order remains stable
 * inside each group. The rail therefore does not jump around by prop count.
 */
export function playerPropsLeagueDefinitions(args: {
  nflEnabled: boolean;
  nbaEnabled: boolean;
  reviewMode?: boolean;
}): PlayerPropsLeagueDefinition[] {
  const reviewMode = args.reviewMode === true;
  return [
    { key: "nfl", label: "NFL", href: args.nflEnabled ? (reviewMode ? "/dev/nfl-props-preview" : "/player-props?league=nfl") : undefined },
    { key: "nba", label: "NBA", href: args.nbaEnabled ? (reviewMode ? "/dev/nba-props-preview" : "/player-props?league=nba") : undefined },
    { key: "mlb", label: "MLB", href: reviewMode ? "/dev/mlb-props-preview" : "/mlb/props" },
    { key: "cfb", label: "CFB" },
    { key: "wnba", label: "WNBA" },
    { key: "cbb", label: "CBB" },
    { key: "nhl", label: "NHL" },
    { key: "soccer", label: "Soccer" },
  ];
}

export function playerPropsLeagueHasActiveBoard(
  activity: PlayerPropsLeagueActivityMap,
  key: Sport,
): boolean {
  const status = activity[key as PlayerPropsLeagueKey];
  return status !== undefined && status.gameCount > 0 && status.propCount > 0;
}

export function orderPlayerPropsLeagueDefinitions(
  definitions: readonly PlayerPropsLeagueDefinition[],
  activity: PlayerPropsLeagueActivityMap,
): PlayerPropsLeagueDefinition[] {
  return definitions
    .map((definition, hierarchyIndex) => ({ definition, hierarchyIndex }))
    .sort((left, right) => {
      const leftActive = playerPropsLeagueHasActiveBoard(activity, left.definition.key);
      const rightActive = playerPropsLeagueHasActiveBoard(activity, right.definition.key);
      if (leftActive !== rightActive) return leftActive ? -1 : 1;
      return left.hierarchyIndex - right.hierarchyIndex;
    })
    .map(({ definition }) => definition);
}

export function preferredPlayerPropsHref(
  activity: PlayerPropsLeagueActivityMap,
  args: { nflEnabled: boolean; nbaEnabled: boolean },
): string {
  const definitions = orderPlayerPropsLeagueDefinitions(
    playerPropsLeagueDefinitions(args),
    activity,
  );
  return definitions.find((definition) =>
    definition.href && playerPropsLeagueHasActiveBoard(activity, definition.key),
  )?.href ?? definitions.find((definition) => definition.href)?.href ?? "/mlb/props";
}
