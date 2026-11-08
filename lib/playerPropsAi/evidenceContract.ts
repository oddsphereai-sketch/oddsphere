/** Product inventory, NOT a production market-selection policy. */
export const PRODUCT_RELEASE = "player_props_ai_offline_full_product_2026_11_06_r1";
export const CATALOG = {
  nba: {
    required: ["points", "rebounds", "assists", "threes", "points_rebounds_assists", "points_rebounds", "points_assists", "rebounds_assists"],
    expansion: ["double_double", "triple_double"],
    researchOnly: [],
  },
  nfl: {
    required: ["passing_attempts", "passing_completions", "passing_yards", "passing_tds", "interceptions", "rushing_attempts", "rushing_yards", "receptions", "receiving_yards", "anytime_td"],
    expansion: ["rushing_receiving_yards", "longest_pass", "longest_reception", "longest_rush", "fg_made", "kicking_points"],
    researchOnly: ["first_td", "touchdowns"],
  },
  mlb: {
    required: ["pitcher_strikeouts", "pitcher_outs", "pitcher_hits_allowed", "pitcher_walks", "pitcher_earned_runs", "batter_strikeouts", "batter_hits", "batter_total_bases", "batter_home_runs", "batter_rbis", "batter_runs_scored", "batter_hits_runs_rbis", "batter_singles", "batter_doubles", "batter_triples", "batter_walks", "batter_stolen_bases"],
    expansion: [],
    researchOnly: ["pitcher_record_a_win", "first_home_run"],
  },
} as const;
export type Sport = keyof typeof CATALOG;
export type Stage = "early" | "final";
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type Evidence = {
  id: string;
  kind: "recent_games" | "matchup_history" | "availability" | "matchup" | "independent_model" | "market";
  /** When this particular record became available, not the date of the event it describes. */
  availableAt: string;
  source: string;
  value: Json;
};
export type Quote = {
  id: string; playerId: string; market: string; provider: string; book: string;
  line: number; side: "over" | "under" | "yes"; american: number;
  observedAt: string; receivedAt: string; live: boolean;
  /** Missing on legacy local packets: do not infer current-quote eligibility from it. */
  opening?: boolean;
  offerContract?: "two_way" | "milestone";
  /** An export/snapshot clock is availability evidence, not a fresh provider confirmation. */
  receivedAtProvenance?: "provider_response" | "collection_start" | "snapshot_availability";
};
export type Player = {
  id: string; name: string; team: string; opponent: string;
  /** All offered scopes, including explicitly unsupported heads. Never infer applicability from position alone. */
  markets: string[];
  evidence: Evidence[];
  missing: string[];
};
export type GamePacket = {
  release: typeof PRODUCT_RELEASE; sport: Sport; gameId: string; start: string; lock: string;
  stage: Stage; cutoff: string; players: Player[]; quotes: Quote[];
  sourceLimitations: string[];
  /** Versioned live-source identity contract; legacy stored inputs retain their own absence. */
  sourceInputRelease?:string;
  sharedGameContext?: Json;
  /** Native collector identity when the funding calendar uses a separately bound fixture ID. */
  sourceGameId?:string;
};

/** Source-of-truth mathematical definitions; count/event units must be retained by adapters. */
export const COMBOS: Record<string, readonly string[]> = {
  points_rebounds_assists: ["points", "rebounds", "assists"],
  points_rebounds: ["points", "rebounds"], points_assists: ["points", "assists"],
  rebounds_assists: ["rebounds", "assists"], rushing_receiving_yards: ["rushing_yards", "receiving_yards"],
  batter_hits_runs_rbis: ["batter_hits", "batter_runs_scored", "batter_rbis"],
};
