import {
  NHL_2026_OPENING_PRIORS,
  type NhlCalibratedTeamState,
} from "./nhlRegularPriors2026";

export type SettledNhlRegularGame = {
  externalId: number;
  startTime: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
};

const ALPHA = 0.04;
const ELO_K = 16;
const ELO_HOME = 40;

function cloneOpeningPriors(): Map<string, NhlCalibratedTeamState> {
  return new Map(Object.entries(NHL_2026_OPENING_PRIORS).map(([team, state]) => [team, { ...state }]));
}

function stateFor(states: Map<string, NhlCalibratedTeamState>, team: string): NhlCalibratedTeamState {
  const found = states.get(team);
  if (found) return found;
  const neutral = { elo: 1500, goalsFor: 3.05, goalsAgainst: 3.05 };
  states.set(team, neutral);
  return neutral;
}

/** Replay only settled, prior regular-season games in chronological order. */
export function replayNhlRegularState(games: readonly SettledNhlRegularGame[]): Map<string, NhlCalibratedTeamState> {
  const states = cloneOpeningPriors();
  const ordered = [...games].sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
  for (const game of ordered) {
    const home = stateFor(states, game.homeTeam);
    const away = stateFor(states, game.awayTeam);
    const expected = 1 / (1 + 10 ** (-((home.elo + ELO_HOME) - away.elo) / 400));
    const actual = game.homeScore > game.awayScore ? 1 : 0;
    const change = ELO_K * (actual - expected);
    home.elo += change;
    away.elo -= change;
    home.goalsFor = (1 - ALPHA) * home.goalsFor + ALPHA * game.homeScore;
    home.goalsAgainst = (1 - ALPHA) * home.goalsAgainst + ALPHA * game.awayScore;
    away.goalsFor = (1 - ALPHA) * away.goalsFor + ALPHA * game.awayScore;
    away.goalsAgainst = (1 - ALPHA) * away.goalsAgainst + ALPHA * game.homeScore;
  }
  return states;
}
