/**
 * ESPN public exact-game NBA injury authority.
 *
 * Public read-only network call. The exact event summary must explicitly
 * publish injury groups for both matchup teams. Missing or partial payloads
 * remain unknown and can never be interpreted as healthy.
 *
 * Master switch: NBA_INJURY_INGEST_ENABLED env var.
 *   default true; set to "false" to disable all injury fetches.
 *
 * Hard rules:
 *   • Returns null on ANY failure (network, non-JSON, HTTP non-2xx).
 *   • Never throws.
 *   • Status normalization: ESPN's status strings ("Out", "Day-To-Day",
 *     "Questionable", "Probable", "Available") are mapped to our compact
 *     NbaInjuryStatus union. Unknown strings → "unknown".
 *   • Player_id mapping is left null in v0 — we don't yet have an NBA
 *     player table populated; admin preview only shows the ESPN name.
 */

import type { NbaInjuryStatus, NbaPlayerInjury } from "../../automodel/nba/types";

export type EspnNbaInjuryFetchOptions = {
  log?: (m: string) => void;
  fetchImpl?: typeof fetch;
};

export type EspnNbaGameInjuryRequest = {
  gameExternalId: number;
  teamAbbreviation: string;
  teamExternalId: number;
  awayTeamAbbreviation: string;
  homeTeamAbbreviation: string;
};

export type EspnNbaGameInjuries = {
  eventId: string;
  teams: ReadonlyMap<string, NbaPlayerInjury[]>;
};

const ESPN_NBA_ROOT = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";

export function isInjuryIngestEnabled(): boolean {
  const env = process.env.NBA_INJURY_INGEST_ENABLED;
  if (env === undefined || env === "") return true;
  return env !== "false" && env !== "0";
}

function normalizeStatus(raw: string | null | undefined): NbaInjuryStatus {
  if (raw === null || raw === undefined) return "unknown";
  const s = raw.trim().toLowerCase();
  if (s === "" || s === "n/a") return "unknown";
  if (s === "out" || s === "out for season" || s.startsWith("out ")) return "out";
  if (s === "questionable") return "questionable";
  if (s === "probable") return "probable";
  if (s === "available" || s === "active") return "available";
  if (s === "day-to-day" || s === "day to day" || s === "doubtful") {
    // Map "day-to-day" / "doubtful" to "questionable" — closest semantic
    // bucket in our union.
    return "questionable";
  }
  return "unknown";
}

/**
 * Exact-game injury authority used by every production NBA snapshot builder.
 * Both matchup teams must be explicitly present in ESPN's game summary. An
 * explicit empty `injuries` array is verified zero; a missing group, missing
 * array, duplicate group, or malformed player row fails closed.
 */
export async function fetchEspnNbaGameInjuries(
  eventId: number | string,
  awayTeamAbbreviation: string,
  homeTeamAbbreviation: string,
  opts: EspnNbaInjuryFetchOptions = {},
): Promise<EspnNbaGameInjuries | null> {
  if (!isInjuryIngestEnabled()) return null;
  const log = opts.log ?? (() => {});
  const fetchFn = opts.fetchImpl ?? fetch;
  const normalizedEventId = String(eventId).trim();
  if (!/^\d+$/.test(normalizedEventId)) return null;
  try {
    const response = await fetchFn(`${ESPN_NBA_ROOT}/summary?event=${normalizedEventId}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 oddsphere/nba-exact-game-availability",
        accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok || !(response.headers.get("content-type") ?? "").toLowerCase().includes("json")) {
      log(`[espnNbaInjuries] ESPN event ${normalizedEventId} did not return JSON success; returning null.`);
      return null;
    }
    return parseEspnGameInjuriesPayload(
      await response.json(),
      normalizedEventId,
      awayTeamAbbreviation,
      homeTeamAbbreviation,
    );
  } catch (error) {
    log(`[espnNbaInjuries] exact-game fetch failed for ${normalizedEventId}: ${(error as Error).message}`);
    return null;
  }
}

/** One cached ESPN summary request per game, shared by both team resolver calls. */
export function createEspnNbaGameInjuryResolver(
  opts: EspnNbaInjuryFetchOptions = {},
): (request: EspnNbaGameInjuryRequest) => Promise<NbaPlayerInjury[] | null> {
  const cache = new Map<number, Promise<EspnNbaGameInjuries | null>>();
  return async (request) => {
    let report = cache.get(request.gameExternalId);
    if (!report) {
      report = fetchEspnNbaGameInjuries(
        request.gameExternalId,
        request.awayTeamAbbreviation,
        request.homeTeamAbbreviation,
        opts,
      );
      cache.set(request.gameExternalId, report);
    }
    const resolved = await report;
    return resolved?.teams.get(canonicalNbaAbbreviation(request.teamAbbreviation)) ?? null;
  };
}

/**
 * Pure parser exposed for tests. Walks the ESPN payload shape:
 *
 *   { injuries: [ { athlete: { id, displayName }, status, ... }, ... ] }
 *
 * ESPN occasionally nests by team; the parser tolerates either flat
 * `injuries[]` or nested `injuries[].athletes[]`.
 */
export function parseEspnInjuriesPayload(
  body: unknown,
): { players: NbaPlayerInjury[] } | null {
  if (body === null || typeof body !== "object") return null;
  const root = body as { injuries?: unknown };
  const list = root.injuries;
  if (!Array.isArray(list)) {
    return null;
  }
  const out: NbaPlayerInjury[] = [];
  for (const entry of list) {
    if (entry === null || typeof entry !== "object") continue;
    const e = entry as {
      athlete?: { id?: number | string; displayName?: string };
      athletes?: Array<{ id?: number | string; displayName?: string; status?: string }>;
      status?: string;
      type?: string;
      details?: { type?: string };
    };
    // Flat shape: top-level athlete + status
    if (e.athlete !== undefined) {
      const name =
        typeof e.athlete.displayName === "string"
          ? e.athlete.displayName
          : null;
      if (name !== null) {
        out.push({
          player_id: null,
          name,
          status: normalizeStatus(e.status ?? e.type ?? e.details?.type ?? null),
        });
      }
      continue;
    }
    // Nested shape: a group with athletes[]
    if (Array.isArray(e.athletes)) {
      for (const ath of e.athletes) {
        const name =
          typeof ath.displayName === "string" ? ath.displayName : null;
        if (name === null) continue;
        out.push({
          player_id: null,
          name,
          status: normalizeStatus(ath.status ?? e.type ?? null),
        });
      }
    }
  }
  return { players: out };
}

export function parseEspnGameInjuriesPayload(
  body: unknown,
  eventId: string,
  awayTeamAbbreviation: string,
  homeTeamAbbreviation: string,
): EspnNbaGameInjuries | null {
  if (body === null || typeof body !== "object") return null;
  const groups = (body as { injuries?: unknown }).injuries;
  if (!Array.isArray(groups)) return null;
  const expected = new Set([
    canonicalNbaAbbreviation(awayTeamAbbreviation),
    canonicalNbaAbbreviation(homeTeamAbbreviation),
  ]);
  if (expected.size !== 2 || expected.has("")) return null;
  const teams = new Map<string, NbaPlayerInjury[]>();
  for (const candidate of groups) {
    if (candidate === null || typeof candidate !== "object") continue;
    const group = candidate as {
      team?: { abbreviation?: unknown };
      injuries?: unknown;
    };
    const abbreviation = canonicalNbaAbbreviation(
      typeof group.team?.abbreviation === "string" ? group.team.abbreviation : "",
    );
    if (!expected.has(abbreviation)) continue;
    if (teams.has(abbreviation) || !Array.isArray(group.injuries)) return null;
    const structurallyComplete = group.injuries.every((injury) => {
      if (injury === null || typeof injury !== "object") return false;
      const row = injury as {
        athlete?: { displayName?: unknown };
        status?: unknown;
        type?: unknown;
        details?: { type?: unknown };
      };
      return typeof row.athlete?.displayName === "string" && row.athlete.displayName.trim().length > 0 &&
        (typeof row.status === "string" || typeof row.type === "string" || typeof row.details?.type === "string");
    });
    if (!structurallyComplete) return null;
    const parsed = parseEspnInjuriesPayload({ injuries: group.injuries });
    if (parsed === null || parsed.players.length !== group.injuries.length) return null;
    teams.set(abbreviation, parsed.players);
  }
  if ([...expected].some((abbreviation) => !teams.has(abbreviation))) return null;
  return { eventId, teams };
}

export function canonicalNbaAbbreviation(value: string): string {
  const abbreviation = value.trim().toUpperCase();
  return ({
    GS: "GSW",
    NO: "NOP",
    NY: "NYK",
    SA: "SAS",
    UTAH: "UTA",
    WSH: "WAS",
  } as Record<string, string>)[abbreviation] ?? abbreviation;
}

export const __NBA_INJURIES_TEST__ = {
  normalizeStatus,
  canonicalNbaAbbreviation,
  parseEspnGameInjuriesPayload,
};
