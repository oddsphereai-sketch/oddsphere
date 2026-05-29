/**
 * BallDontLieSlateProvider — ISlateProvider implementation backed by BDL
 * MLB GOAT. Phase 1 (Gate B.1).
 *
 * Verified by Gate A probe — /teams, /games, /lineups all live with
 * confirmed shapes. Probable starter resolution uses /games first
 * (home_team_pitcher / away_team_pitcher when populated) with a fallback
 * to /lineups?game_ids[]=N filtered to is_probable_pitcher=true. This
 * matters for Morning Card preliminary/draft generation when starters
 * aren't yet posted at 8 AM ET — the publish-quality lock happens later
 * at T-60 (Phase 4).
 *
 * Discipline:
 *   • No DB imports — pure data transform
 *   • No service imports
 *   • Constructor takes the API key only
 *   • Defensive nulls; skip games we can't ID confidently
 */

import type { Sport } from "../../types/domain/Sport";
import type {
  ISlateProvider,
  SlateGameRecord,
  SlateTeamRecord,
} from "../interfaces/ISlateProvider";
import { BdlClient, BdlNotFoundError } from "./_bdlClient";

// ─────────────────────────────────────────────────────────────
// Raw shapes
// ─────────────────────────────────────────────────────────────

type RawTeam = {
  id: number;
  abbreviation?: string | null;
  display_name?: string | null;
  short_display_name?: string | null;
  name?: string | null;
  full_name?: string | null;
  city?: string | null;
  location?: string | null;
  slug?: string | null;
  league?: string | null;
  conference?: string | null;
  division?: string | null;
  logo_url?: string | null;
  primary_color?: string | null;
};

type RawGameTeam = {
  id?: number | null;
  abbreviation?: string | null;
};

type RawGame = {
  id: number;
  date?: string | null;
  game_date?: string | null;
  status?: string | null;
  season?: number | null;
  season_type?: string | null;
  postseason?: boolean | null;
  period?: number | null;
  clock?: string | null;
  home_team?: RawGameTeam | null;
  away_team?: RawGameTeam | null;
  home_team_id?: number | null;
  away_team_id?: number | null;
  home_team_pitcher?: { id?: number | null } | null;
  away_team_pitcher?: { id?: number | null } | null;
  home_team_pitcher_id?: number | null;
  away_team_pitcher_id?: number | null;
  home_team_score?: number | null;
  away_team_score?: number | null;
  home_team_hits?: number | null;
  away_team_hits?: number | null;
  home_team_errors?: number | null;
  away_team_errors?: number | null;
  total_runs?: number | null;
  inning_scores?: unknown | null;
  first_inning_runs?: number | null;
  venue?: string | null;
  attendance?: number | null;
};

type RawLineupRow = {
  game_id?: number | null;
  team_id?: number | null;
  player_id?: number | null;
  is_probable_pitcher?: boolean | null;
  is_starter?: boolean | null;
  position?: string | null;
};

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function asNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function asStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

function asBoolOrFalse(v: unknown): boolean {
  return v === true || v === "true" || v === 1 || v === "1";
}

function normalizeGameStatus(raw: string | null): string {
  if (raw === null) return "STATUS_SCHEDULED";
  const v = raw.toLowerCase();
  if (v.includes("final")) return "STATUS_FINAL";
  if (v.includes("progress") || v.includes("live") || v.includes("in")) {
    return "STATUS_IN_PROGRESS";
  }
  return "STATUS_SCHEDULED";
}

function pickGameDate(raw: RawGame): string {
  // Prefer ISO timestamp; fall back to date string.
  const ts = asStringOrNull(raw.game_date) ?? asStringOrNull(raw.date);
  if (ts === null) {
    // Provider should never return rows without a date; defensively use
    // epoch so downstream slateService skips on FK resolution.
    return new Date(0).toISOString();
  }
  // Normalize "YYYY-MM-DD" to a full ISO timestamp; pass through already-
  // ISO values.
  if (/^\d{4}-\d{2}-\d{2}$/.test(ts)) {
    return `${ts}T00:00:00.000Z`;
  }
  const t = Date.parse(ts);
  return Number.isFinite(t) ? new Date(t).toISOString() : ts;
}

function mapTeam(raw: RawTeam): SlateTeamRecord {
  const abbreviation = asStringOrNull(raw.abbreviation) ?? "";
  const displayName =
    asStringOrNull(raw.display_name) ??
    asStringOrNull(raw.full_name) ??
    asStringOrNull(raw.name) ??
    "";
  const shortDisplayName =
    asStringOrNull(raw.short_display_name) ?? asStringOrNull(raw.name) ?? "";
  const name = asStringOrNull(raw.name) ?? "";
  const location =
    asStringOrNull(raw.location) ?? asStringOrNull(raw.city) ?? "";
  const slug =
    asStringOrNull(raw.slug) ??
    abbreviation.toLowerCase() ??
    name.toLowerCase().replace(/\s+/g, "-");
  return {
    external_id: raw.id,
    sport: "mlb",
    slug,
    abbreviation,
    display_name: displayName,
    short_display_name: shortDisplayName,
    name,
    location,
    league: asStringOrNull(raw.league) ?? asStringOrNull(raw.conference),
    division: asStringOrNull(raw.division),
    logo_url: asStringOrNull(raw.logo_url),
    primary_color: asStringOrNull(raw.primary_color),
    provider_ids: { balldontlie: raw.id },
  };
}

function pickHomeTeamId(raw: RawGame): number | null {
  return (
    asNumberOrNull(raw.home_team?.id) ?? asNumberOrNull(raw.home_team_id)
  );
}

function pickAwayTeamId(raw: RawGame): number | null {
  return (
    asNumberOrNull(raw.away_team?.id) ?? asNumberOrNull(raw.away_team_id)
  );
}

function pickHomePitcherId(raw: RawGame): number | null {
  return (
    asNumberOrNull(raw.home_team_pitcher?.id) ??
    asNumberOrNull(raw.home_team_pitcher_id)
  );
}

function pickAwayPitcherId(raw: RawGame): number | null {
  return (
    asNumberOrNull(raw.away_team_pitcher?.id) ??
    asNumberOrNull(raw.away_team_pitcher_id)
  );
}

function mapInningScores(raw: unknown): { home: number[]; away: number[] } | null {
  if (raw === null || raw === undefined || typeof raw !== "object") return null;
  const obj = raw as { home?: unknown; away?: unknown };
  const homeArr = Array.isArray(obj.home)
    ? obj.home.map((n) => asNumberOrNull(n) ?? 0)
    : null;
  const awayArr = Array.isArray(obj.away)
    ? obj.away.map((n) => asNumberOrNull(n) ?? 0)
    : null;
  if (homeArr === null || awayArr === null) return null;
  return { home: homeArr, away: awayArr };
}

function mapGame(
  raw: RawGame,
  homePitcherOverride: number | null,
  awayPitcherOverride: number | null
): SlateGameRecord {
  return {
    external_id: raw.id,
    sport: "mlb",
    home_team_external_id: pickHomeTeamId(raw),
    away_team_external_id: pickAwayTeamId(raw),
    home_pitcher_external_id:
      pickHomePitcherId(raw) ?? homePitcherOverride,
    away_pitcher_external_id:
      pickAwayPitcherId(raw) ?? awayPitcherOverride,
    game_date: pickGameDate(raw),
    season: asNumberOrNull(raw.season) ?? new Date().getUTCFullYear(),
    season_type: asStringOrNull(raw.season_type),
    postseason: asBoolOrFalse(raw.postseason),
    status: normalizeGameStatus(asStringOrNull(raw.status)),
    period: asNumberOrNull(raw.period),
    clock: asStringOrNull(raw.clock),
    home_score: asNumberOrNull(raw.home_team_score),
    away_score: asNumberOrNull(raw.away_team_score),
    home_hits: asNumberOrNull(raw.home_team_hits),
    away_hits: asNumberOrNull(raw.away_team_hits),
    home_errors: asNumberOrNull(raw.home_team_errors),
    away_errors: asNumberOrNull(raw.away_team_errors),
    total_runs: asNumberOrNull(raw.total_runs),
    inning_scores: mapInningScores(raw.inning_scores),
    first_inning_runs: asNumberOrNull(raw.first_inning_runs),
    venue: asStringOrNull(raw.venue),
    attendance: asNumberOrNull(raw.attendance),
    slate_status: "draft",
    provider_ids: { balldontlie: raw.id },
  };
}

// ─────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────

export class BallDontLieSlateProvider implements ISlateProvider {
  private readonly client: BdlClient;

  constructor(apiKey: string) {
    this.client = new BdlClient(apiKey);
  }

  /** Test/diagnostic accessor — never called by services. */
  getClient(): BdlClient {
    return this.client;
  }

  async getTeams(_sport: Sport): Promise<SlateTeamRecord[]> {
    void _sport;
    try {
      const rows = await this.client.fetchAll<RawTeam>({
        path: "/teams",
        query: { per_page: 100 },
        maxPages: 2,
      });
      return rows.map(mapTeam);
    } catch (e) {
      if (e instanceof BdlNotFoundError) return [];
      throw e;
    }
  }

  async getGames(date: string, sport?: Sport): Promise<SlateGameRecord[]> {
    // Sport filter: BDL MLB endpoint is sport-scoped at the base URL —
    // sport param is informational. The output's sport field is "mlb"; if
    // the caller asked for a non-mlb sport, return [].
    if (sport !== undefined && sport !== "mlb") return [];

    let rawGames: RawGame[];
    try {
      rawGames = await this.client.fetchAll<RawGame>({
        path: "/games",
        query: { "dates[]": [date], per_page: 100 },
        maxPages: 5,
      });
    } catch (e) {
      if (e instanceof BdlNotFoundError) return [];
      throw e;
    }

    // For each game where probable starter is missing on either side,
    // make a follow-up /lineups call to resolve from is_probable_pitcher.
    // Protects Morning Card draft generation when /games hasn't been
    // populated with probable starters yet.
    const out: SlateGameRecord[] = [];
    for (const raw of rawGames) {
      const homeExisting = pickHomePitcherId(raw);
      const awayExisting = pickAwayPitcherId(raw);
      let homeFromLineup: number | null = null;
      let awayFromLineup: number | null = null;
      if (homeExisting === null || awayExisting === null) {
        const resolved = await this.resolveProbableStartersFromLineups(
          raw.id,
          pickHomeTeamId(raw),
          pickAwayTeamId(raw)
        );
        homeFromLineup = resolved.home;
        awayFromLineup = resolved.away;
      }
      out.push(mapGame(raw, homeFromLineup, awayFromLineup));
    }
    return out;
  }

  /**
   * Follow-up /lineups call for a single game. Filters to
   * is_probable_pitcher=true and maps the result back to the home/away
   * side via team_id. Returns nulls when the lineup endpoint doesn't yet
   * have probable-starter rows for the game (expected at 8 AM ET; lineups
   * typically drop 2-4 hours before first pitch).
   */
  private async resolveProbableStartersFromLineups(
    gameExternalId: number,
    homeTeamId: number | null,
    awayTeamId: number | null
  ): Promise<{ home: number | null; away: number | null }> {
    try {
      const rows = await this.client.fetchAll<RawLineupRow>({
        path: "/lineups",
        query: { "game_ids[]": [gameExternalId], per_page: 100 },
        maxPages: 2,
      });
      let home: number | null = null;
      let away: number | null = null;
      for (const r of rows) {
        if (!asBoolOrFalse(r.is_probable_pitcher)) continue;
        const teamId = asNumberOrNull(r.team_id);
        const playerId = asNumberOrNull(r.player_id);
        if (teamId === null || playerId === null) continue;
        if (homeTeamId !== null && teamId === homeTeamId) {
          home = playerId;
        } else if (awayTeamId !== null && teamId === awayTeamId) {
          away = playerId;
        }
      }
      return { home, away };
    } catch (e) {
      if (e instanceof BdlNotFoundError) return { home: null, away: null };
      throw e;
    }
  }
}
