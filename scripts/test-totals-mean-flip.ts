/**
 * Tests for the totals official mean-side selector.
 *   - pure helper: lib/services/totalsMeanFlip.ts
 *   - integration: predictionRecordService.buildPredictionRecordsFromSlate
 * Run: npx tsx scripts/test-totals-mean-flip.ts
 */
import {
  resolveTotalsMarketOpposedFlip,
  resolveTotalsMidEdgeFlip,
  resolveTotalsMeanFlip,
  TOTALS_MARKET_OPPOSED_FLIP_RULE_ID,
  TOTALS_MID_EDGE_FLIP_RULE_ID,
  TOTALS_MEAN_FLIP_RULE_ID,
} from "../lib/services/totalsMeanFlip";
import {
  buildPredictionRecordsFromSlate,
  TOTAL_VALIDATED_LEAN_RULE_ID,
} from "../lib/services/predictionRecordService";

let pass = 0, fail = 0;
const failures: string[] = [];
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push(`${label}${detail ? ` — ${detail}` : ""}`); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

// pick=under but projected mean (8.9) > line (8.5) → mean side = over → divergent.
const base = {
  predictedSide: "under" as const, line: 8.5, projectedTotal: 8.9, modelProb: 0.52, marketProb: 0.5,
  originalConfidence: 52, overOdds: -105, underOdds: -115, reconciliationDivergence: true,
};
console.log("━━━ resolveTotalsMeanFlip ━━━");
{
  const r = resolveTotalsMeanFlip(base);
  check("divergent gap>=0.3 line<10 + odds → FLIP to over", r.action === "flip" && r.action === "flip" && r.meanSide === "over");
  check("flip uses mean-side (over) odds -105", r.action === "flip" && r.flippedOdds === -105);
  check("flip mean_gap = 0.4", r.action === "flip" && Math.abs(r.meanGap - 0.4) < 1e-9);
  check("member confidence floored to 55 (orig 52, NOT sub-50)", r.action === "flip" && r.recommendationConfidence === 55);
  check("raw mean-side prob preserved (0.48) [audit only]", r.action === "flip" && Math.abs((r.flippedSideModelProb ?? 0) - 0.48) < 1e-9);
  check("flip rule_id stamped", r.action === "flip" && r.rule_id === TOTALS_MEAN_FLIP_RULE_ID);
}
check("member confidence capped at 60 when orig=72", (() => { const r = resolveTotalsMeanFlip({ ...base, originalConfidence: 72 }); return r.action === "flip" && r.recommendationConfidence === 60; })());
check("gap<0.3 → still flips under v2 selector", (() => { const r = resolveTotalsMeanFlip({ ...base, projectedTotal: 8.6 }); return r.action === "flip" && r.meanSide === "over"; })());
check("line>=10 → still flips under v2 selector", (() => { const r = resolveTotalsMeanFlip({ ...base, line: 10, projectedTotal: 10.5 }); return r.action === "flip" && r.meanSide === "over"; })());
check("missing mean-side odds → standdown", resolveTotalsMeanFlip({ ...base, overOdds: null }).action === "standdown");
check("non-divergent (pick==mean side) → none", resolveTotalsMeanFlip({ ...base, predictedSide: "over" }).action === "none");
check("projected total exactly equals line → none unless reconciliation fallback says divergent", resolveTotalsMeanFlip({ ...base, projectedTotal: 8.5 }).action === "standdown");
check("no projected total but reconciliation flag → standdown", resolveTotalsMeanFlip({ ...base, projectedTotal: null, line: null }).action === "standdown");
check("no projected total and NOT reconciliation-divergent → none", resolveTotalsMeanFlip({ ...base, projectedTotal: null, line: null, reconciliationDivergence: false }).action === "none");

console.log("\n━━━ resolveTotalsMarketOpposedFlip ━━━");
{
  const r = resolveTotalsMarketOpposedFlip({
    predictedSide: "over",
    modelProb: 0.56,
    marketProb: 0.49,
    opposingPublicSplitConflict: true,
    originalConfidence: 56,
    overOdds: -110,
    underOdds: -105,
  });
  check("market-opposed weak total + public conflict → FLIP to under", r.action === "flip" && r.flippedSide === "under");
  check("market-opposed flip uses opposite-side odds", r.action === "flip" && r.flippedOdds === -105);
  check("market-opposed flip rule_id stamped", r.action === "flip" && r.rule_id === TOTALS_MARKET_OPPOSED_FLIP_RULE_ID);
  check("market-opposed flip preserves raw opposite-side model prob", r.action === "flip" && r.flippedSideModelProb !== null && Math.abs(r.flippedSideModelProb - 0.44) < 1e-9);
}
check("market-opposed flip blocked without public conflict", resolveTotalsMarketOpposedFlip({
  predictedSide: "over", modelProb: 0.56, marketProb: 0.49, opposingPublicSplitConflict: false,
  originalConfidence: 56, overOdds: -110, underOdds: -105,
}).action === "none");
check("market-opposed flip blocked when model is strong", resolveTotalsMarketOpposedFlip({
  predictedSide: "over", modelProb: 0.59, marketProb: 0.49, opposingPublicSplitConflict: true,
  originalConfidence: 59, overOdds: -110, underOdds: -105,
}).action === "none");
check("market-opposed flip blocked when book does not oppose picked side", resolveTotalsMarketOpposedFlip({
  predictedSide: "over", modelProb: 0.56, marketProb: 0.51, opposingPublicSplitConflict: true,
  originalConfidence: 56, overOdds: -110, underOdds: -105,
}).action === "none");
check("market-opposed flip stands down when opposite price is missing", resolveTotalsMarketOpposedFlip({
  predictedSide: "over", modelProb: 0.56, marketProb: 0.49, opposingPublicSplitConflict: true,
  originalConfidence: 56, overOdds: -110, underOdds: null,
}).action === "standdown");

console.log("\n━━━ resolveTotalsMidEdgeFlip ━━━");
const midEdgeBase = {
  currentSide: "over" as const,
  currentEdgePp: 3.8,
  currentModelProb: 0.558,
  currentMarketProb: 0.52,
  currentConfidence: 56,
  overOdds: -110,
  underOdds: -105,
  priorCorrectionApplied: false,
};
{
  const r = resolveTotalsMidEdgeFlip(midEdgeBase);
  check("3-5pp uncorrected total flips to priced opposite side", r.action === "flip" && r.flippedSide === "under" && r.flippedOdds === -105);
  check("mid-edge flip stamps dedicated rule", r.action === "flip" && r.rule_id === TOTALS_MID_EDGE_FLIP_RULE_ID);
  check("mid-edge flip preserves original edge for audit", r.action === "flip" && r.originalEdgePp === 3.8);
  check("mid-edge flip uses presentable recommendation confidence", r.action === "flip" && r.recommendationConfidence >= 55 && r.recommendationConfidence <= 60);
}
check("3.0pp lower boundary qualifies", resolveTotalsMidEdgeFlip({ ...midEdgeBase, currentEdgePp: 3 }).action === "flip");
check("negative 3-5pp edge qualifies by absolute magnitude", resolveTotalsMidEdgeFlip({ ...midEdgeBase, currentEdgePp: -4.9 }).action === "flip");
check("5.0pp upper boundary does not qualify", resolveTotalsMidEdgeFlip({ ...midEdgeBase, currentEdgePp: 5 }).action === "none");
check("below 3.0pp does not qualify", resolveTotalsMidEdgeFlip({ ...midEdgeBase, currentEdgePp: 2.9 }).action === "none");
check("missing opposite price leaves original prediction unchanged", resolveTotalsMidEdgeFlip({ ...midEdgeBase, underOdds: null }).action === "none");
check("prior correction is never double-flipped", resolveTotalsMidEdgeFlip({ ...midEdgeBase, priorCorrectionApplied: true }).action === "none");

// ── integration ────────────────────────────────────────────────────
const baseGame = { id: 800, external_id: 9100, game_date: "2026-06-22T18:00:00Z", slate_status: "published", home_team_id: 771, away_team_id: 780 };
const abbrevByTeamId = new Map<number, string>([[771, "CHC"], [780, "SF"]]);
const oddsSrc = (odds: number | null, line: number | null = null) => ({ source: "lines" as const, book: "pinnacle", odds, line, observedAt: "2026-06-22T16:00:00Z" });
function oddsSnap(over: number | null, under: number | null) {
  return { mlHomeOdds: -130, mlAwayOdds: 115, ouOverOdds: over, ouUnderOdds: under, oddsSourceMl: { home: oddsSrc(-130), away: oddsSrc(115) }, oddsSourceOu: { over: oddsSrc(over), under: oddsSrc(under) } };
}
function mkPred(spOver: Record<string, any>, audit: Record<string, any>) {
  return {
    id: 6000, game_id: 800, predicted_ml_winner: "home", ml_confidence: 70, predicted_ou_side: "under", ou_confidence: 56,
    predicted_nrfi: null, nrfi_confidence: 52, prediction_source: "auto_v1", is_override: false,
    locked_at: "2026-06-22T17:00:00Z", computed_at: "2026-06-22T16:00:00Z", predicted_home_score: 4.5, predicted_away_score: 4.4,
    ml_grade: "market_watch", ou_grade: "market_watch", nrfi_grade: null, ml_signal_type: null, ou_signal_type: null,
    nrfi_signal_type: null, ml_market_signal: null, ou_market_signal: null, nrfi_market_signal: null,
    sport_specific: {
      model_used: "v2_2", model_version: "auto_v2.2_mlb", hold_picks: ["nrfi"], ml_play_grade: "lean", ou_play_grade: "lean",
      ml_prediction_type: "lean", ou_prediction_type: "lean", v2_data_quality_tier: "high", v2_provisional: false,
      ml_market_aligned: true, ou_market_aligned: false,
      auto_factors: { ml_raw_confidence: 70, nrfi_probability: 0.5 },
      v2_2_audit: { ou_model_prob: 0.52, ou_market_prob: 0.5, market_total: 8.5, posterior_total: 8.9, posterior_home_diff: 0.1, ...audit },
      ...spOver,
    },
  };
}
function build(pred: any, odds: any, signals: Map<number, any[]> = new Map()) {
  return buildPredictionRecordsFromSlate({ sport: "mlb", slateDate: "2026-06-22", launchDay: false, games: [baseGame], predictionByGameId: new Map([[800, pred]]), abbrevByTeamId, signalsByGameId: signals, oddsByGameId: new Map([[800, odds as any]]) });
}

console.log("\n━━━ integration: buildPredictionRecordsFromSlate ━━━");
{
  // Divergent (pick under, mean 8.9 > line 8.5), gap 0.4, line<10, odds present → FLIP to over.
  const recs = build(mkPred({}, {}), oddsSnap(-105, -115));
  const ou = recs.find((r) => r.market === "total");
  check("eligible divergence keeps original under official", ou?.pick === "under" && ou?.side === "under");
  check("official side keeps its real odds -115", ou?.odds_american === -115);
  check("projection-divergent correction stands down from betting", ou?.no_bet === true);
  check("rejected correction best_angle=false", ou?.best_angle === false);
  check("rejected correction has no actionable grade", ou?.play_grade === null);
  check("member confidence >=55 (NOT sub-50 raw)", typeof ou?.confidence === "number" && ou!.confidence >= 55 && ou!.confidence <= 60);
  check("member model_probability >=0.5 (presentable)", typeof ou?.model_probability === "number" && ou!.model_probability >= 0.5);
  check("official side retains its model edge", typeof ou?.edge === "number");
  const f = (ou?.snapshot_json as any)?.ou_flip;
  const rejection = (ou?.snapshot_json as any)?.totals_correction_rejection;
  check("no official ou_flip is emitted", f == null);
  check("rejection audit records original under + rejected over", rejection?.action === "stand_down" && rejection?.original_side === "under" && rejection?.rejected_candidate_side === "over");
  check("rejection audit records the governing rule", rejection?.rule_id === TOTALS_MEAN_FLIP_RULE_ID);
  check("decision pipeline records no final side change", (ou?.snapshot_json as any)?.decision_pipeline?.final_side_changed === false);
  check("decision pipeline makes an explicit No Play board action", (ou?.snapshot_json as any)?.decision_pipeline?.board_action === "no_play");
  check("decision pipeline stamps paired total promotion rules", (ou?.snapshot_json as any)?.decision_pipeline?.paired_policy?.promotions?.includes(TOTAL_VALIDATED_LEAN_RULE_ID));
  // ML + FI unaffected
  check("ML record unaffected by totals flip", recs.find((r) => r.market === "moneyline")?.pick === "home");
}
{
  // gap < 0.3 still flips in v2. Score sum 8.6 vs bet line 8.5 ⇒ divergent
  // (mean over, pick under); the full historical replay favored mean-aligned
  // side selection over standing down thin gaps.
  const pred = mkPred({}, { posterior_total: 8.6 });
  const recs = build(pred, oddsSnap(-105, -115));
  const ou = recs.find((r) => r.market === "total");
  check("gap<0.3 → original stays under and correction stands down", ou?.no_bet === true && ou?.pick === "under" && (ou?.snapshot_json as any)?.totals_correction_rejection?.action === "stand_down");
}
{
  // line>=10 still flips in v2. Score sum 10.6 vs bet line 10 ⇒ divergent
  // (mean over, pick under); the prior line cap is removed.
  const pred = mkPred({}, { market_total: 10, posterior_total: 10.6 });
  const recs = build(pred, oddsSnap(-105, -115));
  const ou = recs.find((r) => r.market === "total");
  check("line>=10 → original stays under and correction stands down", ou?.no_bet === true && ou?.pick === "under" && (ou?.snapshot_json as any)?.totals_correction_rejection?.action === "stand_down");
}
{
  // missing mean-side (over) odds → stand down.
  const recs = build(mkPred({}, {}), oddsSnap(null, -115));
  const ou = recs.find((r) => r.market === "total");
  check("missing mean-side odds → No Play (no flip)", ou?.no_bet === true && (ou?.snapshot_json as any)?.ou_flip == null);
}
{
  // non-divergent (pick over, mean over) → unchanged, no flip, no stand-down.
  const recs = build(mkPred({ }, {}), oddsSnap(-105, -115));
  // override pick to over so it agrees with mean
  const pred = mkPred({}, {}); pred.predicted_ou_side = "over";
  const recs2 = build(pred, oddsSnap(-105, -115));
  const ou = recs2.find((r) => r.market === "total");
  check("non-divergent total unchanged (no flip, no no_bet)", ou?.pick === "over" && ou?.no_bet === false && (ou?.snapshot_json as any)?.ou_flip == null);
}
{
  // Non-divergent model Over (projection also Over), but the no-vig market is
  // against the picked side and opposite Under has the public-money conflict.
  const pred = mkPred({}, { ou_model_prob: 0.56, ou_market_prob: 0.49, posterior_total: 8.9 });
  pred.predicted_ou_side = "over";
  pred.ou_confidence = 56;
  const signals = new Map([
    [800, [{ market_type: "total", side: "under", public_money_pct: 80, public_betting_pct: 50 }]],
  ]);
  const recs = build(pred, oddsSnap(-110, -105), signals);
  const ou = recs.find((r) => r.market === "total");
  const f = (ou?.snapshot_json as any)?.ou_flip;
  check("market-opposed candidate leaves original over official", ou?.pick === "over" && ou?.side === "over");
  const rejection = (ou?.snapshot_json as any)?.totals_correction_rejection;
  check("market-opposed correction is explicit No Play", ou?.no_bet === true);
  check("market-opposed correction has no actionable grade", ou?.play_grade === null);
  check("market-opposed rejection audit stamped", f == null && rejection?.action === "stand_down" && rejection?.rejected_candidate_side === "under" && rejection?.rule_id === TOTALS_MARKET_OPPOSED_FLIP_RULE_ID);
  check("market-opposed correction kind stamped", rejection?.correction_kind === "market_opposed_public_conflict");
}
{
  // LINE BASIS: the bet line (oddsSourceOu.over/under.line) differs from the
  // model's market_total. The correction + line_value must resolve against the
  // BET line the member sees, not market_total. Score sum 8.9; book line 9.0 ⇒
  // mean 8.9 < 9.0 ⇒ mean side UNDER == pick under ⇒ NON-divergent ⇒ no flip,
  // a real Under pick tracked at 9.0. (Against market_total 8.5 it would have
  // diverged and flipped to over — proving the basis actually changed the side.)
  const odds = oddsSnap(-105, -115);
  odds.oddsSourceOu = { over: oddsSrc(-105, 9.0), under: oddsSrc(-115, 9.0) };
  const recs = build(mkPred({}, {}), odds);
  const ou = recs.find((r) => r.market === "total");
  check("bet-line basis: resolves vs book line 9.0 (not market_total 8.5) → no flip, pick under",
    ou?.pick === "under" && (ou?.snapshot_json as any)?.ou_flip == null);
  check("bet-line basis: line_value tracks the bet line 9.0", ou?.line_value === 9.0);
}
{
  const pred = mkPred({}, { ou_model_prob: 0.558, ou_market_prob: 0.52, ou_edge_pct: 3.8, posterior_total: 8.9 });
  pred.predicted_ou_side = "over";
  pred.ou_confidence = 56;
  const odds = oddsSnap(-110, -105);
  odds.oddsSourceOu.over.line = 8.5;
  odds.oddsSourceOu.under.line = 9;
  const recs = build(pred, odds);
  const ou = recs.find((r) => r.market === "total");
  const f = (ou?.snapshot_json as any)?.ou_flip;
  const rejection = (ou?.snapshot_json as any)?.totals_correction_rejection;
  const gradeResolution = (ou?.snapshot_json as any)?.total_flip_public_grade_resolution;
  check("3-5pp integration leaves original over official", ou?.pick === "over" && ou?.odds_american === -110);
  check("3-5pp official row keeps the original side's exact line", ou?.line_value === 8.5);
  check("3-5pp correction is No Play, never actionable", ou?.play_grade === null && ou?.best_angle === false && ou?.no_bet === true);
  check("3-5pp integration stamps rejection metadata", f == null && rejection?.rule_id === TOTALS_MID_EDGE_FLIP_RULE_ID && rejection?.correction_kind === "mid_edge_inversion");
  check("3-5pp integration records stand-down resolution", gradeResolution?.action === "no_public_grade" && gradeResolution?.public_play_grade === null);
}
{
  const pred = mkPred({}, { ou_model_prob: 0.558, ou_market_prob: 0.52, ou_edge_pct: 3.8, posterior_total: 8.9 });
  pred.predicted_ou_side = "over";
  const recs = build(pred, oddsSnap(-110, null));
  const ou = recs.find((r) => r.market === "total");
  check("3-5pp integration never flips without opposite price", ou?.pick === "over" && (ou?.snapshot_json as any)?.ou_flip == null);
}
{
  // Determinism: build twice → identical flipped side (locked snapshot freezes).
  const a = build(mkPred({}, {}), oddsSnap(-105, -115)).find((r) => r.market === "total");
  const b = build(mkPred({}, {}), oddsSnap(-105, -115)).find((r) => r.market === "total");
  check("stand-down policy is deterministic (freezes original side)", a?.pick === b?.pick && a?.pick === "under");
}

console.log(`\n  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) { console.log("\nFAILURES:\n" + failures.map((f) => "  - " + f).join("\n")); process.exit(1); }
console.log("\n✅ Totals mean-side flip tests passed.");
