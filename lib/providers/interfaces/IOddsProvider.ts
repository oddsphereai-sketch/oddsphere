/**
 * IOddsProvider — contract for game-line + player-prop odds data.
 *
 * Odds and sharp-signal detection are split into separate provider contracts
 * (see ISharpSignalProvider) so the tri-state routing (mock / manual /
 * real_api) can swap them independently — e.g. real odds feed + mock sharp
 * signals during a phased ramp.
 *
 * Real implementation: SharpAPIProvider (paid Pro tier) — Phase 8.
 * Manual implementation: AdminUploadOddsProvider — Phase 7.25.
 * Mock implementation: MockOddsProvider (reads from JSON fixtures).
 *
 * Real-API note: SharpAPI provides built-in de-vigging vs Pinnacle (ev_percent,
 * fair_odds, is_ev_positive) so the implementation passes those through rather
 * than computing them locally.
 *
 * RECORD SHAPES: see IPlayerStatsProvider header for the conventions
 * (no DB ids, FKs expressed as external_id).
 */

import type { Sport } from "../../types/domain/Sport";
import type { MarketType, Side, Sportsbook } from "../../types/domain/Lines";

/**
 * One observed line from one sportsbook.
 *
 * Covers both game lines (market_type='moneyline'/'spread'/'total'/
 * 'first_inning_total') and player props (market_type='batter_hits' etc.).
 * For game lines, player_external_id is null.
 *
 * SharpAPI built-in fields (ev_percent / fair_odds / is_ev_positive) are
 * pre-computed against Pinnacle by the provider; consumers should NOT
 * re-derive them.
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
  ev_percent: number | null;
  fair_odds: number | null;
  is_ev_positive: boolean | null;
  fetched_at: string;
};

// ─────────────────────────────────────────────────────────────
// Interface
// ─────────────────────────────────────────────────────────────

export interface IOddsProvider {
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
}
