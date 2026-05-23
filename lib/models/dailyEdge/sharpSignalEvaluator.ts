/**
 * Sharp Signal Evaluator — classify a sharp_signals row as STRONG / CAUTION / neutral.
 *
 * Pure function. Input: one SharpSignalRecord (raw signal bundle from SharpAPI
 * via IBettingProvider). Output: composite verdict + the signal_strength /
 * signal_summary fields that will overwrite the row in the sharp_signals
 * table.
 *
 * Verdict order:
 *   1. CAUTION conditions check first — CAUTION is "sticky", overriding any
 *      bullish signals. Customer needs to know about red flags.
 *   2. STRONG conditions: primary signal (≥2% EV + confirming) OR stack of
 *      ≥3 weak confirming signals.
 *   3. Otherwise neutral (no card banner).
 *
 * The evaluator's `reasons[]` array enumerates exactly which thresholds
 * fired — used by verdictGenerator to compose customer-facing text and
 * by the audit log for "why did this signal classify the way it did".
 */

import type { SharpSignalRecord } from "../../providers/interfaces/IBettingProvider";
import type { SignalStrength } from "../../types/domain/SharpSignal";
import { SHARP_SIGNAL_THRESHOLDS } from "../../config/constants";

export type SharpVerdict = "STRONG" | "CAUTION" | null;

export type SignalEvaluation = {
  verdict: SharpVerdict;
  signalStrength: SignalStrength;
  /** Human-readable enumeration of the thresholds that fired */
  reasons: string[];
};

const T = SHARP_SIGNAL_THRESHOLDS;

// ─────────────────────────────────────────────────────────────────────────
// Predicates over a signal row
// ─────────────────────────────────────────────────────────────────────────

function hasPrimaryPlusEv(s: SharpSignalRecord): boolean {
  return s.is_plus_ev && (s.ev_pct ?? 0) >= T.MIN_EV_FOR_PLUS_EV_SIGNAL;
}

function hasNegativeEv(s: SharpSignalRecord): boolean {
  return (s.ev_pct ?? 0) <= T.NEGATIVE_EV_CAUTION_THRESHOLD;
}

function hasStrongSteam(s: SharpSignalRecord): boolean {
  return s.has_steam_move && (s.steam_books_count ?? 0) >= T.MIN_STEAM_BOOKS;
}

function hasLightSteam(s: SharpSignalRecord): boolean {
  const n = s.steam_books_count ?? 0;
  return s.has_steam_move && n >= T.LIGHT_STEAM_BOOKS_MIN && n < T.MIN_STEAM_BOOKS;
}

function hasRlm(s: SharpSignalRecord): boolean {
  return s.has_reverse_line_movement;
}

/**
 * Sharp money divergence: more public $ on this side than public bets.
 * Positive divergence = sharp money confirms this signal's side.
 */
function sharpMoneyDivergencePP(s: SharpSignalRecord): number {
  if (s.public_money_pct === null || s.public_betting_pct === null) return 0;
  return s.public_money_pct - s.public_betting_pct;
}

function hasStrongSharpMoneyDivergence(s: SharpSignalRecord): boolean {
  return sharpMoneyDivergencePP(s) >= T.MIN_SHARP_MONEY_DIVERGENCE_PP;
}

function hasLightSharpMoneyDivergence(s: SharpSignalRecord): boolean {
  const d = sharpMoneyDivergencePP(s);
  return d >= T.LIGHT_SHARP_DIVERGENCE_PP && d < T.MIN_SHARP_MONEY_DIVERGENCE_PP;
}

function hasLightPlusEv(s: SharpSignalRecord): boolean {
  const ev = s.ev_pct ?? 0;
  return ev >= T.LIGHT_EV_MIN && ev < T.MIN_EV_FOR_PLUS_EV_SIGNAL;
}

function hasPinnacleFairConfirmation(s: SharpSignalRecord): boolean {
  return (s.pinnacle_fair_probability ?? 0) >= T.PINNACLE_FAIR_PROB_CONFIRM;
}

// ─────────────────────────────────────────────────────────────────────────
// CAUTION conditions
// ─────────────────────────────────────────────────────────────────────────

function isPublicHeavyNoConfirm(s: SharpSignalRecord): boolean {
  const bp = s.public_betting_pct ?? 0;
  const moneyDiff =
    s.public_money_pct !== null && s.public_betting_pct !== null
      ? Math.abs(s.public_money_pct - s.public_betting_pct)
      : 0;
  return (
    bp >= T.MIN_PUBLIC_HEAVY_PCT &&
    !s.has_steam_move &&
    !s.has_reverse_line_movement &&
    moneyDiff < T.PUBLIC_MONEY_FLATNESS_PP
  );
}

/**
 * Conflicting signals: steam fires AND RLM fires AND they imply opposite
 * directions. We detect this by checking whether the rlm_direction string
 * points to the OTHER side from the signal's `side`. If they both fire but
 * we can't determine direction conflict from the data, we treat as
 * non-conflicting (better to under-fire CAUTION than over-fire).
 */
function hasConflictingSignals(s: SharpSignalRecord): boolean {
  if (!s.has_steam_move || !s.has_reverse_line_movement) return false;
  // If the RLM direction explicitly mentions the OPPOSITE side, conflict.
  // For example, signal side='home' but rlm_direction includes 'away'.
  const dir = s.rlm_direction ?? "";
  const side = s.side ?? "";
  if (side === "home" && dir.toLowerCase().includes("away")) return true;
  if (side === "away" && dir.toLowerCase().includes("home")) return true;
  if (side === "over" && dir.toLowerCase().includes("under")) return true;
  if (side === "under" && dir.toLowerCase().includes("over")) return true;
  return false;
}

// ─────────────────────────────────────────────────────────────────────────
// Main evaluator
// ─────────────────────────────────────────────────────────────────────────

export function evaluateSignal(s: SharpSignalRecord): SignalEvaluation {
  const reasons: string[] = [];

  // ── 1. CAUTION conditions check first (sticky) ─────────────────────────
  if (hasNegativeEv(s)) {
    reasons.push(`negative_ev (${(s.ev_pct ?? 0).toFixed(2)}%)`);
    return { verdict: "CAUTION", signalStrength: "caution", reasons };
  }
  if (isPublicHeavyNoConfirm(s)) {
    reasons.push(
      `public_heavy_no_confirm (betting ${s.public_betting_pct}%, no steam, no RLM)`
    );
    return { verdict: "CAUTION", signalStrength: "caution", reasons };
  }
  if (hasConflictingSignals(s)) {
    reasons.push("conflicting_steam_vs_rlm");
    return { verdict: "CAUTION", signalStrength: "caution", reasons };
  }

  // ── 2. STRONG primary check ─────────────────────────────────────────────
  if (hasPrimaryPlusEv(s)) {
    reasons.push(`plus_ev_primary (${(s.ev_pct ?? 0).toFixed(2)}%)`);
    let confirmingCount = 0;
    if (hasStrongSteam(s)) {
      reasons.push(`steam_strong (${s.steam_books_count} books)`);
      confirmingCount++;
    }
    if (hasRlm(s)) {
      reasons.push(`reverse_line_movement`);
      confirmingCount++;
    }
    if (hasStrongSharpMoneyDivergence(s)) {
      reasons.push(
        `sharp_money_divergence_strong (+${sharpMoneyDivergencePP(s).toFixed(1)}pp)`
      );
      confirmingCount++;
    }
    if (confirmingCount >= 1) {
      return { verdict: "STRONG", signalStrength: "strong", reasons };
    }
    // Primary +EV without confirmation falls through to weak-stack check
  }

  // ── 3. STRONG via weak signal stack ────────────────────────────────────
  // Count weak indicators confirming this side.
  const weakSignals: string[] = [];
  if (hasLightPlusEv(s)) weakSignals.push(`light_plus_ev (${(s.ev_pct ?? 0).toFixed(2)}%)`);
  if (hasLightSteam(s)) weakSignals.push(`light_steam (${s.steam_books_count} books)`);
  if (hasLightSharpMoneyDivergence(s)) {
    weakSignals.push(
      `light_sharp_divergence (+${sharpMoneyDivergencePP(s).toFixed(1)}pp)`
    );
  }
  if (hasPinnacleFairConfirmation(s)) {
    weakSignals.push(
      `pinnacle_fair_confirm (${((s.pinnacle_fair_probability ?? 0) * 100).toFixed(1)}%)`
    );
  }

  if (weakSignals.length >= T.WEAK_SIGNAL_STACK_MIN) {
    reasons.push(`weak_signal_stack (${weakSignals.length} confirming)`);
    reasons.push(...weakSignals);
    return { verdict: "STRONG", signalStrength: "strong", reasons };
  }

  // ── 4. Neutral — no banner ──────────────────────────────────────────────
  if (weakSignals.length > 0) reasons.push(...weakSignals.map((s) => `weak_only:${s}`));
  return { verdict: null, signalStrength: null, reasons };
}
