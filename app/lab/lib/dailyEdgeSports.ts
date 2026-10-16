import type { Sport } from "@/lib/types/domain/Sport";

export type DailyEdgeSportDefinition = {
  key: Sport;
  label: string;
  navigationTier: "flagship" | "core" | "specialist" | "planned";
  memberAvailable: boolean;
  inSeason?: boolean;
  /** Official fixtures are visible while analyzed model cards remain closed. */
  scheduleLive?: boolean;
};

export type DailyEdgeSportAvailability = {
  isLive: boolean;
  comingSoonLabel?: string;
  statusLabel?: string;
};

export type DailyEdgeSportActivity = {
  gameCount: number;
  checkedAt: string;
};

export type DailyEdgeSportActivityMap = Partial<Record<Sport, DailyEdgeSportActivity>>;

const NHL_2026_REGULAR_SEASON_START_MS = Date.parse("2026-09-29T04:00:00.000Z");
const NBA_2026_MEMBER_BOARD_START_MS = Date.parse("2026-10-14T04:00:00.000Z");

/**
 * One presentation/readiness registry for every Daily Edge surface.
 * This controls navigation and honest availability labels only; it does not
 * enable a writer, prediction model, tracking scope, or publication job.
 */
export const DAILY_EDGE_SPORTS: readonly DailyEdgeSportDefinition[] = [
  { key: "nfl", label: "NFL", navigationTier: "flagship", memberAvailable: true, inSeason: true },
  { key: "cfb", label: "CFB", navigationTier: "flagship", memberAvailable: true, inSeason: true },
  {
    key: "nba",
    label: "NBA",
    navigationTier: "flagship",
    memberAvailable: true,
    inSeason: Date.now() >= NBA_2026_MEMBER_BOARD_START_MS,
  },
  { key: "cbb", label: "CBB", navigationTier: "flagship", memberAvailable: false },
  { key: "nhl", label: "NHL", navigationTier: "core", memberAvailable: true, inSeason: Date.now() >= NHL_2026_REGULAR_SEASON_START_MS },
  { key: "mlb", label: "MLB", navigationTier: "core", memberAvailable: true, inSeason: true },
  { key: "soccer", label: "Soccer", navigationTier: "core", memberAvailable: true, inSeason: true },
  { key: "wnba", label: "WNBA", navigationTier: "specialist", memberAvailable: true, inSeason: true },
  { key: "ucl", label: "UCL", navigationTier: "planned", memberAvailable: false, inSeason: false },
] as const;

export const DAILY_EDGE_SPORT_KEYS: Sport[] = DAILY_EDGE_SPORTS.map(
  (definition) => definition.key,
);

/** Member navigation groups every soccer competition beneath one Soccer tab.
 * The legacy `ucl` sport key remains available to data adapters and old URLs,
 * but must not compete with Soccer in the top-level selector. */
export const DAILY_EDGE_TOP_LEVEL_SPORT_KEYS: Sport[] = DAILY_EDGE_SPORT_KEYS.filter(
  (sport) => sport !== "ucl",
);

/** In-season member models that must remain simultaneously reachable in a
 * constrained reader header. Offseason and coming-soon sports stay available
 * in the full board selector. */
export const ACTIVE_DAILY_EDGE_TOP_LEVEL_SPORT_KEYS: Sport[] = DAILY_EDGE_SPORTS
  .filter((definition) => definition.key !== "ucl" && definition.memberAvailable && definition.inSeason)
  .map((definition) => definition.key);

export const ACTIVE_DAILY_EDGE_TOP_LEVEL_SPORT_LABELS: string[] = DAILY_EDGE_SPORTS
  .filter((definition) => definition.key !== "ucl" && definition.memberAvailable && definition.inSeason)
  .map((definition) => definition.label);

export const AVAILABLE_DAILY_EDGE_SPORTS: Sport[] = DAILY_EDGE_SPORTS
  .filter((definition) => definition.memberAvailable)
  .map((definition) => definition.key);

export const DAILY_EDGE_SPORT_AVAILABILITY: Partial<
  Record<Sport, DailyEdgeSportAvailability>
> = Object.fromEntries(
  DAILY_EDGE_SPORTS.map((definition) => [
    definition.key,
    {
      isLive: definition.memberAvailable,
      comingSoonLabel: definition.memberAvailable ? undefined : "Coming soon",
      statusLabel: definition.memberAvailable
        ? definition.inSeason
          ? "In season"
          : definition.scheduleLive
            ? "Schedule live"
          : "Offseason"
        : undefined,
    },
  ]),
);

const DAILY_EDGE_STATUS_PRIORITY: Record<string, number> = {
  Active: 0,
  "In season": 1,
  "Schedule live": 2,
  "No games today": 3,
  Offseason: 4,
};

const DAILY_EDGE_NAVIGATION_TIER_PRIORITY: Record<DailyEdgeSportDefinition["navigationTier"], number> = {
  flagship: 0,
  core: 1,
  specialist: 2,
  planned: 3,
};

const DAILY_EDGE_DEFINITION_BY_SPORT = new Map(
  DAILY_EDGE_SPORTS.map((definition) => [definition.key, definition] as const),
);

/**
 * Product hierarchy is the primary contract: an active specialist model must
 * not jump ahead of a flagship model. The flagship sequence deliberately keeps
 * each professional league beside its college counterpart (NFL/CFB, NBA/CBB).
 * Activity orders the core tier, so a live core board leads an empty core board
 * without turning the entire selector into a volatile game-count ranking.
 */
export function orderDailyEdgeSportKeys(
  sports: readonly Sport[],
  availability: Partial<Record<Sport, DailyEdgeSportAvailability>> = DAILY_EDGE_SPORT_AVAILABILITY,
): Sport[] {
  return sports
    .map((sport, registryIndex) => ({ sport, registryIndex }))
    .sort((left, right) => {
      const leftDefinition = DAILY_EDGE_DEFINITION_BY_SPORT.get(left.sport);
      const rightDefinition = DAILY_EDGE_DEFINITION_BY_SPORT.get(right.sport);
      const leftNavigationTier = leftDefinition
        ? DAILY_EDGE_NAVIGATION_TIER_PRIORITY[leftDefinition.navigationTier]
        : DAILY_EDGE_NAVIGATION_TIER_PRIORITY.planned;
      const rightNavigationTier = rightDefinition
        ? DAILY_EDGE_NAVIGATION_TIER_PRIORITY[rightDefinition.navigationTier]
        : DAILY_EDGE_NAVIGATION_TIER_PRIORITY.planned;
      if (leftNavigationTier !== rightNavigationTier) return leftNavigationTier - rightNavigationTier;
      if (leftDefinition?.navigationTier === "flagship" && rightDefinition?.navigationTier === "flagship") {
        return left.registryIndex - right.registryIndex;
      }
      const leftAvailability = availability[left.sport];
      const rightAvailability = availability[right.sport];
      const leftTier = leftAvailability?.isLive === false
        ? 5
        : DAILY_EDGE_STATUS_PRIORITY[leftAvailability?.statusLabel ?? ""] ?? 2;
      const rightTier = rightAvailability?.isLive === false
        ? 5
        : DAILY_EDGE_STATUS_PRIORITY[rightAvailability?.statusLabel ?? ""] ?? 2;
      return leftTier - rightTier || left.registryIndex - right.registryIndex;
    })
    .map(({ sport }) => sport);
}
