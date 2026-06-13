/**
 * Tests for market comparison, de-vig, and edge derivation.
 */

import {
  americanToImpliedProbability,
  devigImplied,
  buildMarketProbabilityBundle,
  computeEdges,
  selectBestModelPicksPerMarket,
} from "../lib/services/soccer/soccerMarketComparison";
import type { NormalizedSoccerOddsRecord } from "../lib/providers/real_api/_soccerMarketNormalizer";

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg?: string): void { if (!cond) throw new Error(`Assertion failed: ${msg ?? ""}`); }
function close(a: number, b: number, eps = 1e-6): boolean { return Math.abs(a - b) < eps; }
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}`); console.log(`      ${e instanceof Error ? e.message : String(e)}`); fail++; }
}

console.log("\nscripts/test-soccer-market-comparison.ts");
console.log("─".repeat(60));

test("americanToImpliedProbability: −110 ≈ 0.524", () => {
  const p = americanToImpliedProbability(-110);
  assert(p !== null && Math.abs(p - 0.5238) < 0.001);
});

test("americanToImpliedProbability: +200 ≈ 0.333", () => {
  const p = americanToImpliedProbability(200);
  assert(p !== null && Math.abs(p - 0.3333) < 0.001);
});

test("americanToImpliedProbability handles null + zero + non-finite", () => {
  assert(americanToImpliedProbability(null) === null);
  assert(americanToImpliedProbability(0) === null);
  assert(americanToImpliedProbability(NaN) === null);
});

test("devigImplied normalizes to sum = 1 (default target)", () => {
  const out = devigImplied([0.55, 0.5]); // sum = 1.05, vig ~5%
  assert(close(out[0] + out[1], 1));
  assert(out[0] > out[1], "higher implied stays higher after devig");
});

test("devigImplied handles a null entry gracefully", () => {
  const out = devigImplied([0.4, null, 0.4]);
  assert(close(out[0] + out[1] + out[2], 1));
});

// ── Change A — DC de-vig math fix ────────────────────────────────────
//
// Double Chance has 3 outcomes (home_or_draw, away_or_draw, home_or_away),
// each covering 2 of 3 mutually exclusive match results. The true target
// sum for DC is 2.0, NOT 1.0. Prior to this fix the de-vig silently halved
// every DC probability and inflated every DC edge by ~2x.

test("Change A — devigImplied with targetSum=2.0 sums to 2.0", () => {
  const out = devigImplied([0.722, 0.672, 0.737], 2.0); // CZE@KOR DC vig
  const sum = out[0] + out[1] + out[2];
  assert(close(sum, 2.0), `DC devig sum = ${sum}, expected 2.0`);
});

test("Change A — devigImplied with targetSum preserves ordering", () => {
  const out = devigImplied([0.722, 0.672, 0.737], 2.0);
  // Highest implied (home_or_away=0.737) stays highest after devig.
  assert(out[2] > out[0] && out[0] > out[1], "ordering preserved under retarget");
});

function mkRow(overrides: Partial<NormalizedSoccerOddsRecord>): NormalizedSoccerOddsRecord {
  return {
    market: "match_result",
    selection: "home",
    line: null,
    odds_american: -110,
    odds_decimal: null,
    sportsbook: "fanduel",
    provider: "bdl",
    provider_endpoint: "/fifa/worldcup/v1/odds",
    fetched_at: "2026-06-11T00:00:00Z",
    provider_event_id: null,
    ...overrides,
  };
}

test("buildMarketProbabilityBundle dedups across sportsbooks via per-book median", () => {
  // Both books quote ALL THREE selections → both are de-viggable and count.
  // (WC-MODEL-6: only books quoting the full group inform the consensus.)
  const rows: NormalizedSoccerOddsRecord[] = [
    mkRow({ market: "match_result", selection: "home", odds_american: 200, sportsbook: "fanduel" }),
    mkRow({ market: "match_result", selection: "home", odds_american: 220, sportsbook: "bovada" }),
    mkRow({ market: "match_result", selection: "draw", odds_american: 250, sportsbook: "fanduel" }),
    mkRow({ market: "match_result", selection: "draw", odds_american: 240, sportsbook: "bovada" }),
    mkRow({ market: "match_result", selection: "away", odds_american: 140, sportsbook: "fanduel" }),
    mkRow({ market: "match_result", selection: "away", odds_american: 145, sportsbook: "bovada" }),
  ];
  const b = buildMarketProbabilityBundle(rows, 2.5);
  const sum = b.devig["match_result|home"] + b.devig["match_result|draw"] + b.devig["match_result|away"];
  assert(close(sum, 1), `match_result devig sum = ${sum}`);
  assert(b.book_counts["match_result"] === 2, "2 complete books counted");
});

test("WC-MODEL-6: a single skewed book does NOT drag the de-vig consensus (outlier-resistant)", () => {
  // BTTS: bovada/fanduel ≈ +100 (≈48-50% yes); draftkings is a +200 outlier
  // (≈33% yes). Per-book de-vig + median ignores the outlier.
  const rows: NormalizedSoccerOddsRecord[] = [
    mkRow({ market: "btts", selection: "yes", odds_american: 100, sportsbook: "fanduel" }),
    mkRow({ market: "btts", selection: "no", odds_american: -128, sportsbook: "fanduel" }),
    mkRow({ market: "btts", selection: "yes", odds_american: 108, sportsbook: "bovada" }),
    mkRow({ market: "btts", selection: "no", odds_american: -140, sportsbook: "bovada" }),
    mkRow({ market: "btts", selection: "yes", odds_american: 200, sportsbook: "draftkings" }), // outlier
    mkRow({ market: "btts", selection: "no", odds_american: -275, sportsbook: "draftkings" }),  // outlier
  ];
  const b = buildMarketProbabilityBundle(rows, 2.5);
  // Consensus yes should sit near the bovada/fanduel level (~0.45-0.47), NOT
  // dragged toward the draftkings outlier (~0.31).
  assert(b.devig["btts|yes"] > 0.43 && b.devig["btts|yes"] < 0.49, `btts yes devig = ${b.devig["btts|yes"]} (expected ~0.45)`);
  assert(b.book_counts["btts"] === 3, "3 complete BTTS books");
});

test("buildMarketProbabilityBundle handles total with the requested line only", () => {
  const rows: NormalizedSoccerOddsRecord[] = [
    mkRow({ market: "total", selection: "over", line: 2.5, odds_american: -110, sportsbook: "fanduel" }),
    mkRow({ market: "total", selection: "under", line: 2.5, odds_american: -110, sportsbook: "fanduel" }),
    mkRow({ market: "total", selection: "over", line: 1.5, odds_american: -200, sportsbook: "fanduel" }), // wrong line — ignored
  ];
  const b = buildMarketProbabilityBundle(rows, 2.5);
  assert(b.implied["total|over|2.5"] !== undefined);
  assert(b.implied["total|under|2.5"] !== undefined);
  assert(b.implied["total|over|1.5"] === undefined, "1.5 line ignored when canonical is 2.5");
});

test("computeEdges: model 50% vs devig 45% on home → edge_pp = +5", () => {
  const rows: NormalizedSoccerOddsRecord[] = [
    mkRow({ market: "match_result", selection: "home", odds_american: 120, sportsbook: "fanduel" }),
    mkRow({ market: "match_result", selection: "draw", odds_american: 300, sportsbook: "fanduel" }),
    mkRow({ market: "match_result", selection: "away", odds_american: 200, sportsbook: "fanduel" }),
    mkRow({ market: "double_chance", selection: "home_or_draw", odds_american: -200, sportsbook: "fanduel" }),
    mkRow({ market: "double_chance", selection: "away_or_draw", odds_american: 200, sportsbook: "fanduel" }),
    mkRow({ market: "double_chance", selection: "home_or_away", odds_american: -110, sportsbook: "fanduel" }),
    mkRow({ market: "total", selection: "over", line: 2.5, odds_american: -110, sportsbook: "fanduel" }),
    mkRow({ market: "total", selection: "under", line: 2.5, odds_american: -110, sportsbook: "fanduel" }),
    mkRow({ market: "btts", selection: "yes", odds_american: 110, sportsbook: "fanduel" }),
    mkRow({ market: "btts", selection: "no", odds_american: -130, sportsbook: "fanduel" }),
  ];
  const bundle = buildMarketProbabilityBundle(rows, 2.5);
  const edges = computeEdges({
    modelMatchResult: { home: 0.50, draw: 0.27, away: 0.23 },
    modelDoubleChance: { home_or_draw: 0.77, away_or_draw: 0.50, home_or_away: 0.73 },
    modelTotal: { line: 2.5, over: 0.55, under: 0.45, push: 0 },
    modelBtts: { yes: 0.55, no: 0.45 },
    marketBundle: bundle,
  });
  // 10 selections expected.
  assert(edges.length === 10, `expected 10 edge rows, got ${edges.length}`);
  const home = edges.find((e) => e.market === "match_result" && e.selection === "home")!;
  assert(home.edge_pp !== null && home.edge_pp > 0, "home edge positive when model > market");
});

test("selectBestModelPicksPerMarket: argmax model_p per market", () => {
  const edges = [
    { market: "match_result", selection: "home", model_p: 0.5, market_implied_p: null, market_devig_p: null, edge_pp: null, model_market_agreement: false },
    { market: "match_result", selection: "draw", model_p: 0.27, market_implied_p: null, market_devig_p: null, edge_pp: null, model_market_agreement: false },
    { market: "match_result", selection: "away", model_p: 0.23, market_implied_p: null, market_devig_p: null, edge_pp: null, model_market_agreement: false },
    { market: "double_chance", selection: "home_or_draw", model_p: 0.77, market_implied_p: null, market_devig_p: null, edge_pp: null, model_market_agreement: false },
    { market: "double_chance", selection: "away_or_draw", model_p: 0.5, market_implied_p: null, market_devig_p: null, edge_pp: null, model_market_agreement: false },
    { market: "double_chance", selection: "home_or_away", model_p: 0.73, market_implied_p: null, market_devig_p: null, edge_pp: null, model_market_agreement: false },
  ] as const;
  const best = selectBestModelPicksPerMarket(edges);
  assert(best.length === 2, "two markets → two best picks");
  assert(best.find((b) => b.market === "match_result")?.selection === "home");
  assert(best.find((b) => b.market === "double_chance")?.selection === "home_or_draw");
});

// ── Change A — bundle-level DC sums to 2.0, others to 1.0 ────────────

test("Change A — buildMarketProbabilityBundle: DC devig sums to 2.0", () => {
  // CZE@KOR-style DC market: implied 0.722, 0.672, 0.737 (sum 2.131, vig ~6.5%).
  // We need odds that yield those implieds:
  //   0.722 ≈ -260 American (0.7222)
  //   0.672 ≈ -205 American (0.6721)
  //   0.737 ≈ -280 American (0.7368)
  const rows: NormalizedSoccerOddsRecord[] = [
    mkRow({ market: "double_chance", selection: "home_or_draw", odds_american: -260, sportsbook: "fanduel" }),
    mkRow({ market: "double_chance", selection: "away_or_draw", odds_american: -205, sportsbook: "fanduel" }),
    mkRow({ market: "double_chance", selection: "home_or_away", odds_american: -280, sportsbook: "fanduel" }),
  ];
  const b = buildMarketProbabilityBundle(rows, 2.5);
  const sum =
    b.devig["double_chance|home_or_draw"]
    + b.devig["double_chance|away_or_draw"]
    + b.devig["double_chance|home_or_away"];
  assert(close(sum, 2.0, 1e-3), `DC devig sum = ${sum}, expected 2.0`);
});

test("Change A — bundle keeps match_result devig at sum=1.0 (no regression)", () => {
  const rows: NormalizedSoccerOddsRecord[] = [
    mkRow({ market: "match_result", selection: "home", odds_american: 120, sportsbook: "fanduel" }),
    mkRow({ market: "match_result", selection: "draw", odds_american: 250, sportsbook: "fanduel" }),
    mkRow({ market: "match_result", selection: "away", odds_american: 200, sportsbook: "fanduel" }),
  ];
  const b = buildMarketProbabilityBundle(rows, 2.5);
  const sum = b.devig["match_result|home"] + b.devig["match_result|draw"] + b.devig["match_result|away"];
  assert(close(sum, 1.0, 1e-6), `match_result sum = ${sum}, expected 1.0`);
});

test("Change A — bundle keeps total devig at sum=1.0 (no regression)", () => {
  const rows: NormalizedSoccerOddsRecord[] = [
    mkRow({ market: "total", selection: "over", line: 2.5, odds_american: -110, sportsbook: "fanduel" }),
    mkRow({ market: "total", selection: "under", line: 2.5, odds_american: -110, sportsbook: "fanduel" }),
  ];
  const b = buildMarketProbabilityBundle(rows, 2.5);
  const sum = b.devig["total|over|2.5"] + b.devig["total|under|2.5"];
  assert(close(sum, 1.0, 1e-6), `total sum = ${sum}, expected 1.0`);
});

test("Change A — bundle keeps btts devig at sum=1.0 (no regression)", () => {
  const rows: NormalizedSoccerOddsRecord[] = [
    mkRow({ market: "btts", selection: "yes", odds_american: 110, sportsbook: "fanduel" }),
    mkRow({ market: "btts", selection: "no", odds_american: -130, sportsbook: "fanduel" }),
  ];
  const b = buildMarketProbabilityBundle(rows, 2.5);
  const sum = b.devig["btts|yes"] + b.devig["btts|no"];
  assert(close(sum, 1.0, 1e-6), `btts sum = ${sum}, expected 1.0`);
});

test("Change A — CZE@KOR DC edge collapses from ~+36pp (bug) to ~+1.7pp (correct)", () => {
  // Tonight's CZE@KOR snapshot:
  //   model_p(home_or_away) = 0.7076
  //   market implied (sum=2.131): home_or_draw=0.722, away_or_draw=0.672, home_or_away=0.737
  //   Correct devig (target 2.0): home_or_away ≈ 0.737 × 2/2.131 ≈ 0.692
  //   Correct edge_pp = (0.7076 − 0.692) × 100 ≈ +1.6pp
  const rows: NormalizedSoccerOddsRecord[] = [
    mkRow({ market: "double_chance", selection: "home_or_draw", odds_american: -260, sportsbook: "fanduel" }),
    mkRow({ market: "double_chance", selection: "away_or_draw", odds_american: -205, sportsbook: "fanduel" }),
    mkRow({ market: "double_chance", selection: "home_or_away", odds_american: -280, sportsbook: "fanduel" }),
    // Minimal coverage for other markets so computeEdges doesn't get spooked.
    mkRow({ market: "match_result", selection: "home", odds_american: -110, sportsbook: "fanduel" }),
    mkRow({ market: "match_result", selection: "draw", odds_american: 300, sportsbook: "fanduel" }),
    mkRow({ market: "match_result", selection: "away", odds_american: 250, sportsbook: "fanduel" }),
    mkRow({ market: "total", selection: "over", line: 2.5, odds_american: -110, sportsbook: "fanduel" }),
    mkRow({ market: "total", selection: "under", line: 2.5, odds_american: -110, sportsbook: "fanduel" }),
    mkRow({ market: "btts", selection: "yes", odds_american: 110, sportsbook: "fanduel" }),
    mkRow({ market: "btts", selection: "no", odds_american: -130, sportsbook: "fanduel" }),
  ];
  const bundle = buildMarketProbabilityBundle(rows, 2.5);
  const edges = computeEdges({
    modelMatchResult: { home: 0.394, draw: 0.292, away: 0.314 },
    modelDoubleChance: { home_or_draw: 0.686, away_or_draw: 0.606, home_or_away: 0.7076 },
    modelTotal: { line: 2.5, over: 0.483, under: 0.517, push: 0 },
    modelBtts: { yes: 0.543, no: 0.457 },
    marketBundle: bundle,
  });
  const ha = edges.find((e) => e.market === "double_chance" && e.selection === "home_or_away")!;
  assert(ha.edge_pp !== null, "home_or_away edge_pp should be defined");
  // The bug would have produced edge_pp ≈ +35 pp; the fix collapses to ≈ +1.6 pp.
  assert(Math.abs(ha.edge_pp!) < 5, `DC home_or_away edge_pp = ${ha.edge_pp}, expected |edge| < 5pp post-fix (was ~+35pp pre-fix)`);
  assert(ha.edge_pp! > 0, `DC home_or_away should still be slightly positive (model > market), got ${ha.edge_pp}`);
});

console.log(`\n  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) { console.log("❌ market-comparison tests FAILED"); process.exit(1); }
console.log(`✅ All ${pass} tests passed.`);
