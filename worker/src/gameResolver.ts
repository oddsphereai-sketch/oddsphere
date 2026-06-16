/**
 * Resolve a normalized WS odds event to an internal game.
 *
 * Ported from lib/providers/factory.ts makeSharpApiGameResolver (two-step
 * teams→games lookup) but expressed over a small ResolverDb interface so it is
 * unit-testable with a mock and the worker owns its own Supabase client.
 *
 * MLB team names are normalized to abbreviations upstream (adapter →
 * homeAbbrev/awayAbbrev) and resolved by abbreviation. Soccer arrives as full
 * names (homeRaw/awayRaw) and is resolved by name via matchSoccerTeamId +
 * findGame's soccer branch (matches across every team alias). 2026-06-16.
 */

import { computeSlateDate } from "../../lib/dates/slateDate";
import type { Sport } from "../../lib/types/domain/Sport";
import type { NormalizedOddsEvent } from "../../lib/providers/real_api/ws/sharpApiWsAdapter";

export type ResolvedGame = {
  id: number; // games.id (FK)
  externalId: number; // games.external_id (recompute filter)
  sport: string; // internal sport key (mlb / soccer)
  slateDate: string; // ET-anchored slate date
  gameDate: string; // ISO kickoff/first-pitch
};

export interface ResolverDb {
  /**
   * Find the upcoming game for these teams. Real impl: teams-by-abbrev then
   * games-by-(sport, home, away) limited to the near-term scheduled window.
   */
  findGame(
    internalSport: string,
    homeAbbrev: string,
    awayAbbrev: string,
  ): Promise<{ id: number; external_id: number; game_date: string } | null>;
}

/**
 * Normalize a soccer team identifier for matching: lowercase, strip diacritics,
 * collapse punctuation/whitespace. Soccer arrives as full names ("England"), not
 * the MLB abbreviations, and SharpAPI / our DB vary across name aliases, so we
 * match leniently against every alias a team carries.
 */
export function normalizeSoccerName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining diacritics (Côte → Cote)
    .replace(/['’]/g, "") // drop apostrophes (d'Ivoire → divoire)
    .replace(/&/g, " and ") // Bosnia & Herzegovina ↔ Bosnia and Herzegovina
    .replace(/[._\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * FIFA/common name variants -> our canonical DB name (both normalized). SharpAPI
 * may use the FIFA-standard spelling while our games table seeds from BDL. Keys
 * and values are post-normalizeSoccerName. EXPAND this as stream_raw_events rows
 * with status="unresolved" + sport=soccer reveal real SharpAPI spellings.
 */
const SOCCER_NAME_ALIASES: Record<string, string> = {
  "united states": "usa",
  "korea republic": "south korea",
  "republic of korea": "south korea",
  "ir iran": "iran",
  turkey: "turkiye",
  "czech republic": "czechia",
  "cape verde": "cabo verde",
  "ivory coast": "cote divoire",
  "congo dr": "dr congo",
  "democratic republic of the congo": "dr congo",
};

function canonSoccerName(normalized: string): string {
  return SOCCER_NAME_ALIASES[normalized] ?? normalized;
}

export type SoccerTeamRow = {
  id: number;
  name: string | null;
  display_name?: string | null;
  short_display_name?: string | null;
  location?: string | null;
  abbreviation: string | null;
  slug?: string | null;
};

/**
 * Resolve a raw SharpAPI soccer team string to an internal team id by matching
 * against every alias the team row carries (name / display / location /
 * abbreviation / slug). Pure + unit-tested. Returns null on no match so the
 * event simply doesn't resolve (no bad write), never throws.
 */
export function matchSoccerTeamId(teams: SoccerTeamRow[], raw: string | null): number | null {
  if (!raw) return null;
  const want = canonSoccerName(normalizeSoccerName(raw));
  if (!want) return null;
  for (const t of teams) {
    const aliases = [t.name, t.display_name, t.short_display_name, t.location, t.abbreviation, t.slug]
      .filter((x): x is string => typeof x === "string" && x.length > 0)
      .map((a) => canonSoccerName(normalizeSoccerName(a)));
    if (aliases.includes(want)) return t.id;
  }
  return null;
}

/** Map SharpAPI sport/league vocab to our internal sport key. */
export function internalSportKey(sport: string | null, league: string | null): string | null {
  const s = (sport ?? "").toLowerCase();
  const l = (league ?? "").toLowerCase();
  if (s === "baseball" || l === "mlb") return "mlb";
  if (s === "soccer" || s === "football") return "soccer";
  return null;
}

export type GameResolver = (ev: NormalizedOddsEvent) => Promise<ResolvedGame | null>;

export function makeGameResolver(db: ResolverDb): GameResolver {
  return async (ev) => {
    const sport = internalSportKey(ev.sport, ev.league);
    if (sport === null) return null;
    const home = sport === "mlb" ? ev.homeAbbrev : ev.homeRaw;
    const away = sport === "mlb" ? ev.awayAbbrev : ev.awayRaw;
    if (!home || !away) return null;
    const game = await db.findGame(sport, home, away);
    if (game === null) return null;
    return {
      id: game.id,
      externalId: game.external_id,
      sport,
      slateDate: computeSlateDate(sport as Sport, game.game_date),
      gameDate: game.game_date,
    };
  };
}
