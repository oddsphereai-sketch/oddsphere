/**
 * Phase 7B.0 — ESPN public NBA scoreboard client.
 *
 * Source: https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard
 *
 * Used for:
 *   • Today's NBA Finals game (schedule, home/away, status, scores)
 *   • Series context: ESPN's `competitions[0].series` field provides
 *     `summary` ("NY leads series 2-0"), `competitors[].wins`,
 *     `totalCompetitions` (best-of-7 = 7), `completed`. We derive game
 *     number / venue shift / elimination from this.
 *   • Notes: `competitions[0].notes[]` includes `{type:"event",
 *     headline:"NBA Finals - Game 3"}` for postseason rounds.
 *
 * Public endpoint — no auth, no rate limit (modest use). All access is
 * read-only; ESPN is not mutated.
 *
 * Defensive parsing: every field is nullable; missing/malformed payload
 * returns the closest-to-empty CanonicalNbaEvent rather than throwing.
 * Callers decide whether absence is fatal.
 */

const BASE_URL =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; OddsphereAI/1.0)",
  Accept: "application/json",
} as const;

/**
 * Cleaned-up NBA event for our domain. We deliberately do NOT mirror
 * ESPN's nested shape — too much accidental dependency on their
 * internals.
 */
export type CanonicalNbaEvent = {
  /** ESPN event id (string). Used as the canonical event_id when BDL not available. */
  espn_event_id: string;
  /** ISO timestamp (UTC). */
  start_time: string;
  /** ESPN status name, e.g. "STATUS_SCHEDULED", "STATUS_IN_PROGRESS", "STATUS_FINAL". */
  status: string;
  /** Human-readable status description for the UI ("Scheduled", "In Progress", "Final"). */
  status_label: string;
  /** "NBA Finals - Game 3" if postseason note present, else null. */
  postseason_note: string | null;
  /** Home/away team rollup. */
  home: NbaEventTeam;
  away: NbaEventTeam;
  /** Series context if available (postseason only). */
  series: NbaEventSeries | null;
  /** Venue if available. */
  venue_name: string | null;
};

export type NbaEventTeam = {
  /** ESPN team id (string form, since ESPN uses strings). */
  espn_team_id: string;
  /** "NY", "SA", "BOS", etc. */
  abbreviation: string;
  /** "New York Knicks", "San Antonio Spurs". */
  display_name: string;
  /** "Knicks", "Spurs". */
  short_name: string | null;
  /** "New York", "San Antonio". */
  location: string | null;
  /** Score so far (in progress) or final (when status=FINAL). null for scheduled. */
  score: number | null;
};

export type NbaEventSeries = {
  /** "playoff" (or future round if ESPN exposes it). */
  type: string;
  /** ESPN summary: "NY leads series 2-0". */
  summary: string;
  /** Inferred from postseason note: "NBA Finals - Game 3" → 3. null if not derivable. */
  game_number: number | null;
  /** Home team's wins so far in this series. */
  home_wins: number;
  /** Away team's wins so far in this series. */
  away_wins: number;
  /** Best-of-N (7 for Finals). */
  total_games_to_clinch_basis: number;
  /** True if the series is already over. */
  series_completed: boolean;
};

type EspnScoreboardResponse = {
  events?: Array<EspnEvent>;
};

type EspnEvent = {
  id?: string;
  uid?: string;
  date?: string;
  name?: string;
  shortName?: string;
  status?: {
    type?: { name?: string; description?: string; completed?: boolean };
  };
  competitions?: Array<EspnCompetition>;
};

type EspnCompetition = {
  id?: string;
  date?: string;
  venue?: { fullName?: string };
  status?: {
    type?: { name?: string; description?: string };
  };
  notes?: Array<{ type?: string; headline?: string }>;
  competitors?: Array<EspnCompetitor>;
  series?: {
    type?: string;
    title?: string;
    summary?: string;
    completed?: boolean;
    totalCompetitions?: number;
    competitors?: Array<{ id?: string; wins?: number }>;
  };
};

type EspnCompetitor = {
  id?: string;
  homeAway?: "home" | "away";
  score?: string | number | null;
  team?: {
    id?: string;
    abbreviation?: string;
    displayName?: string;
    shortDisplayName?: string;
    location?: string;
  };
};

/**
 * Parse the integer suffix from an ESPN postseason note headline like
 * "NBA Finals - Game 3" → 3. Returns null if the format doesn't match.
 */
function parseGameNumberFromNote(note: string | null): number | null {
  if (note === null) return null;
  const match = note.match(/Game\s+(\d+)/i);
  if (match === null) return null;
  const n = Number.parseInt(match[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function pickPostseasonNote(comp: EspnCompetition): string | null {
  for (const n of comp.notes ?? []) {
    if (typeof n.headline === "string" && n.headline.length > 0) {
      return n.headline;
    }
  }
  return null;
}

function parseScore(s: string | number | null | undefined): number | null {
  if (s === null || s === undefined) return null;
  const n = typeof s === "number" ? s : Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

function buildTeam(c: EspnCompetitor): NbaEventTeam {
  return {
    espn_team_id: c.team?.id ?? "",
    abbreviation: c.team?.abbreviation ?? "?",
    display_name: c.team?.displayName ?? "?",
    short_name: c.team?.shortDisplayName ?? null,
    location: c.team?.location ?? null,
    score: parseScore(c.score ?? null),
  };
}

function buildSeries(
  comp: EspnCompetition,
  homeTeamId: string,
  awayTeamId: string,
  postseasonNote: string | null,
): NbaEventSeries | null {
  const s = comp.series;
  if (s === undefined || s === null) return null;
  let homeWins = 0;
  let awayWins = 0;
  for (const cs of s.competitors ?? []) {
    if (cs.id === homeTeamId) homeWins = cs.wins ?? 0;
    else if (cs.id === awayTeamId) awayWins = cs.wins ?? 0;
  }
  return {
    type: s.type ?? "playoff",
    summary: s.summary ?? "",
    game_number: parseGameNumberFromNote(postseasonNote),
    home_wins: homeWins,
    away_wins: awayWins,
    total_games_to_clinch_basis: s.totalCompetitions ?? 7,
    series_completed: s.completed === true,
  };
}

/**
 * Fetch today's NBA scoreboard. ESPN returns "today" relative to its
 * own clock — for our use we just take what it returns and the operator
 * filters by date downstream if needed.
 *
 * Optional `dateYYYYMMDD` param queries a specific date.
 */
export async function fetchNbaScoreboard(
  opts?: { dateYYYYMMDD?: string },
): Promise<CanonicalNbaEvent[]> {
  const url =
    opts?.dateYYYYMMDD !== undefined
      ? `${BASE_URL}/scoreboard?dates=${opts.dateYYYYMMDD}`
      : `${BASE_URL}/scoreboard`;
  let res: Response;
  try {
    res = await fetch(url, { headers: HEADERS });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  let body: EspnScoreboardResponse;
  try {
    body = (await res.json()) as EspnScoreboardResponse;
  } catch {
    return [];
  }
  const out: CanonicalNbaEvent[] = [];
  for (const e of body.events ?? []) {
    if (typeof e.id !== "string") continue;
    const comp = e.competitions?.[0];
    if (comp === undefined) continue;
    const competitors = comp.competitors ?? [];
    const homeCompetitor = competitors.find((c) => c.homeAway === "home");
    const awayCompetitor = competitors.find((c) => c.homeAway === "away");
    if (homeCompetitor === undefined || awayCompetitor === undefined) continue;
    const home = buildTeam(homeCompetitor);
    const away = buildTeam(awayCompetitor);
    if (home.espn_team_id === "" || away.espn_team_id === "") continue;
    const postseasonNote = pickPostseasonNote(comp);
    const series = buildSeries(comp, home.espn_team_id, away.espn_team_id, postseasonNote);
    const statusName = comp.status?.type?.name ?? e.status?.type?.name ?? "STATUS_SCHEDULED";
    const statusLabel = comp.status?.type?.description ?? e.status?.type?.description ?? "Scheduled";
    out.push({
      espn_event_id: e.id,
      start_time: e.date ?? "",
      status: statusName,
      status_label: statusLabel,
      postseason_note: postseasonNote,
      home,
      away,
      series,
      venue_name: comp.venue?.fullName ?? null,
    });
  }
  return out;
}

/**
 * Fetch ESPN's NBA teams reference list. Used to seed the `teams` table
 * with ESPN team ids + abbreviations when BDL is partial. Returns one
 * row per team.
 */
export type EspnNbaTeam = {
  espn_team_id: string;
  abbreviation: string;
  display_name: string;
  short_name: string | null;
  location: string | null;
};

export async function fetchAllNbaTeams(): Promise<EspnNbaTeam[]> {
  const url = `${BASE_URL}/teams`;
  let res: Response;
  try {
    res = await fetch(url, { headers: HEADERS });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return [];
  }
  // ESPN nests this: { sports: [ { leagues: [ { teams: [ { team: {...} } ] } ] } ] }
  const sports = (body as { sports?: Array<{ leagues?: Array<{ teams?: Array<{ team?: unknown }> }> }> })
    .sports;
  const out: EspnNbaTeam[] = [];
  const teamWrappers = sports?.[0]?.leagues?.[0]?.teams ?? [];
  for (const tw of teamWrappers) {
    const t = (tw.team ?? {}) as {
      id?: string;
      abbreviation?: string;
      displayName?: string;
      shortDisplayName?: string;
      location?: string;
    };
    if (typeof t.id !== "string" || typeof t.abbreviation !== "string") continue;
    out.push({
      espn_team_id: t.id,
      abbreviation: t.abbreviation,
      display_name: t.displayName ?? "?",
      short_name: t.shortDisplayName ?? null,
      location: t.location ?? null,
    });
  }
  return out;
}
