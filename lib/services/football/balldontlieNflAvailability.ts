import type {
  DailyEdgeAvailabilityPlayer,
  DailyEdgeGameAvailability,
  DailyEdgeTeamAvailability,
} from "@/lib/services/dailyEdge/gameAvailability";

export type NflAvailabilityMatchup = {
  id: string;
  awayTeam: string;
  homeTeam: string;
  awayTeamId?: number;
  homeTeamId?: number;
};

type BdlNflInjuryRow = {
  player?: {
    first_name?: unknown;
    last_name?: unknown;
    position?: unknown;
    position_abbreviation?: unknown;
    team?: {
      abbreviation?: unknown;
      full_name?: unknown;
    };
  };
  status?: unknown;
  comment?: unknown;
  date?: unknown;
};

type BdlNflInjuryPage = {
  data?: unknown;
  meta?: { next_cursor?: unknown } | null;
};

const NFL_INJURIES_ENDPOINT = "https://api.balldontlie.io/nfl/v1/player_injuries";
const NFL_TEAMS_ENDPOINT = "https://api.balldontlie.io/nfl/v1/teams";
const NFL_INJURIES_DOCS = "https://nfl.balldontlie.io/#player-injuries";
const MAX_PAGES = 4;

/**
 * Read-only NFL availability collector for a stored Daily Edge snapshot.
 *
 * The endpoint is paginated league-wide, so one bounded collection can serve
 * the entire weekly slate. This function must be called by a scheduled or
 * cached server workflow, never once per card, user, or browser render.
 */
export async function fetchBalldontlieNflSlateAvailability(
  matchups: NflAvailabilityMatchup[],
  options: { apiKey?: string; fetchImpl?: typeof fetch } = {},
): Promise<DailyEdgeGameAvailability[] | null> {
  const apiKey = options.apiKey ?? process.env.BALLDONTLIE_API_KEY;
  const fetchImpl = options.fetchImpl ?? fetch;
  if (!apiKey || matchups.length === 0) return null;

  const requestedTeams = new Set(
    matchups.flatMap((matchup) => [matchup.awayTeam, matchup.homeTeam]),
  );

  try {
    const suppliedTeamIds = matchups.flatMap((matchup) => [matchup.awayTeamId, matchup.homeTeamId]);
    const teamIds = suppliedTeamIds.every((value): value is number => Number.isInteger(value))
      ? suppliedTeamIds
      : await fetchNflTeamIds(requestedTeams, apiKey, fetchImpl);
    if (teamIds === null || teamIds.length !== requestedTeams.size) return null;

    const rows: BdlNflInjuryRow[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const params = new URLSearchParams({ per_page: "100" });
      for (const teamId of teamIds) params.append("team_ids[]", String(teamId));
      if (cursor) params.set("cursor", cursor);
      const response = await fetchImpl(`${NFL_INJURIES_ENDPOINT}?${params.toString()}`, {
        headers: { Authorization: apiKey, accept: "application/json" },
      });
      if (!response.ok || !(response.headers.get("content-type") ?? "").toLowerCase().includes("json")) return null;
      const body = await response.json() as BdlNflInjuryPage;
      if (!Array.isArray(body.data)) return null;
      rows.push(...body.data.filter((row): row is BdlNflInjuryRow => row !== null && typeof row === "object"));
      const nextCursor = body.meta?.next_cursor;
      cursor = typeof nextCursor === "string" || typeof nextCursor === "number" ? String(nextCursor) : null;
      if (!cursor) break;
      if (page === MAX_PAGES - 1) return null;
    }

    const teams = normalizeNflInjuryTeams(rows, requestedTeams);
    const teamByAbbreviation = new Map(teams.map((team) => [team.abbreviation, team]));
    const reportUpdatedAt = latestPlayerReportTime(teams);
    return matchups.map((matchup) => ({
      eventId: matchup.id,
      awayTeam: matchup.awayTeam,
      homeTeam: matchup.homeTeam,
      source: "BALLDONTLIE",
      sourceLabel: "BALLDONTLIE NFL injury report",
      sourceUrl: NFL_INJURIES_DOCS,
      reportUpdatedAt,
      teams: [
        teamByAbbreviation.get(matchup.awayTeam) ?? emptyTeam(matchup.awayTeam),
        teamByAbbreviation.get(matchup.homeTeam) ?? emptyTeam(matchup.homeTeam),
      ],
    }));
  } catch {
    return null;
  }
}

async function fetchNflTeamIds(
  requestedTeams: ReadonlySet<string>,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<number[] | null> {
  const response = await fetchImpl(NFL_TEAMS_ENDPOINT, {
    headers: { Authorization: apiKey, accept: "application/json" },
  });
  if (!response.ok || !(response.headers.get("content-type") ?? "").toLowerCase().includes("json")) return null;
  const body = await response.json() as { data?: unknown };
  if (!Array.isArray(body.data)) return null;
  const ids = new Map<string, number>();
  for (const row of body.data) {
    if (row === null || typeof row !== "object") continue;
    const team = row as { id?: unknown; abbreviation?: unknown };
    const abbreviation = stringValue(team.abbreviation)?.toUpperCase() ?? null;
    const id = typeof team.id === "number" && Number.isInteger(team.id) ? team.id : null;
    if (abbreviation && id !== null && requestedTeams.has(abbreviation)) ids.set(abbreviation, id);
  }
  return [...requestedTeams].map((abbreviation) => ids.get(abbreviation) ?? null)
    .filter((id): id is number => id !== null);
}

function normalizeNflInjuryTeams(
  rows: BdlNflInjuryRow[],
  requestedTeams: ReadonlySet<string>,
): DailyEdgeTeamAvailability[] {
  const teams = new Map<string, DailyEdgeTeamAvailability>();
  const playerKeys = new Map<string, Set<string>>();

  for (const row of rows) {
    const abbreviation = stringValue(row.player?.team?.abbreviation)?.toUpperCase() ?? null;
    const firstName = stringValue(row.player?.first_name);
    const lastName = stringValue(row.player?.last_name);
    if (!abbreviation || !requestedTeams.has(abbreviation) || (!firstName && !lastName)) continue;

    const player: DailyEdgeAvailabilityPlayer = {
      name: [firstName, lastName].filter(Boolean).join(" "),
      status: stringValue(row.status) ?? "Status unavailable",
      detail: stringValue(row.comment),
      position: stringValue(row.player?.position_abbreviation) ?? stringValue(row.player?.position),
      reportedAt: isoTimestamp(row.date),
    };
    const team = teams.get(abbreviation) ?? {
      abbreviation,
      teamName: stringValue(row.player?.team?.full_name) ?? abbreviation,
      players: [],
    };
    const dedupeKey = player.name.toLowerCase();
    const seen = playerKeys.get(abbreviation) ?? new Set<string>();
    if (!seen.has(dedupeKey)) {
      team.players.push(player);
      seen.add(dedupeKey);
    }
    teams.set(abbreviation, team);
    playerKeys.set(abbreviation, seen);
  }

  return [...teams.values()].map((team) => ({
    ...team,
    players: [...team.players].sort((first, second) => Date.parse(second.reportedAt ?? "") - Date.parse(first.reportedAt ?? "")),
  }));
}

function emptyTeam(abbreviation: string): DailyEdgeTeamAvailability {
  return { abbreviation, teamName: abbreviation, players: [] };
}

function latestPlayerReportTime(teams: DailyEdgeTeamAvailability[]): string | null {
  return teams
    .flatMap((team) => team.players)
    .map((player) => player.reportedAt)
    .filter((value): value is string => value !== null)
    .sort((first, second) => Date.parse(second) - Date.parse(first))[0] ?? null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isoTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export const __BALLDONTLIE_NFL_AVAILABILITY_TEST__ = {
  normalizeNflInjuryTeams,
};
