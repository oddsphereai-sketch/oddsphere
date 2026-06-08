/**
 * Phase 7A — NBA Finals v0a — ESPN public NBA injuries fetcher.
 *
 * Public read-only network call. Returns NbaPlayerInjury[] for a single
 * team or null on any failure (the snapshot builder treats null as
 * "unknown" and caps confidence accordingly).
 *
 * Endpoint:
 *   https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/{abbr}/injuries
 *
 * The team abbreviation is what ESPN expects (e.g. "lal", "bos"). ESPN's
 * abbreviations are commonly lowercase but the endpoint accepts upper
 * also. We lowercase before the call to be safe.
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
 * Fetch ESPN injuries for a single NBA team. Returns null on any failure
 * (caller treats null as "unknown" status).
 */
export async function fetchEspnNbaInjuries(
  teamAbbr: string,
  opts: EspnNbaInjuryFetchOptions = {},
): Promise<{ players: NbaPlayerInjury[] } | null> {
  if (!isInjuryIngestEnabled()) {
    return null;
  }
  const log = opts.log ?? (() => {});
  const fetchFn = opts.fetchImpl ?? fetch;
  const abbr = teamAbbr.trim().toLowerCase();
  if (abbr === "") {
    log(`[espnNbaInjuries] empty team abbreviation; returning null.`);
    return null;
  }
  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${abbr}/injuries`;
  try {
    const res = await fetchFn(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 oddsphere/nba-v0a",
        accept: "application/json",
      },
    });
    if (!res.ok) {
      log(`[espnNbaInjuries] ESPN ${abbr} returned HTTP ${res.status}; returning null.`);
      return null;
    }
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("json")) {
      log(`[espnNbaInjuries] ESPN ${abbr} non-JSON content-type=${ct}; returning null.`);
      return null;
    }
    const body = (await res.json()) as unknown;
    return parseEspnInjuriesPayload(body);
  } catch (e) {
    log(`[espnNbaInjuries] fetch threw for ${abbr}: ${(e as Error).message}; returning null.`);
    return null;
  }
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
    // ESPN sometimes returns no injuries at all → empty list is the right
    // answer; treat it as "known" (zero injuries).
    return { players: [] };
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

export const __NBA_INJURIES_TEST__ = {
  normalizeStatus,
};
