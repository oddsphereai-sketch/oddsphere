/**
 * WC-MODEL-5 research-calibrated grade-ladder test.
 *
 * Verifies market- + side-specific edge thresholds, the miscalibration
 * ceiling, Double Chance exclusion from Best Angle, and that Best Angle
 * stays structurally locked under external_priors_only.
 *
 * Pure logic. Run: npx tsx scripts/test-soccer-grade-ladder-v5.ts
 */

import { deriveSoccerGrade, type GradeInputContext } from "../lib/services/soccer/soccerConfidenceGrade";

let failures = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`✓ ${name}`);
  else { failures++; console.error(`✗ ${name}${detail ? `  — ${detail}` : ""}`); }
}

function ctx(over: Partial<GradeInputContext> = {}): GradeInputContext {
  return {
    calibration_evidence_level: "external_priors_only",
    market_supports_pick: false,
    is_stale_market: false,
    is_single_source: false,
    is_far_from_market: false,
    is_short_price_dc: false,
    short_price_dc_market_implied_p: null,
    splits_provider_error: false,
    is_draw_pick: false,
    lambda_total: 2.6,
    is_btts_yes_pick: false,
    lambda_min: 1.2,
    is_match_favorite: false,
    ...over,
  };
}
// Grade only (agreement true + not far, unless overridden) for a given market/edge.
function grade(market: any, edge: number, o: { fav?: boolean; agreement?: boolean; far?: boolean; model_p?: number } = {}) {
  return deriveSoccerGrade({
    market,
    selection: market === "match_result" ? "home" : market === "total" ? "over" : market === "btts" ? "yes" : "home_or_draw",
    model_p: o.model_p ?? 0.55,
    edge_pp: edge,
    model_market_agreement: o.agreement ?? true,
    ctx: ctx({ is_match_favorite: o.fav ?? false, is_far_from_market: o.far ?? false }),
  });
}

// 1 — Match Result FAVORITE (watchlist 2.0, lean 3.0)
ok("MR favorite +2.5pp → Watchlist", grade("match_result", 2.5, { fav: true }).grade === "Watchlist");
ok("MR favorite +3.0pp → Lean", grade("match_result", 3.0, { fav: true }).grade === "Lean");
ok("MR favorite +1.5pp → Caution (below watchlist)", grade("match_result", 1.5, { fav: true }).grade === "Caution");

// 2 — Match Result DRAW/LONGSHOT (watchlist 3.0, lean 5.0) — higher bar
ok("MR longshot +3.0pp → Watchlist", grade("match_result", 3.0, { fav: false }).grade === "Watchlist");
ok("MR longshot +3.9pp → Watchlist (below 5.0 lean)", grade("match_result", 3.9, { fav: false }).grade === "Watchlist");
ok("MR longshot +5.0pp → Lean", grade("match_result", 5.0, { fav: false }).grade === "Lean");

// 3 — Total (watchlist 2.5, lean 4.0)
ok("Total +2.5pp → Watchlist", grade("total", 2.5).grade === "Watchlist");
ok("Total +4.0pp → Lean", grade("total", 4.0).grade === "Lean");
ok("Total +2.0pp → Caution", grade("total", 2.0).grade === "Caution");

// 4 — BTTS (watchlist 3.0, lean 5.0)
ok("BTTS +3.0pp → Watchlist", grade("btts", 3.0).grade === "Watchlist");
ok("BTTS +5.0pp → Lean", grade("btts", 5.0).grade === "Lean");
ok("BTTS +2.5pp → Caution", grade("btts", 2.5).grade === "Caution");

// 5 — Double Chance (watchlist 4.0, lean 6.0) — strictest
ok("DC +4.0pp → Watchlist", grade("double_chance", 4.0).grade === "Watchlist");
ok("DC +6.0pp → Lean", grade("double_chance", 6.0).grade === "Lean");
ok("DC +3.5pp → Caution", grade("double_chance", 3.5).grade === "Caution");

// 6 — Double Chance can NEVER be Best Angle (excluded, null floor)
const dcHigh = grade("double_chance", 8.0);
ok("DC +8.0pp is NOT Best Angle", dcHigh.grade !== "Best Angle" && dcHigh.best_angle === false);

// 7 — Miscalibration ceiling: implausibly large edge → Caution + flag
const mc = grade("match_result", 11.0, { fav: true });
ok("MR +11pp → Caution (above 10pp ceiling)", mc.grade === "Caution");
ok("MR +11pp sets miscalibration_flag", mc.miscalibration_flag === true);
ok("Total +9.5pp → Caution + flag (ceiling 9)", grade("total", 9.5).grade === "Caution" && grade("total", 9.5).miscalibration_flag === true);
ok("Below ceiling does NOT flag", grade("match_result", 6.0, { fav: true }).miscalibration_flag === false);

// 8 — Best Angle stays locked under external_priors_only (downgrades to Lean)
const ba = grade("match_result", 6.0, { fav: true }); // ≥ favorite BA floor 5.0, agreement, !far
ok("MR favorite +6pp would-be Best Angle is locked → Lean", ba.grade === "Lean");
ok("best_angle flag stays false under external_priors_only", ba.best_angle === false);

// 9-10 — Reader wiring (static source checks): the shell renders the
// grade-honesty block with calibration level + model/market/edge + reason,
// and the adapter builds it. (Source-text checks — no React import.)
import { readFileSync } from "node:fs";
const shellSrc = readFileSync("app/lab/components/daily-edge/DailyEdgeShell.tsx", "utf8");
ok("shell defines SoccerGradeContext component", shellSrc.includes("function SoccerGradeContext("));
ok(
  "shell grade block renders calibration_label + grade_reason + model/market/edge",
  ["calibration_label", "grade_reason", "model_pct", "market_pct", "edge_pp"].every((f) => shellSrc.includes(`ctx.${f}`)),
);
ok("shell renders SoccerGradeContext in soccer market branches", (shellSrc.match(/<SoccerGradeContext ctx=\{gradeCtx\}/g) ?? []).length >= 3);
const adapterSrc = readFileSync("lib/services/soccer/buildSoccerDailyEdgeAdapted.ts", "utf8");
ok("adapter builds soccerGradeContext on slots", (adapterSrc.match(/soccerGradeContext: buildSoccerGradeContext\(/g) ?? []).length >= 3);

if (failures > 0) { console.error(`\n${failures} assertion(s) failed.`); process.exit(1); }
console.log("\nAll WC-MODEL-5 grade-ladder + reader-wiring assertions passed.");
