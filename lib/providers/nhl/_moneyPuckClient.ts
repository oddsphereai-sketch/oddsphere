/**
 * MoneyPuck client — fetches and parses team + goalie season-summary CSVs.
 *
 * Season convention: MoneyPuck URL uses START year (e.g. 2025 = 2025-26
 * season ending June 2026). The path branches by season_type:
 *   /seasonSummary/{year}/regular/teams.csv
 *   /seasonSummary/{year}/regular/goalies.csv
 *   /seasonSummary/{year}/playoffs/teams.csv
 *   /seasonSummary/{year}/playoffs/goalies.csv
 *
 * Phase 7L probe verified availability for the current 2025-26 playoffs
 * (sizes 100KB regular teams, 45KB playoff teams, 93KB regular goalies,
 * 23KB playoff goalies). Updates lag real-time by ~hours after games
 * complete — fine for the morning model run.
 *
 * Temporary source for the 2026 Finals; a clean interface boundary so
 * we can swap to BDL NHL or another provider next season without
 * touching call sites.
 */

const MONEYPUCK_BASE = "https://moneypuck.com/moneypuck/playerData/seasonSummary";
const USER_AGENT = "oddsphere/1.0 (NHL model ingest)";

export type MoneyPuckSeasonType = "regular" | "playoffs";
export type MoneyPuckSituation = "all" | "5on5" | "4on5" | "5on4" | "other";

export type MoneyPuckTeamRow = {
  team_abbr: string;
  season: number; // MoneyPuck start-year, e.g. 2025
  season_type: MoneyPuckSeasonType;
  situation: MoneyPuckSituation;
  games_played: number | null;
  ice_time: number | null;
  xgoals_pct: number | null;
  corsi_pct: number | null;
  fenwick_pct: number | null;
  x_goals_for: number | null;
  x_goals_against: number | null;
  goals_for: number | null;
  goals_against: number | null;
  shots_on_goal_for: number | null;
  shots_on_goal_against: number | null;
  source_url: string;
  fetched_at: string;
};

export type MoneyPuckGoalieRow = {
  player_external_id: number;
  player_name: string;
  team_abbr: string;
  season: number;
  season_type: MoneyPuckSeasonType;
  situation: MoneyPuckSituation;
  games_played: number | null;
  ice_time: number | null;
  x_goals: number | null;
  goals: number | null;
  shots_against: number | null;
  saves: number | null;
  source_url: string;
  fetched_at: string;
};

/**
 * Compute the MoneyPuck season start-year for a given calendar date.
 * NHL seasons run Oct–Jun. A date in Oct or later belongs to the season
 * starting that year; a date Jan–Sep belongs to the previous Oct's
 * season.
 *   Oct 2025 → returns 2025 (the 2025-26 season).
 *   Jan 2026 → returns 2025 (still the 2025-26 season).
 *   Sep 2026 → returns 2025 (no NHL games typically; treat as previous).
 *   Oct 2026 → returns 2026 (start of 2026-27 season).
 */
export function moneyPuckSeasonStartYear(now: Date): number {
  const month = now.getUTCMonth(); // 0 = Jan, 9 = Oct
  const year = now.getUTCFullYear();
  return month >= 9 ? year : year - 1;
}

// ─── CSV utilities ────────────────────────────────────────────────────

/**
 * Minimal CSV parser. MoneyPuck's CSV is plain ASCII with no embedded
 * commas/quotes in fields, so we don't need a full RFC 4180 parser.
 * Detected duplicate "team" header column in the schema — parser picks
 * the FIRST occurrence by index when callers request "team".
 */
function parseCsv(text: string): { header: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return { header: [], rows: [] };
  const header = lines[0]!.split(",");
  const rows = lines.slice(1).map((l) => l.split(","));
  return { header, rows };
}

/** Returns the FIRST column index with the given name. */
function colIndex(header: string[], name: string): number {
  return header.indexOf(name);
}

function parseNullableNumber(s: string | undefined): number | null {
  if (s === undefined) return null;
  const t = s.trim();
  if (t === "" || t.toLowerCase() === "na") return null;
  const n = Number.parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

function parseNullableInt(s: string | undefined): number | null {
  const n = parseNullableNumber(s);
  return n === null ? null : Math.trunc(n);
}

// ─── Teams CSV ────────────────────────────────────────────────────────

export async function fetchMoneyPuckTeams(
  season: number,
  seasonType: MoneyPuckSeasonType,
): Promise<MoneyPuckTeamRow[]> {
  const url = `${MONEYPUCK_BASE}/${season}/${seasonType}/teams.csv`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    throw new Error(
      `MoneyPuck teams fetch ${season}/${seasonType} failed: HTTP ${res.status}`,
    );
  }
  const text = await res.text();
  const fetchedAt = new Date().toISOString();
  const { header, rows } = parseCsv(text);

  // Use FIRST "team" column (the schema has two "team" columns; both
  // contain the abbreviation, so either works — pick first for stability).
  const ixTeam = colIndex(header, "team");
  const ixSeason = colIndex(header, "season");
  const ixSituation = colIndex(header, "situation");
  const ixGp = colIndex(header, "games_played");
  const ixIceTime = colIndex(header, "iceTime");
  const ixXgoalsPct = colIndex(header, "xGoalsPercentage");
  const ixCorsiPct = colIndex(header, "corsiPercentage");
  const ixFenwickPct = colIndex(header, "fenwickPercentage");
  const ixXgFor = colIndex(header, "xGoalsFor");
  const ixXgAgainst = colIndex(header, "xGoalsAgainst");
  const ixGoalsFor = colIndex(header, "goalsFor");
  const ixGoalsAgainst = colIndex(header, "goalsAgainst");
  const ixSogFor = colIndex(header, "shotsOnGoalFor");
  const ixSogAgainst = colIndex(header, "shotsOnGoalAgainst");

  if (ixTeam < 0 || ixSeason < 0 || ixSituation < 0) {
    throw new Error(
      `MoneyPuck teams CSV header missing required columns (team/season/situation)`,
    );
  }

  const out: MoneyPuckTeamRow[] = [];
  for (const r of rows) {
    const situationRaw = r[ixSituation];
    if (
      situationRaw !== "all" && situationRaw !== "5on5" &&
      situationRaw !== "4on5" && situationRaw !== "5on4" &&
      situationRaw !== "other"
    ) continue;
    out.push({
      team_abbr: (r[ixTeam] ?? "").trim(),
      season: Number.parseInt(r[ixSeason] ?? "0", 10),
      season_type: seasonType,
      situation: situationRaw,
      games_played: parseNullableInt(r[ixGp]),
      ice_time: parseNullableNumber(r[ixIceTime]),
      xgoals_pct: parseNullableNumber(r[ixXgoalsPct]),
      corsi_pct: parseNullableNumber(r[ixCorsiPct]),
      fenwick_pct: parseNullableNumber(r[ixFenwickPct]),
      x_goals_for: parseNullableNumber(r[ixXgFor]),
      x_goals_against: parseNullableNumber(r[ixXgAgainst]),
      goals_for: parseNullableNumber(r[ixGoalsFor]),
      goals_against: parseNullableNumber(r[ixGoalsAgainst]),
      shots_on_goal_for: parseNullableNumber(r[ixSogFor]),
      shots_on_goal_against: parseNullableNumber(r[ixSogAgainst]),
      source_url: url,
      fetched_at: fetchedAt,
    });
  }
  return out;
}

// ─── Goalies CSV ──────────────────────────────────────────────────────

export async function fetchMoneyPuckGoalies(
  season: number,
  seasonType: MoneyPuckSeasonType,
): Promise<MoneyPuckGoalieRow[]> {
  const url = `${MONEYPUCK_BASE}/${season}/${seasonType}/goalies.csv`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    throw new Error(
      `MoneyPuck goalies fetch ${season}/${seasonType} failed: HTTP ${res.status}`,
    );
  }
  const text = await res.text();
  const fetchedAt = new Date().toISOString();
  const { header, rows } = parseCsv(text);

  const ixPlayerId = colIndex(header, "playerId");
  const ixSeason = colIndex(header, "season");
  const ixName = colIndex(header, "name");
  const ixTeam = colIndex(header, "team");
  const ixSituation = colIndex(header, "situation");
  const ixGp = colIndex(header, "games_played");
  const ixIceTime = colIndex(header, "icetime");
  const ixXg = colIndex(header, "xGoals");
  const ixGoals = colIndex(header, "goals");
  const ixOnGoal = colIndex(header, "ongoal");

  if (ixPlayerId < 0 || ixName < 0 || ixSituation < 0) {
    throw new Error(
      `MoneyPuck goalies CSV header missing required columns (playerId/name/situation)`,
    );
  }

  const out: MoneyPuckGoalieRow[] = [];
  for (const r of rows) {
    const situationRaw = r[ixSituation];
    if (
      situationRaw !== "all" && situationRaw !== "5on5" &&
      situationRaw !== "4on5" && situationRaw !== "5on4" &&
      situationRaw !== "other"
    ) continue;
    const playerId = parseNullableInt(r[ixPlayerId]);
    if (playerId === null) continue;
    const ongoal = parseNullableNumber(r[ixOnGoal]);
    const goals = parseNullableInt(r[ixGoals]);
    const saves = ongoal !== null && goals !== null ? Math.max(0, ongoal - goals) : null;
    out.push({
      player_external_id: playerId,
      player_name: (r[ixName] ?? "").trim(),
      team_abbr: (r[ixTeam] ?? "").trim(),
      season: Number.parseInt(r[ixSeason] ?? "0", 10),
      season_type: seasonType,
      situation: situationRaw,
      games_played: parseNullableInt(r[ixGp]),
      ice_time: parseNullableNumber(r[ixIceTime]),
      x_goals: parseNullableNumber(r[ixXg]),
      goals,
      shots_against: ongoal,
      saves,
      source_url: url,
      fetched_at: fetchedAt,
    });
  }
  return out;
}
