import type {
  DailyEdgeAvailabilityPlayer,
  DailyEdgeGameAvailability,
  DailyEdgeTeamAvailability,
} from "@/lib/services/dailyEdge/gameAvailability";

export type WnbaAvailabilityPlayer = DailyEdgeAvailabilityPlayer;
export type WnbaTeamAvailability = DailyEdgeTeamAvailability;
export type WnbaGameAvailability = DailyEdgeGameAvailability & {
  source: "ESPN";
  sourceLabel: "ESPN game availability report";
  sourceUrl: string;
};

type EspnScoreboardEvent = {
  id?: unknown;
  competitions?: Array<{
    competitors?: Array<{
      homeAway?: unknown;
      team?: { abbreviation?: unknown };
    }>;
  }>;
};

type EspnInjuryGroup = {
  team?: { abbreviation?: unknown; displayName?: unknown };
  injuries?: Array<{
    status?: unknown;
    date?: unknown;
    athlete?: {
      displayName?: unknown;
      fullName?: unknown;
      position?: { abbreviation?: unknown; displayName?: unknown };
    };
    details?: { type?: unknown };
  }>;
};

const ESPN_WNBA_ROOT = "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba";

/**
 * Read-only availability context for the private Daily Edge candidate.
 * The function fails closed so an unavailable external report can never be
 * mistaken for a clean bill of health.
 */
export async function fetchEspnWnbaSlateAvailability(
  slateDate: string,
  fetchImpl: typeof fetch = fetch,
): Promise<WnbaGameAvailability[] | null> {
  const compactDate = slateDate.replaceAll("-", "");
  if (!/^\d{8}$/.test(compactDate)) return null;

  try {
    const scoreboardResponse = await fetchImpl(`${ESPN_WNBA_ROOT}/scoreboard?dates=${compactDate}`, {
      headers: { accept: "application/json", "User-Agent": "Mozilla/5.0" },
    });
    if (!scoreboardResponse.ok || !isJson(scoreboardResponse)) return null;
    const scoreboard = await scoreboardResponse.json() as { events?: unknown };
    if (!Array.isArray(scoreboard.events)) return null;

    const events = scoreboard.events
      .map(parseScoreboardEvent)
      .filter((event): event is { eventId: string; awayTeam: string; homeTeam: string } => event !== null);

    const reports: Array<WnbaGameAvailability | null> = await Promise.all(events.map(async (event) => {
      const summaryResponse = await fetchImpl(`${ESPN_WNBA_ROOT}/summary?event=${event.eventId}`, {
        headers: { accept: "application/json", "User-Agent": "Mozilla/5.0" },
      });
      if (!summaryResponse.ok || !isJson(summaryResponse)) return null;
      const summary = await summaryResponse.json() as { injuries?: unknown };
      const teams = parseInjuryGroups(summary.injuries);
      return {
        ...event,
        source: "ESPN" as const,
        sourceLabel: "ESPN game availability report" as const,
        sourceUrl: `https://www.espn.com/wnba/game/_/gameId/${event.eventId}`,
        reportUpdatedAt: null,
        teams,
      } satisfies WnbaGameAvailability;
    }));

    return reports.filter((report): report is WnbaGameAvailability => report !== null);
  } catch {
    return null;
  }
}

function isJson(response: Response): boolean {
  return (response.headers.get("content-type") ?? "").toLowerCase().includes("json");
}

function parseScoreboardEvent(event: unknown): { eventId: string; awayTeam: string; homeTeam: string } | null {
  if (event === null || typeof event !== "object") return null;
  const candidate = event as EspnScoreboardEvent;
  const eventId = typeof candidate.id === "string" ? candidate.id : null;
  const competitors = candidate.competitions?.[0]?.competitors ?? [];
  const away = competitors.find((entry) => entry.homeAway === "away")?.team?.abbreviation;
  const home = competitors.find((entry) => entry.homeAway === "home")?.team?.abbreviation;
  if (eventId === null || typeof away !== "string" || typeof home !== "string") return null;
  return { eventId, awayTeam: away, homeTeam: home };
}

function parseInjuryGroups(value: unknown): WnbaTeamAvailability[] {
  if (!Array.isArray(value)) return [];
  const groups: WnbaTeamAvailability[] = [];
  for (const rawGroup of value) {
    if (rawGroup === null || typeof rawGroup !== "object") continue;
    const group = rawGroup as EspnInjuryGroup;
    const abbreviation = group.team?.abbreviation;
    const teamName = group.team?.displayName;
    if (typeof abbreviation !== "string" || typeof teamName !== "string") continue;
    const players: WnbaAvailabilityPlayer[] = [];
    for (const injury of group.injuries ?? []) {
      const name = injury.athlete?.displayName ?? injury.athlete?.fullName;
      if (typeof name !== "string") continue;
      players.push({
        name,
        status: typeof injury.status === "string" ? injury.status : "Status unavailable",
        detail: typeof injury.details?.type === "string" ? injury.details.type : null,
        position: typeof injury.athlete?.position?.abbreviation === "string"
          ? injury.athlete.position.abbreviation
          : typeof injury.athlete?.position?.displayName === "string"
            ? injury.athlete.position.displayName
            : null,
        reportedAt: typeof injury.date === "string" ? injury.date : null,
      });
    }
    groups.push({ abbreviation, teamName, players });
  }
  return groups;
}

export const __WNBA_AVAILABILITY_TEST__ = { parseScoreboardEvent, parseInjuryGroups };
