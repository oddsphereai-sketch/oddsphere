/**
 * Meaningful-movement trigger engine (2026-06-16). PURE — no DB, no Next, no
 * env. Worker-safe.
 *
 * The streaming worker must NOT rerun the model on every tick. It evaluates
 * each observed line move with `evaluateMovement` and only requests a
 * lock-safe recompute when the move is *meaningful*. Thresholds are
 * config-driven (defaults below); all comparisons are pure so they are fully
 * unit-testable without infrastructure.
 *
 * Direction-vs-pick reuses the shared classifier in ./lineDirection so the
 * worker and the member-facing line-move UI agree on "toward / against".
 */

import { classifyMove, type MoveDirection } from "./lineDirection";

export type ActiveGrade = "best_angle" | "lean" | "watchlist" | "no_play" | null;

export type MovementInput = {
  marketType: "moneyline" | "total" | "spread" | "first_inning_total" | (string & {});
  /** Picked-side American price before/after the move (for ML cents + direction). */
  prevOddsAmerican: number | null;
  nextOddsAmerican: number | null;
  /** Picked-side no-vig probability before/after, 0..1 (null when not de-viggable). */
  prevNoVigProb: number | null;
  nextNoVigProb: number | null;
  /** Total/spread point before/after the move. */
  prevPoint: number | null;
  nextPoint: number | null;
  /** The model's current pick side for this market (null before a pick exists). */
  pickSide: "home" | "away" | "over" | "under" | (string & {}) | null;
  /** The side that actually moved in this event. */
  movedSide: "home" | "away" | "over" | "under" | (string & {});
  /** The active play grade on this market (drives BA/Lean-specific triggers). */
  activeGrade: ActiveGrade;
  /** Availability transition (odds:removed → odds:update). */
  wasAvailable: boolean;
  isAvailable: boolean;
  /** Minutes until first pitch / kickoff (null when unknown). Drives attention window. */
  minutesToStart: number | null;
};

export type TriggerReason =
  | "ml_cents"
  | "novig_pp"
  | "point_move"
  | "key_number"
  | "moved_against_best_angle"
  | "moved_toward_lean"
  | "became_available"
  | "became_unavailable"
  | "attention_window";

export type TriggerDecision = {
  fire: boolean;
  reasons: TriggerReason[];
  /** Normalized severity for prioritizing the recompute queue (higher = more urgent). */
  magnitude: number;
};

export type TriggerConfig = {
  mlCents: number; // |Δ american cents| to fire on moneyline
  noVigPp: number; // |Δ no-vig prob| in pp to fire
  pointMove: number; // |Δ point| (total/spread) to fire
  /** Inside this window (minutes to start) thresholds are lowered to catch late steam. */
  attentionWindowMin: number; // upper bound (e.g. 180)
  attentionWindowMax: number; // lower bound (e.g. 60 — never below T-60 lock)
  mlCentsAttention: number;
  noVigPpAttention: number;
  /** Key numbers per market family. */
  keyNumbersTotal: number[]; // e.g. MLB totals
  keyNumbersSpread: number[]; // e.g. runline ±1.5
};

export const DEFAULT_TRIGGER_CONFIG: TriggerConfig = {
  mlCents: 10,
  noVigPp: 2.0,
  pointMove: 0.5,
  attentionWindowMin: 180,
  attentionWindowMax: 60,
  mlCentsAttention: 8,
  noVigPpAttention: 1.5,
  keyNumbersTotal: [7, 7.5, 8, 8.5, 9],
  keyNumbersSpread: [1.5, 2.5],
};

/** True when `start` minutes-to-start is inside [attentionWindowMax, attentionWindowMin]. */
function inAttentionWindow(minutesToStart: number | null, cfg: TriggerConfig): boolean {
  if (minutesToStart === null || !Number.isFinite(minutesToStart)) return false;
  return minutesToStart <= cfg.attentionWindowMin && minutesToStart >= cfg.attentionWindowMax;
}

/** Did the point cross any configured key number between prev and next? */
function crossedKeyNumber(prev: number | null, next: number | null, keys: number[]): boolean {
  if (prev === null || next === null || !Number.isFinite(prev) || !Number.isFinite(next)) return false;
  const lo = Math.min(prev, next);
  const hi = Math.max(prev, next);
  if (lo === hi) return false;
  // A key number is "crossed" when it lies strictly between the two values
  // (moved THROUGH it) or the line lands exactly on it from a different value
  // (moved ONTO it). Leaving a key it was already sitting on is NOT a cross.
  return keys.some((k) => (k > lo && k < hi) || (k === next && k !== prev));
}

/**
 * Evaluate whether an observed move warrants a lock-safe recompute.
 * Direction of the move relative to our pick only matters when the move is on
 * the PICKED side (movedSide === pickSide).
 */
export function evaluateMovement(
  input: MovementInput,
  cfg: TriggerConfig = DEFAULT_TRIGGER_CONFIG,
): TriggerDecision {
  const reasons: TriggerReason[] = [];
  let magnitude = 0;

  // Availability transitions are always meaningful (a market opening/closing
  // changes whether we can even price the pick).
  if (input.wasAvailable && !input.isAvailable) {
    reasons.push("became_unavailable");
    magnitude = Math.max(magnitude, 0.6);
  }
  if (!input.wasAvailable && input.isAvailable) {
    reasons.push("became_available");
    magnitude = Math.max(magnitude, 0.6);
  }

  const attention = inAttentionWindow(input.minutesToStart, cfg);
  const mlThresh = attention ? cfg.mlCentsAttention : cfg.mlCents;
  const ppThresh = attention ? cfg.noVigPpAttention : cfg.noVigPp;
  if (attention) reasons.push("attention_window");

  // Moneyline cents move (picked-side price).
  if (input.prevOddsAmerican !== null && input.nextOddsAmerican !== null) {
    const cents = Math.abs(input.nextOddsAmerican - input.prevOddsAmerican);
    if (cents >= mlThresh) {
      reasons.push("ml_cents");
      magnitude = Math.max(magnitude, Math.min(1, cents / 50));
    }
  }

  // No-vig probability move (pp).
  if (input.prevNoVigProb !== null && input.nextNoVigProb !== null) {
    const pp = Math.abs(input.nextNoVigProb - input.prevNoVigProb) * 100;
    if (pp >= ppThresh) {
      reasons.push("novig_pp");
      magnitude = Math.max(magnitude, Math.min(1, pp / 10));
    }
  }

  // Total / spread point move + key-number cross.
  if (input.prevPoint !== null && input.nextPoint !== null) {
    const dp = Math.abs(input.nextPoint - input.prevPoint);
    if (dp >= cfg.pointMove) {
      reasons.push("point_move");
      magnitude = Math.max(magnitude, Math.min(1, dp / 2));
    }
    const keys =
      input.marketType === "spread" ? cfg.keyNumbersSpread : cfg.keyNumbersTotal;
    if (crossedKeyNumber(input.prevPoint, input.nextPoint, keys)) {
      reasons.push("key_number");
      magnitude = Math.max(magnitude, 0.85);
    }
  }

  // Pick-relative triggers (only when the move is on our picked side).
  if (input.pickSide !== null && input.movedSide === input.pickSide) {
    const dir: MoveDirection = classifyMove(input.prevOddsAmerican, input.nextOddsAmerican);
    if (input.activeGrade === "best_angle" && dir === "against") {
      // Value leaving an active Best Angle is the highest-value signal — always fire.
      reasons.push("moved_against_best_angle");
      magnitude = Math.max(magnitude, 1);
    }
    if ((input.activeGrade === "lean" || input.activeGrade === "watchlist") && dir === "toward") {
      reasons.push("moved_toward_lean");
      magnitude = Math.max(magnitude, 0.7);
    }
  }

  return { fire: reasons.length > 0, reasons, magnitude };
}
