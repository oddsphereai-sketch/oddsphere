import type { CfbForwardQuarterback, CfbForwardTeamQuarterbacks } from "./cfbForwardEvidence";

export const BALLDONTLIE_NCAAF_QUARTERBACK_RELEASE =
  "balldontlie_ncaaf_active_qb_context_2026_08_25_r2_team_scoped" as const;

export const BALLDONTLIE_NCAAF_ACTIVE_ROSTER_PAGES_PER_TEAM = 2 as const;
export const BALLDONTLIE_NCAAF_QB_STATS_PAGE_BUDGET = 2 as const;

type JsonRecord = Record<string, unknown>;

export async function fetchBalldontlieNcaafQuarterbacks(args: {
  teams: Array<{ id: number; abbreviation: string }>;
  previousSeason: number;
  capturedAt: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  activeRosterPagesPerTeam?: number;
  statsPageBudget?: number;
  maxProviderRequests?: number;
}): Promise<{ byTeamId: Map<number, CfbForwardTeamQuarterbacks>; providerRequests: number }> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const teams = uniqueTeams(args.teams);
  const activeRosterPagesPerTeam = positiveInteger(
    args.activeRosterPagesPerTeam ?? BALLDONTLIE_NCAAF_ACTIVE_ROSTER_PAGES_PER_TEAM,
    "activeRosterPagesPerTeam",
  );
  const statsPageBudget = positiveInteger(
    args.statsPageBudget ?? BALLDONTLIE_NCAAF_QB_STATS_PAGE_BUDGET,
    "statsPageBudget",
  );
  const maxProviderRequests = positiveInteger(
    args.maxProviderRequests ?? teams.length * activeRosterPagesPerTeam + statsPageBudget,
    "maxProviderRequests",
  );
  let providerRequests = 0;
  const onRequest = () => {
    if (providerRequests >= maxProviderRequests) {
      throw new Error(`BALLDONTLIE NCAAF quarterback context exceeded its ${maxProviderRequests}-request budget.`);
    }
    providerRequests += 1;
  };
  const active: unknown[] = [];
  for (const team of teams) {
    const teamRows = await readPages({
      path: "/players/active",
      query: { "team_ids[]": [team.id], per_page: 100 },
      apiKey: args.apiKey,
      fetchImpl,
      maxPages: activeRosterPagesPerTeam,
      onRequest,
    });
    for (const value of teamRows) {
      const returnedTeamId = integer(record(record(value).team).id);
      if (returnedTeamId !== team.id) {
        throw new Error(`BALLDONTLIE NCAAF /players/active returned team ${returnedTeamId ?? "unknown"} for team-scoped request ${team.id}.`);
      }
    }
    active.push(...teamRows);
  }
  const quarterbacks = active.filter((value) => {
    const row = record(value);
    const position = text(row.position_abbreviation) ?? text(row.position);
    return position?.toUpperCase() === "QB" || position?.toLowerCase() === "quarterback";
  });
  const playerIds = quarterbacks.map((value) => integer(record(value).id)).filter((value): value is number => value !== null);
  const stats = playerIds.length === 0 ? [] : await readPages({ path: "/player_season_stats", query: { "player_ids[]": playerIds, season: args.previousSeason, per_page: 100 }, apiKey: args.apiKey, fetchImpl, maxPages: statsPageBudget, onRequest });
  const requestedPlayerIds = new Set(playerIds);
  const statsByPlayer = new Map(stats.flatMap((value) => {
    const row = record(value);
    const id = integer(record(row.player).id);
    if (id !== null && !requestedPlayerIds.has(id)) {
      throw new Error(`BALLDONTLIE NCAAF /player_season_stats returned unrequested player ${id}.`);
    }
    return id === null ? [] : [[id, { attempts: number(row.passing_attempts), yards: number(row.passing_yards) }] as const];
  }));
  const byTeam = new Map<number, CfbForwardQuarterback[]>();
  for (const value of quarterbacks) {
    const row = record(value);
    const playerId = integer(row.id);
    const teamId = integer(record(row.team).id);
    if (playerId === null || teamId === null) continue;
    const firstName = text(row.first_name) ?? "";
    const lastName = text(row.last_name) ?? "";
    const name = `${firstName} ${lastName}`.trim();
    if (!name) continue;
    const stat = statsByPlayer.get(playerId);
    const player: CfbForwardQuarterback = { playerId: String(playerId), name, position: "QB", jerseyNumber: text(row.jersey_number), previousSeasonPassingAttempts: stat?.attempts ?? null, previousSeasonPassingYards: stat?.yards ?? null };
    byTeam.set(teamId, [...(byTeam.get(teamId) ?? []), player]);
  }
  const result = new Map<number, CfbForwardTeamQuarterbacks>();
  for (const team of teams) {
    const players = [...(byTeam.get(team.id) ?? [])].sort((a, b) => (b.previousSeasonPassingAttempts ?? -1) - (a.previousSeasonPassingAttempts ?? -1) || a.name.localeCompare(b.name));
    result.set(team.id, { provider: "balldontlie", teamId: team.id, team: team.abbreviation, capturedAt: args.capturedAt, starterStatus: players.length > 0 ? "projected" : "unknown", projectionMethod: players.length > 0 ? "active_roster_previous_season_attempts" : "no_active_quarterback", expectedStartingQuarterback: players[0] ?? null, activeQuarterbacks: players });
  }
  return { byTeamId: result, providerRequests };
}

function uniqueTeams(teams: Array<{ id: number; abbreviation: string }>): Array<{ id: number; abbreviation: string }> {
  const byId = new Map<number, { id: number; abbreviation: string }>();
  for (const team of teams) {
    if (!Number.isInteger(team.id) || team.id <= 0) throw new Error("BALLDONTLIE NCAAF team id must be a positive integer.");
    const existing = byId.get(team.id);
    if (existing && existing.abbreviation !== team.abbreviation) throw new Error(`BALLDONTLIE NCAAF team ${team.id} has conflicting abbreviations.`);
    byId.set(team.id, team);
  }
  return [...byId.values()].sort((first, second) => first.id - second.id);
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer.`);
  return value;
}

async function readPages(args: { path: string; query: Record<string, number | number[]>; apiKey: string; fetchImpl: typeof fetch; maxPages: number; onRequest: () => void }): Promise<unknown[]> {
  const output: unknown[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < args.maxPages; page += 1) {
    const url = new URL(`https://api.balldontlie.io/ncaaf/v1${args.path}`);
    for (const [key, value] of Object.entries(args.query)) {
      if (Array.isArray(value)) value.forEach((item) => url.searchParams.append(key, String(item)));
      else url.searchParams.set(key, String(value));
    }
    if (cursor) url.searchParams.set("cursor", cursor);
    args.onRequest();
    const response = await args.fetchImpl(url, { headers: { Authorization: args.apiKey, accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`BALLDONTLIE NCAAF ${args.path} failed with HTTP ${response.status}.`);
    const body = await response.json() as { data?: unknown; meta?: { next_cursor?: unknown } };
    if (!Array.isArray(body.data)) throw new Error(`BALLDONTLIE NCAAF ${args.path} returned malformed data.`);
    output.push(...body.data);
    const next = body.meta?.next_cursor;
    cursor = typeof next === "string" || typeof next === "number" ? String(next) : null;
    if (!cursor) return output;
  }
  throw new Error(`BALLDONTLIE NCAAF ${args.path} exceeded its pagination budget.`);
}

function record(value: unknown): JsonRecord { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}; }
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function number(value: unknown): number | null { const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN; return Number.isFinite(parsed) ? parsed : null; }
function integer(value: unknown): number | null { const parsed = number(value); return parsed !== null && Number.isInteger(parsed) ? parsed : null; }
