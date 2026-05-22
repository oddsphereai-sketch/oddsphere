/**
 * SharpAPI Pro response shapes.
 * Source: https://docs.sharpapi.io · base URL https://api.sharpapi.io/api/v1/
 *
 * Critical features SharpAPI provides out-of-the-box (no manual math needed):
 *   - `ev_percent`: built-in EV calc vs Pinnacle no-vig
 *   - `fair_odds`: Pinnacle de-vigged line (our sharp reference)
 *   - `is_ev_positive`: boolean for fast filtering
 *   - Pinnacle included in the sportsbook list for free sharp comparison
 */

// ───────────────────── Envelope ─────────────────────

export type SharpAPIEnvelope<T> = {
  data: T[];
  meta?: Record<string, unknown>;
};

// ───────────────────── Sportsbooks ─────────────────────

export type SharpAPISportsbook =
  | "draftkings"
  | "fanduel"
  | "caesars"
  | "betmgm"
  | "pinnacle"
  | (string & {}); // 27+ more — open-ended

// ───────────────────── Markets ─────────────────────

export type SharpAPIGameMarket =
  | "moneyline"
  | "spread"
  | "total"
  | "first_inning_total"
  | (string & {});

export type SharpAPIPlayerPropMarket =
  | "player_hits"
  | "player_total_bases"
  | "player_home_runs"
  | "player_rbis"
  | "player_strikeouts"
  | "player_earned_runs"
  | "player_hits_allowed";

// ───────────────────── Odds row ─────────────────────

export type SharpAPIOddsRow = {
  sportsbook: SharpAPISportsbook;
  market: SharpAPIGameMarket | SharpAPIPlayerPropMarket;
  selection: string; // 'home', 'away', 'over', 'under', team name, etc.
  line_value?: number | null;
  odds_american: number;
  odds_decimal?: number;
  ev_percent: number; // built-in EV calc vs Pinnacle
  fair_odds: number;
  is_ev_positive: boolean;
  updated_at: string;
};

// ───────────────────── Game event ─────────────────────

export type SharpAPIEvent = {
  id: string;
  name: string; // 'Yankees vs Tigers'
  league: string; // 'MLB'
  commence_time: string; // ISO datetime
  odds: SharpAPIOddsRow[];
};

// ───────────────────── Player prop event ─────────────────────

export type SharpAPIPlayerProp = {
  event_id: string;
  player_id: number;
  player_name: string;
  team: string; // team abbreviation
  market: SharpAPIPlayerPropMarket;
  props: SharpAPIOddsRow[];
};

// ───────────────────── Sharp signal payload ─────────────────────

export type SharpAPISignal = {
  event_id: string;
  market: SharpAPIGameMarket;
  side: string;
  pinnacle_fair_probability?: number;
  is_plus_ev?: boolean;
  ev_pct?: number;
  has_steam_move?: boolean;
  steam_detected_at?: string;
  steam_books_count?: number;
  has_reverse_line_movement?: boolean;
  rlm_direction?: string;
  public_betting_pct?: number;
  public_money_pct?: number;
};
