/**
 * Internal market types. Mirrors the SharpAPI market strings we ingest, with
 * our own narrowed unions for type-safe usage.
 */

export type GameMarketType =
  | "moneyline"
  | "spread"
  | "total"
  | "first_inning_total";

export type PropMarketType =
  | "batter_hits"
  | "batter_total_bases"
  | "batter_home_runs"
  | "batter_rbis"
  | "pitcher_strikeouts"
  | "pitcher_earned_runs"
  | "pitcher_hits_allowed";

export type MarketType = GameMarketType | PropMarketType | (string & {});

export type Sportsbook =
  | "draftkings"
  | "fanduel"
  | "caesars"
  | "betmgm"
  | "pinnacle"
  | (string & {});

/** Side selection on a market — varies by market_type. */
export type Side =
  | "home"
  | "away"
  | "over"
  | "under"
  | "yes"
  | "no"
  | (string & {});

/** Mirrors the `lines` table (latest snapshot of current odds). */
export type Line = {
  id: number;
  game_id: number | null;
  market_type: MarketType;
  player_id: number | null; // NULL for game lines, populated for props
  sportsbook: Sportsbook;
  side: Side | null;
  line_value: number | null;
  odds_american: number | null;
  odds_decimal: number | null;
  implied_probability: number | null;
  // SharpAPI built-in fields (already de-vigged vs Pinnacle)
  ev_percent: number | null;
  fair_odds: number | null;
  is_ev_positive: boolean | null;
  fetched_at: string;
  created_at: string;
};

/** Mirrors the `line_history` table (time-series of all observed lines). */
export type LineHistoryEntry = {
  id: number;
  game_id: number | null;
  market_type: MarketType;
  player_id: number | null;
  sportsbook: Sportsbook;
  side: Side | null;
  line_value: number | null;
  odds_american: number | null;
  is_opener: boolean;
  recorded_at: string;
  created_at: string;
};
