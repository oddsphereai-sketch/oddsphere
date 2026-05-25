/**
 * ISharpSignalProvider — contract for sharp-signal detection data.
 *
 * The provider does the detection work (steam moves, RLM, public splits, EV
 * vs Pinnacle); our `verdictGenerator` model turns the records below into the
 * STRONG/CAUTION banner on the Daily Edge card. Odds data lives on the
 * companion IOddsProvider contract so the two can be swapped independently.
 *
 * Real implementation: SharpAPIProvider (paid Pro tier) — Phase 8.
 * Manual implementation: AdminUploadSharpSignalProvider — Phase 7.25.
 * Mock implementation: MockSharpSignalProvider (reads from JSON fixtures).
 *
 * RECORD SHAPES: see IPlayerStatsProvider header for the conventions
 * (no DB ids, FKs expressed as external_id).
 */

import type { MarketType, Side } from "../../types/domain/Lines";
import type { SignalStrength } from "../../types/domain/SharpSignal";

/**
 * One detected sharp signal for a (game, market, side) tuple.
 *
 * `signal_strength` and `signal_summary` may be pre-computed by the provider;
 * downstream evaluation (sharpSignalEvaluator + verdictGenerator) may recompute
 * them after correlating with our scores-model output.
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

export interface ISharpSignalProvider {
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
