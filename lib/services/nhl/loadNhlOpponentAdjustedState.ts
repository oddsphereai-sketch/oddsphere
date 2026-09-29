import {
  fetchMoneyPuckTeamGameDirectory,
  fetchMoneyPuckTeamGames,
  type MoneyPuckTeamGameRow,
} from "../../providers/nhl/_moneyPuckClient";
import { normalizeNhlTeamName } from "../../providers/nhl/_teamNameNormalizer";
import {
  NHL_OPPONENT_ADJUSTED_ALPHA,
  openingNhlOpponentAdjustedState,
  type NhlOpponentAdjustedState,
} from "../../automodel/nhlOpponentAdjustedState2026";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export type NhlOpponentAdjustedLoadResult = {
  states: Map<string, NhlOpponentAdjustedState>;
  source: "opening" | "moneypuck_game_by_game" | "fallback";
  complete: boolean;
  gamesApplied: number;
  requestCount: number;
  error?: string;
};

type CachedRows = {
  season: number;
  expiresAt: number;
  rows: MoneyPuckTeamGameRow[];
  openingEmpty: boolean;
  requestCount: number;
};

let cache: CachedRows | null = null;

function compactDate(value: string): string | null {
  const digits = value.replace(/[^0-9]/g, "");
  if (digits.length < 8) return null;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

/**
 * Replay only fully paired, earlier games. Updates are simultaneous and match
 * the release-pure research equation, preventing same-game or same-day leakage.
 */
export function replayNhlOpponentAdjustedState(
  rows: readonly MoneyPuckTeamGameRow[],
  slateDate: string,
): { states: Map<string, NhlOpponentAdjustedState>; gamesApplied: number } {
  const states = openingNhlOpponentAdjustedState();
  const byGame = new Map<number, Map<string, MoneyPuckTeamGameRow>>();
  for (const row of rows) {
    const gameDate = compactDate(row.game_date);
    const team = normalizeNhlTeamName(row.team_abbr);
    const opponent = normalizeNhlTeamName(row.opponent_abbr);
    if (!gameDate || gameDate >= slateDate || !team || !opponent || team === opponent) continue;
    const game = byGame.get(row.game_id) ?? new Map<string, MoneyPuckTeamGameRow>();
    game.set(team, { ...row, team_abbr: team, opponent_abbr: opponent });
    byGame.set(row.game_id, game);
  }

  const games = [...byGame.entries()]
    .map(([gameId, teams]) => ({ gameId, rows: [...teams.values()] }))
    .filter(({ rows: gameRows }) => gameRows.length === 2)
    .sort((a, b) => {
      const ad = compactDate(a.rows[0]!.game_date) ?? "";
      const bd = compactDate(b.rows[0]!.game_date) ?? "";
      return ad.localeCompare(bd) || a.gameId - b.gameId;
    });

  let gamesApplied = 0;
  for (const game of games) {
    const home = game.rows.find((row) => row.home_or_away === "HOME");
    const away = game.rows.find((row) => row.home_or_away === "AWAY");
    if (!home || !away || home.opponent_abbr !== away.team_abbr || away.opponent_abbr !== home.team_abbr) continue;
    const homeState = states.get(home.team_abbr);
    const awayState = states.get(away.team_abbr);
    if (!homeState || !awayState) continue;
    const expectedHome = 3.05 + homeState.attack + awayState.defenseWeakness;
    const expectedAway = 3.05 + awayState.attack + homeState.defenseWeakness;
    const homeResidual = home.x_goals_for - expectedHome;
    const awayResidual = away.x_goals_for - expectedAway;
    const halfAlpha = NHL_OPPONENT_ADJUSTED_ALPHA / 2;
    states.set(home.team_abbr, {
      attack: homeState.attack + halfAlpha * homeResidual,
      defenseWeakness: homeState.defenseWeakness + halfAlpha * awayResidual,
    });
    states.set(away.team_abbr, {
      attack: awayState.attack + halfAlpha * awayResidual,
      defenseWeakness: awayState.defenseWeakness + halfAlpha * homeResidual,
    });
    gamesApplied += 1;
  }
  return { states, gamesApplied };
}

async function fetchAllTeamRows(season: number): Promise<CachedRows> {
  const listedTeams = (await fetchMoneyPuckTeamGameDirectory(season))
    .map((team) => normalizeNhlTeamName(team))
    .filter((team): team is NonNullable<typeof team> => team !== null);
  if (listedTeams.length === 0) {
    const value = {
      season, expiresAt: Date.now() + CACHE_TTL_MS, rows: [],
      openingEmpty: true, requestCount: 1,
    };
    cache = value;
    return value;
  }
  const results: Array<MoneyPuckTeamGameRow[] | null> = [];
  for (let offset = 0; offset < listedTeams.length; offset += 6) {
    const batch = listedTeams.slice(offset, offset + 6);
    results.push(...await Promise.all(batch.map((team) => fetchMoneyPuckTeamGames(season, team))));
  }
  if (results.some((rows) => rows === null)) throw new Error("MoneyPuck listed a current-season team file that returned 404");
  const rows = results.flatMap((teamRows) => teamRows ?? []);
  const teamsByGame = new Map<number, Set<string>>();
  for (const row of rows) {
    const teams = teamsByGame.get(row.game_id) ?? new Set<string>();
    teams.add(row.team_abbr);
    teamsByGame.set(row.game_id, teams);
  }
  const incompleteGame = [...teamsByGame].find(([, teams]) => teams.size !== 2);
  if (incompleteGame) throw new Error(`MoneyPuck game ${incompleteGame[0]} has incomplete paired team rows`);
  const value = {
    season,
    expiresAt: Date.now() + CACHE_TTL_MS,
    rows,
    openingEmpty: false,
    requestCount: 1 + listedTeams.length,
  };
  cache = value;
  return value;
}

export async function loadNhlOpponentAdjustedState(
  season: number,
  slateDate: string,
): Promise<NhlOpponentAdjustedLoadResult> {
  if (season !== 2026) {
    return { states: new Map(), source: "fallback", complete: false, gamesApplied: 0, requestCount: 0 };
  }
  try {
    const hadCache = cache !== null && cache.season === season && cache.expiresAt > Date.now();
    const current = hadCache ? cache! : await fetchAllTeamRows(season);
    if (current.openingEmpty) {
      return {
        states: openingNhlOpponentAdjustedState(), source: "opening", complete: true,
        gamesApplied: 0, requestCount: hadCache ? 0 : current.requestCount,
      };
    }
    const replay = replayNhlOpponentAdjustedState(current.rows, slateDate);
    return {
      ...replay, source: "moneypuck_game_by_game", complete: true,
      requestCount: hadCache ? 0 : current.requestCount,
    };
  } catch (error) {
    return {
      states: new Map(), source: "fallback", complete: false, gamesApplied: 0,
      requestCount: 1, error: (error as Error).message,
    };
  }
}
