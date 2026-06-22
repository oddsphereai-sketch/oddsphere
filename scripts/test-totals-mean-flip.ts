/**
 * Tests for the totals conservative mean-side flip.
 *   - pure helper: lib/services/totalsMeanFlip.ts
 *   - integration: predictionRecordService.buildPredictionRecordsFromSlate
 * Run: npx tsx scripts/test-totals-mean-flip.ts
 */
import { resolveTotalsMeanFlip, TOTALS_MEAN_FLIP_RULE_ID } from "../lib/services/totalsMeanFlip";
import { buildPredictionRecordsFromSlate } from "../lib/services/predictionRecordService";

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
check("gap<0.3 → standdown", resolveTotalsMeanFlip({ ...base, projectedTotal: 8.6 }).action === "standdown");
check("line>=10 → standdown", resolveTotalsMeanFlip({ ...base, line: 10, projectedTotal: 10.5 }).action === "standdown");
check("missing mean-side odds → standdown", resolveTotalsMeanFlip({ ...base, overOdds: null }).action === "standdown");
check("non-divergent (pick==mean side) → none", resolveTotalsMeanFlip({ ...base, predictedSide: "over" }).action === "none");
check("no projected total but reconciliation flag → standdown", resolveTotalsMeanFlip({ ...base, projectedTotal: null, line: null }).action === "standdown");
check("no projected total and NOT reconciliation-divergent → none", resolveTotalsMeanFlip({ ...base, projectedTotal: null, line: null, reconciliationDivergence: false }).action === "none");

// ── integration ────────────────────────────────────────────────────
const baseGame = { id: 800, external_id: 9100, game_date: "2026-06-22T18:00:00Z", slate_status: "published", home_team_id: 771, away_team_id: 780 };
const abbrevByTeamId = new Map<number, string>([[771, "CHC"], [780, "SF"]]);
const oddsSrc = (odds: number | null) => ({ source: "lines" as const, book: "pinnacle", odds, line: null, observedAt: "2026-06-22T16:00:00Z" });
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
function build(pred: any, odds: any) {
  return buildPredictionRecordsFromSlate({ sport: "mlb", slateDate: "2026-06-22", launchDay: false, games: [baseGame], predictionByGameId: new Map([[800, pred]]), abbrevByTeamId, signalsByGameId: new Map(), oddsByGameId: new Map([[800, odds as any]]) });
}

console.log("\n━━━ integration: buildPredictionRecordsFromSlate ━━━");
{
  // Divergent (pick under, mean 8.9 > line 8.5), gap 0.4, line<10, odds present → FLIP to over.
  const recs = build(mkPred({}, {}), oddsSnap(-105, -115));
  const ou = recs.find((r) => r.market === "total");
  check("eligible divergent FLIPS to over (was under)", ou?.pick === "over" && ou?.side === "over");
  check("flip uses mean-side odds -105", ou?.odds_american === -105);
  check("flip no_bet=false (real pick, not No Play)", ou?.no_bet === false);
  check("flip best_angle=false", ou?.best_angle === false);
  check("flip play_grade=null", ou?.play_grade === null);
  check("member confidence >=55 (NOT sub-50 raw)", typeof ou?.confidence === "number" && ou!.confidence >= 55 && ou!.confidence <= 60);
  check("member model_probability >=0.5 (presentable)", typeof ou?.model_probability === "number" && ou!.model_probability >= 0.5);
  check("flipped edge column nulled", ou?.edge === null);
  const f = (ou?.snapshot_json as any)?.ou_flip;
  check("ou_flip audit + original side=under, mean_side=over", f?.flipped === true && f?.original_probability_side === "under" && f?.mean_side === "over");
  check("ou_flip records projected_total + gap", f?.projected_total === 8.9 && Math.abs(f?.mean_gap - 0.4) < 1e-9);
  check("ou_flip preserves RAW mean-side prob in audit (sub-50)", typeof f?.flipped_side_model_prob === "number" && f.flipped_side_model_prob < 0.5);
  check("ou_flip final_displayed_confidence matches column", f?.final_displayed_confidence === ou?.confidence);
  check("coherent: pick(over) agrees with projected_total>line", ou?.pick === "over" && 8.9 > Number(ou?.line_value));
  // ML + FI unaffected
  check("ML record unaffected by totals flip", recs.find((r) => r.market === "moneyline")?.pick === "home");
}
{
  // gap < 0.3 → stand down (no_bet=true), pick stays under.
  const recs = build(mkPred({}, { posterior_total: 8.6 }), oddsSnap(-105, -115));
  const ou = recs.find((r) => r.market === "total");
  check("gap<0.3 → No Play (no_bet=true), pick stays under", ou?.no_bet === true && ou?.pick === "under" && (ou?.snapshot_json as any)?.ou_flip == null);
}
{
  // line>=10 → stand down.
  const recs = build(mkPred({}, { market_total: 10, posterior_total: 10.6 }), oddsSnap(-105, -115));
  const ou = recs.find((r) => r.market === "total");
  check("line>=10 → No Play (no flip)", ou?.no_bet === true && (ou?.snapshot_json as any)?.ou_flip == null);
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
  // Determinism: build twice → identical flipped side (locked snapshot freezes).
  const a = build(mkPred({}, {}), oddsSnap(-105, -115)).find((r) => r.market === "total");
  const b = build(mkPred({}, {}), oddsSnap(-105, -115)).find((r) => r.market === "total");
  check("flip is deterministic (freezes same side)", a?.pick === b?.pick && a?.pick === "over");
}

console.log(`\n  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) { console.log("\nFAILURES:\n" + failures.map((f) => "  - " + f).join("\n")); process.exit(1); }
console.log("\n✅ Totals mean-side flip tests passed.");
