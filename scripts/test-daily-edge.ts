/**
 * Unit tests for Daily Edge models.
 *
 * Run with: npm run test:daily-edge
 *
 * Covers:
 *   • sharpSignalEvaluator — STRONG / CAUTION / neutral classification
 *   • verdictGenerator — brand-voice banner text composition
 *   • scoresModelIngester — validateDanielsModelRow (pure validator)
 */

import type { SharpSignalRecord } from "../lib/providers/interfaces/IBettingProvider";
import { evaluateSignal } from "../lib/models/dailyEdge/sharpSignalEvaluator";
import { generateVerdictText } from "../lib/models/dailyEdge/verdictGenerator";
import {
  validateDanielsModelRow,
  type DanielsModelRow,
} from "../lib/scoresModel/ingester";

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

function section(title: string) {
  console.log(`\n━━━ ${title} ━━━`);
}

function baseSignal(overrides: Partial<SharpSignalRecord> = {}): SharpSignalRecord {
  return {
    game_external_id: 1,
    market_type: "moneyline",
    side: "home",
    pinnacle_fair_probability: 0.50,
    is_plus_ev: false,
    ev_pct: 0,
    has_steam_move: false,
    steam_detected_at: null,
    steam_books_count: null,
    has_reverse_line_movement: false,
    rlm_direction: null,
    public_betting_pct: 50,
    public_money_pct: 50,
    signal_strength: null,
    signal_summary: null,
    computed_at: "2026-05-22T17:00:00.000Z",
    ...overrides,
  };
}

const CONTEXT = {
  homeTeamAbbr: "HOU",
  awayTeamAbbr: "SEA",
};

// ─── sharpSignalEvaluator ────────────────────────────────────────────────
section("sharpSignalEvaluator — STRONG paths");

// Primary STRONG: +EV ≥ 2 + steam ≥ 3 books
{
  const sig = baseSignal({
    is_plus_ev: true,
    ev_pct: 3.8,
    has_steam_move: true,
    steam_books_count: 4,
    public_betting_pct: 42,
    public_money_pct: 58,
  });
  const r = evaluateSignal(sig);
  check("STRONG: +EV 3.8% + 4-book steam", r.verdict === "STRONG" && r.signalStrength === "strong");
  check("  reasons include plus_ev_primary", r.reasons.some((x) => x.startsWith("plus_ev_primary")));
  check("  reasons include steam_strong", r.reasons.some((x) => x.startsWith("steam_strong")));
}

// Primary STRONG: +EV + RLM
{
  const sig = baseSignal({
    is_plus_ev: true,
    ev_pct: 2.6,
    has_reverse_line_movement: true,
    rlm_direction: "toward_home",
    public_betting_pct: 36,
    public_money_pct: 55,
  });
  const r = evaluateSignal(sig);
  check("STRONG: +EV 2.6% + RLM", r.verdict === "STRONG");
  check("  reasons include reverse_line_movement", r.reasons.includes("reverse_line_movement"));
}

// Primary STRONG: +EV + sharp money divergence ≥ 10pp
{
  const sig = baseSignal({
    is_plus_ev: true,
    ev_pct: 4.2,
    public_betting_pct: 50,
    public_money_pct: 62, // +12pp divergence
  });
  const r = evaluateSignal(sig);
  check("STRONG: +EV 4.2% + sharp money +12pp", r.verdict === "STRONG");
  check("  reasons include sharp_money_divergence_strong",
    r.reasons.some((x) => x.startsWith("sharp_money_divergence_strong")));
}

// STRONG via weak signal stack (3+ confirming)
{
  const sig = baseSignal({
    is_plus_ev: true,
    ev_pct: 1.0, // light +EV
    has_steam_move: true,
    steam_books_count: 2, // light steam
    public_betting_pct: 50,
    public_money_pct: 56, // light divergence (+6pp)
    pinnacle_fair_probability: 0.55, // pinnacle confirms
  });
  const r = evaluateSignal(sig);
  check("STRONG via 4-stack weak signals", r.verdict === "STRONG");
  check("  reasons include weak_signal_stack",
    r.reasons.some((x) => x.startsWith("weak_signal_stack")));
}

section("sharpSignalEvaluator — CAUTION paths");

// CAUTION: negative EV
{
  const sig = baseSignal({ ev_pct: -3.5 });
  const r = evaluateSignal(sig);
  check("CAUTION: -3.5% EV", r.verdict === "CAUTION" && r.signalStrength === "caution");
  check("  reasons include negative_ev", r.reasons.some((x) => x.startsWith("negative_ev")));
}

// CAUTION: public-heavy without confirmation
{
  const sig = baseSignal({
    public_betting_pct: 75,
    public_money_pct: 74, // |diff| = 1pp, no flow
    has_steam_move: false,
    has_reverse_line_movement: false,
    ev_pct: 0,
  });
  const r = evaluateSignal(sig);
  check("CAUTION: 75% public bets, no steam/RLM, flat money", r.verdict === "CAUTION");
  check("  reasons include public_heavy_no_confirm",
    r.reasons.some((x) => x.startsWith("public_heavy_no_confirm")));
}

// CAUTION: conflicting signals (steam side=over, RLM direction=under)
{
  const sig = baseSignal({
    market_type: "total",
    side: "over",
    has_steam_move: true,
    steam_books_count: 4,
    has_reverse_line_movement: true,
    rlm_direction: "toward_under",
    is_plus_ev: true,
    ev_pct: 3,
    public_betting_pct: 50,
    public_money_pct: 50,
  });
  const r = evaluateSignal(sig);
  check("CAUTION: steam on over but RLM toward under", r.verdict === "CAUTION");
  check("  reasons include conflicting_steam_vs_rlm", r.reasons.includes("conflicting_steam_vs_rlm"));
}

// CAUTION sticky: negative EV overrides bullish signals
{
  const sig = baseSignal({
    is_plus_ev: false,
    ev_pct: -2.5,
    has_steam_move: true,
    steam_books_count: 4,
  });
  const r = evaluateSignal(sig);
  check("CAUTION sticky over steam (neg EV beats bullish)", r.verdict === "CAUTION");
}

section("sharpSignalEvaluator — neutral paths");

// Neutral: nothing fires
{
  const r = evaluateSignal(baseSignal());
  check("neutral: empty signal", r.verdict === null && r.signalStrength === null);
}

// Neutral: 2 weak signals (under stack threshold)
{
  const sig = baseSignal({
    is_plus_ev: true,
    ev_pct: 1.0,
    has_steam_move: true,
    steam_books_count: 2,
  });
  const r = evaluateSignal(sig);
  check("neutral: 2 weak signals (stack needs 3+)", r.verdict === null);
}

// Neutral: +EV at primary threshold but no confirming signal
{
  const sig = baseSignal({
    is_plus_ev: true,
    ev_pct: 3.0,
    has_steam_move: false,
    has_reverse_line_movement: false,
    public_betting_pct: 50,
    public_money_pct: 50,
  });
  const r = evaluateSignal(sig);
  check("neutral: +EV 3% but no confirming + insufficient stack", r.verdict === null);
}

// ─── verdictGenerator ────────────────────────────────────────────────────
section("verdictGenerator — brand voice");

// STRONG · steam
{
  const sig = baseSignal({
    market_type: "moneyline",
    side: "home",
    is_plus_ev: true,
    ev_pct: 3.8,
    has_steam_move: true,
    steam_books_count: 4,
    steam_detected_at: "2026-05-22T20:15:00.000Z",
    public_betting_pct: 42,
    public_money_pct: 58,
  });
  const evalRes = evaluateSignal(sig);
  const text = generateVerdictText(evalRes, sig, CONTEXT);
  console.log(`     ${text}`);
  check("STRONG · steam includes 'Steam across 4 books'", (text ?? "").includes("Steam across 4 books"));
  check("  includes '+EV 3.8%'", (text ?? "").includes("3.8%"));
  check("  includes 'public bets'", (text ?? "").includes("public bets"));
  check("  no banned words (LOCK/FADE/etc)", !/(lock|fade|hammer|smash|square)/i.test(text ?? ""));
}

// STRONG · RLM
{
  const sig = baseSignal({
    market_type: "moneyline",
    side: "home",
    is_plus_ev: true,
    ev_pct: 2.6,
    has_reverse_line_movement: true,
    rlm_direction: "toward_home",
    public_betting_pct: 36,
    public_money_pct: 55,
  });
  const evalRes = evaluateSignal(sig);
  const text = generateVerdictText(evalRes, sig, { ...CONTEXT, homeTeamAbbr: "PHI", awayTeamAbbr: "NYM" });
  console.log(`     ${text}`);
  check("STRONG · RLM includes 'Reverse line movement'", (text ?? "").includes("Reverse line movement"));
  check("  no banned words", !/(lock|fade|hammer|smash|square)/i.test(text ?? ""));
}

// STRONG · Total with weather
{
  const sig = baseSignal({
    market_type: "total",
    side: "over",
    is_plus_ev: true,
    ev_pct: 5.4,
    public_betting_pct: 60,
    public_money_pct: 72, // +12pp divergence
  });
  const evalRes = evaluateSignal(sig);
  const text = generateVerdictText(evalRes, sig, {
    ...CONTEXT,
    weatherWindMph: 18,
    weatherWindDirRelative: "out_to_cf",
  });
  console.log(`     ${text}`);
  check("STRONG · Total with wind mentions wind", (text ?? "").includes("18mph wind"));
  check("  no banned words", !/(lock|fade|hammer|smash|square)/i.test(text ?? ""));
}

// CAUTION · public-heavy
{
  const sig = baseSignal({
    market_type: "moneyline",
    side: "home",
    public_betting_pct: 72,
    public_money_pct: 71,
  });
  const evalRes = evaluateSignal(sig);
  const text = generateVerdictText(evalRes, sig, { ...CONTEXT, homeTeamAbbr: "NYY", awayTeamAbbr: "BOS" });
  console.log(`     ${text}`);
  check("CAUTION · public-heavy includes '72%'", (text ?? "").includes("72%"));
  check("  uses 'public bets' (not 'public square')",
    (text ?? "").includes("public bets") && !/public square/i.test(text ?? ""));
  check("  no banned words", !/(lock|fade|hammer|smash|square)/i.test(text ?? ""));
}

// CAUTION · negative EV
{
  const sig = baseSignal({ ev_pct: -3.5 });
  const evalRes = evaluateSignal(sig);
  const text = generateVerdictText(evalRes, sig, CONTEXT);
  console.log(`     ${text}`);
  check("CAUTION · negative EV mentions mispriced", (text ?? "").toLowerCase().includes("mispriced"));
}

// neutral returns null
{
  const text = generateVerdictText(
    { verdict: null, signalStrength: null, reasons: [] },
    baseSignal(),
    CONTEXT
  );
  check("neutral verdict returns null", text === null);
}

// ─── scoresModelIngester (validator) ─────────────────────────────────────
section("validateDanielsModelRow — pure validator");

const validRow: DanielsModelRow = {
  game_external_id: 18599100,
  predicted_home_score: 4.6,
  predicted_away_score: 3.8,
  predicted_total: 8.4,
  predicted_ml_winner: "home",
  ml_confidence: 64.5,
  predicted_ou_side: "under",
  ou_confidence: 53.2,
  predicted_nrfi: true,
  nrfi_confidence: 58.4,
  model_version: "daniels-v3.2",
  computed_at: "2026-05-22T13:00:00.000Z",
};
const known = new Set([18599100, 18599101]);

check("valid row passes", validateDanielsModelRow(validRow, known).ok);

check(
  "unknown game_external_id fails",
  !validateDanielsModelRow({ ...validRow, game_external_id: 99999 }, known).ok
);
check(
  "ml_confidence > 100 fails",
  !validateDanielsModelRow({ ...validRow, ml_confidence: 110 }, known).ok
);
check(
  "ml_confidence < 0 fails",
  !validateDanielsModelRow({ ...validRow, ml_confidence: -1 }, known).ok
);
check(
  "predicted_ml_winner='neutral' fails",
  !validateDanielsModelRow({ ...validRow, predicted_ml_winner: "neutral" }, known).ok
);
check(
  "predicted_ou_side='push' fails",
  !validateDanielsModelRow({ ...validRow, predicted_ou_side: "push" }, known).ok
);
check(
  "negative predicted_home_score fails",
  !validateDanielsModelRow({ ...validRow, predicted_home_score: -1 }, known).ok
);
check(
  "empty model_version fails",
  !validateDanielsModelRow({ ...validRow, model_version: "" }, known).ok
);
check(
  "invalid computed_at fails",
  !validateDanielsModelRow({ ...validRow, computed_at: "not-a-date" }, known).ok
);

// ─── Summary ─────────────────────────────────────────────────────────────
console.log(`\n${"━".repeat(70)}`);
console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) {
  console.log(`\nFailures:`);
  failures.forEach((m) => console.log(m));
  process.exit(1);
}
console.log(`\n✅ All Daily Edge tests passed.`);
