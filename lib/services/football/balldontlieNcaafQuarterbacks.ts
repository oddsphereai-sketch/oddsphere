import type { CfbForwardQuarterback, CfbForwardTeamQuarterbacks } from "./cfbForwardEvidence";

export const BALLDONTLIE_NCAAF_QUARTERBACK_RELEASE =
  "balldontlie_ncaaf_active_qb_context_2026_08_25_r1" as const;

type JsonRecord = Record<string, unknown>;

export async function fetchBalldontlieNcaafQuarterbacks(args: {
  teams: Array<{ id: number; abbreviation: string }>;
  previousSeason: number;
  capturedAt: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  pageBudget?: number;
}): Promise<{ byTeamId: Map<number, CfbForwardTeamQuarterbacks>; providerRequests: number }> {
  const fetchImpl = args.fetchImpl ?? fetch;
  let providerRequests = 0;
  const active = await readPages({ path: "/players/active", query: { "team_ids[]": args.teams.map((team) => team.id), per_page: 100 }, apiKey: args.apiKey, fetchImpl, maxPages: args.pageBudget ?? 4, onRequest: () => { providerRequests += 1; } });
  const quarterbacks = active.filter((value) => {
    const row = record(value);
    const position = text(row.position_abbreviation) ?? text(row.position);
    return position?.toUpperCase() === "QB" || position?.toLowerCase() === "quarterback";
  });
  const playerIds = quarterbacks.map((value) => integer(record(value).id)).filter((value): value is number => value !== null);
  const stats = playerIds.length === 0 ? [] : await readPages({ path: "/player_season_stats", query: { "player_ids[]": playerIds, season: args.previousSeason, per_page: 100 }, apiKey: args.apiKey, fetchImpl, maxPages: args.pageBudget ?? 4, onRequest: () => { providerRequests += 1; } });
  const statsByPlayer = new Map(stats.flatMap((value) => {
    const row = record(value);
    const id = integer(record(row.player).id);
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
  for (const team of args.teams) {
    const players = [...(byTeam.get(team.id) ?? [])].sort((a, b) => (b.previousSeasonPassingAttempts ?? -1) - (a.previousSeasonPassingAttempts ?? -1) || a.name.localeCompare(b.name));
    result.set(team.id, { provider: "balldontlie", teamId: team.id, team: team.abbreviation, capturedAt: args.capturedAt, starterStatus: players.length > 0 ? "projected" : "unknown", projectionMethod: players.length > 0 ? "active_roster_previous_season_attempts" : "no_active_quarterback", expectedStartingQuarterback: players[0] ?? null, activeQuarterbacks: players });
  }
  return { byTeamId: result, providerRequests };
}

async function readPages(args: { path: string; query: Record<string, number | number[]>; apiKey: string; fetchImpl: typeof fetch; maxPages: number; onRequest: () => void }): Promise<unknown[]> {
  const output: unknown[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < args.maxPages; page += 1) {
    const url = new URL(`https://api.balldontlie.io/ncaaf/v1${args.path}`);
    for (const [key, value] of Object.entries(args.query)) Array.isArray(value) ? value.forEach((item) => url.searchParams.append(key, String(item))) : url.searchParams.set(key, String(value));
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
