/**
 * MockSlateProvider — JSON-fixture-backed implementation of ISlateProvider.
 *
 * Fix 7.2 extracted this from MockPlayerStatsProvider so slate and
 * player-stats can route through independent factories. Behavior is byte-
 * identical to the prior in-place implementation: same fixtures, same
 * slate-date rollback rule, same sport filter.
 */

import type { Sport } from "../../types/domain/Sport";
import type {
  ISlateProvider,
  SlateGameRecord,
  SlateTeamRecord,
} from "../interfaces/ISlateProvider";

import teamsJson from "./fixtures/teams.json";
import gamesJson from "./fixtures/games.json";

const TEAMS = teamsJson as unknown as SlateTeamRecord[];
const GAMES = gamesJson as unknown as SlateGameRecord[];

/**
 * Extract the "slate date" for a game from its UTC timestamp.
 *
 * Games scheduled at e.g. 02:10 UTC technically belong to the previous local
 * day's slate (Pacific evening = next-day UTC). Convention: UTC hour < 6 →
 * roll back one day.
 *
 * Note: slateService.refreshGames computes its own canonical `slate_date`
 * via `computeSlateDate(sport, game_date)` (Fix 5E.1) before UPSERTing. This
 * helper exists only so the mock provider's getGames filters its fixture to
 * the requested date — it's intentionally simpler than the real per-sport
 * timezone computation.
 */
function slateDate(g: SlateGameRecord): string {
  const t = new Date(g.game_date);
  if (t.getUTCHours() < 6) {
    const rolled = new Date(t.getTime() - 24 * 3600 * 1000);
    return rolled.toISOString().slice(0, 10);
  }
  return g.game_date.slice(0, 10);
}

export class MockSlateProvider implements ISlateProvider {
  async getTeams(sport: Sport): Promise<SlateTeamRecord[]> {
    return TEAMS.filter((t) => t.sport === sport);
  }

  async getGames(date: string, sport?: Sport): Promise<SlateGameRecord[]> {
    return GAMES.filter((g) => {
      if (slateDate(g) !== date) return false;
      if (sport !== undefined && g.sport !== sport) return false;
      return true;
    });
  }
}
