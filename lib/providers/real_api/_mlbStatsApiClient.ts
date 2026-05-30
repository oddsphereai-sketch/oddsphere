/**
 * Phase 3.x.0b — MLB Stats API read-only helper.
 *
 * Two named exports: `searchPersonByNameDob` (BDL identity → MLB Person ID
 * via /people/search + DOB validation) and `getPitcherFirstInningStats`
 * (first-inning splits via /people/{id}/stats).
 *
 * Endpoint shape confirmed via Phase 3.x.0a probe — `byInning` is NOT in
 * MLB's valid /statTypes enum. The correct shape for per-inning pitcher
 * data is `stats=statSplits&sitCodes=i01`.
 *
 * Public API (no auth, no key). All helpers are fail-closed: network /
 * HTTP / parse / shape failures return null and never throw.
 */

const BASE_URL = "https://statsapi.mlb.com/api/v1";

export type MlbPersonSearchResult = {
  id: number;
  fullName: string;
  birthDate: string;
  primaryPosition?: { abbreviation: string | null };
  currentTeam?: { id: number; name: string };
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
    res = await fetch(url);
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
    res = await fetch(url);
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
