/**
 * signalEvidenceClassifier — tier-aware per-signal classification.
 *
 * Framework reference: planning-docs/SHARP_SIGNAL_FRAMEWORK.md §"The Five
 * Sharp-Signal Inputs" (per-signal tier tables) + §"Per-Pick Signal
 * Combination Logic".
 *
 * THE THREE-LAYER ARCHITECTURE
 *   Layer 1 — Permissive market detection (`marketSignalDerivationService`):
 *     Detects what the market is doing. EV opposing fires market_resistance;
 *     steam aligned fires steam_alert. Honest data, no judgment.
 *   Layer 2 — Rich evidence carrier (this module):
 *     Per-signal tier + alignment. Pure information. The classifier surfaces
 *     "ev at very_strong opposing", "steam at strong aligned", etc., without
 *     interpreting whether the combination crosses any grade threshold.
 *   Layer 3 — Conservative gatekeeper (`gradeDerivationService`):
 *     Applies framework rules to the evidence record. The Sharp Conflict
 *     bar (strong-tier opposing primary + confirming opposing secondary)
 *     lives here, not in the market signal layer.
 *
 * This separation matters for analytics, debugging, future ML training,
 * and member trust. Conservatism lives at the GRADE layer — Layer 1 stays
 * permissive so the underlying market reads are honestly recorded.
 *
 * WHY NOT EXTEND `MarketSignal`?
 *   The MarketSignal enum (steam_alert / market_confirmed / market_resistance /
 *   public_smoke / market_neutral) is the DB-persisted Layer 3 verdict. Tier
 *   metadata is in-memory only — passed to the grade engine via GradeInput,
 *   never serialized. Keeps the schema stable; keeps the wire shape narrow.
 *
 * TIER VOCABULARY
 *   Three actionable tiers: `moderate < strong < very_strong`. Below
 *   moderate (= "weak" / "ignore" in framework parlance) the classifier
 *   returns null for that signal slot. RLM's framework-named "weak" tier
 *   maps to this classifier's "moderate" — naming consistency across the
 *   five signals matters more than mirroring each table verbatim.
 *
 * Used by:
 *   • gradeDerivationService.deriveGrade — `market_resistance` branch
 *     applies the Sharp Conflict bar against the evidence record.
 *   • marketSignalDerivationService.deriveMarketSignal — internally
 *     consults tier classification for tie-breaking when multiple signals
 *     fire on the same row (refactor preserves verdict bit-for-bit per
 *     the regression-anchor at test-derive-market-signal-regression).
 */

import { SHARP_SIGNAL_THRESHOLDS } from "../config/constants";
import type { Side } from "../types/domain/Lines";
import type { MarketSignalSource } from "./marketSignalDerivationService";

const T = SHARP_SIGNAL_THRESHOLDS;

// ─── Types ────────────────────────────────────────────────────────────────

/**
 * Three actionable tiers. Below this is "weak / ignore" — represented as
 * `null` for the signal slot in `SignalEvidence`.
 */
export type SignalTier = "moderate" | "strong" | "very_strong";

const TIER_ORDER: Record<SignalTier, number> = {
  moderate: 1,
  strong: 2,
  very_strong: 3,
};

/**
 * Compare tier to a floor. `tierAtLeast(t, "strong")` returns true when t
 * is strong or very_strong. Use for Sharp Conflict bar and similar rules.
 */
export function tierAtLeast(t: SignalTier, floor: SignalTier): boolean {
  return TIER_ORDER[t] >= TIER_ORDER[floor];
}

export type AlignedTier = {
  tier: SignalTier;
  /**
   * True when the signal is on the same side as the model's pick (the
   * market agrees), false when on the opposite side (the market resists).
   */
  aligned: boolean;
};

/**
 * Per-signal evidence record. Each slot is null when that signal type is
 * below its lowest actionable tier or absent from the row. The grade
 * engine reads this to enforce framework rules.
 */
/**
 * Public smoke evidence slot. Fix 3.1 (Flag F1): reshaped from `boolean` to
 * `{ aligned: boolean } | null` for slot-API consistency with the four
 * tiered signals. The Public Smoke grade bar (Gap-17) needs alignment info
 * — framework §"Public Smoke" requires the model to pick the public side
 * for the grade to fire (otherwise it's supportive, not cautionary).
 *
 * `null`     — public_smoke detection didn't fire on this row
 * `{aligned:true}`  — fired and signal.side === modelSide (model picks the public side)
 * `{aligned:false}` — fired but signal.side !== modelSide (model fades public)
 *
 * Distinct from the tiered slots: public_smoke is a flag, not a tier-graded
 * signal. The `AlignedTier` union doesn't apply here.
 */
export type PublicSmokeEvidence = { aligned: boolean } | null;

export type SignalEvidence = {
  /** Pinnacle de-vig EV (framework Signal 1). */
  ev: AlignedTier | null;
  /** Steam movement (framework Signal 2). */
  steam: AlignedTier | null;
  /** Reverse line movement (framework Signal 3). */
  rlm: AlignedTier | null;
  /** Sharp money vs ticket divergence (framework Signal 4). */
  sharpDivergence: AlignedTier | null;
  /** Public smoke (framework Signal 5). See PublicSmokeEvidence above. */
  publicSmoke: PublicSmokeEvidence;
};

// ─── Per-signal tier classifiers ──────────────────────────────────────────

/**
 * Pinnacle EV tiers (framework Signal 1):
 *   weak       < 1.5%    → null (ignore)
 *   moderate   [1.5, 3)  → "moderate"
 *   strong     [3, 5)    → "strong"
 *   very strong ≥ 5      → "very_strong"
 */
export function classifyEvTier(
  ev_pct: number | null,
  is_plus_ev: boolean
): SignalTier | null {
  if (!is_plus_ev || ev_pct === null) return null;
  if (ev_pct >= T.EV_VERY_STRONG_THRESHOLD) return "very_strong";
  if (ev_pct >= T.EV_STRONG_THRESHOLD) return "strong";
  if (ev_pct >= T.MIN_EV_FOR_PLUS_EV_SIGNAL) return "moderate";
  return null;
}

/**
 * Steam tiers (framework Signal 2):
 *   weak/ignore < 2 books         → null
 *   moderate    = 2 books         → "moderate"
 *   strong      [3, 5)            → "strong"
 *   very strong ≥ 5               → "very_strong"
 *
 * The moderate-floor of 2 books is framework-defined ("Moderate / watch:
 * 2 books") but not exposed as a named constant — the audit-tracked steam
 * constants are MIN_STEAM_BOOKS (3) and STEAM_VERY_STRONG_BOOKS (5).
 * Hardcoded literal `2` here with this framework-anchored comment.
 */
export function classifySteamTier(
  has_steam: boolean,
  books_count: number | null
): SignalTier | null {
  if (!has_steam || books_count === null) return null;
  if (books_count >= T.STEAM_VERY_STRONG_BOOKS) return "very_strong";
  if (books_count >= T.MIN_STEAM_BOOKS) return "strong";
  if (books_count >= 2) return "moderate";
  return null;
}

/**
 * RLM tiers (framework Signal 3) — note framework's RLM "weak" tier is
 * mapped to our "moderate" for cross-signal naming consistency.
 *   not actionable    public < 60%                 → null
 *   moderate ("weak") [60, 65)                     → "moderate"
 *   strong            [65, 70)                     → "strong"
 *   very strong       ≥ 70%                        → "very_strong"
 *
 * The 70% very-strong threshold is framework-defined as a descriptive
 * cutoff, not a named constant. Hardcoded `70` here with framework
 * reference.
 *
 * Returns `aligned` separately because RLM alignment is encoded in
 * `rlm_direction.endsWith(modelSide)`, not in `signal.side`.
 *
 * ── D1 CONTRACT (ratified 2026-06-24) ─────────────────────────────────────
 * RLM REQUIRES real same-source line movement against the public side. That
 * requirement is the gate below: `has_rlm` (= `has_reverse_line_movement`) and
 * `rlm_direction` must come from REAL movement and may NEVER be derived from
 * public betting %. `public_betting_pct` is consumed ONLY as the framework
 * strength tier, and ONLY AFTER the real-movement gate is satisfied — so
 * public action ALONE can never produce RLM. This matches SHARP_SIGNAL_
 * FRAMEWORK.md Signal 3 (public % is the strength dimension of a CONFIRMED
 * RLM, not a trigger). Locked by scripts/test-rlm-public-gate.ts. If you ever
 * wire a real `has_reverse_line_movement` source, it must be computed from
 * same-source line-history movement, not from splits.
 */
export function classifyRlm(
  has_rlm: boolean,
  rlm_direction: string | null,
  public_betting_pct: number | null,
  modelSide: Side
): AlignedTier | null {
  if (!has_rlm || rlm_direction === null || public_betting_pct === null) {
    return null;
  }
  const aligned = rlm_direction.endsWith(modelSide);
  let tier: SignalTier;
  if (public_betting_pct >= 70) tier = "very_strong";
  else if (public_betting_pct >= T.RLM_STRONG_PUBLIC_THRESHOLD) tier = "strong";
  else if (public_betting_pct >= T.RLM_PUBLIC_THRESHOLD) tier = "moderate";
  else return null;
  return { tier, aligned };
}

/**
 * Sharp money divergence tiers (framework Signal 4):
 *   weak       < 10pp gap        → null
 *   moderate   [10, 15)          → "moderate"
 *   strong     [15, 25)          → "strong"
 *   very strong ≥ 25pp           → "very_strong"
 *
 * The `aligned` resolution: the signal row's `side` reflects the side
 * with the higher money% (sharp side). Aligned = signal.side === modelSide.
 */
export function classifySharpDivergenceTier(
  public_betting_pct: number | null,
  public_money_pct: number | null
): SignalTier | null {
  if (public_betting_pct === null || public_money_pct === null) return null;
  const gap = Math.abs(public_money_pct - public_betting_pct);
  if (gap >= T.SHARP_DIVERGENCE_VERY_STRONG) return "very_strong";
  if (gap >= T.SHARP_DIVERGENCE_STRONG) return "strong";
  if (gap >= T.MIN_SHARP_MONEY_DIVERGENCE_PP) return "moderate";
  return null;
}

/**
 * Public smoke detection (framework Signal 5). Boolean — public_smoke is a
 * flag, not a tiered signal. All criteria must hold:
 *   • is_plus_ev !== true (no meaningful Pinnacle EV)
 *   • public_betting_pct ≥ PUBLIC_SMOKE_TICKET_THRESHOLD (65)
 *   • |money% − ticket%| ≤ PUBLIC_SMOKE_FLAT_GAP_MAX (8pp)
 *
 * Caller may still want to factor in steam/RLM absence; this helper
 * implements the public_smoke definition exactly as the V2.1.1 market
 * signal layer does — keeps the two paths bit-for-bit consistent.
 */
export function detectPublicSmoke(signal: MarketSignalSource): boolean {
  if (signal.is_plus_ev === true) return false;
  if (signal.public_betting_pct === null || signal.public_money_pct === null) {
    return false;
  }
  if (signal.public_betting_pct < T.PUBLIC_SMOKE_TICKET_THRESHOLD) return false;
  if (
    Math.abs(signal.public_money_pct - signal.public_betting_pct) >
    T.PUBLIC_SMOKE_FLAT_GAP_MAX
  ) {
    return false;
  }
  return true;
}

// ─── Top-level classifier ─────────────────────────────────────────────────

/**
 * Classify all five signal axes for a single (game, market, modelSide)
 * tuple. Pure function. The grade engine consumes the returned record to
 * enforce framework rules — most notably the Sharp Conflict bar.
 */
export function classifyEvidence(
  modelSide: Side,
  signal: MarketSignalSource | null
): SignalEvidence {
  if (signal === null) {
    return {
      ev: null,
      steam: null,
      rlm: null,
      sharpDivergence: null,
      publicSmoke: null,
    };
  }

  const aligned = signal.side === modelSide;

  const evTier = classifyEvTier(signal.ev_pct, signal.is_plus_ev ?? false);
  const ev: AlignedTier | null = evTier ? { tier: evTier, aligned } : null;

  const steamTier = classifySteamTier(
    signal.has_steam_move ?? false,
    signal.steam_books_count
  );
  const steam: AlignedTier | null = steamTier
    ? { tier: steamTier, aligned }
    : null;

  const rlm = classifyRlm(
    signal.has_reverse_line_movement ?? false,
    signal.rlm_direction,
    signal.public_betting_pct,
    modelSide
  );

  const sdTier = classifySharpDivergenceTier(
    signal.public_betting_pct,
    signal.public_money_pct
  );
  const sharpDivergence: AlignedTier | null = sdTier
    ? { tier: sdTier, aligned }
    : null;

  // Fix 3.1 (Flag F1): publicSmoke carries alignment for the Gap-17 bar.
  // When detection fires, signal.side IS the public side (the side with
  // ticket% ≥ 65). Alignment with model = signal.side === modelSide.
  const publicSmoke: PublicSmokeEvidence = detectPublicSmoke(signal)
    ? { aligned }
    : null;

  return { ev, steam, rlm, sharpDivergence, publicSmoke };
}
