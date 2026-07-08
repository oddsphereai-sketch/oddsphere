/**
 * Tests for the FI NRFI overconfident mid-band flip
 * (lib/services/fiInversionFlip.ts) + its integration in buildFiRecord.
 * Confident NRFI picks with NRFI prob in [0.57,0.63) fade to YRFI at the real
 * YRFI price at the pure helper layer. The live writer now stands that replay-
 * flat cohort down to Toss-Up/No Play while preserving the proposed flip audit.
 * Toss-Up / YRFI / out-of-band are never flipped; missing YRFI odds => no flip.
 * Run: npx tsx --env-file=.env.local scripts/test-fi-inversion-flip.ts
 */
import { resolveFiInversionFlip, FI_INVERSION_RULE_ID } from "../lib/services/fiInversionFlip";
import { buildPredictionRecordsFromSlate } from "../lib/services/predictionRecordService";

let pass = 0, fail = 0;
const failures: string[] = [];
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push(`${label}${detail ? ` — ${detail}` : ""}`); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

console.log("━━━ resolveFiInversionFlip (unit) ━━━");
const base = { predictedSide: "nrfi" as const, nrfiProbability: 0.60, originalConfidence: 58, nrfiMarketProb: 0.55, yrfiOdds: 110 };
{
  const r = resolveFiInversionFlip(base);
  check("in-band NRFI flips to YRFI", r.flipped === true && r.flipped && r.flippedSide === "yrfi");
  check("uses YRFI odds", r.flipped && r.flippedOdds === 110);
  check("rule_id stamped", r.flipped && r.rule_id === FI_INVERSION_RULE_ID);
  check("recommendation confidence clamped 55-60", r.flipped && r.recommendationConfidence >= 55 && r.recommendationConfidence <= 60);
  check("raw YRFI prob < 0.5 (audit)", r.flipped && typeof r.flippedSideModelProb === "number" && r.flippedSideModelProb! < 0.5);
}
check("band lower bound 0.57 inclusive flips", resolveFiInversionFlip({ ...base, nrfiProbability: 0.57 }).flipped === true);
check("0.63 upper bound exclusive → no flip", resolveFiInversionFlip({ ...base, nrfiProbability: 0.63 }).flipped === false);
check("below band (0.55) → no flip (low NRFI kept)", resolveFiInversionFlip({ ...base, nrfiProbability: 0.55 }).flipped === false);
check("above band (0.65) → no flip (high NRFI kept)", resolveFiInversionFlip({ ...base, nrfiProbability: 0.65 }).flipped === false);
check("YRFI pick never flips", resolveFiInversionFlip({ ...base, predictedSide: "yrfi" }).flipped === false);
check("Toss-Up never flips", resolveFiInversionFlip({ ...base, predictedSide: "tossup" }).flipped === false);
check("null side never flips", resolveFiInversionFlip({ ...base, predictedSide: null }).flipped === false);
check("missing YRFI odds → no flip (keep NRFI, not No Play)", resolveFiInversionFlip({ ...base, yrfiOdds: null }).flipped === false);
check("non-finite prob → no flip", resolveFiInversionFlip({ ...base, nrfiProbability: NaN }).flipped === false);

// ── integration ──
console.log("\n━━━ integration: buildFiRecord via slate ━━━");
const baseGame = { id: 900, external_id: 9300, game_date: "2026-06-22T18:00:00Z", slate_status: "published", home_team_id: 1, away_team_id: 2 };
const abbrev = new Map<number, string>([[1, "CHC"], [2, "SF"]]);
function mkPred(nrfiProb: number, conf: number, predictedNrfi: boolean | null, decisionKind: string | null = null) {
  return {
    id: 7000, game_id: 900, predicted_ml_winner: "home", ml_confidence: 70, predicted_ou_side: "over", ou_confidence: 56,
    predicted_nrfi: predictedNrfi, nrfi_confidence: conf, prediction_source: "auto_v1", is_override: false,
    locked_at: "2026-06-22T17:00:00Z", computed_at: "2026-06-22T16:00:00Z", predicted_home_score: 4.5, predicted_away_score: 4.4,
    ml_grade: "market_watch", ou_grade: "market_watch", nrfi_grade: "market_watch", ml_signal_type: null, ou_signal_type: null,
    nrfi_signal_type: null, ml_market_signal: null, ou_market_signal: null, nrfi_market_signal: null,
    sport_specific: {
      model_used: "v2_2", model_version: "auto_v2.2_mlb", hold_picks: [], v2_data_quality_tier: "high", v2_provisional: false,
      nrfi_decision_kind: decisionKind,
      auto_factors: { nrfi_probability: nrfiProb, nrfi_expected_runs: 0.7 },
    },
  };
}
// FI first_inning_total lines: under=NRFI, over=YRFI.
const fiLines = [
  { game_id: 900, market_type: "first_inning_total", sportsbook: "pinnacle", side: "under", line_value: 0.5, odds_american: -140, fetched_at: "2026-06-22T16:00:00Z", odds_american_observed_at: null, line_value_observed_at: null },
  { game_id: 900, market_type: "first_inning_total", sportsbook: "pinnacle", side: "over", line_value: 0.5, odds_american: 120, fetched_at: "2026-06-22T16:00:00Z", odds_american_observed_at: null, line_value_observed_at: null },
];
function build(pred: any) {
  return buildPredictionRecordsFromSlate({
    sport: "mlb", slateDate: "2026-06-22", launchDay: false, games: [baseGame],
    predictionByGameId: new Map([[900, pred]]), abbrevByTeamId: abbrev,
    currentLinesByGameId: new Map([[900, fiLines as any]]),
  });
}
{
  // In-band confident NRFI => proposed flip is audited, but the live writer
  // stands the cohort down after replay showed it did not add value.
  const fi = build(mkPred(0.60, 58, true)).find((r) => r.market === "first_inning");
  check("in-band NRFI writer stands down to Toss-Up", fi?.pick === "Toss-Up" && fi?.side === null);
  check("stand-down clears actionable FI odds/confidence", fi?.odds_american === null && fi?.confidence === null);
  check("stand-down is no_bet with toss_up prediction_type", fi?.no_bet === true && fi?.prediction_type === "toss_up");
  check("stand-down play_grade null + best_angle false + edge null", fi?.play_grade === null && fi?.best_angle === false && fi?.edge === null);
  const f = (fi?.snapshot_json as any)?.fi_flip;
  check("fi_flip audit + original NRFI preserved", f?.flipped === true && f?.original_pick === "NRFI" && f?.flipped_pick === "YRFI" && f?.rule_id === FI_INVERSION_RULE_ID);
  check("fi_flip raw YRFI prob < 0.5 in audit", typeof f?.flipped_side_model_prob === "number" && f.flipped_side_model_prob < 0.5);
  check("fi_flip audit marks writer stand-down", f?.stood_down === true);
  check("champion correction audit present", (fi?.snapshot_json as any)?.champion_candidate_correction?.action === "stand_down");
}
{
  // Out-of-band NRFI (0.66) → unchanged.
  const fi = build(mkPred(0.66, 62, true)).find((r) => r.market === "first_inning");
  check("out-of-band NRFI stays NRFI (no flip)", fi?.pick === "NRFI" && (fi?.snapshot_json as any)?.fi_flip == null);
}
{
  // Toss-Up in-band prob → never flipped.
  const fi = build(mkPred(0.60, 52, true, "toss_up")).find((r) => r.market === "first_inning");
  check("Toss-Up never flips (stays Toss-Up)", fi?.pick === "Toss-Up" && (fi?.snapshot_json as any)?.fi_flip == null);
}
{
  // YRFI pick in-band → never flipped.
  const fi = build(mkPred(0.60, 58, false)).find((r) => r.market === "first_inning");
  check("YRFI pick stays YRFI (no flip)", fi?.pick === "YRFI" && (fi?.snapshot_json as any)?.fi_flip == null);
}

console.log(`\n  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) { console.log("\nFAILURES:\n" + failures.map((f) => "  - " + f).join("\n")); process.exit(1); }
console.log("\n✅ FI inversion flip tests passed.");
