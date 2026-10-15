export type DailyEdgeAvailabilityPlayer = {
  name: string;
  status: string;
  detail: string | null;
  position: string | null;
  reportedAt: string | null;
};

export type DailyEdgeTeamAvailability = {
  abbreviation: string;
  teamName: string;
  players: DailyEdgeAvailabilityPlayer[];
};

export type DailyEdgeGameAvailability = {
  eventId: string;
  awayTeam: string;
  homeTeam: string;
  source: "ESPN" | "Playbook" | "BALLDONTLIE" | "Conference";
  sourceLabel: string;
  sourceUrl: string | null;
  /** Provider-declared report date when the source publishes one. */
  reportDate?: string | null;
  /** Previous-day reports remain visible as explicitly stale context. */
  freshnessStatus?: "current" | "previous_day";
  /** Exact-game source rows were present and verified that no player remains reportable. */
  verifiedClear?: boolean;
  reportUpdatedAt: string | null;
  teams: DailyEdgeTeamAvailability[];
};
