import type {
  DailyEdgeAvailabilityPlayer,
  DailyEdgeGameAvailability,
  DailyEdgeTeamAvailability,
} from "@/lib/services/dailyEdge/gameAvailability";
import type { NcaafGame, NcaafTeam } from "./balldontlieNcaafSlate";
import { cfbProviderTeamMatches } from "./cfbProviderTeamIdentity";

export const CFB_SPORTSDATAIO_AVAILABILITY_RELEASE =
  "cfb_sportsdataio_availability_2026_10_21_r1_national_cfb_contract" as const;
export const CFB_SPORTSDATAIO_AVAILABILITY_MAX_REQUESTS = 2 as const;
export const CFB_SPORTSDATAIO_AVAILABILITY_TIMEOUT_MS = 10_000 as const;
export const CFB_SPORTSDATAIO_AVAILABILITY_MAX_RESPONSE_BYTES = 20_000_000 as const;
export const CFB_SPORTSDATAIO_AVAILABILITY_REFRESH_MINUTES = 60 as const;
export const CFB_SPORTSDATAIO_AVAILABILITY_PREGAME_REFRESH_MINUTES = 15 as const;

const BASE_URL = "https://api.sportsdata.io/v3/cfb/scores/json";
const SOURCE_URL = "https://sportsdata.io/developers/api-documentation/ncaa-football";

type JsonRecord = Record<string, unknown>;

export type CfbSportsDataIoAvailabilityResult = {
  release: typeof CFB_SPORTSDATAIO_AVAILABILITY_RELEASE;
  requests: number;
  reportsByGame: Record<string, DailyEdgeGameAvailability>;
  unmatchedTeams: string[];
};

/**
 * Fetch the national CFB team catalog and current injured-player wire. A
 * successful catalog match is required before an empty player list may be
 * interpreted as a verified clear report. Provider absence or a failed team
 * match is never converted into medical clearance.
 */
export async function fetchCfbSportsDataIoAvailability(args: {
  games: NcaafGame[];
  capturedAt: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}): Promise<CfbSportsDataIoAvailabilityResult> {
  const games = [...new Map(args.games.map((game) => [game.providerGameId, game])).values()];
  if (games.length === 0) return emptyResult();
  if (!args.apiKey.trim()) throw new Error("SportsDataIO CFB API key is required.");
  const fetchImpl = args.fetchImpl ?? fetch;
  let requests = 0;
  const requestJson = async (path: "Teams" | "InjuredPlayers"): Promise<unknown> => {
    requests += 1;
    const response = await fetchImpl(`${BASE_URL}/${path}`, {
      cache: "no-store",
      headers: { "Ocp-Apim-Subscription-Key": args.apiKey.trim(), accept: "application/json" },
      signal: AbortSignal.timeout(CFB_SPORTSDATAIO_AVAILABILITY_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`sportsdataio_${path.toLowerCase()}_http_${response.status}`);
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > CFB_SPORTSDATAIO_AVAILABILITY_MAX_RESPONSE_BYTES) {
      throw new Error(`sportsdataio_${path.toLowerCase()}_response_too_large`);
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > CFB_SPORTSDATAIO_AVAILABILITY_MAX_RESPONSE_BYTES) {
      throw new Error(`sportsdataio_${path.toLowerCase()}_response_too_large`);
    }
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch {
      throw new Error(`sportsdataio_${path.toLowerCase()}_invalid_json`);
    }
  };
  const [teams, injuredPlayers] = await Promise.all([requestJson("Teams"), requestJson("InjuredPlayers")]);
  if (requests > CFB_SPORTSDATAIO_AVAILABILITY_MAX_REQUESTS) {
    throw new Error(`SportsDataIO CFB availability exceeded its ${CFB_SPORTSDATAIO_AVAILABILITY_MAX_REQUESTS}-request ceiling.`);
  }
  return parseCfbSportsDataIoAvailability({ games, capturedAt: args.capturedAt, teams, injuredPlayers, requests });
}

export function parseCfbSportsDataIoAvailability(args: {
  games: NcaafGame[];
  capturedAt: string;
  teams: unknown;
  injuredPlayers: unknown;
  requests?: number;
}): CfbSportsDataIoAvailabilityResult {
  if (!Number.isFinite(Date.parse(args.capturedAt))) throw new Error("SportsDataIO CFB capture timestamp is invalid.");
  const teamRows = arrayOfRecords(args.teams, "teams").filter((row) => row.Active !== false);
  const injuryRows = arrayOfRecords(args.injuredPlayers, "injured_players");
  const reportsByGame: Record<string, DailyEdgeGameAvailability> = {};
  const unmatchedTeams = new Set<string>();

  for (const game of args.games) {
    const away = exactProviderTeam(game.away, teamRows);
    const home = exactProviderTeam(game.home, teamRows);
    if (!away || !home) {
      if (!away) unmatchedTeams.add(`${game.away.abbreviation}:${game.away.name}`);
      if (!home) unmatchedTeams.add(`${game.home.abbreviation}:${game.home.name}`);
      continue;
    }
    const teams = [
      buildTeamAvailability(game.away, away, injuryRows),
      buildTeamAvailability(game.home, home, injuryRows),
    ];
    const reportedAt = latestIso(teams.flatMap((team) => team.players.map((player) => player.reportedAt))) ??
      new Date(args.capturedAt).toISOString();
    reportsByGame[game.providerGameId] = {
      eventId: game.providerGameId,
      awayTeam: game.away.abbreviation,
      homeTeam: game.home.abbreviation,
      source: "SportsDataIO",
      sourceLabel: "National college football injury wire",
      sourceUrl: SOURCE_URL,
      reportDate: reportedAt,
      reportUpdatedAt: reportedAt,
      verifiedClear: teams.every((team) => team.players.length === 0),
      teams,
    };
  }

  return {
    release: CFB_SPORTSDATAIO_AVAILABILITY_RELEASE,
    requests: args.requests ?? 0,
    reportsByGame,
    unmatchedTeams: [...unmatchedTeams].sort(),
  };
}

function exactProviderTeam(team: NcaafTeam, rows: JsonRecord[]): JsonRecord | null {
  const matches = rows.filter((row) => providerTeamLabels(row).some((observed) => cfbProviderTeamMatches({
    observed,
    abbreviation: team.abbreviation,
    expectedName: team.name,
  })));
  return matches.length === 1 ? matches[0]! : null;
}

function buildTeamAvailability(team: NcaafTeam, providerTeam: JsonRecord, injuries: JsonRecord[]): DailyEdgeTeamAvailability {
  const teamId = integer(providerTeam.TeamID);
  const providerLabels = providerTeamLabels(providerTeam);
  const players = injuries
    .filter((row) => {
      const injuryTeamId = integer(row.TeamID);
      if (teamId !== null && injuryTeamId !== null) return teamId === injuryTeamId;
      return providerTeamLabels(row).some((label) => providerLabels.some((providerLabel) => normalized(label) === normalized(providerLabel)));
    })
    .flatMap(toAvailabilityPlayer)
    .sort((first, second) => first.name.localeCompare(second.name));
  return { abbreviation: team.abbreviation, teamName: team.name, players };
}

function toAvailabilityPlayer(row: JsonRecord): DailyEdgeAvailabilityPlayer[] {
  const name = text(row.Name) ?? [text(row.FirstName), text(row.LastName)].filter(Boolean).join(" ").trim();
  const status = text(row.InjuryStatus) ?? text(row.Status);
  if (!name || !status) return [];
  const notes = text(row.InjuryNotes);
  const bodyPart = text(row.InjuryBodyPart);
  return [{
    name,
    status,
    detail: [bodyPart, notes].filter(Boolean).join(" — ") || null,
    position: text(row.Position),
    reportedAt: validIso(row.Updated) ?? validIso(row.InjuryStartDate),
  }];
}

function providerTeamLabels(row: JsonRecord): string[] {
  return [row.Key, row.Team, row.School, row.Name, row.FullName]
    .map(text)
    .filter((value): value is string => value !== null);
}

function arrayOfRecords(value: unknown, label: string): JsonRecord[] {
  if (!Array.isArray(value)) throw new Error(`SportsDataIO CFB ${label} response is not an array.`);
  return value.filter((row): row is JsonRecord => Boolean(row) && typeof row === "object" && !Array.isArray(row));
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function integer(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function validIso(value: unknown): string | null {
  const parsed = Date.parse(typeof value === "string" ? value : "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function latestIso(values: Array<string | null>): string | null {
  return values.filter((value): value is string => value !== null)
    .sort((first, second) => Date.parse(second) - Date.parse(first))[0] ?? null;
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function emptyResult(): CfbSportsDataIoAvailabilityResult {
  return { release: CFB_SPORTSDATAIO_AVAILABILITY_RELEASE, requests: 0, reportsByGame: {}, unmatchedTeams: [] };
}
