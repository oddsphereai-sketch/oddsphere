export type CbbTeam = {
  id: number; conference_id: number | null; name: string; full_name: string;
  college: string | null; abbreviation: string;
};

export type CbbGame = {
  id: number; date: string; season: number; status: string; status_state?: string;
  period: number; home_team: CbbTeam; visitor_team: CbbTeam;
  home_score: number; away_score: number;
  home_score_h1?: number | null; home_score_h2?: number | null;
  away_score_h1?: number | null; away_score_h2?: number | null;
  home_ot_scores?: number[] | null; away_ot_scores?: number[] | null;
};

export type CbbBox = {
  team: CbbTeam; game: Pick<CbbGame, "id" | "date" | "season">;
  fgm: number | null; fga: number | null; fg3m: number | null; fg3a: number | null;
  ftm: number | null; fta: number | null; oreb: number | null; dreb: number | null;
  turnovers: number | null;
};

export type CbbPlayer = {
  id: number; first_name: string; last_name: string; team: CbbTeam;
};
export type CbbPlayerSeason = {
  player: CbbPlayer; team: CbbTeam; season: number; games_played: number;
  min: number | null; pts: number | null; fga: number | null; fgm: number | null;
  fg3m: number | null; fta: number | null; ftm: number | null; turnover: number | null;
};

export type CbbOdds = {
  id: number; game_id: number; vendor: string;
  moneyline_home_odds: number | null; moneyline_away_odds: number | null;
  spread_home_value: string | number | null; spread_away_value: string | number | null;
  spread_home_odds: number | null; spread_away_odds: number | null;
  total_value: string | number | null; total_over_odds: number | null;
  total_under_odds: number | null; updated_at?: string; opened_at?: string;
};

export type CbbVenue = {
  gameId: number; espnEventId: string; neutral: boolean; venue: string | null;
  source: string; fetchedAt: string; timeConfirmed?: boolean;
};

export type CbbTrainingGame = {
  id: number; date: string; season: number; homeId: number; awayId: number;
  homeScore: number; awayScore: number; homeRegulation: number; awayRegulation: number;
  overtime: boolean; possessions: number; tempo: number; neutral: boolean | null;
  homeFactors: CbbFourFactors; awayFactors: CbbFourFactors;
};

export type CbbFourFactors = {
  efg: number; turnoverRate: number; offensiveReboundRate: number; freeThrowRate: number;
};

export type CbbModelConfig = {
  id: string; ridge: number; priorCarry: number; recencyDays: number;
};
export type CbbTeamRating = {
  offense: number; defense: number; pace: number; games: number;
  factors: CbbFourFactors | null; opponentFactors: CbbFourFactors | null;
};
export type CbbRatingState = {
  release: string; config: CbbModelConfig; season: number; asOf: string;
  leagueEfficiency: number; leagueTempo: number; homeEfficiency: number;
  teams: Record<number, CbbTeamRating>; trainingGames: number;
};

export type CbbUncertainty = {
  marginSd: number; totalSd: number; marginTotalCorrelation: number;
  marginCorrection: number; totalCorrection: number;
  fitThroughSeason: number; games: number;
};
export type CbbForecast = {
  release: string; gameId: number; asOf: string; homeId: number; awayId: number;
  homeScore: number; awayScore: number; margin: number; total: number;
  possessions: number; homeWinProbability: number; uncertainty: CbbUncertainty;
  inputStatus: "complete" | "incomplete"; issues: string[];
};

export type CbbMarket = "moneyline" | "spread" | "total";
export type CbbQuote = {
  gameId: number; sportsbook: string; market: CbbMarket; line: number | null;
  firstPrice: number; secondPrice: number; providerObservedAt: string;
  fetchedAt: string; phase: "opening" | "current";
};
