import type { MarketType, Side } from "./Lines";

/**
 * Composite verdict strength.
 * 'strong' surfaces a green banner; 'caution' surfaces yellow; null = no
 * banner. Never 'lock' or 'fade' — see banned-language list in FOUNDATION.md.
 */
export type SignalStrength = "strong" | "caution" | null;

/** Mirrors the `sharp_signals` table. */
export type SharpSignal = {
  id: number;
  game_id: number | null;
  market_type: MarketType;
  side: Side;
  // Pinnacle reference + EV
  pinnacle_fair_probability: number | null;
  is_plus_ev: boolean;
  ev_pct: number | null;
  // Steam moves
  has_steam_move: boolean;
  steam_detected_at: string | null;
  steam_books_count: number | null;
  // Reverse line movement
  has_reverse_line_movement: boolean;
  rlm_direction: string | null;
  // Public 'smoke' (breakdown-only, never on card)
  public_betting_pct: number | null;
  public_money_pct: number | null;
  // Composite verdict
  signal_strength: SignalStrength;
  signal_summary: string | null;
  computed_at: string;
  created_at: string;
};
