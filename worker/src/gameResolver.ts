/**
 * Resolve a normalized WS odds event to an internal game.
 *
 * Ported from lib/providers/factory.ts makeSharpApiGameResolver (two-step
 * teams→games lookup) but expressed over a small ResolverDb interface so it is
 * unit-testable with a mock and the worker owns its own Supabase client.
 *
 * NOTE (unresolved assumption): MLB team names are normalized to abbreviations
 * upstream (adapter → homeAbbrev/awayAbbrev). Soccer has no MLB normalizer yet,
 * so soccer resolution falls back to the raw names and may miss until a pure
 * soccer normalizer is added (tracked for a later chunk).
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
