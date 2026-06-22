/**
 * Tests for the ML inverted low-conviction market-divergent flip.
 *   - pure helper: lib/services/mlInversionFlip.ts
 *   - integration: predictionRecordService.buildPredictionRecordsFromSlate
 * Run: npx tsx scripts/test-ml-inversion-flip.ts
 */
import { resolveMlInversionFlip, ML_INVERSION_RULE_ID } from "../lib/services/mlInversionFlip";
import { buildPredictionRecordsFromSlate } from "../lib/services/predictionRecordService";

let pass = 0, fail = 0;
const failures: string[] = [];
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push(`${label}${detail ? ` — ${detail}` : ""}`); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

// ── pure helper eligibility matrix ──────────────────────────────────
const base = {
  predictedSide: "home" as const, confidence: 57, rawConfidence: 57, marketAligned: false,
  modelProb: 0.57, marketProb: 0.62, homeOdds: -150, awayOdds: 135,
};
console.log("━━━ resolveMlInversionFlip ━━━");
{
  const r = resolveMlInversionFlip(base);
  check("eligible cohort flips to opposite (away)", r.flipped === true && r.flipped && r.flippedSide === "away");
  check("flipped uses real opposite odds (135)", r.flipped === true && r.flipped && r.flippedOdds === 135);
  check("flipped model prob = 1 - model (0.43)", r.flipped === true && r.flipped && Math.abs((r.flippedModelProb ?? 0) - 0.43) < 1e-9);
  check("rule_id stamped", r.flipped === true && r.flipped && r.rule_id === ML_INVERSION_RULE_ID);
}
check("raw>=60 does NOT flip", resolveMlInversionFlip({ ...base, rawConfidence: 60 }).flipped === false);
check("confidence>=60 does NOT flip", resolveMlInversionFlip({ ...base, confidence: 60 }).flipped === false);
check("confidence<55 does NOT flip", resolveMlInversionFlip({ ...base, confidence: 54.9 }).flipped === false);
check("market_aligned=true does NOT flip", resolveMlInversionFlip({ ...base, marketAligned: true }).flipped === false);
check("missing opposite odds does NOT flip", resolveMlInversionFlip({ ...base, awayOdds: null }).flipped === false);
check("null predicted side does NOT flip", resolveMlInversionFlip({ ...base, predictedSide: null as any }).flipped === false);
{
  const r = resolveMlInversionFlip({ ...base, predictedSide: "away", homeOdds: 120, awayOdds: -140 });
  check("away pick flips to home with home odds", r.flipped === true && r.flipped && r.flippedSide === "home" && r.flippedOdds === 120);
}

// ── integration ────────────────────────────────────────────────────
const baseGame = { id: 700, external_id: 9001, game_date: "2026-06-22T18:00:00Z", slate_status: "published", home_team_id: 771, away_team_id: 780 };
const abbrevByTeamId = new Map<number, string>([[771, "CHC"], [780, "SF"]]);
const oddsSrc = (odds: number | null) => ({ source: "lines" as const, book: "pinnacle", odds, line: null, observedAt: "2026-06-22T16:00:00Z" });
function oddsSnap(mlHome: number | null, mlAway: number | null) {
  return { mlHomeOdds: mlHome, mlAwayOdds: mlAway, ouOverOdds: -110, ouUnderOdds: -110, oddsSourceMl: { home: oddsSrc(mlHome), away: oddsSrc(mlAway) }, oddsSourceOu: { over: oddsSrc(-110), under: oddsSrc(-110) } };
}
function mkPred(over: Record<string, any>, sp: Record<string, any>) {
  return {
    id: 5000, game_id: 700, predicted_ml_winner: "home", ml_confidence: 57, predicted_ou_side: "over", ou_confidence: 56,
    predicted_nrfi: null, nrfi_confidence: 52, prediction_source: "auto_v1", is_override: false,
    locked_at: "2026-06-22T17:00:00Z", computed_at: "2026-06-22T16:00:00Z", predicted_home_score: 4.2, predicted_away_score: 3.9,
    ml_grade: "market_watch", ou_grade: "market_watch", nrfi_grade: null, ml_signal_type: null, ou_signal_type: null,
    nrfi_signal_type: null, ml_market_signal: null, ou_market_signal: null, nrfi_market_signal: null,
    sport_specific: {
      model_used: "v2_2", model_version: "auto_v2.2_mlb", hold_picks: ["nrfi"], ml_play_grade: "lean", ou_play_grade: "lean",
      ml_prediction_type: "lean", ou_prediction_type: "lean", v2_data_quality_tier: "high", v2_provisional: false,
      ml_market_aligned: false, auto_factors: { ml_raw_confidence: 57 },
      // posterior_total (8.9) > line (8.5) so the OU pick "over" agrees with the
      // projected mean → OU is NON-divergent and must be untouched by the ML flip.
      v2_2_audit: { ml_model_prob: 0.57, ml_market_prob: 0.62, market_total: 8.5, posterior_home_diff: 0.3, posterior_total: 8.9, ou_market_prob: 0.5 },
      ...sp,
    },
    ...over,
  };
}
function build(pred: any, odds: any) {
  return buildPredictionRecordsFromSlate({ sport: "mlb", slateDate: "2026-06-22", launchDay: false, games: [baseGame], predictionByGameId: new Map([[700, pred]]), abbrevByTeamId, signalsByGameId: new Map(), oddsByGameId: new Map([[700, odds as any]]) });
}

console.log("\n━━━ integration: buildPredictionRecordsFromSlate ━━━");
{
  // Eligible cohort (home fav -150, away dog +135) → flip to away.
  const recs = build(mkPred({}, {}), oddsSnap(-150, 135));
  const ml = recs.find((r) => r.market === "moneyline");
  check("flipped record pick=away (was home)", ml?.pick === "away" && ml?.side === "away");
  check("flipped record uses opposite odds (135)", ml?.odds_american === 135);
  check("flipped record best_angle=false", ml?.best_angle === false);
  check("flipped record play_grade=null", ml?.play_grade === null);
  const flip = (ml?.snapshot_json as any)?.ml_flip;
  check("ml_flip audit present + original_side=home", flip?.flipped === true && flip?.original_side === "home" && flip?.flipped_side === "away");
  check("ml_flip records original_raw_confidence + original_odds", flip?.original_raw_confidence === 57 && flip?.original_odds === -150);
  check("ml_flip rule_id stamped", flip?.rule_id === ML_INVERSION_RULE_ID);
  // model opinion preserved: snapshot keeps original sp.v2_2_audit, and OU record untouched
  const ou = recs.find((r) => r.market === "total");
  check("TOTALS record unaffected by ML flip", ou?.pick === "over");
}
{
  // raw>=60 → no flip.
  const recs = build(mkPred({}, { auto_factors: { ml_raw_confidence: 61 } }), oddsSnap(-150, 135));
  const ml = recs.find((r) => r.market === "moneyline");
  check("raw>=60: ML pick stays home (no flip)", ml?.pick === "home" && (ml?.snapshot_json as any)?.ml_flip == null);
}
{
  // market_aligned=true → no flip.
  const recs = build(mkPred({}, { ml_market_aligned: true }), oddsSnap(-150, 135));
  const ml = recs.find((r) => r.market === "moneyline");
  check("market_aligned: ML pick stays home (no flip)", ml?.pick === "home" && ml?.best_angle !== false ? true : ml?.pick === "home");
}
{
  // missing opposite odds → no flip.
  const recs = build(mkPred({}, {}), oddsSnap(-150, null));
  const ml = recs.find((r) => r.market === "moneyline");
  check("missing opposite odds: ML pick stays home (no flip)", ml?.pick === "home" && (ml?.snapshot_json as any)?.ml_flip == null);
}
{
  // out-of-band confidence → no flip.
  const recs = build(mkPred({ ml_confidence: 62 }, {}), oddsSnap(-150, 135));
  const ml = recs.find((r) => r.market === "moneyline");
  check("confidence 62: ML pick stays home (no flip)", ml?.pick === "home" && (ml?.snapshot_json as any)?.ml_flip == null);
}

console.log(`\n  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) { console.log("\nFAILURES:\n" + failures.map((f) => "  - " + f).join("\n")); process.exit(1); }
console.log("\n✅ ML inversion flip tests passed.");
