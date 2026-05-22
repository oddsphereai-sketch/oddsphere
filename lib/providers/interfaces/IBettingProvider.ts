/**
 * IBettingProvider — contract for the betting / lines / sharp-signal data source.
 *
 * Real implementation: SharpAPIProvider (paid Pro tier).
 * Mock implementation: MockBettingProvider (reads from JSON fixtures).
 *
 * SharpAPI provides built-in de-vigging vs Pinnacle (ev_percent / fair_odds /
 * is_ev_positive) so we don't compute it ourselves — the provider just passes
 * these fields through.
 *
 * RECORD SHAPES: see IStatsProvider header for the conventions
 * (no DB ids, FKs expressed as external_id).
 */

import type { Sport } from "../../types/domain/Sport";
import type { MarketType, Side, Sportsbook } from "../../types/domain/Lines";
import type { SignalStrength } from "../../types/domain/SharpSignal";

// ─────────────────────────────────────────────────────────────
// Provider record types
// ─────────────────────────────────────────────────────────────

/**
 * One observed line from one sportsbook.
 *
 * Covers both game lines (market_type='moneyline'/'spread'/'total'/
 * 'first_inning_total') and player props (market_type='batter_hits' etc.).
 * For game lines, player_external_id is null.
 */
export type LineRecord = {
  game_external_id: number;
  market_type: MarketType;
  player_external_id: number | null;
  sportsbook: Sportsbook;
  side: Side | null;
  line_value: number | null;
  odds_american: number | null;
  odds_decimal: number | null;
  implied_probability: number | null;
  // SharpAPI built-in fields
  ev_percent: number | null;
  fair_odds: number | null;
  is_ev_positive: boolean | null;
  fetched_at: string;
};

/**
 * One detected sharp signal for a (game, market, side) tuple.
 *
 * The provider does the detection work (steam moves, RLM, public splits, EV
 * vs Pinnacle). Our `verdictGenerator` model in Phase 3 turns these into the
 * STRONG/CAUTION banner on the Daily Edge card.
 */
export type SharpSignalRecord = {
  game_external_id: number;
  market_type: MarketType;
  side: Side;
  // Pinnacle reference + EV
  pinnacle_fair_probability: number | null;
  is_plus_ev: boolean;
  ev_pct: number | null;
  // Steam
  has_steam_move: boolean;
  steam_detected_at: string | null;
  steam_books_count: number | null;
  // Reverse line movement
  has_reverse_line_movement: boolean;
  rlm_direction: string | null;
  // Public 'smoke' — breakdown-only, never on card
  public_betting_pct: number | null;
  public_money_pct: number | null;
  // Composite verdict (provider may pre-compute; we may recompute downstream)
  signal_strength: SignalStrength;
  signal_summary: string | null;
  computed_at: string;
};

// ─────────────────────────────────────────────────────────────
// Interface
// ─────────────────────────────────────────────────────────────

export interface IBettingProvider {
  /**
   * Game lines (ML / Spread / Total / First-Inning Total) from every
   * sportsbook the provider tracks, including Pinnacle for fair reference.
   *
   * @param date  YYYY-MM-DD.
   * @param sport Optional filter. Omit for cross-sport.
   * @returns One record per (game × market × sportsbook × side).
   */
  getGameLines(date: string, sport?: Sport): Promise<LineRecord[]>;

  /**
   * Player prop lines across all markets the provider exposes
   * (batter_hits, batter_total_bases, batter_home_runs, batter_rbis,
   *  pitcher_strikeouts, pitcher_earned_runs, pitcher_hits_allowed).
   *
   * Player props coverage varies by book — Pinnacle is sparse on props,
   * DraftKings and FanDuel are most reliable.
   */
  getPlayerProps(date: string, sport?: Sport): Promise<LineRecord[]>;

  /**
   * Sharp signal detections for a date's slate.
   *
   * @param date            YYYY-MM-DD.
   * @param gameExternalId  Optional — scope to a single game.
   */
  getSharpSignals(
    date: string,
    gameExternalId?: number
  ): Promise<SharpSignalRecord[]>;
}
