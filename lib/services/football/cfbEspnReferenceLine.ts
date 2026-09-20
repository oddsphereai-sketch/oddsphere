import { CFB_TEAM_IDENTITIES } from "./cfbTeamIdentity";
import type { NcaafGame } from "./balldontlieNcaafSlate";

export const CFB_ESPN_REFERENCE_LINE_RELEASE =
  "cfb_espn_reference_line_2026_09_20_r1_strict_opening_fallback" as const;
export const CFB_ESPN_REFERENCE_MAX_GAMES_PER_RUN = 32 as const;
export const CFB_ESPN_REFERENCE_MAX_SCOREBOARD_DATES = 7 as const;
export const CFB_ESPN_REFERENCE_MAX_REQUESTS =
  CFB_ESPN_REFERENCE_MAX_SCOREBOARD_DATES * 2 + CFB_ESPN_REFERENCE_MAX_GAMES_PER_RUN;
export const CFB_ESPN_REFERENCE_CONCURRENCY = 6 as const;
export const CFB_ESPN_REFERENCE_TIMEOUT_MS = 6_000 as const;
export const CFB_ESPN_REFERENCE_KICKOFF_TOLERANCE_MS = 90 * 60_000;

export type CfbEspnReferenceLine = {
  release: typeof CFB_ESPN_REFERENCE_LINE_RELEASE;
  provider: "espn";
  sportsbook: "DraftKings";
  providerEventId: string;
  capturedAt: string;
  lineType: "opening";
  homeSpread: number;
  awaySpread: number;
  total: number;
};

export type CfbEspnReferenceResult = {
  release: typeof CFB_ESPN_REFERENCE_LINE_RELEASE;
  requests: number;
  attemptedGames: number;
  matchedGames: number;
  linesByGame: Record<string, CfbEspnReferenceLine>;
  failuresByGame: Record<string, string>;
};

type JsonRecord = Record<string, unknown>;
type EspnTeam = { id?: unknown };
type EspnEvent = {
  id?: unknown;
  date?: unknown;
  competitions?: Array<{ competitors?: Array<{ homeAway?: unknown; team?: EspnTeam }> }>;
};

const ESPN_TEAM_ID_OVERRIDES: Record<string, string> = {
  VAL: "2674", INST: "282", YALE: "43", HC: "107", CCSU: "2115", MTST: "147",
  PENN: "219", BUCK: "2083", SHU: "2529", ELON: "2210", NCCU: "2428", GWEB: "2241",
  CARK: "2110", SEMO: "2546", HCU: "2277", UIW: "2916",
};

export async function fetchCfbEspnReferenceLines(args: {
  games: NcaafGame[];
  capturedAt: string;
  fetchImpl?: typeof fetch;
  maximumGames?: number;
}): Promise<CfbEspnReferenceResult> {
  const capturedAt = new Date(args.capturedAt).toISOString();
  const maximumGames = args.maximumGames ?? CFB_ESPN_REFERENCE_MAX_GAMES_PER_RUN;
  if (!Number.isInteger(maximumGames) || maximumGames < 0 || maximumGames > CFB_ESPN_REFERENCE_MAX_GAMES_PER_RUN) {
    throw new Error(`CFB ESPN reference collection maximum must be between 0 and ${CFB_ESPN_REFERENCE_MAX_GAMES_PER_RUN}.`);
  }
  const games = [...new Map(args.games.map((game) => [game.providerGameId, game])).values()]
    .sort((first, second) => Date.parse(first.scheduledStart) - Date.parse(second.scheduledStart) || first.providerGameId.localeCompare(second.providerGameId))
    .slice(0, maximumGames);
  if (games.length === 0) return emptyResult();

  const fetchImpl = args.fetchImpl ?? fetch;
  const dates = [...new Set(games.flatMap(scoreboardDates))].sort();
  if (dates.length > CFB_ESPN_REFERENCE_MAX_SCOREBOARD_DATES) {
    throw new Error(`CFB ESPN reference collection exceeds its ${CFB_ESPN_REFERENCE_MAX_SCOREBOARD_DATES}-date scoreboard bound.`);
  }
  let requests = 0;
  const scoreboard = await Promise.all(dates.flatMap((date) => [80, 81].map(async (group) => {
    requests += 1;
    return fetchJson(fetchImpl, `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${date}&limit=400&groups=${group}`);
  })));
  const events = dedupeEvents(scoreboard.flatMap((payload) => Array.isArray(payload.events) ? payload.events as EspnEvent[] : []));
  const failuresByGame: Record<string, string> = {};
  const matches = games.flatMap((game) => {
    const result = matchEvent(game, events);
    if (typeof result === "string") {
      failuresByGame[game.providerGameId] = result;
      return [];
    }
    return [{ game, event: result }];
  });
  const linesByGame: Record<string, CfbEspnReferenceLine> = {};
  let cursor = 0;
  const worker = async () => {
    while (cursor < matches.length) {
      const match = matches[cursor++];
      if (!match) continue;
      requests += 1;
      try {
        const payload = await fetchJson(fetchImpl, `https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=${match.event.id}`);
        const line = normalizeOpeningLine(payload, String(match.event.id), capturedAt);
        if (line) linesByGame[match.game.providerGameId] = line;
        else failuresByGame[match.game.providerGameId] = "draftkings_complete_opening_line_unavailable";
      } catch (error) {
        failuresByGame[match.game.providerGameId] = boundedError(error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CFB_ESPN_REFERENCE_CONCURRENCY, matches.length) }, worker));
  if (requests > CFB_ESPN_REFERENCE_MAX_REQUESTS) throw new Error("CFB ESPN reference collection exceeded its request bound.");
  return {
    release: CFB_ESPN_REFERENCE_LINE_RELEASE,
    requests,
    attemptedGames: games.length,
    matchedGames: Object.keys(linesByGame).length,
    linesByGame,
    failuresByGame,
  };
}

export function normalizeCfbEspnOpeningLine(
  payload: JsonRecord,
  providerEventId: string,
  capturedAt: string,
): CfbEspnReferenceLine | null {
  return normalizeOpeningLine(payload, providerEventId, new Date(capturedAt).toISOString());
}

function normalizeOpeningLine(payload: JsonRecord, providerEventId: string, capturedAt: string): CfbEspnReferenceLine | null {
  const rows = Array.isArray(payload.pickcenter) ? payload.pickcenter : [];
  for (const raw of rows) {
    const row = record(raw);
    const provider = record(row?.provider);
    if (provider?.name !== "DraftKings") continue;
    const pointSpread = record(row?.pointSpread);
    const total = record(row?.total);
    const homeSpread = lineValue(record(record(record(pointSpread?.home)?.open))?.line, false);
    const awaySpread = lineValue(record(record(record(pointSpread?.away)?.open))?.line, false);
    const over = lineValue(record(record(record(total?.over)?.open))?.line, true);
    const under = lineValue(record(record(record(total?.under)?.open))?.line, true);
    if (homeSpread === null || awaySpread === null || over === null || under === null) continue;
    if (Math.abs(homeSpread + awaySpread) > 1e-9 || Math.abs(over - under) > 1e-9) continue;
    return {
      release: CFB_ESPN_REFERENCE_LINE_RELEASE,
      provider: "espn",
      sportsbook: "DraftKings",
      providerEventId,
      capturedAt,
      lineType: "opening",
      homeSpread,
      awaySpread,
      total: over,
    };
  }
  return null;
}

function matchEvent(game: NcaafGame, events: EspnEvent[]): EspnEvent | string {
  const awayId = teamId(game.away.abbreviation);
  const homeId = teamId(game.home.abbreviation);
  if (!awayId || !homeId) return "espn_team_identity_unavailable";
  const matches = events.filter((event) => {
    const pair = eventPair(event);
    const eventAt = Date.parse(typeof event.date === "string" ? event.date : "");
    return pair?.away === awayId && pair.home === homeId && Number.isFinite(eventAt) &&
      Math.abs(eventAt - Date.parse(game.scheduledStart)) <= CFB_ESPN_REFERENCE_KICKOFF_TOLERANCE_MS;
  });
  return matches.length === 1 && typeof matches[0]?.id === "string"
    ? matches[0]
    : matches.length === 0 ? "strict_event_not_found" : "strict_event_ambiguous";
}

function teamId(abbreviation: string): string | null {
  if (ESPN_TEAM_ID_OVERRIDES[abbreviation]) return ESPN_TEAM_ID_OVERRIDES[abbreviation]!;
  const identity = (CFB_TEAM_IDENTITIES as Record<string, { logoUrl?: string }>)[abbreviation];
  return identity?.logoUrl?.match(/\/(\d+)\.png$/)?.[1] ?? null;
}

function eventPair(event: EspnEvent): { away: string; home: string } | null {
  const competitors = event.competitions?.[0]?.competitors ?? [];
  const away = competitors.find((value) => value.homeAway === "away")?.team?.id;
  const home = competitors.find((value) => value.homeAway === "home")?.team?.id;
  return typeof away === "string" && typeof home === "string" ? { away, home } : null;
}

function scoreboardDates(game: NcaafGame): string[] {
  const instant = new Date(game.scheduledStart);
  if (!Number.isFinite(instant.getTime())) throw new Error(`CFB ESPN reference game ${game.providerGameId} has an invalid kickoff.`);
  const eastern = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(instant);
  const part = (type: string) => eastern.find((value) => value.type === type)?.value;
  const easternDate = `${part("year")}${part("month")}${part("day")}`;
  return [...new Set([game.scheduledStart.slice(0, 10).replaceAll("-", ""), easternDate])];
}

function dedupeEvents(events: EspnEvent[]): EspnEvent[] {
  return [...new Map(events.filter((event) => typeof event.id === "string").map((event) => [String(event.id), event])).values()];
}

async function fetchJson(fetchImpl: typeof fetch, url: string): Promise<JsonRecord> {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(CFB_ESPN_REFERENCE_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`ESPN CFB reference request failed (${response.status}).`);
  const payload = await response.json();
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("ESPN CFB reference response is invalid.");
  return payload as JsonRecord;
}

function lineValue(value: unknown, stripTotalPrefix: boolean): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim().replace(/^PK$/i, "0").replace(stripTotalPrefix ? /^[ou]/i : /$^/, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function boundedError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").trim().slice(0, 160) || "unknown_error";
}

function emptyResult(): CfbEspnReferenceResult {
  return { release: CFB_ESPN_REFERENCE_LINE_RELEASE, requests: 0, attemptedGames: 0, matchedGames: 0, linesByGame: {}, failuresByGame: {} };
}
