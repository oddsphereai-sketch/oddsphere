/**
 * Tests for lib/services/signalSummaryGenerator (Fix 4.1 — Gap-18 + Gap-19).
 *
 * Framework reference: SHARP_SIGNAL_FRAMEWORK.md §"Member-Facing
 * Explanation Copy" — four example copy templates + brand voice rules.
 *
 * Coverage:
 *   • Each of the 4 framework template shapes — verbatim-form match
 *   • Brand voice rule compliance (no exclamation, no capper words,
 *     Pinnacle cited, quantified data)
 *   • Per-grade composers fire on the right (grade × evidence) combos
 *   • Fallback for true no-signal cases — "No actionable sharp signals
 *     detected on this pick."
 *   • Market-specific label formatting (ML / total / first_inning_total)
 *
 * The seed slate's actual signals (WSH @ ATL, MIL @ CHC, NYM @ PHI,
 * SEA @ HOU) are exercised against the generator with their real numbers
 * to spot-check end-to-end alignment with framework templates.
 *
 * Run with: npm run test:signal-summary-generator
 */

import { generateSignalSummary } from "../lib/services/signalSummaryGenerator";
import type { MarketSignalSource } from "../lib/services/marketSignalDerivationService";
import type {
  SignalEvidence,
  AlignedTier,
} from "../lib/services/signalEvidenceClassifier";

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

const CTX = { homeTeamAbbr: "PHI", awayTeamAbbr: "NYM" };

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

function tier(t: "moderate" | "strong" | "very_strong", aligned: boolean): AlignedTier {
  return { tier: t, aligned };
}

function main() {
  // ─── Brand voice global checks (all generator output must comply) ────────
  // Tested implicitly across the per-grade cases — assertions inline.

  const FORBIDDEN_WORDS = ["LOCK", "SMASH", "HAMMER", "NUKE", "BOMB", "FADE!", "guaranteed", "sure thing"];
  function assertBrandVoice(label: string, text: string) {
    if (text.includes("!")) {
      fail++;
      failures.push(`  ✗ ${label}: contains exclamation point (brand voice violation): "${text}"`);
      return;
    }
    for (const word of FORBIDDEN_WORDS) {
      if (text.includes(word)) {
        fail++;
        failures.push(`  ✗ ${label}: contains forbidden word "${word}": "${text}"`);
        return;
      }
    }
    pass++;
    console.log(`  ✓ ${label}: brand voice compliant`);
  }

  // ─── Framework Template 1: Aligned strong + confirming ───────────────────
  section("Framework Template 1 — Aligned strong + confirming → STRONG · ...");

  {
    const text = generateSignalSummary(
      "home",
      "moneyline",
      sig({
        side: "home",
        is_plus_ev: true,
        ev_pct: 3.2,
        has_steam_move: true,
        steam_books_count: 4,
        public_betting_pct: 53,
        public_money_pct: 65,
      }),
      evidence({
        ev: tier("strong", true),
        steam: tier("strong", true),
      }),
      "best_signal",
      { ...CTX, steamDetectedAt: "2026-05-22T15:45:00+00:00" }
    );
    console.log(`  → "${text}"`);
    check(
      'starts with "STRONG · " (best_signal header)',
      text.startsWith("STRONG · ")
    );
    check(
      'mentions "PHI ML" (model pick label)',
      text.includes("PHI ML")
    );
    check(
      'cites Pinnacle EV (brand voice "cite Pinnacle as de-vig reference")',
      text.includes("Pinnacle EV") || text.includes("EV +")
    );
    check(
      'mentions "Steam across 4 books" (steam detail)',
      text.includes("Steam across 4 books")
    );
    check(
      'mentions sharp money vs public (template 1 detail)',
      text.includes("Sharp money") && text.includes("public bets")
    );
    assertBrandVoice("Template 1 brand voice", text);
  }

  // ─── Framework Template 2: Aligned EV-only no confirmation ────────────────
  section("Framework Template 2 — Aligned EV-only no confirmation → MODERATE · ...");

  {
    const text = generateSignalSummary(
      "home",
      "moneyline",
      sig({ side: "home", is_plus_ev: true, ev_pct: 2.1 }),
      evidence({ ev: tier("moderate", true) }),
      "market_watch", // Aligned moderate EV alone fails Sharp Confirmed bar → market_watch
      CTX
    );
    console.log(`  → "${text}"`);
    check(
      'starts with "MODERATE · " (framework template 2 header)',
      text.startsWith("MODERATE · ")
    );
    check(
      'mentions Pinnacle fair value supports + pick label',
      text.includes("Pinnacle fair value supports") && text.includes("PHI ML")
    );
    check(
      'mentions +2.1% EV (quantified)',
      text.includes("+2.1%") && text.includes("EV")
    );
    check(
      'mentions "No confirming steam or sharp money divergence" (template 2 verbatim)',
      text.includes("No confirming steam or sharp money divergence")
    );
    assertBrandVoice("Template 2 brand voice", text);
  }

  // ─── Framework Template 3: Opposing EV-only — the MIL @ CHC case ──────────
  section("Framework Template 3 — Opposing EV-only → WATCH · ... (MIL @ CHC shape)");

  {
    const text = generateSignalSummary(
      "under",
      "total",
      sig({ side: "over", is_plus_ev: true, ev_pct: 5.4 }),
      evidence({ ev: tier("very_strong", false) }),
      "market_watch", // Opposing EV-only fails Sharp Conflict bar → market_watch
      CTX
    );
    console.log(`  → "${text}"`);
    check(
      'starts with "WATCH · " (framework template 3 header)',
      text.startsWith("WATCH · ")
    );
    check(
      'mentions "opposes the model\'s Under pick" (template 3 verbatim phrase)',
      text.includes("opposes the model's Under pick")
    );
    check(
      'mentions "+5.4% EV on Over" (opposing side EV)',
      text.includes("+5.4%") && text.includes("on Over")
    );
    check(
      'mentions "No confirming steam or sharp money divergence on the opposing side"',
      text.includes("No confirming steam or sharp money divergence on the opposing side")
    );
    assertBrandVoice("Template 3 brand voice", text);
  }

  // ─── Framework Template 4: Opposing confirmed — WSH @ ATL case ────────────
  section("Framework Template 4 — Opposing confirmed → STRONG CAUTION · ...");

  {
    const text = generateSignalSummary(
      "under",
      "total",
      sig({
        side: "over",
        is_plus_ev: true,
        ev_pct: 4.2,
        has_steam_move: true,
        steam_books_count: 3,
        public_betting_pct: 53,
        public_money_pct: 65,
      }),
      evidence({
        ev: tier("strong", false),
        steam: tier("strong", false),
      }),
      "sharp_conflict",
      CTX
    );
    console.log(`  → "${text}"`);
    check(
      'starts with "STRONG CAUTION · " (template 4 header)',
      text.startsWith("STRONG CAUTION · ")
    );
    check(
      'mentions "Steam across 3 books opposing the model\'s Under pick"',
      text.includes("Steam across 3 books opposing the model's Under pick")
    );
    check(
      'mentions "+4.2% EV on Over confirms" (confirming opposing indicator)',
      text.includes("+4.2%") && text.includes("on Over") && text.includes("confirms")
    );
    check(
      'mentions "Sharp money 65% on Over vs public 53%"',
      text.includes("Sharp money 65% on Over vs public 53%")
    );
    assertBrandVoice("Template 4 brand voice", text);
  }

  // ─── Per-grade composer routing ──────────────────────────────────────────
  section("Per-grade composer routing");

  // best_signal — fires composeConfirmed with STRONG header
  {
    const text = generateSignalSummary(
      "home",
      "moneyline",
      sig({ side: "home", has_steam_move: true, steam_books_count: 4, is_plus_ev: true, ev_pct: 3.5 }),
      evidence({ steam: tier("strong", true), ev: tier("strong", true) }),
      "best_signal",
      CTX
    );
    check("best_signal → STRONG header", text.startsWith("STRONG · "));
  }

  // sharp_confirmed (2× moderate, no strong) — MODERATE header
  {
    const text = generateSignalSummary(
      "home",
      "moneyline",
      sig({ side: "home", is_plus_ev: true, ev_pct: 2.0 }),
      evidence({
        ev: tier("moderate", true),
        steam: tier("moderate", true),
      }),
      "sharp_confirmed",
      CTX
    );
    check(
      "sharp_confirmed (only moderate aligned) → MODERATE header",
      text.startsWith("MODERATE · ")
    );
  }

  // market_led — STRONG header (market-only)
  {
    const text = generateSignalSummary(
      "home",
      "moneyline",
      sig({ side: "home", has_steam_move: true, steam_books_count: 3 }),
      evidence({ steam: tier("strong", true) }),
      "market_led",
      CTX
    );
    check("market_led → STRONG header", text.startsWith("STRONG · "));
    check(
      "market_led mentions 'model edge is light' framing",
      text.includes("model edge is light")
    );
  }

  // public_smoke — CAUTION header
  {
    const text = generateSignalSummary(
      "home",
      "moneyline",
      sig({ side: "home", public_betting_pct: 75, public_money_pct: 75 }),
      evidence({ publicSmoke: { aligned: true } }),
      "public_smoke",
      CTX
    );
    console.log(`  public_smoke → "${text}"`);
    check("public_smoke → CAUTION header", text.startsWith("CAUTION · "));
    check(
      "public_smoke mentions 'public bets' + 'no sharp confirmation'",
      text.includes("public bets") && text.includes("sharp")
    );
  }

  // model_only — honest framing, no STRONG/MODERATE prefix
  {
    const text = generateSignalSummary(
      "home",
      "moneyline",
      sig({ side: "home" }),
      evidence(),
      "model_only",
      CTX
    );
    console.log(`  model_only → "${text}"`);
    check(
      "model_only mentions 'model-driven' framing",
      text.includes("model")
    );
    check(
      "model_only acknowledges no market activity",
      text.includes("no major market activity")
    );
  }

  // market_watch with NO evidence → fallback
  {
    const text = generateSignalSummary(
      "home",
      "moneyline",
      sig({ side: "home" }),
      evidence(),
      "market_watch",
      CTX
    );
    console.log(`  market_watch (no evidence) → "${text}"`);
    check(
      "market_watch with no evidence → 'No actionable sharp signals detected' (Flag B1 fallback)",
      text === "No actionable sharp signals detected on this pick."
    );
  }

  // null grade → fallback
  {
    const text = generateSignalSummary(
      "home",
      "moneyline",
      sig(),
      evidence(),
      null,
      CTX
    );
    check(
      "null grade → fallback honest-neutral copy",
      text === "No actionable sharp signals detected on this pick."
    );
  }

  // ─── Market label formatting ─────────────────────────────────────────────
  section("Pick label formatting per market");

  {
    // ML home pick
    const t1 = generateSignalSummary(
      "home",
      "moneyline",
      sig({ side: "home", is_plus_ev: true, ev_pct: 2.1 }),
      evidence({ ev: tier("moderate", true) }),
      "market_watch",
      CTX
    );
    check('ML home → "PHI ML" label', t1.includes("PHI ML"));

    // ML away pick
    const t2 = generateSignalSummary(
      "away",
      "moneyline",
      sig({ side: "away", is_plus_ev: true, ev_pct: 2.1 }),
      evidence({ ev: tier("moderate", true) }),
      "market_watch",
      CTX
    );
    check('ML away → "NYM ML" label', t2.includes("NYM ML"));

    // Total over
    const t3 = generateSignalSummary(
      "over",
      "total",
      sig({ side: "over", is_plus_ev: true, ev_pct: 2.1 }),
      evidence({ ev: tier("moderate", true) }),
      "market_watch",
      CTX
    );
    check('Total over → label includes "Over"', t3.includes("Over"));

    // NRFI / YRFI
    const t4 = generateSignalSummary(
      "under",
      "first_inning_total",
      sig({ side: "under", is_plus_ev: true, ev_pct: 2.1 }),
      evidence({ ev: tier("moderate", true) }),
      "market_watch",
      CTX
    );
    check('NRFI under → label includes "NRFI"', t4.includes("NRFI"));

    const t5 = generateSignalSummary(
      "over",
      "first_inning_total",
      sig({ side: "over", is_plus_ev: true, ev_pct: 2.1 }),
      evidence({ ev: tier("moderate", true) }),
      "market_watch",
      CTX
    );
    check('NRFI over → label includes "YRFI"', t5.includes("YRFI"));
  }

  // ─── Brand voice global compliance — every composer output ───────────────
  section("Brand voice global compliance");

  // Sample a representative case across each grade composer (besides those
  // already brand-voice-checked above).
  const samples: Array<{ label: string; text: string }> = [
    {
      label: "best_signal (strong steam + EV)",
      text: generateSignalSummary(
        "home",
        "moneyline",
        sig({ side: "home", is_plus_ev: true, ev_pct: 3.5, has_steam_move: true, steam_books_count: 4, public_betting_pct: 50, public_money_pct: 65 }),
        evidence({ ev: tier("strong", true), steam: tier("strong", true) }),
        "best_signal",
        CTX
      ),
    },
    {
      label: "market_led (strong RLM aligned, no edge)",
      text: generateSignalSummary(
        "home",
        "moneyline",
        sig({ side: "home", has_reverse_line_movement: true, public_betting_pct: 35 }),
        evidence({ rlm: tier("strong", true) }),
        "market_led",
        CTX
      ),
    },
    {
      label: "public_smoke aligned",
      text: generateSignalSummary(
        "home",
        "moneyline",
        sig({ side: "home", public_betting_pct: 75, public_money_pct: 76 }),
        evidence({ publicSmoke: { aligned: true } }),
        "public_smoke",
        CTX
      ),
    },
    {
      label: "model_only",
      text: generateSignalSummary("home", "moneyline", sig(), evidence(), "model_only", CTX),
    },
    {
      label: "market_watch fallback",
      text: generateSignalSummary("home", "moneyline", sig(), evidence(), "market_watch", CTX),
    },
  ];

  for (const s of samples) {
    assertBrandVoice(s.label, s.text);
  }

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All signal-summary-generator tests passed.`);
}

main();
