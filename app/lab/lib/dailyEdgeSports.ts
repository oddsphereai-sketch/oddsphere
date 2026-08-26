import type { Sport } from "@/lib/types/domain/Sport";

export type DailyEdgeSportDefinition = {
  key: Sport;
  label: string;
  memberAvailable: boolean;
  inSeason?: boolean;
};

/**
 * One presentation/readiness registry for every Daily Edge surface.
 * This controls navigation and honest availability labels only; it does not
 * enable a writer, prediction model, tracking scope, or publication job.
 */
export const DAILY_EDGE_SPORTS: readonly DailyEdgeSportDefinition[] = [
  { key: "mlb", label: "MLB", memberAvailable: true, inSeason: true },
  { key: "wnba", label: "WNBA", memberAvailable: true, inSeason: true },
  { key: "soccer", label: "Soccer", memberAvailable: true, inSeason: true },
  { key: "nfl", label: "NFL", memberAvailable: true, inSeason: true },
  { key: "cfb", label: "CFB", memberAvailable: true, inSeason: true },
  { key: "nba", label: "NBA", memberAvailable: true, inSeason: false },
  { key: "nhl", label: "NHL", memberAvailable: true, inSeason: false },
  { key: "cbb", label: "CBB", memberAvailable: false },
  { key: "ucl", label: "UCL", memberAvailable: true, inSeason: false },
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

export const AVAILABLE_DAILY_EDGE_SPORTS: Sport[] = DAILY_EDGE_SPORTS
  .filter((definition) => definition.memberAvailable)
  .map((definition) => definition.key);

export const DAILY_EDGE_SPORT_AVAILABILITY: Partial<
  Record<Sport, { isLive: boolean; comingSoonLabel?: string; statusLabel?: string }>
> = Object.fromEntries(
  DAILY_EDGE_SPORTS.map((definition) => [
    definition.key,
    {
      isLive: definition.memberAvailable,
      comingSoonLabel: definition.memberAvailable ? undefined : "Coming soon",
      statusLabel: definition.memberAvailable
        ? definition.inSeason
          ? "Active"
          : "No games today"
        : undefined,
    },
  ]),
);
