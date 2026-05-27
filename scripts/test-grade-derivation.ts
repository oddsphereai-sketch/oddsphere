/**
 * Tests for gradeDerivationService (Phase 6.3d).
 *
 *   • Pure deriveGrade: each of the 7 grades fires under its conditions,
 *     for both kind: "game" (5% threshold) and kind: "prop" (10% threshold).
 *   • Threshold boundaries — exactly at the line fires, just under doesn't.
 *   • signal_type attribution: each of the 5 union values fires correctly.
 *   • Best-signal slate monitor: emits warn when >25% of slate qualifies.
 *   • Batch + DB: deriveGradesForSlate joins predictions + sharp_signals +
 *     market_signal correctly; updateGradesForSlate writes are idempotent.
 *
 * Prerequisite: schema-migration-v7.sql applied (grade + signal_type
 * columns). Batch tests need the seed slate (npm run seed → MLB 2026-05-22)
 * AND for the prior derivation pass to have populated market_signal — the
 * batch block calls updateMarketSignalsForSlate first to ensure that.
 *
 * Run with: npm run test:grade-derivation
 */

import {
  deriveGrade,
  deriveGradesForSlate,
  updateGradesForSlate,
  monitorBestSignalShare,
  type GradeInput,
  type SlateGrades,
} from "../lib/services/gradeDerivationService";
import { updateMarketSignalsForSlate } from "../lib/services/marketSignalDerivationService";
import type { SignalEvidence } from "../lib/services/signalEvidenceClassifier";
import { supabase } from "../lib/db/supabase";
import {
  GRADE_THRESHOLDS,
  SHARP_SIGNAL_THRESHOLDS,
} from "../lib/config/constants";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, hint?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    const msg = `  ✗ ${label}${hint ? ` — ${hint}` : ""}`;
    console.log(msg);
    failures.push(msg);
  }
}

function section(t: string) {
  console.log(`\n━━━ ${t} ━━━`);
}

function input(overrides: Partial<GradeInput>): GradeInput {
  return {
    kind: "prop",
    modelEdgePct: null,
    marketSignal: null,
    // Fix 2.1 (Gap-9): evidence defaults to null so existing tests that
    // don't set it exercise the legacy permissive path (market_resistance
    // → sharp_conflict). Tests that need the new tier-aware Sharp Conflict
    // bar pass an explicit evidence record.
    evidence: null,
    ...overrides,
  };
}

/**
 * Build a SignalEvidence record for tier-aware Sharp Conflict tests.
 * Defaults every slot to null/false; tests override only the slots they need.
 */
function evidence(overrides: Partial<SignalEvidence> = {}): SignalEvidence {
  return {
    ev: null,
    steam: null,
    rlm: null,
    sharpDivergence: null,
    publicSmoke: null,
    ...overrides,
  };
}

async function main() {
  // ─── best_signal — both layers strong, edge >= threshold ───────────────
  section("best_signal (props @ 10%, games @ 5%)");

  check(
    "Prop @ 10% with market_confirmed → best_signal/balanced",
    (() => {
      const r = deriveGrade(
        input({ kind: "prop", modelEdgePct: 10, marketSignal: "market_confirmed" })
      );
      return r.grade === "best_signal" && r.signal_type === "balanced";
    })()
  );

  check(
    "Prop @ 15% with steam_alert → best_signal/balanced",
    (() => {
      const r = deriveGrade(
        input({ kind: "prop", modelEdgePct: 15, marketSignal: "steam_alert" })
      );
      return r.grade === "best_signal" && r.signal_type === "balanced";
    })()
  );

  check(
    "Game @ 3% with market_confirmed → best_signal (game threshold, evidence-null legacy path)",
    (() => {
      const r = deriveGrade(
        input({ kind: "game", modelEdgePct: 3, marketSignal: "market_confirmed" })
      );
      return r.grade === "best_signal";
    })()
  );

  check(
    "Prop @ 9.9% (just under 10% threshold) with market_confirmed → sharp_confirmed (NOT best)",
    (() => {
      const r = deriveGrade(
        input({ kind: "prop", modelEdgePct: 9.9, marketSignal: "market_confirmed" })
      );
      return r.grade === "sharp_confirmed";
    })()
  );

  // Fix 3.1 (Flag A→A2): BEST_SIGNAL_GAME_EDGE moved from 5 to 3 to match
  // framework §"Best Signal" verbatim. Below the threshold → sharp_confirmed
  // in the evidence-null (legacy) path.
  check(
    "Game @ 2.9% (just under 3% threshold) with market_confirmed → sharp_confirmed",
    (() => {
      const r = deriveGrade(
        input({ kind: "game", modelEdgePct: 2.9, marketSignal: "market_confirmed" })
      );
      return r.grade === "sharp_confirmed";
    })()
  );

  // ─── sharp_confirmed — market_confirmed + model edge below best ────────
  section("sharp_confirmed (market confirms, edge below best threshold)");

  check(
    "Prop @ 5% with market_confirmed → sharp_confirmed/balanced",
    (() => {
      const r = deriveGrade(
        input({ kind: "prop", modelEdgePct: 5, marketSignal: "market_confirmed" })
      );
      return r.grade === "sharp_confirmed" && r.signal_type === "balanced";
    })()
  );

  check(
    "Game @ 2% with steam_alert → sharp_confirmed (above MIN_GAME_EDGE 1%, below best 5%)",
    (() => {
      const r = deriveGrade(
        input({ kind: "game", modelEdgePct: 2, marketSignal: "steam_alert" })
      );
      return r.grade === "sharp_confirmed";
    })()
  );

  // ─── market_led — market signal without model edge ─────────────────────
  section("market_led (market alone)");

  check(
    "Prop with market_confirmed but edge below MIN_PROP_EDGE → market_led/market_only",
    (() => {
      const r = deriveGrade(
        input({
          kind: "prop",
          modelEdgePct: GRADE_THRESHOLDS.MIN_PROP_EDGE - 0.5,
          marketSignal: "market_confirmed",
        })
      );
      return r.grade === "market_led" && r.signal_type === "market_only";
    })()
  );

  check(
    "Game with steam_alert + NULL edge → market_led/market_only",
    (() => {
      const r = deriveGrade(
        input({ kind: "game", modelEdgePct: null, marketSignal: "steam_alert" })
      );
      return r.grade === "market_led" && r.signal_type === "market_only";
    })()
  );

  check(
    "Game with market_confirmed + edge below MIN_GAME_EDGE → market_led",
    (() => {
      const r = deriveGrade(
        input({
          kind: "game",
          modelEdgePct: GRADE_THRESHOLDS.MIN_GAME_EDGE - 0.5,
          marketSignal: "market_confirmed",
        })
      );
      return r.grade === "market_led";
    })()
  );

  // ─── model_only — model edge present, market neutral ───────────────────
  section("model_only (model alone)");

  check(
    "Prop with market_neutral + edge >= MIN → model_only/model_only",
    (() => {
      const r = deriveGrade(
        input({
          kind: "prop",
          modelEdgePct: GRADE_THRESHOLDS.MIN_PROP_EDGE,
          marketSignal: "market_neutral",
        })
      );
      return r.grade === "model_only" && r.signal_type === "model_only";
    })()
  );

  check(
    "Game with market_neutral + edge >= MIN → model_only",
    (() => {
      const r = deriveGrade(
        input({
          kind: "game",
          modelEdgePct: GRADE_THRESHOLDS.MIN_GAME_EDGE,
          marketSignal: "market_neutral",
        })
      );
      return r.grade === "model_only";
    })()
  );

  // ─── market_watch — neither convincing ─────────────────────────────────
  section("market_watch (default / neither convincing)");

  check(
    "Prop with market_neutral + edge below MIN → market_watch/balanced",
    (() => {
      const r = deriveGrade(
        input({
          kind: "prop",
          modelEdgePct: GRADE_THRESHOLDS.MIN_PROP_EDGE - 0.5,
          marketSignal: "market_neutral",
        })
      );
      return r.grade === "market_watch" && r.signal_type === "balanced";
    })()
  );

  check(
    "Prop with market_neutral + NULL edge → market_watch",
    (() => {
      const r = deriveGrade(
        input({ kind: "prop", modelEdgePct: null, marketSignal: "market_neutral" })
      );
      return r.grade === "market_watch";
    })()
  );

  check(
    "NULL marketSignal (defensive fallback) → market_watch/balanced",
    (() => {
      const r = deriveGrade(
        input({ kind: "prop", modelEdgePct: 12, marketSignal: null })
      );
      return r.grade === "market_watch" && r.signal_type === "balanced";
    })()
  );

  // ─── public_smoke — market public_smoke regardless of model edge ───────
  section("public_smoke (market_only attribution)");

  check(
    "Any prop with public_smoke + high edge → public_smoke/market_only",
    (() => {
      const r = deriveGrade(
        input({ kind: "prop", modelEdgePct: 12, marketSignal: "public_smoke" })
      );
      return r.grade === "public_smoke" && r.signal_type === "market_only";
    })()
  );

  check(
    "Game with public_smoke + low edge → public_smoke",
    (() => {
      const r = deriveGrade(
        input({ kind: "game", modelEdgePct: 0.5, marketSignal: "public_smoke" })
      );
      return r.grade === "public_smoke";
    })()
  );

  // ─── sharp_conflict — market_resistance, balanced or market_only ───────
  section("sharp_conflict (sharps fade our pick)");

  check(
    "Prop with market_resistance + model edge → sharp_conflict/balanced",
    (() => {
      const r = deriveGrade(
        input({ kind: "prop", modelEdgePct: 8, marketSignal: "market_resistance" })
      );
      return r.grade === "sharp_conflict" && r.signal_type === "balanced";
    })()
  );

  check(
    "Game with market_resistance + NO model edge → sharp_conflict/market_only",
    (() => {
      const r = deriveGrade(
        input({
          kind: "game",
          modelEdgePct: null,
          marketSignal: "market_resistance",
        })
      );
      return r.grade === "sharp_conflict" && r.signal_type === "market_only";
    })()
  );

  check(
    "Prop with market_resistance + edge below MIN → sharp_conflict/market_only",
    (() => {
      const r = deriveGrade(
        input({
          kind: "prop",
          modelEdgePct: GRADE_THRESHOLDS.MIN_PROP_EDGE - 0.5,
          marketSignal: "market_resistance",
        })
      );
      return r.signal_type === "market_only";
    })()
  );

  // ─── Opposing-EV alignment flow (6.3.5e-fix WSH @ ATL pattern) ────────
  // The fix's contract for gradeDerivationService: when a sharp signal's
  // side opposes the model pick, edgeForModelSide() returns null (Pinnacle's
  // +EV is on the OTHER side; we conservatively decline inverse extrapolation
  // rather than fabricate a negative edge). The market_signal pure function
  // independently flips the signal to market_resistance for opposing +EV.
  // Together: modelEdgePct=null + marketSignal=market_resistance →
  // sharp_conflict/market_only. These two cases lock that downstream shape.

  check(
    "Game with NULL edge + market_resistance (opposing +EV path) → sharp_conflict/market_only",
    (() => {
      const r = deriveGrade(
        input({
          kind: "game",
          modelEdgePct: null,
          marketSignal: "market_resistance",
        })
      );
      return r.grade === "sharp_conflict" && r.signal_type === "market_only";
    })()
  );

  check(
    "Prop with NULL edge + market_resistance (opposing +EV path) → sharp_conflict/market_only",
    (() => {
      const r = deriveGrade(
        input({
          kind: "prop",
          modelEdgePct: null,
          marketSignal: "market_resistance",
        })
      );
      return r.grade === "sharp_conflict" && r.signal_type === "market_only";
    })()
  );

  // ─── Tier-aware Sharp Conflict bar (Fix 2.1 — Gap-12) ─────────────────
  // Framework reference: SHARP_SIGNAL_FRAMEWORK.md §"Sharp Conflict" —
  //   Required: AT LEAST ONE strong-tier opposing primary (steam ≥3 books,
  //   RLM clearly opposing, sharp_div ≥15pp) PLUS confirming opposing
  //   secondary (typically EV moderate+).
  //
  //   Edge case: single very-strong opposing primary suffices alone (steam
  //   5+, RLM ≥70% public, sharp_div ≥25pp). EV at very_strong is excluded
  //   by the explicit "EV alone" carve-out.
  //
  //   Critical carve-out: "Pinnacle EV opposing alone does NOT trigger
  //   Sharp Conflict. It triggers Market Watch."
  //
  // These cases exercise the bar via explicit evidence records.
  section("tier-aware Sharp Conflict bar (Fix 2.1 — Gap-12)");

  // MIL @ CHC shape: opposing EV alone, no other opposing signals.
  // Framework says: market_watch, NOT sharp_conflict.
  check(
    "MIL @ CHC shape (opposing very_strong EV, no steam/RLM/sharp_div) → market_watch (NOT sharp_conflict)",
    (() => {
      const r = deriveGrade(
        input({
          kind: "game",
          modelEdgePct: null,
          marketSignal: "market_resistance",
          evidence: evidence({
            ev: { tier: "very_strong", aligned: false },
            // No opposing steam/RLM/sharp_div — bar must fail.
          }),
        })
      );
      return r.grade === "market_watch" && r.signal_type === "balanced";
    })()
  );

  // WSH @ ATL shape: opposing strong steam + opposing strong EV.
  // Framework says: sharp_conflict (strong primary + confirming secondary).
  check(
    "WSH @ ATL shape (opposing strong steam + opposing strong EV) → sharp_conflict",
    (() => {
      const r = deriveGrade(
        input({
          kind: "game",
          modelEdgePct: null,
          marketSignal: "market_resistance",
          evidence: evidence({
            steam: { tier: "strong", aligned: false },
            ev: { tier: "strong", aligned: false },
          }),
        })
      );
      return r.grade === "sharp_conflict" && r.signal_type === "market_only";
    })()
  );

  // Edge case: single very-strong opposing steam (5+ books) alone fires
  // sharp_conflict per framework §"Edge Case Handling".
  check(
    "Single very_strong opposing steam alone → sharp_conflict (very-strong shortcut)",
    (() => {
      const r = deriveGrade(
        input({
          kind: "game",
          modelEdgePct: null,
          marketSignal: "market_resistance",
          evidence: evidence({
            steam: { tier: "very_strong", aligned: false },
          }),
        })
      );
      return r.grade === "sharp_conflict";
    })()
  );

  // Edge case: single very-strong opposing sharp_div (25pp+) alone fires.
  check(
    "Single very_strong opposing sharp_div alone → sharp_conflict",
    (() => {
      const r = deriveGrade(
        input({
          kind: "game",
          modelEdgePct: null,
          marketSignal: "market_resistance",
          evidence: evidence({
            sharpDivergence: { tier: "very_strong", aligned: false },
          }),
        })
      );
      return r.grade === "sharp_conflict";
    })()
  );

  // Carve-out: very_strong opposing EV ALONE does NOT trigger (EV is
  // explicitly excluded from the very-strong-alone shortcut).
  check(
    "Single very_strong opposing EV alone → market_watch (EV-alone carve-out wins)",
    (() => {
      const r = deriveGrade(
        input({
          kind: "game",
          modelEdgePct: null,
          marketSignal: "market_resistance",
          evidence: evidence({
            ev: { tier: "very_strong", aligned: false },
          }),
        })
      );
      return r.grade === "market_watch";
    })()
  );

  // Bar fail: opposing strong steam ALONE (no secondary) — needs confirming.
  check(
    "Opposing strong steam alone (no secondary) → market_watch (needs confirming)",
    (() => {
      const r = deriveGrade(
        input({
          kind: "game",
          modelEdgePct: null,
          marketSignal: "market_resistance",
          evidence: evidence({
            steam: { tier: "strong", aligned: false },
          }),
        })
      );
      return r.grade === "market_watch";
    })()
  );

  // Bar pass: opposing strong sharp_div + opposing moderate EV (different signal as confirming).
  check(
    "Opposing strong sharp_div + opposing moderate EV → sharp_conflict",
    (() => {
      const r = deriveGrade(
        input({
          kind: "game",
          modelEdgePct: null,
          marketSignal: "market_resistance",
          evidence: evidence({
            sharpDivergence: { tier: "strong", aligned: false },
            ev: { tier: "moderate", aligned: false },
          }),
        })
      );
      return r.grade === "sharp_conflict";
    })()
  );

  // Bar fail: opposing moderate primary (not strong) — never satisfies primary requirement.
  check(
    "Opposing moderate steam (2 books) + opposing moderate EV → market_watch (no strong primary)",
    (() => {
      const r = deriveGrade(
        input({
          kind: "game",
          modelEdgePct: null,
          marketSignal: "market_resistance",
          evidence: evidence({
            steam: { tier: "moderate", aligned: false },
            ev: { tier: "moderate", aligned: false },
          }),
        })
      );
      return r.grade === "market_watch";
    })()
  );

  // Props with evidence=null: bar bypassed (legacy permissive behavior per Flag D1).
  check(
    "Prop with market_resistance + evidence=null → sharp_conflict (Flag D1 legacy bypass)",
    (() => {
      const r = deriveGrade(
        input({
          kind: "prop",
          modelEdgePct: 8,
          marketSignal: "market_resistance",
          // evidence defaults to null via the input() helper
        })
      );
      return r.grade === "sharp_conflict";
    })()
  );

  // hasModelEdge → signal_type "balanced"; no edge → "market_only" — Fix 2.1
  // preserves the existing attribution rule for the sharp_conflict outcome.
  check(
    "Sharp Conflict with model edge → signal_type 'balanced'",
    (() => {
      const r = deriveGrade(
        input({
          kind: "game",
          modelEdgePct: 8,
          marketSignal: "market_resistance",
          evidence: evidence({
            steam: { tier: "very_strong", aligned: false },
          }),
        })
      );
      return r.grade === "sharp_conflict" && r.signal_type === "balanced";
    })()
  );

  // ─── Tier-aware Best Signal bar (Fix 3.1 — Gap-13) ──────────────────
  // Framework §"Best Signal" requires:
  //   • Model edge ≥ 3% (gated by caller via bestSignalThreshold)
  //   • AT LEAST TWO strong/very_strong aligned (EV/steam/RLM/sharp_div)
  //   • No opposing strong-tier signals (includes EV per Flag D1)
  section("tier-aware Best Signal bar (Fix 3.1 — Gap-13)");

  // SEA @ HOU shape: aligned strong steam + aligned strong EV — should fire.
  check(
    "SEA @ HOU shape (aligned strong steam + aligned strong EV) → best_signal",
    (() => {
      const r = deriveGrade(
        input({
          kind: "game",
          modelEdgePct: 3.8,
          marketSignal: "steam_alert",
          evidence: evidence({
            steam: { tier: "strong", aligned: true },
            ev: { tier: "strong", aligned: true },
          }),
        })
      );
      return r.grade === "best_signal";
    })()
  );

  // Single strong aligned + one moderate → fails (need 2 strong+).
  check(
    "One strong aligned + one moderate aligned → sharp_confirmed (fails Best Signal bar, falls to Sharp Confirmed)",
    (() => {
      const r = deriveGrade(
        input({
          kind: "game",
          modelEdgePct: 3.5,
          marketSignal: "market_confirmed",
          evidence: evidence({
            ev: { tier: "strong", aligned: true },
            steam: { tier: "moderate", aligned: true },
          }),
        })
      );
      return r.grade === "sharp_confirmed";
    })()
  );

  // Two strong aligned + opposing strong EV → blocked by opposing exclusion.
  check(
    "Two strong aligned + opposing strong EV → market_watch (opposing strong blocks Best Signal AND Sharp Confirmed)",
    (() => {
      const r = deriveGrade(
        input({
          kind: "game",
          modelEdgePct: 5,
          marketSignal: "market_confirmed",
          evidence: evidence({
            steam: { tier: "strong", aligned: true },
            rlm: { tier: "strong", aligned: true },
            ev: { tier: "strong", aligned: false },
          }),
        })
      );
      // Best Signal bar fails (opposing strong EV exists).
      // Sharp Confirmed bar also fails (same opposing exclusion).
      // Market-Led bar also fails for same reason.
      // → market_watch
      return r.grade === "market_watch";
    })()
  );

  // Edge: very_strong alone counts as one — still needs ≥2 of any strong+.
  check(
    "Single very_strong aligned (only signal) → sharp_confirmed (not best_signal — count=1)",
    (() => {
      const r = deriveGrade(
        input({
          kind: "game",
          modelEdgePct: 5,
          marketSignal: "steam_alert",
          evidence: evidence({
            steam: { tier: "very_strong", aligned: true },
          }),
        })
      );
      return r.grade === "sharp_confirmed";
    })()
  );

  // Below edge threshold (modelEdgePct < 3) → can't fire best_signal even
  // with strong-tier evidence; falls to sharp_confirmed.
  check(
    "Strong aligned ev + steam but modelEdgePct=2 (below 3% bestThreshold) → sharp_confirmed",
    (() => {
      const r = deriveGrade(
        input({
          kind: "game",
          modelEdgePct: 2,
          marketSignal: "market_confirmed",
          evidence: evidence({
            ev: { tier: "strong", aligned: true },
            steam: { tier: "strong", aligned: true },
          }),
        })
      );
      return r.grade === "sharp_confirmed";
    })()
  );

  // ─── Tier-aware Sharp Confirmed bar (Fix 3.1 — Gap-14) ────────────────
  // Framework §"Sharp Confirmed" requires:
  //   • hasModelEdge (caller-gated per Flag C1)
  //   • ≥1 strong-tier aligned OR ≥2 moderate-tier aligned
  //   • No opposing strong signals
  section("tier-aware Sharp Confirmed bar (Fix 3.1 — Gap-14)");

  check(
    "Single strong aligned (e.g., strong RLM only) → sharp_confirmed",
    (() => {
      const r = deriveGrade(
        input({
          kind: "game",
          modelEdgePct: 2,
          marketSignal: "market_confirmed",
          evidence: evidence({
            rlm: { tier: "strong", aligned: true },
          }),
        })
      );
      return r.grade === "sharp_confirmed";
    })()
  );

  check(
    "Two moderate aligned (e.g., moderate EV + moderate steam) → sharp_confirmed",
    (() => {
      const r = deriveGrade(
        input({
          kind: "game",
          modelEdgePct: 2,
          marketSignal: "market_confirmed",
          evidence: evidence({
            ev: { tier: "moderate", aligned: true },
            steam: { tier: "moderate", aligned: true },
          }),
        })
      );
      return r.grade === "sharp_confirmed";
    })()
  );

  check(
    "Single moderate aligned (no other signals) → market_watch (fails Sharp Confirmed bar)",
    (() => {
      const r = deriveGrade(
        input({
          kind: "game",
          modelEdgePct: 2,
          marketSignal: "market_confirmed",
          evidence: evidence({
            ev: { tier: "moderate", aligned: true },
          }),
        })
      );
      // Sharp Confirmed bar: ≥1 strong (no) OR ≥2 moderate (only 1) → fail
      // Market-Led bar: ≥1 strong aligned → fail (only moderate)
      // → market_watch
      return r.grade === "market_watch";
    })()
  );

  check(
    "Strong aligned + opposing strong steam → market_watch (opposing block)",
    (() => {
      const r = deriveGrade(
        input({
          kind: "game",
          modelEdgePct: 2,
          marketSignal: "market_confirmed",
          evidence: evidence({
            ev: { tier: "strong", aligned: true },
            steam: { tier: "strong", aligned: false },
          }),
        })
      );
      return r.grade === "market_watch";
    })()
  );

  // ─── Tier-aware Market-Led bar (Fix 3.1 — Gap-15, v1.1 tightening) ────
  // Framework v1.1: "Market-Led should NOT fire on weak or mixed movement."
  //   • ≥1 strong-tier aligned signal
  //   • No opposing strong signals
  // Caller enters this branch with hasModelEdge=false.
  section("tier-aware Market-Led bar (Fix 3.1 — Gap-15)");

  check(
    "Strong aligned signal, no model edge → market_led",
    (() => {
      const r = deriveGrade(
        input({
          kind: "game",
          modelEdgePct: null,
          marketSignal: "steam_alert",
          evidence: evidence({
            steam: { tier: "strong", aligned: true },
          }),
        })
      );
      return r.grade === "market_led";
    })()
  );

  check(
    "Only moderate aligned, no model edge → market_watch (v1.1: not Market-Led on weak movement)",
    (() => {
      const r = deriveGrade(
        input({
          kind: "game",
          modelEdgePct: null,
          marketSignal: "market_confirmed",
          evidence: evidence({
            steam: { tier: "moderate", aligned: true },
          }),
        })
      );
      return r.grade === "market_watch";
    })()
  );

  check(
    "Strong aligned + opposing strong → market_watch (opposing block on Market-Led too)",
    (() => {
      const r = deriveGrade(
        input({
          kind: "game",
          modelEdgePct: null,
          marketSignal: "steam_alert",
          evidence: evidence({
            steam: { tier: "strong", aligned: true },
            rlm: { tier: "strong", aligned: false },
          }),
        })
      );
      return r.grade === "market_watch";
    })()
  );

  // ─── Tier-aware Model Only bar (Fix 3.1 — Gap-16) ─────────────────────
  // Framework §"Model Only": "No signal at moderate or stronger tier in
  // any of the five inputs. Market is silent; model speaks alone."
  section("tier-aware Model Only bar (Fix 3.1 — Gap-16)");

  check(
    "market_neutral + model edge + no moderate+ evidence → model_only",
    (() => {
      const r = deriveGrade(
        input({
          kind: "game",
          modelEdgePct: 5,
          marketSignal: "market_neutral",
          evidence: evidence(),
        })
      );
      return r.grade === "model_only" && r.signal_type === "model_only";
    })()
  );

  check(
    "market_neutral + model edge BUT moderate-aligned steam → market_watch (market is not silent)",
    (() => {
      const r = deriveGrade(
        input({
          kind: "game",
          modelEdgePct: 5,
          marketSignal: "market_neutral",
          evidence: evidence({
            steam: { tier: "moderate", aligned: true },
          }),
        })
      );
      return r.grade === "market_watch";
    })()
  );

  check(
    "market_neutral + model edge BUT moderate-opposing sharp_div → market_watch",
    (() => {
      const r = deriveGrade(
        input({
          kind: "game",
          modelEdgePct: 5,
          marketSignal: "market_neutral",
          evidence: evidence({
            sharpDivergence: { tier: "moderate", aligned: false },
          }),
        })
      );
      return r.grade === "market_watch";
    })()
  );

  check(
    "market_neutral + model edge BUT publicSmoke fires → market_watch",
    (() => {
      const r = deriveGrade(
        input({
          kind: "game",
          modelEdgePct: 5,
          marketSignal: "market_neutral",
          evidence: evidence({ publicSmoke: { aligned: true } }),
        })
      );
      return r.grade === "market_watch";
    })()
  );

  // ─── Tier-aware Public Smoke bar (Fix 3.1 — Gap-17) ───────────────────
  // Framework §"Public Smoke": model must pick the public side. When
  // model fades public, the underlying public_smoke read is supportive.
  section("tier-aware Public Smoke bar (Fix 3.1 — Gap-17)");

  check(
    "public_smoke market_signal + publicSmoke aligned → public_smoke grade",
    (() => {
      const r = deriveGrade(
        input({
          kind: "game",
          modelEdgePct: 0.5,
          marketSignal: "public_smoke",
          evidence: evidence({ publicSmoke: { aligned: true } }),
        })
      );
      return r.grade === "public_smoke" && r.signal_type === "market_only";
    })()
  );

  check(
    "public_smoke market_signal + publicSmoke opposing → market_watch (model fades public)",
    (() => {
      const r = deriveGrade(
        input({
          kind: "game",
          modelEdgePct: 0.5,
          marketSignal: "public_smoke",
          evidence: evidence({ publicSmoke: { aligned: false } }),
        })
      );
      return r.grade === "market_watch";
    })()
  );

  check(
    "public_smoke market_signal + publicSmoke=null in evidence → market_watch",
    (() => {
      const r = deriveGrade(
        input({
          kind: "game",
          modelEdgePct: 0.5,
          marketSignal: "public_smoke",
          evidence: evidence(),
        })
      );
      return r.grade === "market_watch";
    })()
  );

  // Props with evidence=null bypass the Public Smoke bar (Flag D1 legacy).
  check(
    "prop with public_smoke + evidence=null → public_smoke (Flag D1 legacy bypass)",
    (() => {
      const r = deriveGrade(
        input({ kind: "prop", marketSignal: "public_smoke" })
      );
      return r.grade === "public_smoke";
    })()
  );

  // ─── Best-signal slate monitor ─────────────────────────────────────────
  section("monitorBestSignalShare");

  /**
   * Synthesize a SlateGrades with `bestSignalCount` best_signal picks +
   * `otherCount` model_only picks. The 6.3.5b monitor counts picks across
   * games.{ml,ou,nrfi} + props — for simplicity we put all picks in the
   * ML market (one pick per row × N rows). Pick-count semantics are the
   * same regardless of which market the picks land in.
   */
  function fakeSlate(
    bestSignalCount: number,
    otherCount: number
  ): SlateGrades {
    const ml = new Map<
      number,
      { grade: import("../lib/types/domain/Grade").Grade; signal_type: import("../lib/types/domain/Grade").SignalType }
    >();
    let id = 1;
    for (let i = 0; i < bestSignalCount; i++) {
      ml.set(id++, { grade: "best_signal", signal_type: "balanced" });
    }
    for (let i = 0; i < otherCount; i++) {
      ml.set(id++, { grade: "model_only", signal_type: "model_only" });
    }
    return {
      games: { ml, ou: new Map(), nrfi: new Map() },
      props: new Map(),
    };
  }

  // Capture console.warn to test the monitor without polluting test output.
  function withMutedWarn<T>(fn: () => T): { result: T; warned: boolean } {
    const original = console.warn;
    let warned = false;
    console.warn = () => {
      warned = true;
    };
    try {
      const result = fn();
      return { result, warned };
    } finally {
      console.warn = original;
    }
  }

  const m1 = withMutedWarn(() => monitorBestSignalShare(fakeSlate(2, 8), "test"));
  check(
    "20% best_signal share does NOT trigger monitor warn",
    m1.result.bestSignalPct === 20 && m1.result.exceededThreshold === false && !m1.warned
  );

  const m2 = withMutedWarn(() => monitorBestSignalShare(fakeSlate(3, 7), "test"));
  check(
    "30% best_signal share DOES trigger monitor warn",
    m2.result.bestSignalPct === 30 && m2.result.exceededThreshold === true && m2.warned
  );

  const m3 = withMutedWarn(() =>
    monitorBestSignalShare(
      {
        games: { ml: new Map(), ou: new Map(), nrfi: new Map() },
        props: new Map(),
      },
      "test"
    )
  );
  check(
    "Empty slate → monitor returns pct=0, does NOT warn",
    m3.result.bestSignalPct === 0 && m3.result.exceededThreshold === false && !m3.warned
  );

  // Pick-count semantics: 1 best_signal in ML + 1 best_signal in OU + 1 in
  // NRFI + 1 in props = 4 best_signal across 4 derived picks (100% — must warn).
  const crossMarketSlate: SlateGrades = {
    games: {
      ml: new Map([[1, { grade: "best_signal", signal_type: "balanced" }]]),
      ou: new Map([[1, { grade: "best_signal", signal_type: "balanced" }]]),
      nrfi: new Map([[1, { grade: "best_signal", signal_type: "balanced" }]]),
    },
    props: new Map([[100, { grade: "best_signal", signal_type: "balanced" }]]),
  };
  const m4 = withMutedWarn(() =>
    monitorBestSignalShare(crossMarketSlate, "test")
  );
  check(
    "monitor counts picks across ml + ou + nrfi + props (not games)",
    m4.result.totalDerivedPicks === 4 && m4.result.bestSignalPicks === 4
  );
  check(
    "perMarket sub-counts surface in monitor result",
    m4.result.perMarket.ml.derived === 1 &&
      m4.result.perMarket.ou.derived === 1 &&
      m4.result.perMarket.nrfi.derived === 1 &&
      m4.result.perMarket.ml.bestSignals === 1 &&
      m4.result.perMarket.ou.bestSignals === 1 &&
      m4.result.perMarket.nrfi.bestSignals === 1
  );

  // ─── Batch + DB integration ────────────────────────────────────────────
  section("batch derivation against the seed slate");

  const targetSlate = "2026-05-22";
  const { data: mlbGames } = await supabase
    .from("games")
    .select("id")
    .eq("sport", "mlb")
    .eq("slate_date", targetSlate);
  const mlbCount = (mlbGames ?? []).length;

  if (mlbCount === 0) {
    console.log(
      "\n  (skipping batch tests — no MLB games at " +
        targetSlate +
        "; run `npm run seed` to populate)"
    );
  } else {
    // Ensure Layer 3 is populated before grading.
    await updateMarketSignalsForSlate("mlb", targetSlate);

    // First ensure marketSignalDerivationService has populated the per-pick
    // market_signal columns gradeDerivationService reads from.
    await updateMarketSignalsForSlate("mlb", targetSlate);

    const derived = await deriveGradesForSlate("mlb", targetSlate);
    check(
      "deriveGradesForSlate returned non-empty per-pick maps for seeded slate",
      derived.games.ml.size > 0 ||
        derived.games.ou.size > 0 ||
        derived.games.nrfi.size > 0 ||
        derived.props.size > 0
    );

    const ALL_GRADES = new Set([
      "best_signal",
      "sharp_confirmed",
      "market_led",
      "model_only",
      "market_watch",
      "public_smoke",
      "sharp_conflict",
    ]);
    const ALL_SIGNAL_TYPES = new Set([
      "model_dominant",
      "market_dominant",
      "balanced",
      "model_only",
      "market_only",
    ]);
    let badGrade = 0;
    let badSignalType = 0;
    for (const market of ["ml", "ou", "nrfi"] as const) {
      for (const out of derived.games[market].values()) {
        if (!ALL_GRADES.has(out.grade)) badGrade++;
        if (!ALL_SIGNAL_TYPES.has(out.signal_type)) badSignalType++;
      }
    }
    for (const out of derived.props.values()) {
      if (!ALL_GRADES.has(out.grade)) badGrade++;
      if (!ALL_SIGNAL_TYPES.has(out.signal_type)) badSignalType++;
    }
    check(`every derived grade is in the canonical Grade union`, badGrade === 0);
    check(
      `every derived signal_type is in the canonical SignalType union`,
      badSignalType === 0
    );

    const r1 = await updateGradesForSlate("mlb", targetSlate);
    check(
      "updateGradesForSlate wrote at least one row",
      r1.gamePredictionsUpdated > 0 || r1.propPredictionsUpdated > 0
    );
    check(
      "result includes perMarket sub-counts (derived === written)",
      r1.perMarket.ml.derived === r1.perMarket.ml.written &&
        r1.perMarket.ou.derived === r1.perMarket.ou.written &&
        r1.perMarket.nrfi.derived === r1.perMarket.nrfi.written
    );

    const r2 = await updateGradesForSlate("mlb", targetSlate);
    check(
      "re-running updateGradesForSlate is idempotent (same row counts)",
      r2.gamePredictionsUpdated === r1.gamePredictionsUpdated &&
        r2.propPredictionsUpdated === r1.propPredictionsUpdated
    );

    // DB spot-check: per-pick columns match derived values. (6.3.5e
    // dropped the legacy grade/signal_type DB column spot-check —
    // those columns are no longer written. V14 migration drops them.)
    const sampleGameIds = Array.from(derived.games.ml.keys()).slice(0, 5);
    if (sampleGameIds.length > 0) {
      const { data: gameDbRows } = await supabase
        .from("game_predictions")
        .select(
          "id, ml_grade, ml_signal_type, ou_grade, ou_signal_type, nrfi_grade, nrfi_signal_type"
        )
        .in("id", sampleGameIds);
      let perPickMismatch = 0;
      for (const row of (gameDbRows ?? []) as Array<{
        id: number;
        ml_grade: string | null;
        ml_signal_type: string | null;
        ou_grade: string | null;
        ou_signal_type: string | null;
        nrfi_grade: string | null;
        nrfi_signal_type: string | null;
      }>) {
        const mlExpected = derived.games.ml.get(row.id) ?? null;
        if (
          (mlExpected?.grade ?? null) !== row.ml_grade ||
          (mlExpected?.signal_type ?? null) !== row.ml_signal_type
        ) {
          perPickMismatch++;
        }
        const ouExpected = derived.games.ou.get(row.id) ?? null;
        if (
          (ouExpected?.grade ?? null) !== row.ou_grade ||
          (ouExpected?.signal_type ?? null) !== row.ou_signal_type
        ) {
          perPickMismatch++;
        }
        const nrfiExpected = derived.games.nrfi.get(row.id) ?? null;
        if (
          (nrfiExpected?.grade ?? null) !== row.nrfi_grade ||
          (nrfiExpected?.signal_type ?? null) !== row.nrfi_signal_type
        ) {
          perPickMismatch++;
        }
      }
      check(
        "DB per-pick ml/ou/nrfi grade+signal_type match derived maps for sampled rows",
        perPickMismatch === 0
      );
    }

    const samplePropIds = Array.from(derived.props.keys()).slice(0, 5);
    if (samplePropIds.length > 0) {
      const { data: propDbRows } = await supabase
        .from("prop_predictions")
        .select("id, grade, signal_type")
        .in("id", samplePropIds);
      let mismatch = 0;
      for (const row of (propDbRows ?? []) as Array<{
        id: number;
        grade: string | null;
        signal_type: string | null;
      }>) {
        const expected = derived.props.get(row.id);
        if (
          !expected ||
          expected.grade !== row.grade ||
          expected.signal_type !== row.signal_type
        )
          mismatch++;
      }
      check(
        "prop_predictions DB grade+signal_type match derived map for sampled rows",
        mismatch === 0
      );
    }

    // Best-signal monitor on the real slate — should NOT throw regardless
    // of whether it warns. Confirm the structured result.
    check(
      "real-slate monitor returns a structured result (totalDerivedPicks >= 0)",
      r1.monitor.totalDerivedPicks >= 0 &&
        typeof r1.monitor.bestSignalPct === "number" &&
        typeof r1.monitor.perMarket.ml.derived === "number"
    );

    // ── Alignment + Sharp Conflict bar audit (Fix 2.1 — Gap-12) ────────
    // End-to-end: for opposing-side total signals on the seed slate, the
    // outcome depends on whether the framework Sharp Conflict bar is met.
    //   WSH @ ATL pattern: opposing steam (strong) + opposing EV (strong)
    //     → meets bar → sharp_conflict.
    //   MIL @ CHC pattern: opposing EV only (no opposing steam/RLM/div)
    //     → bar NOT met (no strong primary) → market_watch.
    //
    // Pre-Fix-2.1 both patterns escalated unconditionally to sharp_conflict
    // (Gap-12 regression). Post-fix the bar gates the escalation.
    const gameIdList = ((mlbGames ?? []) as Array<{ id: number }>).map(
      (g) => g.id
    );
    // Pull the full evidence-bearing fields, not just (game_id, side),
    // so we can classify each opposing signal's evidence shape and form
    // the correct expectation per pick.
    const { data: alignSignals } = await supabase
      .from("sharp_signals")
      .select(
        "game_id, side, is_plus_ev, ev_pct, has_steam_move, steam_books_count, has_reverse_line_movement, rlm_direction, public_betting_pct, public_money_pct"
      )
      .eq("market_type", "total")
      .in("game_id", gameIdList);
    const { data: alignPicks } = await supabase
      .from("game_predictions")
      .select("id, game_id, predicted_ou_side")
      .in("game_id", gameIdList);
    const alignPickByGame = new Map<
      number,
      { id: number; side: string | null }
    >();
    for (const p of (alignPicks ?? []) as Array<{
      id: number;
      game_id: number;
      predicted_ou_side: string | null;
    }>) {
      alignPickByGame.set(p.game_id, {
        id: p.id,
        side: p.predicted_ou_side,
      });
    }

    type SignalRow = {
      game_id: number;
      side: string;
      is_plus_ev: boolean | null;
      ev_pct: number | null;
      has_steam_move: boolean | null;
      steam_books_count: number | null;
      has_reverse_line_movement: boolean | null;
      rlm_direction: string | null;
      public_betting_pct: number | null;
      public_money_pct: number | null;
    };

    // Classify each opposing-side signal: does it have strong-tier confirming
    // sharp action (steam/RLM/sharp_div) or is it EV-only? The expectation
    // forks accordingly per Fix 2.1's Sharp Conflict bar.
    const opposingExpectations: Array<{
      pickId: number;
      gameId: number;
      expectsSharpConflict: boolean;
      hasStrongPrimary: boolean;
    }> = [];

    for (const s of (alignSignals ?? []) as SignalRow[]) {
      const pick = alignPickByGame.get(s.game_id);
      if (!pick || pick.side === null || pick.side === s.side) continue;
      // Opposing-side signal. Check whether it carries strong-tier primary
      // confirming evidence.
      const opposingStrongSteam =
        (s.has_steam_move ?? false) &&
        (s.steam_books_count ?? 0) >= SHARP_SIGNAL_THRESHOLDS.MIN_STEAM_BOOKS;
      const opposingStrongRlm =
        (s.has_reverse_line_movement ?? false) &&
        s.rlm_direction !== null &&
        !s.rlm_direction.endsWith(pick.side) &&
        (s.public_betting_pct ?? 0) >=
          SHARP_SIGNAL_THRESHOLDS.RLM_STRONG_PUBLIC_THRESHOLD;
      const gap =
        s.public_betting_pct !== null && s.public_money_pct !== null
          ? Math.abs(s.public_money_pct - s.public_betting_pct)
          : 0;
      const opposingStrongSharpDiv =
        gap >= SHARP_SIGNAL_THRESHOLDS.SHARP_DIVERGENCE_STRONG;
      const hasStrongPrimary =
        opposingStrongSteam || opposingStrongRlm || opposingStrongSharpDiv;

      // Bar requires a confirming secondary too. For seed slate purposes,
      // assume EV at moderate+ tier counts as confirming (matches MIL @ CHC
      // and WSH @ ATL data shape — both have EV opposing at moderate+).
      const evModeratePlus =
        (s.is_plus_ev ?? false) &&
        (s.ev_pct ?? 0) >= SHARP_SIGNAL_THRESHOLDS.MIN_EV_FOR_PLUS_EV_SIGNAL;

      // Edge case: very-strong primary alone suffices regardless of secondary.
      const veryStrongSteamAlone =
        (s.has_steam_move ?? false) &&
        (s.steam_books_count ?? 0) >=
          SHARP_SIGNAL_THRESHOLDS.STEAM_VERY_STRONG_BOOKS;
      const veryStrongSharpDivAlone =
        gap >= SHARP_SIGNAL_THRESHOLDS.SHARP_DIVERGENCE_VERY_STRONG;
      const veryStrongRlmAlone =
        (s.has_reverse_line_movement ?? false) &&
        s.rlm_direction !== null &&
        !s.rlm_direction.endsWith(pick.side) &&
        (s.public_betting_pct ?? 0) >= 70;
      const veryStrongAloneShortcut =
        veryStrongSteamAlone || veryStrongSharpDivAlone || veryStrongRlmAlone;

      const expectsSharpConflict =
        veryStrongAloneShortcut || (hasStrongPrimary && evModeratePlus);

      opposingExpectations.push({
        pickId: pick.id,
        gameId: s.game_id,
        expectsSharpConflict,
        hasStrongPrimary,
      });
    }

    if (opposingExpectations.length > 0) {
      // (1) WSH @ ATL pattern: opposing strong primary + confirming EV →
      //     sharp_conflict.
      // (2) MIL @ CHC pattern: opposing EV only (no strong primary) →
      //     market_watch.
      let conflictMismatches = 0;
      let watchMismatches = 0;
      const conflictExpectedCount = opposingExpectations.filter(
        (e) => e.expectsSharpConflict
      ).length;
      const watchExpectedCount = opposingExpectations.filter(
        (e) => !e.expectsSharpConflict
      ).length;

      for (const e of opposingExpectations) {
        const out = derived.games.ou.get(e.pickId);
        if (e.expectsSharpConflict) {
          if (out?.grade !== "sharp_conflict") conflictMismatches++;
        } else {
          if (out?.grade !== "market_watch") watchMismatches++;
        }
      }

      check(
        `opposing-side totals with strong-tier confirming evidence → sharp_conflict (${conflictExpectedCount} expected, WSH @ ATL pattern)`,
        conflictMismatches === 0
      );
      check(
        `opposing-side totals with EV-only evidence (no strong primary) → market_watch (${watchExpectedCount} expected, MIL @ CHC pattern — Gap-12 fix)`,
        watchMismatches === 0
      );

      // (3) DB persistence — derived grades match the written columns.
      const allOpposingIds = opposingExpectations.map((e) => e.pickId);
      const { data: alignDbRows } = await supabase
        .from("game_predictions")
        .select("id, ou_grade, ou_signal_type")
        .in("id", allOpposingIds);
      const dbById = new Map<
        number,
        { ou_grade: string | null; ou_signal_type: string | null }
      >();
      for (const row of (alignDbRows ?? []) as Array<{
        id: number;
        ou_grade: string | null;
        ou_signal_type: string | null;
      }>) {
        dbById.set(row.id, {
          ou_grade: row.ou_grade,
          ou_signal_type: row.ou_signal_type,
        });
      }
      let dbMismatch = 0;
      for (const e of opposingExpectations) {
        const db = dbById.get(e.pickId);
        if (!db) {
          dbMismatch++;
          continue;
        }
        const expectedGrade = e.expectsSharpConflict
          ? "sharp_conflict"
          : "market_watch";
        if (db.ou_grade !== expectedGrade) dbMismatch++;
      }
      check(
        "DB ou_grade matches the per-pick framework expectation (sharp_conflict vs market_watch) — write path wired",
        dbMismatch === 0
      );
    } else {
      console.log(
        "  (no opposing-side total signals in seed slate — alignment-audit coverage relies on pure-function cases above)"
      );
    }
  }

  // ─── Summary ──────────────────────────────────────────────────────────
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All grade-derivation tests passed.`);
}

main().catch((e) => {
  console.error("\n❌ test-grade-derivation failed:", (e as Error).message);
  if ((e as Error).stack) console.error((e as Error).stack);
  process.exit(1);
});
