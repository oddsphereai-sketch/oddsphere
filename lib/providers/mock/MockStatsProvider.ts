import type { Sport } from "../../types/domain/Sport";
import type {
  HitterPitchRecord,
  IStatsProvider,
  PitcherPitchRecord,
  StatsGameRecord,
  StatsInjuryRecord,
  StatsLineupRecord,
  StatsPlayerRecord,
  StatsSeasonRecord,
  StatsSplitRecord,
  StatsTeamRecord,
} from "../interfaces/IStatsProvider";

import teamsJson from "./fixtures/teams.json";
import playersJson from "./fixtures/players.json";
import gamesJson from "./fixtures/games.json";
import lineupsJson from "./fixtures/lineups.json";
import injuriesJson from "./fixtures/injuries.json";
import seasonStatsJson from "./fixtures/player_season_stats.json";
import splitsJson from "./fixtures/player_splits.json";
import pitcherPitchJson from "./fixtures/pitcher_pitch_stats.json";
import hitterPitchJson from "./fixtures/hitter_pitch_stats.json";

// JSON imports are typed as wide literal tuples by TypeScript. Cast to the
// provider Record shapes — the fixtures were authored against these contracts
// (cross-file FK validation in Checkpoint 2A confirmed shape compliance).
const TEAMS = teamsJson as unknown as StatsTeamRecord[];
const PLAYERS = playersJson as unknown as StatsPlayerRecord[];
const GAMES = gamesJson as unknown as StatsGameRecord[];
const LINEUPS = lineupsJson as unknown as StatsLineupRecord[];
const INJURIES = injuriesJson as unknown as StatsInjuryRecord[];
const SEASON_STATS = seasonStatsJson as unknown as StatsSeasonRecord[];
const SPLITS = splitsJson as unknown as StatsSplitRecord[];
const PITCHER_PITCH = pitcherPitchJson as unknown as PitcherPitchRecord[];
const HITTER_PITCH = hitterPitchJson as unknown as HitterPitchRecord[];

/**
 * Extract the "slate date" for an MLB game from its UTC timestamp.
 *
 * Games scheduled at e.g. 02:10 UTC technically belong to the previous local
 * day's slate (Pacific evening = next-day UTC). Convention: UTC hour < 6 →
 * roll back one day.
 */
function slateDate(g: StatsGameRecord): string {
  const t = new Date(g.game_date);
  if (t.getUTCHours() < 6) {
    const rolled = new Date(t.getTime() - 24 * 3600 * 1000);
    return rolled.toISOString().slice(0, 10);
  }
  return g.game_date.slice(0, 10);
}

export class MockStatsProvider implements IStatsProvider {
  async getTeams(sport: Sport): Promise<StatsTeamRecord[]> {
    return TEAMS.filter((t) => t.sport === sport);
  }

  async getPlayers(teamExternalId?: number): Promise<StatsPlayerRecord[]> {
    if (teamExternalId === undefined) return [...PLAYERS];
    return PLAYERS.filter((p) => p.team_external_id === teamExternalId);
  }

  async getPlayer(
    playerExternalId: number
  ): Promise<StatsPlayerRecord | null> {
    return PLAYERS.find((p) => p.external_id === playerExternalId) ?? null;
  }

  async getPlayerSeasonStats(
    playerExternalId: number,
    seasons: number[]
  ): Promise<StatsSeasonRecord[]> {
    return SEASON_STATS.filter(
      (s) =>
        s.player_external_id === playerExternalId && seasons.includes(s.season)
    );
  }

  async getPlayerSplits(
    playerExternalId: number,
    season: number
  ): Promise<StatsSplitRecord[]> {
    return SPLITS.filter(
      (s) => s.player_external_id === playerExternalId && s.season === season
    );
  }

  async getPitcherPitchStats(
    pitcherExternalId: number,
    season: number
  ): Promise<PitcherPitchRecord[]> {
    return PITCHER_PITCH.filter(
      (p) => p.player_external_id === pitcherExternalId && p.season === season
    );
  }

  async getHitterPitchStats(
    hitterExternalId: number,
    season: number
  ): Promise<HitterPitchRecord[]> {
    return HITTER_PITCH.filter(
      (h) => h.player_external_id === hitterExternalId && h.season === season
    );
  }

  async getGames(date: string, sport?: Sport): Promise<StatsGameRecord[]> {
    return GAMES.filter((g) => {
      if (slateDate(g) !== date) return false;
      if (sport !== undefined && g.sport !== sport) return false;
      return true;
    });
  }

  async getLineups(gameExternalId: number): Promise<StatsLineupRecord[]> {
    return LINEUPS.filter((l) => l.game_external_id === gameExternalId);
  }

  async getInjuries(sport?: Sport): Promise<StatsInjuryRecord[]> {
    // Injuries don't carry a sport field; look up via the referenced player.
    if (sport === undefined) return [...INJURIES];
    const playerSport = new Map(
      PLAYERS.map((p) => [p.external_id, p.sport])
    );
    return INJURIES.filter(
      (i) => playerSport.get(i.player_external_id) === sport
    );
  }
}
