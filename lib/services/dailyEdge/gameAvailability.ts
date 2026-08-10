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
  source: "ESPN" | "Playbook";
  sourceLabel: string;
  sourceUrl: string | null;
  reportUpdatedAt: string | null;
  teams: DailyEdgeTeamAvailability[];
};
