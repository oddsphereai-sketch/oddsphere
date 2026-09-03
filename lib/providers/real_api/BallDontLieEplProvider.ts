/**
 * Read-only BALLDONTLIE Premier League V2 client.
 *
 * This provider intentionally has no database imports or write methods. It is
 * the data boundary for the local EPL shadow model and founder preview.
 */

export const BALLDONTLIE_EPL_API_BASE_URL = "https://api.balldontlie.io/epl/v2";

type EplEnvelope<T> = {
  data?: T[];
  meta?: { next_cursor?: number | string | null; per_page?: number };
  error?: string;
};

export type BdlEplTeam = {
  id: number;
  name: string;
  short_name: string;
  abbreviation: string;
  location: string;
};

export type BdlEplMatch = {
  id: number;
  season: number;
  home_team_id: number;
  away_team_id: number;
  date: string;
  name: string;
  short_name: string;
  status: string;
  status_state: "scheduled" | "in_progress" | "final" | "postponed" | "canceled" | "delayed" | "suspended" | "abandoned" | "unknown";
  status_detail: string | null;
  home_score: number | null;
  away_score: number | null;
  venue_name: string | null;
  venue_city: string | null;
  round_number: number | null;
  first_half_home_score?: number | null;
  first_half_away_score?: number | null;
  second_half_home_score?: number | null;
  second_half_away_score?: number | null;
  venue_latitude?: number | null;
  venue_longitude?: number | null;
};

export type BdlEplTeamMatchStats = {
  match_id: number;
  team_id: number;
  possession_pct: number | null;
  shots: number | null;
  shots_on_target: number | null;
  expected_goals: number | null;
  big_chances: number | null;
  red_cards: number | null;
  corners?: number | null;
  passes?: number | null;
  pass_accuracy_pct?: number | null;
  big_chances_missed?: number | null;
  shots_inside_box?: number | null;
  shots_outside_box?: number | null;
  tackles?: number | null;
  interceptions?: number | null;
  clearances?: number | null;
};

export type BdlEplStanding = {
  team: BdlEplTeam;
  season: number;
  rank: number;
  games_played: number;
  wins: number;
  losses: number;
  draws: number;
  points: number;
  goals_for: number;
  goals_against: number;
  goal_differential: number;
};

export type BdlEplPregameForm = {
  match_id: number;
  team_id: number;
  is_home: boolean;
  avg_rating: number | null;
  position: number | null;
  value: string | null;
  form: Array<"W" | "D" | "L"> | null;
};

export type BdlEplPlayerInjury = {
  id: number;
  player: { id: number; display_name: string; short_name: string };
  team: BdlEplTeam;
  position: string | null;
  injury_type: string | null;
  status: string | null;
  updated_at: string | null;
};

export type BdlEplMatchLineup = {
  match_id: number;
  team_id: number;
  player: { id: number; display_name: string; short_name: string };
  is_starter: boolean;
  position: string | null;
  position_abbreviation: string | null;
};

export type BdlEplOdds = {
  id: number;
  match_id: number;
  vendor: string;
  moneyline_home_odds: number | null;
  moneyline_away_odds: number | null;
  moneyline_draw_odds: number | null;
  updated_at: string | null;
  opened_at?: string | null;
};

type QueryValue = string | number | ReadonlyArray<string | number> | null | undefined;

function buildUrl(path: string, query: Record<string, QueryValue>, baseUrl = BALLDONTLIE_EPL_API_BASE_URL): string {
  const url = new URL(`${baseUrl}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      const arrayKey = key.endsWith("[]") ? key : `${key}[]`;
      for (const item of value) url.searchParams.append(arrayKey, String(item));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export class BallDontLieEplProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
    private readonly apiBaseUrl: string = BALLDONTLIE_EPL_API_BASE_URL,
    private readonly providerLabel: string = "EPL",
  ) {
    if (!apiKey) throw new Error("BallDontLieEplProvider requires an API key");
  }

  private async page<T>(path: string, query: Record<string, QueryValue>): Promise<EplEnvelope<T>> {
    const response = await this.fetchImpl(buildUrl(path, query, this.apiBaseUrl), {
      headers: { Authorization: this.apiKey, Accept: "application/json" },
      cache: "no-store",
    });
    const body = (await response.json().catch(() => null)) as EplEnvelope<T> | null;
    if (!response.ok) {
      throw new Error(`BALLDONTLIE ${this.providerLabel} ${path} failed with HTTP ${response.status}${body?.error ? `: ${body.error}` : ""}`);
    }
    return body ?? { data: [] };
  }

  private async all<T>(path: string, query: Record<string, QueryValue>): Promise<T[]> {
    const rows: T[] = [];
    let cursor: number | string | null = null;
    const seen = new Set<string>();
    for (let page = 0; page < 20; page++) {
      const body: EplEnvelope<T> = await this.page<T>(path, { ...query, per_page: 100, cursor });
      rows.push(...(body.data ?? []));
      const next: number | string | null = body.meta?.next_cursor ?? null;
      if (next === null || next === undefined || seen.has(String(next))) break;
      seen.add(String(next));
      cursor = next;
    }
    return rows;
  }

  listTeams(season: number): Promise<BdlEplTeam[]> {
    return this.all<BdlEplTeam>("/teams", { season });
  }

  listMatches(options: { season?: number; dates?: string[]; teamIds?: number[] }): Promise<BdlEplMatch[]> {
    return this.all<BdlEplMatch>("/matches", {
      season: options.season,
      "dates[]": options.dates,
      "team_ids[]": options.teamIds,
    });
  }

  async listTeamMatchStats(matchIds: number[]): Promise<BdlEplTeamMatchStats[]> {
    const rows: BdlEplTeamMatchStats[] = [];
    for (let index = 0; index < matchIds.length; index += 40) {
      rows.push(...await this.all<BdlEplTeamMatchStats>("/team_match_stats", {
        "match_ids[]": matchIds.slice(index, index + 40),
      }));
    }
    return rows;
  }

  listOdds(options: { matchIds?: number[]; dates?: string[]; opening?: boolean }): Promise<BdlEplOdds[]> {
    return this.all<BdlEplOdds>(options.opening ? "/odds/opening" : "/odds", {
      "match_ids[]": options.matchIds,
      "dates[]": options.dates,
    });
  }

  listStandings(season: number): Promise<BdlEplStanding[]> {
    return this.all<BdlEplStanding>("/standings", { season });
  }

  listMatchPregameForms(matchIds: number[]): Promise<BdlEplPregameForm[]> {
    return this.all<BdlEplPregameForm>("/match_pregame_forms", { "match_ids[]": matchIds });
  }

  listPlayerInjuries(teamIds: number[]): Promise<BdlEplPlayerInjury[]> {
    return this.all<BdlEplPlayerInjury>("/player_injuries", { "team_ids[]": teamIds });
  }

  listMatchLineups(matchIds: number[]): Promise<BdlEplMatchLineup[]> {
    return this.all<BdlEplMatchLineup>("/match_lineups", { "match_ids[]": matchIds });
  }
}
