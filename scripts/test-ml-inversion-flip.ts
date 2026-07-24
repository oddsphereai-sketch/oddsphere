/**
 * Tests for the ML inverted low-conviction market-divergent flip.
 *   - pure helper: lib/services/mlInversionFlip.ts
 *   - integration: predictionRecordService.buildPredictionRecordsFromSlate
 * Run: npx tsx scripts/test-ml-inversion-flip.ts
 */
import {
  resolveMlInversionFlip,
  resolveMlInversionPublicGrade,
  ML_INVERSION_GRADE_RULE_ID,
  ML_INVERSION_RULE_ID,
} from "../lib/services/mlInversionFlip";
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
  check("raw opposite-side prob = 1 - model (0.43) [audit only]", r.flipped === true && r.flipped && Math.abs((r.flippedSideModelProb ?? 0) - 0.43) < 1e-9);
  check("member confidence is conservative >=55 (NOT sub-50)", r.flipped === true && r.flipped && r.recommendationConfidence >= 55 && r.recommendationConfidence <= 60);
  check("member confidence = clamp(orig 57) = 57", r.flipped === true && r.flipped && r.recommendationConfidence === 57);
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

console.log("\n━━━ resolveMlInversionPublicGrade ━━━");
{
  const grade = resolveMlInversionPublicGrade({
    inversionTriggered: true,
    finalSideChanged: true,
    finalOdds: -130,
    recommendationProbability: 0.581,
    finalMarketProbability: 0.542744,
    dataQualityTier: "high",
    provisional: false,
  });
  check("positive-value high-quality inversion is exactly Lean", grade.actionable && grade.playGrade === "lean");
  check("inversion grade can never manufacture Best Angle", grade.bestAngle === false);
  check("inversion Lean records positive edge and EV", (grade.edgePp ?? 0) > 0 && (grade.expectedValue ?? 0) > 0);
  check("inversion grade rule is versioned", grade.rule_id === ML_INVERSION_GRADE_RULE_ID);
}
{
  const grade = resolveMlInversionPublicGrade({
    inversionTriggered: true,
    finalSideChanged: true,
    finalOdds: -170,
    recommendationProbability: 0.555,
    finalMarketProbability: 0.6018,
    dataQualityTier: "high",
    provisional: false,
  });
  check("negative-EV inversion is non-actionable", !grade.actionable && grade.playGrade === null);
  check("negative-EV inversion remains blocked from Best Angle", grade.bestAngle === false);
}
{
  const grade = resolveMlInversionPublicGrade({
    inversionTriggered: true,
    finalSideChanged: true,
    finalOdds: 135,
    recommendationProbability: 0.57,
    finalMarketProbability: 0.38,
    dataQualityTier: "low",
    provisional: false,
  });
  check("low-data-quality inversion is non-actionable", !grade.actionable && grade.reason.includes("data_quality"));
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
    // Scores sum to 8.9 (= posterior_total) so the score-sum totals basis agrees
    // with the OU "over" pick vs line 8.5 → OU non-divergent, untouched by the ML flip.
    locked_at: "2026-06-22T17:00:00Z", computed_at: "2026-06-22T16:00:00Z", predicted_home_score: 4.6, predicted_away_score: 4.3,
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
  check("genuine final-side flip is an actionable Lean", ml?.play_grade === "lean");
  check("genuine final-side flip has no stale No Bet reason", ml?.no_bet === false && ml?.no_bet_reason === null);
  check("member confidence >=55 (NOT sub-50 raw)", typeof ml?.confidence === "number" && ml!.confidence >= 55 && ml!.confidence <= 60);
  check("member model_probability >=0.5 (presentable)", typeof ml?.model_probability === "number" && ml!.model_probability >= 0.5);
  check("flipped edge column uses inversion recommendation value", typeof ml?.edge === "number" && ml.edge > 0);
  check("flipped expected value is positive and explicit", typeof ml?.expected_value === "number" && ml.expected_value > 0);
  const flip = (ml?.snapshot_json as any)?.ml_flip;
  check("ml_flip audit present + original_side=home", flip?.flipped === true && flip?.original_side === "home" && flip?.flipped_side === "away");
  check("ml_flip records original_raw_confidence + original_odds", flip?.original_raw_confidence === 57 && flip?.original_odds === -150);
  check("ml_flip preserves RAW opposite-side prob in audit (sub-50)", typeof flip?.flipped_side_model_prob === "number" && flip.flipped_side_model_prob < 0.5);
  check("ml_flip records final_displayed_confidence (matches column)", flip?.final_displayed_confidence === ml?.confidence);
  check("ml_flip rule_id stamped", flip?.rule_id === ML_INVERSION_RULE_ID);
  check("decision release records a true final-side change", (ml?.snapshot_json as any)?.decision_pipeline?.final_side_changed === true);
  check("decision release marks a genuine final-side flip as BET", (ml?.snapshot_json as any)?.decision_pipeline?.board_action === "bet");
  check("decision release uses the inversion grade rule", (ml?.snapshot_json as any)?.decision_pipeline?.action_rule_id === ML_INVERSION_GRADE_RULE_ID);
  check("grade audit preserves raw model probability as audit-only", (ml?.snapshot_json as any)?.ml_inversion_grade_resolution?.raw_model_probability_role === "audit_only");
  // model opinion preserved: snapshot keeps original sp.v2_2_audit, and OU record untouched
  const ou = recs.find((r) => r.market === "total");
  check("TOTALS record unaffected by ML flip", ou?.pick === "over");
}
{
  const recs = build(
    mkPred(
      { predicted_ml_winner: "away", ml_confidence: 58.1 },
      {
        auto_factors: { ml_raw_confidence: 58.1 },
        v2_2_audit: {
          ml_model_prob: 0.4710295964719537,
          ml_market_prob: 0.457256,
          market_total: 8.5,
          posterior_home_diff: 0.3,
          posterior_total: 8.9,
          ou_market_prob: 0.5,
        },
      },
    ),
    oddsSnap(-130, 110),
  );
  const ml = recs.find((r) => r.market === "moneyline");
  check("TOR-BOS shape flips dog to -130 favorite", ml?.pick === "home" && ml?.odds_american === -130);
  check("TOR-BOS shape remains Lean on positive inversion EV", ml?.play_grade === "lean" && ml?.no_bet === false);
  check("TOR-BOS shape never becomes Best Angle", ml?.best_angle === false);
  check("TOR-BOS shape records about +2.8% inversion EV", typeof ml?.expected_value === "number" && Math.abs(ml.expected_value - 0.027923) < 0.0001);
}
{
  const recs = build(
    mkPred({}, { v2_data_quality_tier: "low" }),
    oddsSnap(-150, 135),
  );
  const ml = recs.find((r) => r.market === "moneyline");
  check("low-quality final inversion side is preserved for transparency", ml?.pick === "away");
  check("low-quality inversion is No Play, not Lean", ml?.play_grade === null && ml?.no_bet === true);
  check("low-quality inversion board action is no_play", (ml?.snapshot_json as any)?.decision_pipeline?.board_action === "no_play");
}
{
  // raw>=60 → no flip.
  const recs = build(mkPred({}, { auto_factors: { ml_raw_confidence: 61 } }), oddsSnap(-150, 135));
  const ml = recs.find((r) => r.market === "moneyline");
  check("raw>=60: ML pick stays home (no flip)", ml?.pick === "home" && (ml?.snapshot_json as any)?.ml_flip == null);
}
{
  // The inversion candidate can be reversed by the downstream raw-model-side
  // calibration. The final published side is then unchanged and must not be
  // counted or rendered as a correction.
  const previousGlobal = process.env.MLB_PICK_CALIBRATION_ENABLED;
  const previousMl = process.env.MLB_ML_PICK_CALIBRATION_ENABLED;
  process.env.MLB_PICK_CALIBRATION_ENABLED = "true";
  process.env.MLB_ML_PICK_CALIBRATION_ENABLED = "true";
  try {
    const recs = build(mkPred({}, {}), oddsSnap(-150, 135));
    const ml = recs.find((r) => r.market === "moneyline");
    const flip = (ml?.snapshot_json as any)?.ml_flip;
    check("downstream calibration can return the final pick to home", ml?.pick === "home");
    check("reversed intermediate event is stamped triggered but not flipped", flip?.triggered === true && flip?.flipped === false);
    check("reversed intermediate event records the candidate away side", flip?.inversion_candidate_side === "away");
    check("reversed intermediate event records final_side_changed=false", flip?.final_side_changed === false);
    check("decision pipeline agrees the official side did not change", (ml?.snapshot_json as any)?.decision_pipeline?.final_side_changed === false);
    check("reversed intermediate event is not actionable", (ml?.snapshot_json as any)?.decision_pipeline?.board_action === "no_play");
  } finally {
    if (previousGlobal === undefined) delete process.env.MLB_PICK_CALIBRATION_ENABLED;
    else process.env.MLB_PICK_CALIBRATION_ENABLED = previousGlobal;
    if (previousMl === undefined) delete process.env.MLB_ML_PICK_CALIBRATION_ENABLED;
    else process.env.MLB_ML_PICK_CALIBRATION_ENABLED = previousMl;
  }
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
