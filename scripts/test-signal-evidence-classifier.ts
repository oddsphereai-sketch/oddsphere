/**
 * Tests for lib/services/signalEvidenceClassifier (Fix 2.1 — Gap-9).
 *
 * Framework reference: SHARP_SIGNAL_FRAMEWORK.md §"The Five Sharp-Signal
 * Inputs" per-signal tier tables.
 *
 * Coverage:
 *   • Per-signal tier classifiers — every tier × boundary case
 *   • Top-level classifyEvidence — alignment vs opposing per signal
 *   • Public smoke detection — all-criteria-must-hold semantics
 *   • tierAtLeast comparator
 *
 * Run with: npm run test:signal-evidence-classifier
 */

import {
  classifyEvTier,
  classifySteamTier,
  classifyRlm,
  classifySharpDivergenceTier,
  detectPublicSmoke,
  classifyEvidence,
  tierAtLeast,
  type SignalTier,
} from "../lib/services/signalEvidenceClassifier";
import { SHARP_SIGNAL_THRESHOLDS } from "../lib/config/constants";
import type { MarketSignalSource } from "../lib/services/marketSignalDerivationService";

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

function sig(overrides: Partial<MarketSignalSource> = {}): MarketSignalSource {
  return {
    side: "home",
    is_plus_ev: false,
    ev_pct: null,
    has_steam_move: false,
    steam_books_count: null,
    has_reverse_line_movement: false,
    rlm_direction: null,
    public_betting_pct: null,
    public_money_pct: null,
    ...overrides,
  };
}

function main() {
  // ─── tierAtLeast ──────────────────────────────────────────────────────────
  section("tierAtLeast comparator");

  check("moderate >= moderate", tierAtLeast("moderate", "moderate"));
  check("strong >= moderate", tierAtLeast("strong", "moderate"));
  check("very_strong >= moderate", tierAtLeast("very_strong", "moderate"));
  check("very_strong >= strong", tierAtLeast("very_strong", "strong"));
  check("very_strong >= very_strong", tierAtLeast("very_strong", "very_strong"));
  check("moderate NOT >= strong", !tierAtLeast("moderate", "strong"));
  check("strong NOT >= very_strong", !tierAtLeast("strong", "very_strong"));

  // ─── classifyEvTier ───────────────────────────────────────────────────────
  section("classifyEvTier (framework Signal 1)");

  check("is_plus_ev=false → null", classifyEvTier(5.0, false) === null);
  check("ev_pct=null → null", classifyEvTier(null, true) === null);
  check(
    "ev_pct=1.0 (below moderate floor 1.5) → null (weak/ignore)",
    classifyEvTier(1.0, true) === null
  );
  check(
    "ev_pct=1.49 (just below moderate) → null",
    classifyEvTier(1.49, true) === null
  );
  check(
    "ev_pct=1.5 (exactly moderate floor) → moderate",
    classifyEvTier(1.5, true) === "moderate"
  );
  check(
    "ev_pct=2.99 (just below strong) → moderate",
    classifyEvTier(2.99, true) === "moderate"
  );
  check(
    "ev_pct=3.0 (strong floor) → strong",
    classifyEvTier(3.0, true) === "strong"
  );
  check(
    "ev_pct=4.99 → strong",
    classifyEvTier(4.99, true) === "strong"
  );
  check(
    "ev_pct=5.0 (very_strong floor) → very_strong",
    classifyEvTier(5.0, true) === "very_strong"
  );
  check(
    "ev_pct=10.0 → very_strong",
    classifyEvTier(10.0, true) === "very_strong"
  );

  // ─── classifySteamTier ────────────────────────────────────────────────────
  section("classifySteamTier (framework Signal 2)");

  check("has_steam=false → null", classifySteamTier(false, 5) === null);
  check("books=null → null", classifySteamTier(true, null) === null);
  check(
    "books=0 → null (ignore)",
    classifySteamTier(true, 0) === null
  );
  check(
    "books=1 → null (framework: <2 books = weak/ignore)",
    classifySteamTier(true, 1) === null
  );
  check(
    "books=2 → moderate (framework: '2 books = moderate/watch')",
    classifySteamTier(true, 2) === "moderate"
  );
  check(
    "books=3 (MIN_STEAM_BOOKS) → strong",
    classifySteamTier(true, 3) === "strong"
  );
  check(
    "books=4 → strong",
    classifySteamTier(true, 4) === "strong"
  );
  check(
    "books=5 (STEAM_VERY_STRONG_BOOKS) → very_strong",
    classifySteamTier(true, 5) === "very_strong"
  );
  check(
    "books=10 → very_strong",
    classifySteamTier(true, 10) === "very_strong"
  );

  // ─── classifyRlm ──────────────────────────────────────────────────────────
  section("classifyRlm (framework Signal 3)");

  check(
    "has_rlm=false → null",
    classifyRlm(false, "toward_home", 65, "home") === null
  );
  check(
    "rlm_direction=null → null",
    classifyRlm(true, null, 65, "home") === null
  );
  check(
    "public_betting_pct=null → null",
    classifyRlm(true, "toward_home", null, "home") === null
  );
  check(
    "public 55% (below RLM_PUBLIC_THRESHOLD 60) → null",
    classifyRlm(true, "toward_home", 55, "home") === null
  );
  check(
    "public 60% exactly → moderate (framework weak tier)",
    classifyRlm(true, "toward_home", 60, "home")?.tier === "moderate"
  );
  check(
    "public 64% → moderate",
    classifyRlm(true, "toward_home", 64, "home")?.tier === "moderate"
  );
  check(
    "public 65% (RLM_STRONG_PUBLIC_THRESHOLD) → strong",
    classifyRlm(true, "toward_home", 65, "home")?.tier === "strong"
  );
  check(
    "public 69% → strong",
    classifyRlm(true, "toward_home", 69, "home")?.tier === "strong"
  );
  check(
    "public 70% → very_strong",
    classifyRlm(true, "toward_home", 70, "home")?.tier === "very_strong"
  );
  check(
    "public 75% → very_strong",
    classifyRlm(true, "toward_home", 75, "home")?.tier === "very_strong"
  );
  check(
    "rlm_direction='toward_home', modelSide='home' → aligned=true",
    classifyRlm(true, "toward_home", 65, "home")?.aligned === true
  );
  check(
    "rlm_direction='toward_away', modelSide='home' → aligned=false",
    classifyRlm(true, "toward_away", 65, "home")?.aligned === false
  );
  check(
    "rlm_direction='toward_over', modelSide='under' → aligned=false",
    classifyRlm(true, "toward_over", 65, "under")?.aligned === false
  );

  // ─── classifySharpDivergenceTier ──────────────────────────────────────────
  section("classifySharpDivergenceTier (framework Signal 4)");

  check(
    "money/ticket null → null",
    classifySharpDivergenceTier(null, 65) === null
  );
  check(
    "gap=5 (below moderate floor) → null",
    classifySharpDivergenceTier(50, 55) === null
  );
  check(
    "gap=9 → null (below MODERATE 10pp)",
    classifySharpDivergenceTier(50, 59) === null
  );
  check(
    "gap=10 (MODERATE floor) → moderate",
    classifySharpDivergenceTier(50, 60) === "moderate"
  );
  check(
    "gap=14 → moderate",
    classifySharpDivergenceTier(50, 64) === "moderate"
  );
  check(
    "gap=15 (STRONG floor) → strong",
    classifySharpDivergenceTier(50, 65) === "strong"
  );
  check(
    "gap=24 → strong",
    classifySharpDivergenceTier(50, 74) === "strong"
  );
  check(
    "gap=25 (VERY_STRONG floor) → very_strong",
    classifySharpDivergenceTier(50, 75) === "very_strong"
  );
  check(
    "gap=30 → very_strong",
    classifySharpDivergenceTier(40, 70) === "very_strong"
  );
  // Absolute value semantics
  check(
    "gap negative direction (money 50, ticket 75) → strong (|25|)",
    classifySharpDivergenceTier(75, 50) === "very_strong"
  );

  // ─── detectPublicSmoke ────────────────────────────────────────────────────
  section("detectPublicSmoke (framework Signal 5 — flag, all criteria must hold)");

  check(
    "is_plus_ev=true blocks public_smoke (Pinnacle disagrees with 'no Pinnacle EV' condition)",
    detectPublicSmoke(
      sig({ is_plus_ev: true, public_betting_pct: 75, public_money_pct: 75 })
    ) === false
  );
  check(
    "public_betting_pct=null → false",
    detectPublicSmoke(sig({ is_plus_ev: false, public_money_pct: 75 })) === false
  );
  check(
    "tickets 64% (below PUBLIC_SMOKE_TICKET_THRESHOLD 65) → false",
    detectPublicSmoke(
      sig({ is_plus_ev: false, public_betting_pct: 64, public_money_pct: 64 })
    ) === false
  );
  check(
    "tickets 65 + flat money → public_smoke",
    detectPublicSmoke(
      sig({ is_plus_ev: false, public_betting_pct: 65, public_money_pct: 65 })
    ) === true
  );
  check(
    "tickets 70 + money 78 (gap=8 at MAX inclusive) → public_smoke",
    detectPublicSmoke(
      sig({ is_plus_ev: false, public_betting_pct: 70, public_money_pct: 78 })
    ) === true
  );
  check(
    "tickets 70 + money 79 (gap=9 > MAX 8) → false (sharps flowing)",
    detectPublicSmoke(
      sig({ is_plus_ev: false, public_betting_pct: 70, public_money_pct: 79 })
    ) === false
  );

  // ─── classifyEvidence (top-level) ─────────────────────────────────────────
  section("classifyEvidence — top-level alignment");

  check("null signal → all slots null/false", (() => {
    const e = classifyEvidence("home", null);
    return (
      e.ev === null &&
      e.steam === null &&
      e.rlm === null &&
      e.sharpDivergence === null &&
      e.publicSmoke === false
    );
  })());

  // Aligned EV: signal.side === modelSide
  check("aligned strong EV → {tier: strong, aligned: true}", (() => {
    const e = classifyEvidence(
      "under",
      sig({ side: "under", is_plus_ev: true, ev_pct: 3.5 })
    );
    return e.ev?.tier === "strong" && e.ev?.aligned === true;
  })());

  check("opposing strong EV → {tier: strong, aligned: false}", (() => {
    const e = classifyEvidence(
      "under",
      sig({ side: "over", is_plus_ev: true, ev_pct: 3.5 })
    );
    return e.ev?.tier === "strong" && e.ev?.aligned === false;
  })());

  // Aligned steam
  check("aligned strong steam (3 books) → {tier: strong, aligned: true}", (() => {
    const e = classifyEvidence(
      "home",
      sig({ side: "home", has_steam_move: true, steam_books_count: 3 })
    );
    return e.steam?.tier === "strong" && e.steam?.aligned === true;
  })());

  check("opposing very_strong steam (5 books) → {tier: very_strong, aligned: false}", (() => {
    const e = classifyEvidence(
      "home",
      sig({ side: "away", has_steam_move: true, steam_books_count: 5 })
    );
    return e.steam?.tier === "very_strong" && e.steam?.aligned === false;
  })());

  // RLM with both signal_side and rlm_direction independence
  check("RLM toward_home, modelSide=home → aligned strong", (() => {
    const e = classifyEvidence(
      "home",
      sig({
        side: "away", // irrelevant for RLM alignment
        has_reverse_line_movement: true,
        rlm_direction: "toward_home",
        public_betting_pct: 65,
      })
    );
    return e.rlm?.tier === "strong" && e.rlm?.aligned === true;
  })());

  check("RLM toward_over, modelSide=under → opposing very_strong (public 70%)", (() => {
    const e = classifyEvidence(
      "under",
      sig({
        side: "over",
        has_reverse_line_movement: true,
        rlm_direction: "toward_over",
        public_betting_pct: 70,
      })
    );
    return e.rlm?.tier === "very_strong" && e.rlm?.aligned === false;
  })());

  // Sharp divergence: aligned per signal.side
  check("aligned strong sharp divergence (15pp gap) → {tier: strong, aligned: true}", (() => {
    const e = classifyEvidence(
      "home",
      sig({ side: "home", public_betting_pct: 50, public_money_pct: 65 })
    );
    return (
      e.sharpDivergence?.tier === "strong" && e.sharpDivergence?.aligned === true
    );
  })());

  check("opposing very_strong sharp divergence (25pp gap) → {tier: very_strong, aligned: false}", (() => {
    const e = classifyEvidence(
      "home",
      sig({ side: "away", public_betting_pct: 75, public_money_pct: 50 })
    );
    return (
      e.sharpDivergence?.tier === "very_strong" &&
      e.sharpDivergence?.aligned === false
    );
  })());

  // Mixed evidence — multiple signals firing
  check("mixed: opposing strong steam + opposing strong EV (WSH @ ATL shape)", (() => {
    const e = classifyEvidence(
      "under",
      sig({
        side: "over",
        is_plus_ev: true,
        ev_pct: 4.2,
        has_steam_move: true,
        steam_books_count: 3,
      })
    );
    return (
      e.steam?.tier === "strong" &&
      e.steam?.aligned === false &&
      e.ev?.tier === "strong" &&
      e.ev?.aligned === false
    );
  })());

  // EV-only opposing (MIL @ CHC shape) — only EV slot populated
  check("EV-only opposing (MIL @ CHC shape: ev=5.4 opposing, nothing else)", (() => {
    const e = classifyEvidence(
      "under",
      sig({ side: "over", is_plus_ev: true, ev_pct: 5.4 })
    );
    return (
      e.ev?.tier === "very_strong" &&
      e.ev?.aligned === false &&
      e.steam === null &&
      e.rlm === null &&
      e.sharpDivergence === null
    );
  })());

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All signal-evidence-classifier tests passed.`);
}

main();
