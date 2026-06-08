/**
 * Phase 6B.31a — ESPN secondary probable-pitcher source.
 *
 * Fetches probable pitchers from ESPN's public scoreboard JSON for use
 * as a SECONDARY source when MLB Stats' `probablePitcher` hydrate is
 * null AND BDL `/games` `home_team_pitcher` / `away_team_pitcher` are
 * null. The 2026-06-08 SEA@BAL incident is the trigger case: ESPN /
 * MLB.TV publicly showed Chris Bassitt as BAL home probable while
 * statsapi.mlb.com and BDL both returned null, leaving our product
 * stuck in V2.2 real-data fallback even though Bassitt is fully mapped
 * in our `players` table (id=13773, mlb_person_id=605135).
 *
 * Hard rules (enforced here AND in refresh-starters.ts):
 *   • ESPN is only consulted when MLB Stats + BDL both returned null
 *     for a side. Never overwrites higher-confidence sources.
 *   • ESPN's athlete id (`33148` for Bassitt) is NOT the MLB Stats
 *     person id (`605135`). Mapping must go through strict
 *     name + team + active + is_pitcher query, never name alone.
 *   • If exactly one `players` row matches the (name, team, pitcher,
 *     active) constraint, the assignment is accepted. Otherwise the
 *     row is skipped with a structured reason: "not_found" (no rows),
 *     "ambiguous" (>1 row).
 *   • If ESPN omits a probable for a game (or omits the game itself),
 *     no assignment is attempted — fallback continues unchanged.
 *
 * Module-level guarantees:
 *   • No DB writes. The mapper performs a SELECT only.
 *   • No fake / synthesized starters.
 *   • Network failures (ESPN unreachable, malformed JSON, timeout)
 *     return an empty map with a logged warning — never throws.
 *   • Output is structured (Map<gameKey, ResolvedEspnProbables>) for
 *     consumption by `runStarterRefreshCycle`.
 *
 * Operator visibility:
 *   • Every assignment + skip flows back through the
 *     `starter_assignments[]` array on RunStarterRefreshResult, which
 *     the orchestrator persists in `step.details` JSONB. Operator can
 *     query `automation_runs` to audit historical ESPN usage.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * One probable pitcher as published by ESPN's scoreboard endpoint.
 * Name is what powers the player lookup; ESPN athlete id is captured
 * for audit/log purposes only.
 */
export interface EspnProbable {
  fullName: string;
  espnAthleteId: number;
}

/**
 * Per-game ESPN probables, keyed by home/away. Either side can be null
 * if ESPN didn't publish a probable for that side.
 */
export interface EspnProbablesForGame {
  /** ESPN event id (NOT MLB gamePk). For audit/log only. */
  espnEventId: number;
  /** Three-letter team abbreviation as ESPN reports it. */
  homeTeamAbbr: string;
  awayTeamAbbr: string;
  home: EspnProbable | null;
  away: EspnProbable | null;
}

/** Map key: `${awayAbbr}@${homeAbbr}` — sport-day unique within a slate. */
export type GameKey = string;

export function buildGameKey(awayAbbr: string, homeAbbr: string): GameKey {
  return `${awayAbbr}@${homeAbbr}`;
}

/**
 * Strict mapper result. `playerId` is non-null only when status is
 * "matched". For "ambiguous" / "not_found", `playerId` is null and the
 * caller logs the skip with the ESPN name + team for operator review.
 */
export type EspnMappingStatus = "matched" | "ambiguous" | "not_found";

export interface EspnMappingResult {
  status: EspnMappingStatus;
  /** `players.id` when status === "matched"; null otherwise. */
  playerId: number | null;
  /** mlb_person_id of the matched player; null otherwise. Audit only. */
  mlbPersonId: number | null;
  /** Count of matching rows; informational. */
  matchCount: number;
}

/**
 * Pure parser for the ESPN scoreboard JSON shape. Extracted so unit
 * tests can validate parsing without a network call.
 */
export function parseEspnScoreboardEvents(
  body: unknown,
): Map<GameKey, EspnProbablesForGame> {
  const result = new Map<GameKey, EspnProbablesForGame>();
  const root = body as Record<string, unknown> | null;
  if (root === null || typeof root !== "object") return result;
  const events = (root.events as unknown[]) ?? [];
  if (!Array.isArray(events)) return result;

  for (const ev of events) {
    if (typeof ev !== "object" || ev === null) continue;
    const eRec = ev as Record<string, unknown>;
    const competitions = (eRec.competitions as unknown[]) ?? [];
    if (!Array.isArray(competitions) || competitions.length === 0) continue;
    const comp = competitions[0] as Record<string, unknown>;
    const competitors = (comp.competitors as unknown[]) ?? [];
    if (!Array.isArray(competitors)) continue;

    let homeAbbr: string | null = null;
    let awayAbbr: string | null = null;
    let home: EspnProbable | null = null;
    let away: EspnProbable | null = null;
    for (const c of competitors) {
      if (typeof c !== "object" || c === null) continue;
      const cRec = c as Record<string, unknown>;
      const team = cRec.team as Record<string, unknown> | undefined;
      const abbr = typeof team?.abbreviation === "string" ? team.abbreviation : null;
      const homeAway = typeof cRec.homeAway === "string" ? cRec.homeAway : null;
      const probables = (cRec.probables as unknown[]) ?? [];
      const probable: EspnProbable | null = (() => {
        if (!Array.isArray(probables) || probables.length === 0) return null;
        const first = probables[0] as Record<string, unknown>;
        const athlete = first.athlete as Record<string, unknown> | undefined;
        if (!athlete) return null;
        const id = athlete.id;
        const name =
          (typeof athlete.fullName === "string" && athlete.fullName) ||
          (typeof athlete.displayName === "string" && athlete.displayName) ||
          null;
        if (id === undefined || id === null || name === null) return null;
        const idNum = typeof id === "number" ? id : Number(id);
        if (!Number.isFinite(idNum) || idNum <= 0) return null;
        return { fullName: name, espnAthleteId: idNum };
      })();
      if (homeAway === "home") {
        homeAbbr = abbr;
        home = probable;
      } else if (homeAway === "away") {
        awayAbbr = abbr;
        away = probable;
      }
    }
    if (homeAbbr === null || awayAbbr === null) continue;
    const espnEventIdRaw = eRec.id;
    const espnEventId = typeof espnEventIdRaw === "number" ? espnEventIdRaw : Number(espnEventIdRaw);
    if (!Number.isFinite(espnEventId)) continue;
    result.set(buildGameKey(awayAbbr, homeAbbr), {
      espnEventId,
      homeTeamAbbr: homeAbbr,
      awayTeamAbbr: awayAbbr,
      home,
      away,
    });
  }
  return result;
}

/**
 * Fetches ESPN's public MLB scoreboard JSON for a given slate date.
 * Returns a Map keyed by `${awayAbbr}@${homeAbbr}`. Network failure /
 * non-JSON / malformed payload yields an empty Map plus a logged
 * warning (never throws — secondary source must not break the cycle).
 *
 * Slate date must be ISO YYYY-MM-DD; ESPN's `dates` query expects
 * YYYYMMDD which we derive here.
 */
export async function fetchEspnProbablePitchers(
  slateDate: string,
  opts: { log?: (m: string) => void; fetchImpl?: typeof fetch } = {},
): Promise<Map<GameKey, EspnProbablesForGame>> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const fetchFn = opts.fetchImpl ?? fetch;
  const yyyymmdd = slateDate.replace(/-/g, "");
  if (!/^\d{8}$/.test(yyyymmdd)) {
    log(`[espnProbablePitcherService] Invalid slate date "${slateDate}". Returning empty map.`);
    return new Map();
  }
  const url = `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=${yyyymmdd}`;
  try {
    const res = await fetchFn(url, {
      headers: { "User-Agent": "Mozilla/5.0 oddsphere/refresh-starters" },
    });
    if (!res.ok) {
      log(`[espnProbablePitcherService] ESPN scoreboard returned HTTP ${res.status} for ${slateDate}; returning empty map.`);
      return new Map();
    }
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("json")) {
      log(`[espnProbablePitcherService] ESPN scoreboard returned non-JSON content-type=${ct}; returning empty map.`);
      return new Map();
    }
    const body = (await res.json()) as unknown;
    const parsed = parseEspnScoreboardEvents(body);
    log(`[espnProbablePitcherService] ESPN scoreboard parsed: ${parsed.size} game(s) on ${slateDate}.`);
    return parsed;
  } catch (e) {
    log(`[espnProbablePitcherService] ESPN scoreboard fetch threw: ${(e as Error).message}; returning empty map.`);
    return new Map();
  }
}

/**
 * Strict players-table mapping for an ESPN-reported probable pitcher.
 * Constraints:
 *   1. team_id matches the DB game's home_team_id (or away_team_id)
 *   2. is_pitcher = true
 *   3. active = true
 *   4. full_name === ESPN's full name (exact match, case sensitive)
 *
 * Phase 6B.31a explicitly requires "exact full_name match first; if
 * fallback matching is needed, only accept if exactly one unambiguous
 * match exists". We use exact full_name match only — no fuzzy /
 * Levenshtein / nickname expansion. Returns "matched" only when exactly
 * 1 row passes all 4 constraints.
 */
export async function mapEspnPitcherToPlayer(
  supabase: SupabaseClient,
  espnName: string,
  teamId: number,
): Promise<EspnMappingResult> {
  const { data, error } = await supabase
    .from("players")
    .select("id, mlb_person_id")
    .eq("team_id", teamId)
    .eq("is_pitcher", true)
    .eq("active", true)
    .eq("full_name", espnName);
  if (error !== null) {
    return { status: "not_found", playerId: null, mlbPersonId: null, matchCount: 0 };
  }
  const rows = (data ?? []) as Array<{ id: number; mlb_person_id: number | null }>;
  if (rows.length === 0) {
    return { status: "not_found", playerId: null, mlbPersonId: null, matchCount: 0 };
  }
  if (rows.length > 1) {
    return { status: "ambiguous", playerId: null, mlbPersonId: null, matchCount: rows.length };
  }
  return {
    status: "matched",
    playerId: rows[0]!.id,
    mlbPersonId: rows[0]!.mlb_person_id,
    matchCount: 1,
  };
}

/**
 * Env-driven master switch. ESPN secondary source is enabled by
 * default; operator can set ESPN_SECONDARY_PROBABLE_PITCHER=false to
 * disable instantly if ESPN's feed misbehaves. Reads env at call time
 * so a single redeploy doesn't burn-in the value at module load.
 */
export function isEspnSecondarySourceEnabled(): boolean {
  const v = process.env.ESPN_SECONDARY_PROBABLE_PITCHER;
  if (v === undefined) return true;
  return v.toLowerCase() !== "false" && v !== "0";
}
