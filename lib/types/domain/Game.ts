import type { Sport } from "./Sport";

/** Game status codes mirroring BALLDONTLIE / ESPN conventions. */
export type GameStatus =
  | "STATUS_SCHEDULED"
  | "STATUS_IN_PROGRESS"
  | "STATUS_FINAL"
  | (string & {});

/** Inning-by-inning scores. Length = number of innings played. */
export type InningScores = {
  home: number[];
  away: number[];
};

/** Mirrors the `games` table. */
export type Game = {
  id: number;
  external_id: number;
  sport: Sport;
  home_team_id: number | null;
  away_team_id: number | null;
  home_pitcher_id: number | null;
  away_pitcher_id: number | null;
  ballpark_id: number | null;
  game_date: string; // ISO timestamp
  season: number;
  season_type: string | null;
  postseason: boolean;
  status: GameStatus;
  period: number | null; // inning/quarter
  clock: string | null;
  // Results (populated when game finishes)
  home_score: number | null;
  away_score: number | null;
  home_hits: number | null;
  away_hits: number | null;
  home_errors: number | null;
  away_errors: number | null;
  total_runs: number | null;
  inning_scores: InningScores | null;
  // First inning data (for NRFI/YRFI tracking)
  first_inning_runs: number | null;
  venue: string | null;
  attendance: number | null;
  created_at: string;
  updated_at: string;
};
