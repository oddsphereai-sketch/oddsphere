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
  source: "ESPN" | "Playbook" | "BALLDONTLIE" | "Conference" | "SportsDataIO";
  sourceLabel: string;
  sourceUrl: string | null;
  /** Provider-declared report date when the source publishes one. */
  reportDate?: string | null;
  /** Previous-day reports remain visible as explicitly stale context. */
  freshnessStatus?: "current" | "previous_day";
  /** Exact-game source rows were present and verified that no player remains reportable. */
  verifiedClear?: boolean;
  /** Exact-player source clearances; omission from a later list is not clearance. */
  playerClearances?: Array<{ teamAbbreviation: string; name: string; reportedAt: string }>;
  /** Original timestamp of a legacy source's explicit whole-game clearance. */
  wholeGameClearanceAt?: string;
  reportUpdatedAt: string | null;
  teams: DailyEdgeTeamAvailability[];
};
