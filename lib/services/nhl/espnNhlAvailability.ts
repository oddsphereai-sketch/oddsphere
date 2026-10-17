import type {
  DailyEdgeAvailabilityPlayer,
  DailyEdgeGameAvailability,
  DailyEdgeTeamAvailability,
} from "@/lib/services/dailyEdge/gameAvailability";
import { normalizeNhlTeamName, type NhlTeamAbbrev } from "@/lib/providers/nhl/_teamNameNormalizer";

export const ESPN_NHL_AVAILABILITY_RELEASE =
  "espn_nhl_availability_2026_10_17_r1_injuries_and_published_goalies" as const;
export const ESPN_NHL_AVAILABILITY_MAX_EVENTS = 20 as const;
export const ESPN_NHL_AVAILABILITY_CONCURRENCY = 4 as const;
export const ESPN_NHL_AVAILABILITY_TIMEOUT_MS = 8_000 as const;

export type NhlPublishedGoalie = {
  team: NhlTeamAbbrev;
  name: string;
  status: "confirmed" | "expected";
};

export type NhlGameAvailability = DailyEdgeGameAvailability & {
  source: "ESPN";
  sourceLabel: "ESPN injuries and starting-goalie report";
  sourceUrl: string;
  publishedGoalies: NhlPublishedGoalie[];
};

type EspnProbable = {
  name?: unknown;
  athlete?: { displayName?: unknown; fullName?: unknown; position?: unknown };
  status?: { type?: unknown; name?: unknown };
};

type EspnCompetitor = {
  homeAway?: unknown;
  team?: { abbreviation?: unknown; displayName?: unknown };
  probables?: unknown;
};

type EspnEvent = {
  id?: unknown;
  competitions?: Array<{ competitors?: EspnCompetitor[] }>;
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
    details?: { type?: unknown; detail?: unknown };
  }>;
};

type ParsedEvent = {
  eventId: string;
  awayTeam: NhlTeamAbbrev;
  homeTeam: NhlTeamAbbrev;
  teamNames: Readonly<Record<NhlTeamAbbrev, string>>;
  publishedGoalies: NhlPublishedGoalie[];
};

const ESPN_NHL_ROOT = "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl";

/**
 * Read-only NHL availability context for the member reader. ESPN publishes
 * injuries in each exact-game summary and marks its probable goalie as either
 * Expected or Confirmed on the date scoreboard. A missing row remains
 * missing; this collector never converts absence into a clean report.
 */
export async function fetchEspnNhlSlateAvailability(
  slateDate: string,
  fetchImpl: typeof fetch = fetch,
): Promise<NhlGameAvailability[] | null> {
  const compactDate = slateDate.replaceAll("-", "");
  if (!/^\d{8}$/.test(compactDate)) return null;

  try {
    const scoreboardResponse = await timedFetch(
      fetchImpl,
      `${ESPN_NHL_ROOT}/scoreboard?dates=${compactDate}`,
    );
    if (!scoreboardResponse.ok || !isJson(scoreboardResponse)) return null;
    const scoreboard = await scoreboardResponse.json() as { events?: unknown };
    if (!Array.isArray(scoreboard.events) || scoreboard.events.length > ESPN_NHL_AVAILABILITY_MAX_EVENTS) {
      return null;
    }
    const events = scoreboard.events
      .map(parseScoreboardEvent)
      .filter((event): event is ParsedEvent => event !== null);

    return await mapWithConcurrency(events, ESPN_NHL_AVAILABILITY_CONCURRENCY, async (event) => {
      let injuryTeams: DailyEdgeTeamAvailability[] = [];
      try {
        const summaryResponse = await timedFetch(
          fetchImpl,
          `${ESPN_NHL_ROOT}/summary?event=${event.eventId}`,
        );
        if (summaryResponse.ok && isJson(summaryResponse)) {
          const summary = await summaryResponse.json() as { injuries?: unknown };
          injuryTeams = parseInjuryGroups(summary.injuries);
        }
      } catch {
        // The published goalie row still makes this a useful exact-game
        // availability report. Missing injuries are not interpreted as clear.
      }

      const teams = ([event.awayTeam, event.homeTeam] as const).map((team) => {
        const injuries = injuryTeams.find((candidate) => candidate.abbreviation === team)?.players ?? [];
        const goalies = event.publishedGoalies
          .filter((goalie) => goalie.team === team)
          .map(goalieAvailabilityPlayer);
        return {
          abbreviation: team,
          teamName: injuryTeams.find((candidate) => candidate.abbreviation === team)?.teamName
            ?? event.teamNames[team]
            ?? team,
          players: [...goalies, ...injuries],
        } satisfies DailyEdgeTeamAvailability;
      });
      const latestUpdate = teams
        .flatMap((team) => team.players.map((player) => player.reportedAt))
        .filter((value): value is string => value !== null)
        .sort((first, second) => Date.parse(second) - Date.parse(first))[0] ?? null;
      return {
        eventId: event.eventId,
        awayTeam: event.awayTeam,
        homeTeam: event.homeTeam,
        source: "ESPN",
        sourceLabel: "ESPN injuries and starting-goalie report",
        sourceUrl: `https://www.espn.com/nhl/game/_/gameId/${event.eventId}`,
        reportUpdatedAt: latestUpdate,
        teams,
        publishedGoalies: event.publishedGoalies,
      } satisfies NhlGameAvailability;
    });
  } catch {
    return null;
  }
}

function parseScoreboardEvent(value: unknown): ParsedEvent | null {
  if (value === null || typeof value !== "object") return null;
  const event = value as EspnEvent;
  const eventId = typeof event.id === "string" ? event.id : null;
  const competitors = event.competitions?.[0]?.competitors ?? [];
  const away = parseCompetitor(competitors.find((candidate) => candidate.homeAway === "away"));
  const home = parseCompetitor(competitors.find((candidate) => candidate.homeAway === "home"));
  if (!eventId || !away || !home || away.team === home.team) return null;
  return {
    eventId,
    awayTeam: away.team,
    homeTeam: home.team,
    teamNames: { [away.team]: away.teamName, [home.team]: home.teamName } as Readonly<Record<NhlTeamAbbrev, string>>,
    publishedGoalies: [...away.publishedGoalies, ...home.publishedGoalies],
  };
}

function parseCompetitor(value: EspnCompetitor | undefined): {
  team: NhlTeamAbbrev;
  teamName: string;
  publishedGoalies: NhlPublishedGoalie[];
} | null {
  const rawAbbreviation = typeof value?.team?.abbreviation === "string" ? value.team.abbreviation : null;
  const team = normalizeNhlTeamName(rawAbbreviation);
  if (!team) return null;
  const teamName = typeof value?.team?.displayName === "string" ? value.team.displayName : team;
  const publishedGoalies = Array.isArray(value?.probables)
    ? value.probables.flatMap((probable): NhlPublishedGoalie[] => {
        if (probable === null || typeof probable !== "object") return [];
        const row = probable as EspnProbable;
        if (row.name !== "probableStartingGoalie") return [];
        const name = typeof row.athlete?.displayName === "string"
          ? row.athlete.displayName
          : typeof row.athlete?.fullName === "string"
            ? row.athlete.fullName
            : null;
        const rawStatus = typeof row.status?.type === "string"
          ? row.status.type.toLowerCase()
          : typeof row.status?.name === "string"
            ? row.status.name.toLowerCase()
            : null;
        if (!name || (rawStatus !== "confirmed" && rawStatus !== "expected")) return [];
        return [{ team, name, status: rawStatus }];
      })
    : [];
  return { team, teamName, publishedGoalies };
}

function parseInjuryGroups(value: unknown): DailyEdgeTeamAvailability[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate): DailyEdgeTeamAvailability[] => {
    if (candidate === null || typeof candidate !== "object") return [];
    const group = candidate as EspnInjuryGroup;
    const rawAbbreviation = typeof group.team?.abbreviation === "string" ? group.team.abbreviation : null;
    const abbreviation = normalizeNhlTeamName(rawAbbreviation);
    if (!abbreviation) return [];
    const teamName = typeof group.team?.displayName === "string" ? group.team.displayName : abbreviation;
    const players = (group.injuries ?? []).flatMap((injury): DailyEdgeAvailabilityPlayer[] => {
      const name = typeof injury.athlete?.displayName === "string"
        ? injury.athlete.displayName
        : typeof injury.athlete?.fullName === "string"
          ? injury.athlete.fullName
          : null;
      if (!name || typeof injury.status !== "string") return [];
      const detailParts = [injury.details?.type, injury.details?.detail]
        .filter((part): part is string => typeof part === "string" && part.trim().length > 0);
      return [{
        name,
        status: injury.status,
        detail: detailParts.join(" · ") || null,
        position: typeof injury.athlete?.position?.abbreviation === "string"
          ? injury.athlete.position.abbreviation
          : typeof injury.athlete?.position?.displayName === "string"
            ? injury.athlete.position.displayName
            : null,
        reportedAt: typeof injury.date === "string" && Number.isFinite(Date.parse(injury.date))
          ? new Date(injury.date).toISOString()
          : null,
      }];
    });
    return [{ abbreviation, teamName, players }];
  });
}

function goalieAvailabilityPlayer(goalie: NhlPublishedGoalie): DailyEdgeAvailabilityPlayer {
  return {
    name: goalie.name,
    status: goalie.status === "confirmed" ? "Confirmed starter" : "Expected starter",
    detail: "Starting goalie",
    position: "G",
    reportedAt: null,
  };
}

async function timedFetch(fetchImpl: typeof fetch, url: string): Promise<Response> {
  return fetchImpl(url, {
    // ESPN's site API rejects non-browser user agents even though this is the
    // same public JSON endpoint used by its web scoreboards.
    headers: { accept: "application/json", "User-Agent": "Mozilla/5.0" },
    cache: "no-store",
    signal: AbortSignal.timeout(ESPN_NHL_AVAILABILITY_TIMEOUT_MS),
  });
}

async function mapWithConcurrency<Input, Output>(
  values: readonly Input[],
  concurrency: number,
  mapper: (value: Input) => Promise<Output>,
): Promise<Output[]> {
  const output = new Array<Output>(values.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < values.length) {
      const index = cursor++;
      output[index] = await mapper(values[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return output;
}

function isJson(response: Response): boolean {
  return (response.headers.get("content-type") ?? "").toLowerCase().includes("json");
}

export const __ESPN_NHL_AVAILABILITY_TEST__ = {
  parseScoreboardEvent,
  parseInjuryGroups,
};
