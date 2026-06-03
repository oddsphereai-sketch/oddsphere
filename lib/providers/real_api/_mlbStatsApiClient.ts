/**
 * Phase 3.x.0b — MLB Stats API read-only helper.
 *
 * Now also serves Phase 4.2.C.1.M (provider ID mapping). Public API, no
 * auth, no key. All helpers are fail-closed: network / HTTP / parse /
 * shape failures return null and never throw.
 *
 * Exports:
 *   • searchPersonByNameDob       — used by Phase 3.x.0b stats reads.
 *                                    Returns 1 match only if DOB exact
 *                                    (strict; not suitable for mapping
 *                                    where DOB normalization differs).
 *   • searchPersonsByName         — Phase 4.2.C.1.M: returns ALL
 *                                    /people/search candidates with full
 *                                    profile fields. Caller filters.
 *   • getPersonById               — Phase 4.2.C.1.M: full profile by id
 *                                    via /people/{id}. Used when an MLB
 *                                    Stats ID is already known.
 *   • getPitcherFirstInningStats  — first-inning splits via statSplits
 *                                    sitCodes=i01. Unchanged.
 *
 * User-Agent: every request carries `OddSphereAI/1.0 (contact:
 * support@oddsphereai.com)` per Phase 4.2.C.1 conventions. The header
 * identifies our traffic to MLB Stats' ops team if they need to contact
 * us about usage patterns. Defensive courtesy — not enforced by the API.
 */

const BASE_URL = "https://statsapi.mlb.com/api/v1";
const USER_AGENT = "OddSphereAI/1.0 (contact: support@oddsphereai.com)";

/** Standard headers for every MLB Stats fetch call. */
const HEADERS: HeadersInit = { "User-Agent": USER_AGENT };

export type MlbPersonSearchResult = {
  id: number;
  fullName: string;
  birthDate: string;
  primaryPosition?: { abbreviation: string | null };
  currentTeam?: { id: number; name: string };
};

/**
 * Phase 4.2.C.1.M — richer person profile for provider-ID mapping.
 *
 * Distinct from `MlbPersonSearchResult` (which is used by the stats-only
 * stricter `searchPersonByNameDob`). This shape carries every field the
 * mapping service needs to compute Tier 1-4 match confidence: name
 * variants, birth city/state, height/weight, handedness. All optional
 * because MLB Stats' `/people` response is occasionally sparse for
 * minor-leaguers and recently-promoted players.
 */
export type MlbPersonProfile = {
  id: number;
  fullName: string;
  firstName: string | null;
  lastName: string | null;
  useName: string | null;
  useLastName: string | null;
  middleName: string | null;
  birthDate: string | null;        // "YYYY-MM-DD" or null
  birthCity: string | null;
  birthStateProvince: string | null;
  birthCountry: string | null;
  height: string | null;            // "6' 4\""
  weight: number | null;            // 220 (numeric in MLB Stats)
  primaryPositionAbbr: string | null;  // "P", "1B", etc.
  primaryPositionName: string | null;  // "Pitcher", "First Baseman"
  primaryPositionType: string | null;  // "Pitcher", "Infielder"
  batSideCode: "L" | "R" | "S" | null;
  pitchHandCode: "L" | "R" | null;
  currentTeamId: number | null;
  currentTeamName: string | null;
  active: boolean | null;
};

export type PitcherFirstInningStatsRecord = {
  mlb_person_id: number;
  season: number;
  first_inning_era: number | null;
  first_inning_starts: number | null;
  first_inning_runs_allowed: number | null;
  first_inning_earned_runs: number | null;
  first_inning_innings_pitched: number | null;
  first_inning_whip: number | null;
  raw_source: "mlb_stats_api";
};

type Opts = { quiet?: boolean };

function log(opts: Opts | undefined, message: string): void {
  if (opts?.quiet) return;
  console.log(`[mlbStatsApi] ${message}`);
}

function parseFloatSafe(s: unknown): number | null {
  if (typeof s === "number" && Number.isFinite(s)) return s;
  if (typeof s !== "string") return null;
  const trimmed = s.trim();
  if (trimmed === "" || trimmed === "-.--" || trimmed.toLowerCase() === "nan") {
    return null;
  }
  const n = parseFloat(trimmed);
  return Number.isFinite(n) ? n : null;
}

function parseIntSafe(s: unknown): number | null {
  if (typeof s === "number" && Number.isFinite(s)) return Math.trunc(s);
  if (typeof s === "string") {
    const n = parseInt(s.trim(), 10);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Baseball-decimal innings parser. "6.0" → 6, "6.1" → 6+1/3, "6.2" →
 * 6+2/3, "5.2" → 5+2/3 (NOT 5.2 decimal — common bug source). Suffix
 * digit must be 0, 1, or 2; anything else returns null.
 */
export function parseBaseballInningsPitched(s: unknown): number | null {
  if (typeof s !== "string") return null;
  const trimmed = s.trim();
  if (trimmed === "") return null;
  const parts = trimmed.split(".");
  if (parts.length > 2 || parts[0] === "") return null;
  const whole = parseInt(parts[0], 10);
  if (!Number.isFinite(whole)) return null;
  const fracStr = parts[1] ?? "0";
  if (!/^[0-2]$/.test(fracStr)) return null;
  return whole + parseInt(fracStr, 10) / 3;
}

export async function searchPersonByNameDob(
  fullName: string,
  dob: string | null,
  opts?: Opts
): Promise<MlbPersonSearchResult | null> {
  if (dob === null) {
    log(opts, "search skipped: dob is null");
    return null;
  }
  const trimmedName = fullName.trim();
  if (trimmedName === "") {
    log(opts, "search skipped: name is empty");
    return null;
  }
  const url = `${BASE_URL}/people/search?names=${encodeURIComponent(trimmedName)}`;

  let res: Response;
  try {
    res = await fetch(url, { headers: HEADERS });
  } catch {
    log(opts, "network error on /people/search");
    return null;
  }
  if (!res.ok) {
    log(opts, `non-200 on /people/search: HTTP ${res.status}`);
    return null;
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    log(opts, "JSON parse error on /people/search");
    return null;
  }
  const people = (body as { people?: unknown[] })?.people;
  if (!Array.isArray(people)) {
    log(opts, "unexpected shape on /people/search");
    return null;
  }

  const matches: MlbPersonSearchResult[] = [];
  for (const p of people) {
    const x = p as Record<string, unknown>;
    if (x.birthDate !== dob) continue;
    if (typeof x.id !== "number" || typeof x.fullName !== "string") continue;
    matches.push({
      id: x.id,
      fullName: x.fullName,
      birthDate: x.birthDate as string,
      primaryPosition: x.primaryPosition as MlbPersonSearchResult["primaryPosition"],
      currentTeam: x.currentTeam as MlbPersonSearchResult["currentTeam"],
    });
  }
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) {
    log(opts, `no DOB match for "${trimmedName}" (${people.length} candidate(s))`);
    return null;
  }
  log(opts, `ambiguous: ${matches.length} same-DOB matches for "${trimmedName}"`);
  return null;
}

function emptyRecord(
  mlb_person_id: number,
  season: number
): PitcherFirstInningStatsRecord {
  return {
    mlb_person_id,
    season,
    first_inning_era: null,
    first_inning_starts: null,
    first_inning_runs_allowed: null,
    first_inning_earned_runs: null,
    first_inning_innings_pitched: null,
    first_inning_whip: null,
    raw_source: "mlb_stats_api",
  };
}

export async function getPitcherFirstInningStats(
  personId: number,
  season: number,
  opts?: Opts
): Promise<PitcherFirstInningStatsRecord | null> {
  const url =
    `${BASE_URL}/people/${personId}/stats?stats=statSplits` +
    `&group=pitching&season=${season}&sportId=1&sitCodes=i01`;

  let res: Response;
  try {
    res = await fetch(url, { headers: HEADERS });
  } catch {
    log(opts, "network error on /people/{id}/stats");
    return null;
  }
  if (!res.ok) {
    log(opts, `non-200 on /people/{id}/stats: HTTP ${res.status}`);
    return null;
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    log(opts, "JSON parse error on /people/{id}/stats");
    return null;
  }

  const stats = (body as { stats?: unknown[] })?.stats;
  if (!Array.isArray(stats) || stats.length === 0) {
    return emptyRecord(personId, season);
  }
  const block = stats[0] as Record<string, unknown>;
  const splits = block.splits;
  if (!Array.isArray(splits) || splits.length === 0) {
    return emptyRecord(personId, season);
  }
  const i01 =
    splits.find((s) => {
      const tag = (s as { split?: Record<string, unknown> }).split;
      return tag?.code === "i01";
    }) ?? splits[0];
  const stat = (i01 as { stat?: Record<string, unknown> })?.stat;
  if (!stat) return emptyRecord(personId, season);

  return {
    mlb_person_id: personId,
    season,
    first_inning_era: parseFloatSafe(stat.era),
    // statSplits does NOT expose gamesStarted. For starters, gamesPlayed
    // in the first-inning split equals starts (each first inning pitched
    // corresponds to one start), so we use it as the sample-size proxy.
    first_inning_starts: parseIntSafe(stat.gamesPlayed),
    first_inning_runs_allowed: parseIntSafe(stat.runs),
    first_inning_earned_runs: parseIntSafe(stat.earnedRuns),
    first_inning_innings_pitched: parseBaseballInningsPitched(stat.inningsPitched),
    first_inning_whip: parseFloatSafe(stat.whip),
    raw_source: "mlb_stats_api",
  };
}

// ───────────────────────────────────────────────────────────────────
// Phase 4.2.C.1.M — provider-ID mapping helpers
// ───────────────────────────────────────────────────────────────────

/**
 * Convert a single /people search-result row into the MlbPersonProfile
 * shape. Tolerant to missing optional fields — every field on
 * MlbPersonProfile is nullable for that reason.
 */
function mapPersonRow(raw: Record<string, unknown>): MlbPersonProfile | null {
  if (typeof raw.id !== "number" || typeof raw.fullName !== "string") {
    return null;
  }
  const pos = raw.primaryPosition as Record<string, unknown> | undefined;
  const bs = raw.batSide as Record<string, unknown> | undefined;
  const ph = raw.pitchHand as Record<string, unknown> | undefined;
  const team = raw.currentTeam as Record<string, unknown> | undefined;
  return {
    id: raw.id,
    fullName: raw.fullName,
    firstName: typeof raw.firstName === "string" ? raw.firstName : null,
    lastName: typeof raw.lastName === "string" ? raw.lastName : null,
    useName: typeof raw.useName === "string" ? raw.useName : null,
    useLastName: typeof raw.useLastName === "string" ? raw.useLastName : null,
    middleName: typeof raw.middleName === "string" ? raw.middleName : null,
    birthDate: typeof raw.birthDate === "string" ? raw.birthDate : null,
    birthCity: typeof raw.birthCity === "string" ? raw.birthCity : null,
    birthStateProvince:
      typeof raw.birthStateProvince === "string"
        ? raw.birthStateProvince
        : null,
    birthCountry:
      typeof raw.birthCountry === "string" ? raw.birthCountry : null,
    height: typeof raw.height === "string" ? raw.height : null,
    weight: typeof raw.weight === "number" ? raw.weight : null,
    primaryPositionAbbr:
      typeof pos?.abbreviation === "string" ? pos.abbreviation : null,
    primaryPositionName:
      typeof pos?.name === "string" ? pos.name : null,
    primaryPositionType:
      typeof pos?.type === "string" ? pos.type : null,
    batSideCode:
      bs?.code === "L" || bs?.code === "R" || bs?.code === "S"
        ? (bs.code as "L" | "R" | "S")
        : null,
    pitchHandCode:
      ph?.code === "L" || ph?.code === "R"
        ? (ph.code as "L" | "R")
        : null,
    currentTeamId: typeof team?.id === "number" ? team.id : null,
    currentTeamName: typeof team?.name === "string" ? team.name : null,
    active: typeof raw.active === "boolean" ? raw.active : null,
  };
}

/**
 * Phase 4.2.C.1.M — full MLB Stats /people/{id} fetch.
 *
 * Returns the full profile by id. Fail-closed: returns null on network
 * error, non-200, parse error, or unexpected shape.
 *
 * Used when we already know an MLB Stats person ID (e.g., from a
 * probablePitcher.id in /schedule) and need the full profile to populate
 * a new players row or compute mapping.
 */
export async function getPersonById(
  personId: number,
  opts?: Opts
): Promise<MlbPersonProfile | null> {
  const url = `${BASE_URL}/people/${personId}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: HEADERS });
  } catch {
    log(opts, "network error on /people/{id}");
    return null;
  }
  if (!res.ok) {
    log(opts, `non-200 on /people/{id}: HTTP ${res.status}`);
    return null;
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    log(opts, "JSON parse error on /people/{id}");
    return null;
  }
  const people = (body as { people?: unknown[] })?.people;
  if (!Array.isArray(people) || people.length === 0) {
    log(opts, `/people/{id} returned no person for id=${personId}`);
    return null;
  }
  return mapPersonRow(people[0] as Record<string, unknown>);
}

/**
 * Phase 4.2.C.1.M — name-search returning ALL candidates.
 *
 * Distinct from `searchPersonByNameDob` (which returns at most one
 * exact-DOB match). For mapping, we want every candidate so the
 * matcher can apply its own confidence tiers (DOB-exact, name-variant,
 * city tiebreaker, etc.) without losing data in a strict pre-filter.
 *
 * Returns empty array on any failure (fail-closed).
 */
export async function searchPersonsByName(
  name: string,
  opts?: Opts
): Promise<MlbPersonProfile[]> {
  const trimmed = name.trim();
  if (trimmed === "") return [];
  const url = `${BASE_URL}/people/search?names=${encodeURIComponent(trimmed)}`;

  let res: Response;
  try {
    res = await fetch(url, { headers: HEADERS });
  } catch {
    log(opts, "network error on /people/search");
    return [];
  }
  if (!res.ok) {
    log(opts, `non-200 on /people/search: HTTP ${res.status}`);
    return [];
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    log(opts, "JSON parse error on /people/search");
    return [];
  }
  const people = (body as { people?: unknown[] })?.people;
  if (!Array.isArray(people)) {
    log(opts, "unexpected shape on /people/search");
    return [];
  }
  const out: MlbPersonProfile[] = [];
  for (const p of people) {
    const mapped = mapPersonRow(p as Record<string, unknown>);
    if (mapped !== null) out.push(mapped);
  }
  return out;
}
