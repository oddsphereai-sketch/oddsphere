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

type BdlNflPracticeReport = {
  date?: unknown;
  status?: unknown;
};

type BdlNflDesignationRow = {
  game_id?: unknown;
  player?: {
    first_name?: unknown;
    last_name?: unknown;
    position?: unknown;
    position_abbreviation?: unknown;
  };
  team?: {
    abbreviation?: unknown;
    full_name?: unknown;
  };
  practice_reports?: unknown;
  injury?: unknown;
  game_status?: unknown;
  active?: unknown;
  did_not_play?: unknown;
  updated_at?: unknown;
};

const NFL_INJURIES_ENDPOINT = "https://api.balldontlie.io/nfl/v1/player_injuries";
const NFL_DESIGNATIONS_ENDPOINT = "https://api.balldontlie.io/nfl/v1/player_designations";
const NFL_TEAMS_ENDPOINT = "https://api.balldontlie.io/nfl/v1/teams";
const NFL_INJURIES_DOCS = "https://nfl.balldontlie.io/#player-designations";
// A full 32-team regular-season slate currently exceeds four 100-row pages
// (Week 2, 2026 returned 488 rows). Keep the request bounded, but do not turn
// a valid fifth page into a slate-wide "injuries unavailable" result.
export const NFL_INJURY_MAX_PAGES = 8;
export const NFL_DESIGNATION_TEAM_BATCH_SIZE = 8;
export const NFL_DESIGNATION_MAX_PAGES_PER_BATCH = 8;

export function nflAvailabilityRequestBudgetMaximum(matchups: NflAvailabilityMatchup[]): number {
  const teamCount = new Set(matchups.flatMap((matchup) => [matchup.awayTeam, matchup.homeTeam])).size;
  const batches = Math.ceil(teamCount / NFL_DESIGNATION_TEAM_BATCH_SIZE);
  return batches * (NFL_DESIGNATION_MAX_PAGES_PER_BATCH + NFL_INJURY_MAX_PAGES);
}

/**
 * Read-only NFL availability collector for a stored Daily Edge snapshot.
 *
 * The endpoint is paginated league-wide, so one bounded collection can serve
 * the entire weekly slate. This function must be called by a scheduled or
 * cached server workflow, never once per card, user, or browser render.
 */
export async function fetchBalldontlieNflSlateAvailability(
  matchups: NflAvailabilityMatchup[],
  options: {
    apiKey?: string;
    fetchImpl?: typeof fetch;
    season?: number;
    week?: number;
    seasonType?: 1 | 2 | 3;
  } = {},
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

    if (validDesignationScope(options)) {
      const designationRows = await fetchDesignationRows({
        apiKey,
        fetchImpl,
        teamIds,
        season: options.season,
        week: options.week,
        seasonType: options.seasonType,
      });
      if (designationRows !== null) {
        const normalized = normalizeNflDesignationGames(designationRows, matchups);
        if (normalized !== null) return normalized;
      }
    }

    const rows = await fetchLegacyInjuryRows({ apiKey, fetchImpl, teamIds });
    if (rows === null) return null;
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

function validDesignationScope(options: {
  season?: number;
  week?: number;
  seasonType?: 1 | 2 | 3;
}): options is { season: number; week: number; seasonType: 1 | 2 | 3 } {
  return typeof options.season === "number" && Number.isInteger(options.season) &&
    typeof options.week === "number" && Number.isInteger(options.week) && options.week > 0 &&
    (options.seasonType === 1 || options.seasonType === 2 || options.seasonType === 3);
}

async function fetchDesignationRows(args: {
  apiKey: string;
  fetchImpl: typeof fetch;
  teamIds: number[];
  season: number;
  week: number;
  seasonType: 1 | 2 | 3;
}): Promise<BdlNflDesignationRow[] | null> {
  const batches = chunk(args.teamIds, NFL_DESIGNATION_TEAM_BATCH_SIZE);
  const results = await Promise.all(batches.map(async (teamIds) => {
    const rows: BdlNflDesignationRow[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < NFL_DESIGNATION_MAX_PAGES_PER_BATCH; page += 1) {
      const params = new URLSearchParams({
        season: String(args.season),
        week: String(args.week),
        per_page: "100",
      });
      params.append("season_types[]", String(args.seasonType));
      for (const teamId of teamIds) params.append("team_ids[]", String(teamId));
      if (cursor) params.set("cursor", cursor);
      const body = await fetchJsonPage(`${NFL_DESIGNATIONS_ENDPOINT}?${params.toString()}`, args.apiKey, args.fetchImpl);
      if (body === null) return null;
      rows.push(...body.data.filter((row): row is BdlNflDesignationRow => row !== null && typeof row === "object"));
      cursor = pageCursor(body.meta);
      if (!cursor) return rows;
    }
    return null;
  }));
  if (results.some((rows) => rows === null)) return null;
  return results.flatMap((rows) => rows ?? []);
}

async function fetchLegacyInjuryRows(args: {
  apiKey: string;
  fetchImpl: typeof fetch;
  teamIds: number[];
}): Promise<BdlNflInjuryRow[] | null> {
  const batches = chunk(args.teamIds, NFL_DESIGNATION_TEAM_BATCH_SIZE);
  const results = await Promise.all(batches.map(async (teamIds) => {
    const rows: BdlNflInjuryRow[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < NFL_INJURY_MAX_PAGES; page += 1) {
      const params = new URLSearchParams({ per_page: "100" });
      for (const teamId of teamIds) params.append("team_ids[]", String(teamId));
      if (cursor) params.set("cursor", cursor);
      const body = await fetchJsonPage(`${NFL_INJURIES_ENDPOINT}?${params.toString()}`, args.apiKey, args.fetchImpl);
      if (body === null) return null;
      rows.push(...body.data.filter((row): row is BdlNflInjuryRow => row !== null && typeof row === "object"));
      cursor = pageCursor(body.meta);
      if (!cursor) return rows;
    }
    return null;
  }));
  if (results.some((rows) => rows === null)) return null;
  return results.flatMap((rows) => rows ?? []);
}

async function fetchJsonPage(
  url: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<{ data: unknown[]; meta?: { next_cursor?: unknown } | null } | null> {
  const response = await fetchImpl(url, {
    headers: { Authorization: apiKey, accept: "application/json" },
  });
  if (!response.ok || !(response.headers.get("content-type") ?? "").toLowerCase().includes("json")) return null;
  const body = await response.json() as BdlNflInjuryPage;
  return Array.isArray(body.data) ? { data: body.data, meta: body.meta } : null;
}

function pageCursor(meta: { next_cursor?: unknown } | null | undefined): string | null {
  const nextCursor = meta?.next_cursor;
  return typeof nextCursor === "string" || typeof nextCursor === "number" ? String(nextCursor) : null;
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}

function normalizeNflDesignationGames(
  rows: BdlNflDesignationRow[],
  matchups: NflAvailabilityMatchup[],
): DailyEdgeGameAvailability[] | null {
  const matchupsByGame = new Map(matchups.map((matchup) => [providerGameId(matchup.id), matchup]));
  const rowsByGame = new Map<string, BdlNflDesignationRow[]>();
  for (const row of rows) {
    const gameId = integerString(row.game_id);
    const abbreviation = stringValue(row.team?.abbreviation)?.toUpperCase() ?? null;
    const matchup = gameId ? matchupsByGame.get(gameId) : null;
    if (!gameId || !matchup || !abbreviation ||
      (abbreviation !== matchup.awayTeam && abbreviation !== matchup.homeTeam)) continue;
    const gameRows = rowsByGame.get(gameId) ?? [];
    gameRows.push(row);
    rowsByGame.set(gameId, gameRows);
  }

  const output: DailyEdgeGameAvailability[] = [];
  for (const matchup of matchups) {
    const gameRows = rowsByGame.get(providerGameId(matchup.id)) ?? [];
    const representedTeams = new Set(gameRows
      .map((row) => stringValue(row.team?.abbreviation)?.toUpperCase() ?? null)
      .filter((value): value is string => value !== null));
    if (!representedTeams.has(matchup.awayTeam) || !representedTeams.has(matchup.homeTeam)) return null;
    const teams = [matchup.awayTeam, matchup.homeTeam].map((abbreviation) => {
      const teamRows = gameRows.filter((row) => stringValue(row.team?.abbreviation)?.toUpperCase() === abbreviation);
      const players = teamRows.map(normalizeNflDesignationPlayer)
        .filter((player): player is DailyEdgeAvailabilityPlayer => player !== null)
        .sort((first, second) => reportTime(second) - reportTime(first));
      return {
        abbreviation,
        teamName: teamRows.map((row) => stringValue(row.team?.full_name)).find(Boolean) ?? abbreviation,
        players,
      };
    });
    output.push({
      eventId: matchup.id,
      awayTeam: matchup.awayTeam,
      homeTeam: matchup.homeTeam,
      source: "BALLDONTLIE",
      sourceLabel: "BALLDONTLIE NFL injury report",
      sourceUrl: NFL_INJURIES_DOCS,
      reportUpdatedAt: latestTimestamp(gameRows.map((row) => isoTimestamp(row.updated_at))),
      teams,
    });
  }
  return output;
}

function providerGameId(eventId: string): string {
  return eventId.startsWith("nfl-") ? eventId.slice(4) : eventId;
}

function normalizeNflDesignationPlayer(row: BdlNflDesignationRow): DailyEdgeAvailabilityPlayer | null {
  const firstName = stringValue(row.player?.first_name);
  const lastName = stringValue(row.player?.last_name);
  if (!firstName && !lastName) return null;
  const practiceReports = Array.isArray(row.practice_reports)
    ? row.practice_reports.filter((report): report is BdlNflPracticeReport => report !== null && typeof report === "object")
    : [];
  const latestPractice = [...practiceReports]
    .filter((report) => isoDate(report.date) !== null && stringValue(report.status) !== null)
    .sort((first, second) => String(second.date).localeCompare(String(first.date)))[0] ?? null;
  const gameStatus = stringValue(row.game_status);
  const injury = stringValue(row.injury);
  const practiceStatus = stringValue(latestPractice?.status);
  const status = gameStatus
    ? titleCaseStatus(gameStatus)
    : row.active === false
      ? "Inactive"
      : row.did_not_play === true
        ? "Did Not Play"
        : practiceStatus && practiceStatus.toLowerCase() !== "full"
          ? titleCaseStatus(practiceStatus)
          : injury
            ? "Status unavailable"
            : null;
  if (status === null) return null;
  return {
    name: [firstName, lastName].filter(Boolean).join(" "),
    status,
    detail: injury,
    position: stringValue(row.player?.position_abbreviation) ?? stringValue(row.player?.position),
    reportedAt: isoTimestamp(row.updated_at),
  };
}

function titleCaseStatus(value: string): string {
  return value.split(/[_\s]+/).filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(" ");
}

function integerString(value: unknown): string | null {
  return typeof value === "number" && Number.isInteger(value)
    ? String(value)
    : typeof value === "string" && /^\d+$/.test(value)
      ? value
      : null;
}

function isoDate(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function latestTimestamp(values: Array<string | null>): string | null {
  return values.filter((value): value is string => value !== null)
    .sort((first, second) => Date.parse(second) - Date.parse(first))[0] ?? null;
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
  const teams = new Map<string, Omit<DailyEdgeTeamAvailability, "players"> & {
    playersByKey: Map<string, DailyEdgeAvailabilityPlayer>;
  }>();

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
      playersByKey: new Map<string, DailyEdgeAvailabilityPlayer>(),
    };
    const dedupeKey = player.name.toLowerCase();
    const incumbent = team.playersByKey.get(dedupeKey);
    if (!incumbent || reportTime(player) > reportTime(incumbent)) {
      team.playersByKey.set(dedupeKey, player);
    }
    teams.set(abbreviation, team);
  }

  return [...teams.values()].map((team) => ({
    abbreviation: team.abbreviation,
    teamName: team.teamName,
    players: [...team.playersByKey.values()].sort((first, second) => reportTime(second) - reportTime(first)),
  }));
}

function reportTime(player: DailyEdgeAvailabilityPlayer): number {
  const parsed = Date.parse(player.reportedAt ?? "");
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

/**
 * A provider omission is not an authoritative healthy/cleared report. Preserve
 * the last verified exact-game team unit until the provider publishes a newer
 * non-empty unit. This is internal continuity only: original timestamps and
 * provider provenance are retained and no row is relabeled as fresh.
 */
export function mergeNflAvailabilityWithPrior(
  current: DailyEdgeGameAvailability | null,
  prior: DailyEdgeGameAvailability | null,
): DailyEdgeGameAvailability | null {
  if (current === null) return prior;
  if (prior === null || !sameAvailabilityGame(current, prior)) {
    return current.teams.some((team) => team.players.length > 0) ? current : null;
  }

  const priorByTeam = new Map(prior.teams.map((team) => [team.abbreviation, team]));
  const teams = current.teams.map((team) =>
    team.players.length > 0 ? team : priorByTeam.get(team.abbreviation) ?? team,
  );
  if (!teams.some((team) => team.players.length > 0)) return prior;

  return {
    ...current,
    reportUpdatedAt: latestAvailabilityReportTime(teams) ?? prior.reportUpdatedAt,
    teams,
  };
}

function sameAvailabilityGame(
  current: DailyEdgeGameAvailability,
  prior: DailyEdgeGameAvailability,
): boolean {
  return current.eventId === prior.eventId &&
    current.awayTeam === prior.awayTeam &&
    current.homeTeam === prior.homeTeam;
}

function latestAvailabilityReportTime(teams: DailyEdgeTeamAvailability[]): string | null {
  return teams
    .flatMap((team) => team.players)
    .map((player) => player.reportedAt)
    .filter((value): value is string => value !== null && Number.isFinite(Date.parse(value)))
    .sort((first, second) => Date.parse(second) - Date.parse(first))[0] ?? null;
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
  normalizeNflDesignationGames,
};
