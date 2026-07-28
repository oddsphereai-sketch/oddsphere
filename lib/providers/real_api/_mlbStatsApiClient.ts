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
 *   • fetchMlbStatsScheduleRaw    — Phase 4.2.C.1.G-2: raw /schedule
 *                                    fetch for one date, hydrate=
 *                                    probablePitcher. Consumed by
 *                                    `parseMlbStatsSchedule` in the
 *                                    starter-refresh operator.
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

export type PitcherGameLogRecord = {
  mlb_person_id: number;
  season: number;
  game_pk: number;
  game_date: string;
  team_id: number;
  opponent_team_id: number;
  opponent_name: string | null;
  is_home: boolean | null;
  is_start: boolean;
  innings_pitched: number | null;
  outs: number | null;
  strikeouts: number | null;
  walks: number | null;
  hits_allowed: number | null;
  earned_runs: number | null;
  runs_allowed: number | null;
  home_runs_allowed: number | null;
  batters_faced: number | null;
  pitch_count: number | null;
  raw_source: "mlb_stats_api";
};

export type HitterGameLogRecord = {
  mlb_person_id: number;
  season: number;
  game_pk: number;
  game_date: string;
  team_id: number;
  opponent_team_id: number;
  opponent_name: string | null;
  is_home: boolean | null;
  plate_appearances: number | null;
  at_bats: number | null;
  hits: number | null;
  singles: number | null;
  doubles: number | null;
  triples: number | null;
  home_runs: number | null;
  total_bases: number | null;
  rbis: number | null;
  runs: number | null;
  strikeouts: number | null;
  walks: number | null;
  stolen_bases: number | null;
  hits_runs_rbis: number | null;
  raw_source: "mlb_stats_api";
};

export type BatterVsPitcherStatsRecord = {
  batter_id: number;
  pitcher_id: number;
  batter_name: string | null;
  pitcher_name: string | null;
  games_played: number;
  plate_appearances: number;
  at_bats: number;
  hits: number;
  doubles: number;
  triples: number;
  home_runs: number;
  walks: number;
  strikeouts: number;
  total_bases: number;
  rbis: number;
  batting_average: number | null;
  on_base_percentage: number | null;
  slugging_percentage: number | null;
  ops: number | null;
  pitches_seen: number;
  raw_source: "mlb_stats_api";
};

export type MlbTeamHittingProfile = {
  team_id: number;
  team_name: string;
  season: number;
  games_played: number | null;
  plate_appearances: number;
  at_bats: number | null;
  hits: number | null;
  strikeouts: number | null;
  walks: number | null;
  home_runs: number | null;
  batting_average: number | null;
  on_base_percentage: number | null;
  slugging_percentage: number | null;
  ops: number | null;
  strikeout_rate: number | null;
  walk_rate: number | null;
  home_run_rate: number | null;
  ranks: {
    strikeout_rate: number | null;
    walk_rate: number | null;
    batting_average: number | null;
    ops: number | null;
    home_run_rate: number | null;
    out_of: number;
  };
  league_average: {
    strikeout_rate: number | null;
    walk_rate: number | null;
    batting_average: number | null;
    ops: number | null;
    home_run_rate: number | null;
  };
  raw_source: "mlb_stats_api";
};

export type MlbHitterSeasonStatsRecord = {
  mlb_person_id: number;
  season: number;
  team_id: number | null;
  games_played: number | null;
  at_bats: number | null;
  runs: number | null;
  hits: number | null;
  batting_average: number | null;
  doubles: number | null;
  triples: number | null;
  home_runs: number | null;
  rbis: number | null;
  total_bases: number | null;
  walks: number | null;
  strikeouts: number | null;
  stolen_bases: number | null;
  on_base_percentage: number | null;
  slugging_percentage: number | null;
  ops: number | null;
  plate_appearances: number | null;
  hit_by_pitch: number | null;
  sacrifice_flies: number | null;
  raw_source: "mlb_stats_api";
};

type Opts = { quiet?: boolean; signal?: AbortSignal };

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

function nullableDifference(
  total: number | null,
  ...parts: Array<number | null>
): number | null {
  return total === null || parts.some((part) => part === null)
    ? null
    : Math.max(0, total - parts.reduce<number>((sum, part) => sum + (part ?? 0), 0));
}

function nullableSum(...values: Array<number | null>): number | null {
  return values.some((value) => value === null)
    ? null
    : values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
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

export function parsePitcherGameLogPayload(
  payload: unknown,
  personId: number,
  season: number
): PitcherGameLogRecord[] {
  if (!isObject(payload) || !Array.isArray(payload.stats)) return [];
  const block = payload.stats.find((candidate) => {
    if (!isObject(candidate) || !isObject(candidate.type)) return false;
    return candidate.type.displayName === "gameLog";
  }) ?? payload.stats[0];
  if (!isObject(block) || !Array.isArray(block.splits)) return [];

  const rows: PitcherGameLogRecord[] = [];
  for (const candidate of block.splits) {
    if (!isObject(candidate) || !isObject(candidate.stat)) continue;
    const game = isObject(candidate.game) ? candidate.game : null;
    const team = isObject(candidate.team) ? candidate.team : null;
    const opponent = isObject(candidate.opponent) ? candidate.opponent : null;
    const gamePk = parseIntSafe(game?.gamePk);
    const teamId = parseIntSafe(team?.id);
    const opponentTeamId = parseIntSafe(opponent?.id);
    const gameDate = typeof candidate.date === "string" ? candidate.date : null;
    if (gamePk === null || teamId === null || opponentTeamId === null || gameDate === null) continue;

    const stat = candidate.stat;
    rows.push({
      mlb_person_id: personId,
      season,
      game_pk: gamePk,
      game_date: gameDate,
      team_id: teamId,
      opponent_team_id: opponentTeamId,
      opponent_name: typeof opponent?.name === "string" ? opponent.name : null,
      is_home: typeof candidate.isHome === "boolean" ? candidate.isHome : null,
      is_start: parseIntSafe(stat.gamesStarted) === 1,
      innings_pitched: parseBaseballInningsPitched(stat.inningsPitched),
      outs: parseIntSafe(stat.outs),
      strikeouts: parseIntSafe(stat.strikeOuts),
      walks: parseIntSafe(stat.baseOnBalls),
      hits_allowed: parseIntSafe(stat.hits),
      earned_runs: parseIntSafe(stat.earnedRuns),
      runs_allowed: parseIntSafe(stat.runs),
      home_runs_allowed: parseIntSafe(stat.homeRuns),
      batters_faced: parseIntSafe(stat.battersFaced),
      pitch_count: parseIntSafe(stat.numberOfPitches),
      raw_source: "mlb_stats_api",
    });
  }
  return rows;
}

/**
 * Read-only season game log for one pitcher. Callers apply their own
 * pregame as-of filter so a future game can never leak into a feature row.
 */
export async function getPitcherGameLogs(
  personId: number,
  season: number,
  opts?: Opts
): Promise<PitcherGameLogRecord[] | null> {
  const url =
    `${BASE_URL}/people/${personId}/stats?stats=gameLog` +
    `&group=pitching&season=${season}&sportId=1`;

  let res: Response;
  try {
    res = await fetch(url, { headers: HEADERS, signal: opts?.signal });
  } catch {
    log(opts, "network error on pitcher game log");
    return null;
  }
  if (!res.ok) {
    log(opts, `non-200 on pitcher game log: HTTP ${res.status}`);
    return null;
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    log(opts, "JSON parse error on pitcher game log");
    return null;
  }
  return parsePitcherGameLogPayload(body, personId, season);
}

export function parseHitterGameLogPayload(
  payload: unknown,
  personId: number,
  season: number
): HitterGameLogRecord[] {
  if (!isObject(payload) || !Array.isArray(payload.stats)) return [];
  const block = payload.stats.find((candidate) => {
    if (!isObject(candidate) || !isObject(candidate.type)) return false;
    return candidate.type.displayName === "gameLog";
  }) ?? payload.stats[0];
  if (!isObject(block) || !Array.isArray(block.splits)) return [];

  const rows: HitterGameLogRecord[] = [];
  for (const candidate of block.splits) {
    if (!isObject(candidate) || !isObject(candidate.stat)) continue;
    const game = isObject(candidate.game) ? candidate.game : null;
    const team = isObject(candidate.team) ? candidate.team : null;
    const opponent = isObject(candidate.opponent) ? candidate.opponent : null;
    const gamePk = parseIntSafe(game?.gamePk);
    const teamId = parseIntSafe(team?.id);
    const opponentTeamId = parseIntSafe(opponent?.id);
    const gameDate = typeof candidate.date === "string" ? candidate.date : null;
    if (gamePk === null || teamId === null || opponentTeamId === null || gameDate === null) continue;
    const stat = candidate.stat;
    const hits = parseIntSafe(stat.hits);
    const doubles = parseIntSafe(stat.doubles);
    const triples = parseIntSafe(stat.triples);
    const homeRuns = parseIntSafe(stat.homeRuns);
    const rbis = parseIntSafe(stat.rbi);
    const runs = parseIntSafe(stat.runs);
    rows.push({
      mlb_person_id: personId,
      season,
      game_pk: gamePk,
      game_date: gameDate,
      team_id: teamId,
      opponent_team_id: opponentTeamId,
      opponent_name: typeof opponent?.name === "string" ? opponent.name : null,
      is_home: typeof candidate.isHome === "boolean" ? candidate.isHome : null,
      plate_appearances: parseIntSafe(stat.plateAppearances),
      at_bats: parseIntSafe(stat.atBats),
      hits,
      singles: nullableDifference(hits, doubles, triples, homeRuns),
      doubles,
      triples,
      home_runs: homeRuns,
      total_bases: parseIntSafe(stat.totalBases),
      rbis,
      runs,
      strikeouts: parseIntSafe(stat.strikeOuts),
      walks: parseIntSafe(stat.baseOnBalls),
      stolen_bases: parseIntSafe(stat.stolenBases),
      hits_runs_rbis: nullableSum(hits, runs, rbis),
      raw_source: "mlb_stats_api",
    });
  }
  return rows;
}

export async function getHitterGameLogs(
  personId: number,
  season: number,
  opts?: Opts
): Promise<HitterGameLogRecord[] | null> {
  const url =
    `${BASE_URL}/people/${personId}/stats?stats=gameLog` +
    `&group=hitting&season=${season}&sportId=1`;
  let res: Response;
  try {
    res = await fetch(url, { headers: HEADERS, signal: opts?.signal });
  } catch {
    log(opts, "network error on hitter game log");
    return null;
  }
  if (!res.ok) {
    log(opts, `non-200 on hitter game log: HTTP ${res.status}`);
    return null;
  }
  try {
    return parseHitterGameLogPayload(await res.json(), personId, season);
  } catch {
    log(opts, "JSON parse error on hitter game log");
    return null;
  }
}

export function parseBatterVsPitcherStatsPayload(
  payload: unknown,
  batterId: number,
  pitcherId: number,
): BatterVsPitcherStatsRecord | null {
  if (!isObject(payload) || !Array.isArray(payload.stats)) return null;
  const block = payload.stats.find((candidate) => {
    if (!isObject(candidate) || !isObject(candidate.type)) return false;
    return candidate.type.displayName === "vsPlayerTotal";
  }) ?? payload.stats.find((candidate) => {
    if (!isObject(candidate) || !isObject(candidate.type)) return false;
    return candidate.type.displayName === "vsPlayer";
  });
  if (!isObject(block) || !Array.isArray(block.splits)) return null;
  const split = block.splits.find((candidate) => isObject(candidate) && isObject(candidate.stat));
  if (!isObject(split) || !isObject(split.stat)) return emptyBatterVsPitcherRecord(batterId, pitcherId);
  const batter = isObject(split.batter) ? split.batter : null;
  const pitcher = isObject(split.pitcher) ? split.pitcher : null;
  const stat = split.stat;
  return {
    batter_id: batterId,
    pitcher_id: pitcherId,
    batter_name: typeof batter?.fullName === "string" ? batter.fullName : null,
    pitcher_name: typeof pitcher?.fullName === "string" ? pitcher.fullName : null,
    games_played: parseIntSafe(stat.gamesPlayed) ?? 0,
    plate_appearances: parseIntSafe(stat.plateAppearances) ?? 0,
    at_bats: parseIntSafe(stat.atBats) ?? 0,
    hits: parseIntSafe(stat.hits) ?? 0,
    doubles: parseIntSafe(stat.doubles) ?? 0,
    triples: parseIntSafe(stat.triples) ?? 0,
    home_runs: parseIntSafe(stat.homeRuns) ?? 0,
    walks: parseIntSafe(stat.baseOnBalls) ?? 0,
    strikeouts: parseIntSafe(stat.strikeOuts) ?? 0,
    total_bases: parseIntSafe(stat.totalBases) ?? 0,
    rbis: parseIntSafe(stat.rbi) ?? 0,
    batting_average: parseFloatSafe(stat.avg),
    on_base_percentage: parseFloatSafe(stat.obp),
    slugging_percentage: parseFloatSafe(stat.slg),
    ops: parseFloatSafe(stat.ops),
    pitches_seen: parseIntSafe(stat.numberOfPitches) ?? 0,
    raw_source: "mlb_stats_api",
  };
}

export async function getBatterVsPitcherStats(
  batterId: number,
  pitcherId: number,
  opts?: Opts,
): Promise<BatterVsPitcherStatsRecord | null> {
  const url = `${BASE_URL}/people/${batterId}/stats?stats=vsPlayer&group=hitting&opposingPlayerId=${pitcherId}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: HEADERS, signal: opts?.signal });
  } catch {
    log(opts, "network error on batter-vs-pitcher stats");
    return null;
  }
  if (!res.ok) {
    log(opts, `non-200 on batter-vs-pitcher stats: HTTP ${res.status}`);
    return null;
  }
  try {
    return parseBatterVsPitcherStatsPayload(await res.json(), batterId, pitcherId);
  } catch {
    log(opts, "JSON parse error on batter-vs-pitcher stats");
    return null;
  }
}

function emptyBatterVsPitcherRecord(batterId: number, pitcherId: number): BatterVsPitcherStatsRecord {
  return {
    batter_id: batterId,
    pitcher_id: pitcherId,
    batter_name: null,
    pitcher_name: null,
    games_played: 0,
    plate_appearances: 0,
    at_bats: 0,
    hits: 0,
    doubles: 0,
    triples: 0,
    home_runs: 0,
    walks: 0,
    strikeouts: 0,
    total_bases: 0,
    rbis: 0,
    batting_average: null,
    on_base_percentage: null,
    slugging_percentage: null,
    ops: null,
    pitches_seen: 0,
    raw_source: "mlb_stats_api",
  };
}

/**
 * Parse the all-team season hitting response into research-ready opponent
 * profiles. Rank 1 always means the highest value for that metric; callers
 * decide whether a high value is favorable for the selected prop.
 */
export function parseMlbTeamHittingProfiles(
  payload: unknown,
  season: number
): MlbTeamHittingProfile[] {
  if (!isObject(payload) || !Array.isArray(payload.stats)) return [];
  const block = payload.stats.find((candidate) => {
    if (!isObject(candidate) || !isObject(candidate.group)) return false;
    return candidate.group.displayName === "hitting";
  }) ?? payload.stats[0];
  if (!isObject(block) || !Array.isArray(block.splits)) return [];

  type ParsedTeam = Omit<MlbTeamHittingProfile, "ranks" | "league_average">;
  const teams: ParsedTeam[] = [];
  for (const candidate of block.splits) {
    if (!isObject(candidate) || !isObject(candidate.team) || !isObject(candidate.stat)) continue;
    const teamId = parseIntSafe(candidate.team.id);
    const teamName = typeof candidate.team.name === "string" ? candidate.team.name : null;
    const plateAppearances = parseIntSafe(candidate.stat.plateAppearances);
    if (teamId === null || teamName === null || plateAppearances === null || plateAppearances <= 0) continue;
    const atBats = parseIntSafe(candidate.stat.atBats);
    const hits = parseIntSafe(candidate.stat.hits);
    const strikeouts = parseIntSafe(candidate.stat.strikeOuts);
    const walks = parseIntSafe(candidate.stat.baseOnBalls);
    const homeRuns = parseIntSafe(candidate.stat.homeRuns);
    teams.push({
      team_id: teamId,
      team_name: teamName,
      season,
      games_played: parseIntSafe(candidate.stat.gamesPlayed),
      plate_appearances: plateAppearances,
      at_bats: atBats,
      hits,
      strikeouts,
      walks,
      home_runs: homeRuns,
      batting_average: parseFloatSafe(candidate.stat.avg),
      on_base_percentage: parseFloatSafe(candidate.stat.obp),
      slugging_percentage: parseFloatSafe(candidate.stat.slg),
      ops: parseFloatSafe(candidate.stat.ops),
      strikeout_rate: rate(strikeouts, plateAppearances),
      walk_rate: rate(walks, plateAppearances),
      home_run_rate: rate(homeRuns, plateAppearances),
      raw_source: "mlb_stats_api",
    });
  }
  if (!teams.length) return [];

  const leagueAverage = {
    strikeout_rate: rate(sumNullable(teams.map((team) => team.strikeouts)), sumNullable(teams.map((team) => team.plate_appearances))),
    walk_rate: rate(sumNullable(teams.map((team) => team.walks)), sumNullable(teams.map((team) => team.plate_appearances))),
    batting_average: rate(sumNullable(teams.map((team) => team.hits)), sumNullable(teams.map((team) => team.at_bats))),
    ops: averageNullable(teams.map((team) => team.ops)),
    home_run_rate: rate(sumNullable(teams.map((team) => team.home_runs)), sumNullable(teams.map((team) => team.plate_appearances))),
  };
  const rankMaps = {
    strikeout_rate: rankDescending(teams, "strikeout_rate"),
    walk_rate: rankDescending(teams, "walk_rate"),
    batting_average: rankDescending(teams, "batting_average"),
    ops: rankDescending(teams, "ops"),
    home_run_rate: rankDescending(teams, "home_run_rate"),
  };

  return teams.map((team) => ({
    ...team,
    ranks: {
      strikeout_rate: rankMaps.strikeout_rate.get(team.team_id) ?? null,
      walk_rate: rankMaps.walk_rate.get(team.team_id) ?? null,
      batting_average: rankMaps.batting_average.get(team.team_id) ?? null,
      ops: rankMaps.ops.get(team.team_id) ?? null,
      home_run_rate: rankMaps.home_run_rate.get(team.team_id) ?? null,
      out_of: teams.length,
    },
    league_average: leagueAverage,
  }));
}

/** Parse the one-call, all-MLB current-season hitter aggregate response. */
export function parseMlbHitterSeasonStats(
  payload: unknown,
  season: number,
): MlbHitterSeasonStatsRecord[] {
  if (!isObject(payload) || !Array.isArray(payload.stats)) return [];
  const block = payload.stats.find((candidate) => {
    if (!isObject(candidate) || !isObject(candidate.group)) return false;
    return candidate.group.displayName === "hitting";
  }) ?? payload.stats[0];
  if (!isObject(block) || !Array.isArray(block.splits)) return [];

  const rows: MlbHitterSeasonStatsRecord[] = [];
  for (const candidate of block.splits) {
    if (!isObject(candidate) || !isObject(candidate.player) || !isObject(candidate.stat)) continue;
    const personId = parseIntSafe(candidate.player.id);
    if (personId === null) continue;
    const team = isObject(candidate.team) ? candidate.team : null;
    const stat = candidate.stat;
    rows.push({
      mlb_person_id: personId,
      season,
      team_id: parseIntSafe(team?.id),
      games_played: parseIntSafe(stat.gamesPlayed),
      at_bats: parseIntSafe(stat.atBats),
      runs: parseIntSafe(stat.runs),
      hits: parseIntSafe(stat.hits),
      batting_average: parseFloatSafe(stat.avg),
      doubles: parseIntSafe(stat.doubles),
      triples: parseIntSafe(stat.triples),
      home_runs: parseIntSafe(stat.homeRuns),
      rbis: parseIntSafe(stat.rbi),
      total_bases: parseIntSafe(stat.totalBases),
      walks: parseIntSafe(stat.baseOnBalls),
      strikeouts: parseIntSafe(stat.strikeOuts),
      stolen_bases: parseIntSafe(stat.stolenBases),
      on_base_percentage: parseFloatSafe(stat.obp),
      slugging_percentage: parseFloatSafe(stat.slg),
      ops: parseFloatSafe(stat.ops),
      plate_appearances: parseIntSafe(stat.plateAppearances),
      hit_by_pitch: parseIntSafe(stat.hitByPitch),
      sacrifice_flies: parseIntSafe(stat.sacFlies),
      raw_source: "mlb_stats_api",
    });
  }
  return rows;
}

/**
 * Read all MLB hitter season aggregates in one request. `playerPool=ALL`
 * avoids the 150-player qualified-only truncation while keeping the slate
 * cycle to a single provider call.
 */
export async function getMlbHitterSeasonStats(
  season: number,
  opts?: Opts,
): Promise<MlbHitterSeasonStatsRecord[] | null> {
  const url =
    `${BASE_URL}/stats?stats=season&group=hitting&season=${season}` +
    "&gameType=R&sportId=1&playerPool=ALL&limit=2000";
  let res: Response;
  try {
    res = await fetch(url, { headers: HEADERS, signal: opts?.signal });
  } catch {
    log(opts, "network error on all-hitter season stats");
    return null;
  }
  if (!res.ok) {
    log(opts, `non-200 on all-hitter season stats: HTTP ${res.status}`);
    return null;
  }
  try {
    return parseMlbHitterSeasonStats(await res.json(), season);
  } catch {
    log(opts, "JSON parse error on all-hitter season stats");
    return null;
  }
}

/**
 * Read leakage-safe hitter aggregates through an explicit historical date.
 * Used by the model-input replay audit so every slate is evaluated with only
 * statistics that were available before that slate began.
 */
export async function getMlbHitterStatsByDateRange(
  season: number,
  startDate: string,
  endDate: string,
  opts?: Opts,
): Promise<MlbHitterSeasonStatsRecord[] | null> {
  const url =
    `${BASE_URL}/stats?stats=byDateRange&group=hitting` +
    `&startDate=${encodeURIComponent(startDate)}` +
    `&endDate=${encodeURIComponent(endDate)}` +
    "&gameType=R&sportId=1&playerPool=ALL&limit=2000";
  let res: Response;
  try {
    res = await fetch(url, { headers: HEADERS, signal: opts?.signal });
  } catch {
    log(opts, "network error on historical all-hitter stats");
    return null;
  }
  if (!res.ok) {
    log(opts, `non-200 on historical all-hitter stats: HTTP ${res.status}`);
    return null;
  }
  try {
    return parseMlbHitterSeasonStats(await res.json(), season);
  } catch {
    log(opts, "JSON parse error on historical all-hitter stats");
    return null;
  }
}

/** Read-only all-team season hitting profiles for opponent research. */
export async function getMlbTeamHittingProfiles(
  season: number,
  opts?: Opts
): Promise<MlbTeamHittingProfile[] | null> {
  const url = `${BASE_URL}/teams/stats?stats=season&group=hitting&season=${season}&sportIds=1`;
  let res: Response;
  try {
    res = await fetch(url, { headers: HEADERS, signal: opts?.signal });
  } catch {
    log(opts, "network error on team hitting profiles");
    return null;
  }
  if (!res.ok) {
    log(opts, `non-200 on team hitting profiles: HTTP ${res.status}`);
    return null;
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    log(opts, "JSON parse error on team hitting profiles");
    return null;
  }
  return parseMlbTeamHittingProfiles(body, season);
}

function rate(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator <= 0) return null;
  return numerator / denominator;
}

function sumNullable(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return present.length ? present.reduce((sum, value) => sum + value, 0) : null;
}

function averageNullable(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : null;
}

function rankDescending<T extends { team_id: number }>(
  rows: T[],
  key: keyof T
): Map<number, number> {
  const sorted = rows
    .filter((row) => typeof row[key] === "number" && Number.isFinite(row[key]))
    .sort((a, b) => Number(b[key]) - Number(a[key]));
  return new Map(sorted.map((row, index) => [row.team_id, index + 1]));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

/**
 * Phase 4.2.C.1.R-11 — season-aggregate pitching stats shape.
 *
 * Sourced from MLB Stats API `/people/{id}/stats?stats=season&group=pitching`.
 * Unlike the first-inning variant which uses statSplits + sitCodes=i01,
 * this one returns the full season aggregate across all innings.
 *
 * All numeric fields are nullable — when MLB Stats returns no row for
 * the requested season (e.g., minor leagues, pre-debut, etc.) the
 * function emits an "empty" record with every field null. Callers
 * decide whether to write the empty row or skip it.
 *
 * `raw_source` lets downstream loggers attribute the row to its origin.
 */
export type PitcherSeasonStatsRecord = {
  mlb_person_id: number;
  season: number;
  /** GamesPlayed from the stat block. Maps to schema's `pitching_gp`. */
  games_played: number | null;
  /** GamesStarted. Maps to `pitching_gs`. */
  games_started: number | null;
  wins: number | null;
  losses: number | null;
  /** ERA from MLB Stats. Maps to `pitching_era` DECIMAL(5,2). */
  era: number | null;
  /** WHIP from MLB Stats. Maps to `pitching_whip` DECIMAL(5,3). */
  whip: number | null;
  /** Innings pitched as a true decimal (X.1 → X+1/3, X.2 → X+2/3
   * parsed via `parseBaseballInningsPitched`). Maps to `pitching_ip`
   * DECIMAL(6,3). */
  innings_pitched: number | null;
  hits_allowed: number | null;
  earned_runs: number | null;
  home_runs_allowed: number | null;
  walks: number | null;
  strikeouts: number | null;
  /** K/9 either as returned by MLB Stats (`strikeoutsPer9Inn`) or
   * computed as `strikeouts * 9 / innings_pitched` when IP > 0.
   * Maps to `pitching_k_per_9` DECIMAL(5,2). Null when uncomputable. */
  strikeouts_per_9: number | null;
  /** Saves + holds — usually 0 for starters but included for relief
   * usage. Map to `pitching_sv` / `pitching_hld`. */
  saves: number | null;
  holds: number | null;
  raw_source: "mlb_stats_api" | "empty";
};

function emptySeasonRecord(personId: number, season: number): PitcherSeasonStatsRecord {
  return {
    mlb_person_id: personId,
    season,
    games_played: null,
    games_started: null,
    wins: null,
    losses: null,
    era: null,
    whip: null,
    innings_pitched: null,
    hits_allowed: null,
    earned_runs: null,
    home_runs_allowed: null,
    walks: null,
    strikeouts: null,
    strikeouts_per_9: null,
    saves: null,
    holds: null,
    raw_source: "empty",
  };
}

/**
 * Fetch season-aggregate pitching stats for a single MLB person ID.
 *
 * Returns a single record by picking the LAST split (most recent team
 * — MLB Stats returns one split per team when a pitcher was traded
 * mid-season; the last split is the current team). Sum-across-teams
 * isn't needed here: in V1 the model reads season ERA / WHIP per
 * starter and a player's current-team aggregate is what matters for
 * tonight's prediction. A future phase can aggregate cross-team if
 * traded pitchers' season-level stats need to combine.
 *
 * Behavior on missing data is identical to the FI helper:
 *   - Endpoint OK but no stats block → empty record (caller skips or
 *     writes empty)
 *   - Network / non-200 / parse errors → null (caller logs + skips)
 *
 * Pure / no DB I/O. Used by `seasonPitchingStatsWriter` and the
 * `backfill-season-pitching-stats` operator.
 */
export async function getPitcherSeasonStats(
  personId: number,
  season: number,
  opts?: Opts
): Promise<PitcherSeasonStatsRecord | null> {
  const url =
    `${BASE_URL}/people/${personId}/stats?stats=season` +
    `&group=pitching&season=${season}&sportId=1`;

  let res: Response;
  try {
    res = await fetch(url, { headers: HEADERS });
  } catch {
    log(opts, "network error on /people/{id}/stats?stats=season");
    return null;
  }
  if (!res.ok) {
    log(opts, `non-200 on /people/{id}/stats?stats=season: HTTP ${res.status}`);
    return null;
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    log(opts, "JSON parse error on /people/{id}/stats?stats=season");
    return null;
  }

  const stats = (body as { stats?: unknown[] })?.stats;
  if (!Array.isArray(stats) || stats.length === 0) {
    return emptySeasonRecord(personId, season);
  }
  const block = stats[0] as Record<string, unknown>;
  const splits = block.splits;
  if (!Array.isArray(splits) || splits.length === 0) {
    return emptySeasonRecord(personId, season);
  }
  // Pick the LATEST split (current team after any trade).
  const split = splits[splits.length - 1] as Record<string, unknown>;
  const stat = (split as { stat?: Record<string, unknown> })?.stat;
  if (!stat) return emptySeasonRecord(personId, season);

  const ip = parseBaseballInningsPitched(stat.inningsPitched);
  const k = parseIntSafe(stat.strikeOuts);
  // Prefer MLB Stats' own K/9 when present; fall back to computed when IP > 0
  let k9 = parseFloatSafe(stat.strikeoutsPer9Inn);
  if (k9 === null && k !== null && ip !== null && ip > 0) {
    k9 = (k * 9) / ip;
  }
  return {
    mlb_person_id: personId,
    season,
    games_played: parseIntSafe(stat.gamesPlayed),
    games_started: parseIntSafe(stat.gamesStarted),
    wins: parseIntSafe(stat.wins),
    losses: parseIntSafe(stat.losses),
    era: parseFloatSafe(stat.era),
    whip: parseFloatSafe(stat.whip),
    innings_pitched: ip,
    hits_allowed: parseIntSafe(stat.hits),
    earned_runs: parseIntSafe(stat.earnedRuns),
    home_runs_allowed: parseIntSafe(stat.homeRuns),
    walks: parseIntSafe(stat.baseOnBalls),
    strikeouts: k,
    strikeouts_per_9: k9,
    saves: parseIntSafe(stat.saves),
    holds: parseIntSafe(stat.holds),
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

// ───────────────────────────────────────────────────────────────────
// Phase 4.2.C.1.G-2 — /schedule with probablePitcher hydrate
// ───────────────────────────────────────────────────────────────────

/**
 * Fetch the raw MLB Stats `/api/v1/schedule` payload for one slate date.
 *
 *   GET https://statsapi.mlb.com/api/v1/schedule
 *       ?date=YYYY-MM-DD&sportId=1&hydrate=probablePitcher
 *
 * Returns the raw JSON for `parseMlbStatsSchedule` (in
 * lib/services/starterResolver) to consume.
 *
 * Fail-closed: any network / HTTP / parse error returns `null` with a log
 * line. The operator caller checks for `null` and decides whether to
 * proceed with degraded coverage or abort the run.
 */
export async function fetchMlbStatsScheduleRaw(
  date: string,
  opts?: Opts
): Promise<unknown> {
  const url =
    `${BASE_URL}/schedule?date=${encodeURIComponent(date)}` +
    `&sportId=1&hydrate=probablePitcher`;
  let res: Response;
  try {
    res = await fetch(url, { headers: HEADERS, signal: opts?.signal });
  } catch {
    log(opts, `network error on /schedule for ${date}`);
    return null;
  }
  if (!res.ok) {
    log(opts, `non-200 on /schedule for ${date}: HTTP ${res.status}`);
    return null;
  }
  try {
    return await res.json();
  } catch {
    log(opts, `JSON parse error on /schedule for ${date}`);
    return null;
  }
}

// ───────────────────────────────────────────────────────────────────
// Phase 4.2.C.1.R-15 — active-roster helper for bullpen ingestion
// ───────────────────────────────────────────────────────────────────

/**
 * Light roster-entry shape returned by `getActiveRoster`. Just enough
 * for the bullpen planner to classify (position abbreviation + person
 * id + name). The full profile required for `players` row insert is
 * fetched separately via `getPersonById` on the selected candidates.
 */
export type MlbRosterEntry = {
  personId: number;
  fullName: string;
  positionAbbreviation: string | null; // typically "P" for all pitchers
  positionType: string | null;          // "Pitcher" / "Hitter" / etc.
  status: string | null;                // "Active" / "Disabled List" / etc.
};

/**
 * R-15 — fetch a team's active roster.
 *
 *   GET /api/v1/teams/{teamId}/roster?rosterType=active
 *
 * Returns the list of active roster entries (40-man + injured-list
 * variants depending on `rosterType`). For bullpen ingestion we use
 * `rosterType=active` to get the players physically on the team.
 *
 * Fail-closed: network / HTTP / parse / shape errors all return `null`
 * so callers can log + skip without throwing.
 */
export async function getActiveRoster(
  teamId: number,
  opts?: Opts
): Promise<MlbRosterEntry[] | null> {
  const url = `${BASE_URL}/teams/${teamId}/roster?rosterType=active`;
  let res: Response;
  try {
    res = await fetch(url, { headers: HEADERS });
  } catch {
    log(opts, `network error on /teams/${teamId}/roster`);
    return null;
  }
  if (!res.ok) {
    log(opts, `non-200 on /teams/${teamId}/roster: HTTP ${res.status}`);
    return null;
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    log(opts, `JSON parse error on /teams/${teamId}/roster`);
    return null;
  }
  const roster = (body as { roster?: unknown[] })?.roster;
  if (!Array.isArray(roster)) {
    log(opts, `unexpected shape on /teams/${teamId}/roster`);
    return null;
  }
  const out: MlbRosterEntry[] = [];
  for (const r of roster) {
    const row = r as Record<string, unknown>;
    const person = (row.person ?? null) as Record<string, unknown> | null;
    const position = (row.position ?? null) as Record<string, unknown> | null;
    const status = (row.status ?? null) as Record<string, unknown> | null;
    const personId = parseIntSafe(person?.id);
    if (personId === null) continue;
    const fullName = typeof person?.fullName === "string" ? person.fullName : "";
    if (fullName === "") continue;
    out.push({
      personId,
      fullName,
      positionAbbreviation:
        typeof position?.abbreviation === "string"
          ? position.abbreviation
          : null,
      positionType:
        typeof position?.type === "string" ? position.type : null,
      status:
        typeof status?.description === "string" ? status.description : null,
    });
  }
  return out;
}
