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

test("devigImplied normalizes to sum = 1", () => {
  const out = devigImplied([0.55, 0.5]); // sum = 1.05, vig ~5%
  assert(close(out[0] + out[1], 1));
  assert(out[0] > out[1], "higher implied stays higher after devig");
});

test("devigImplied handles a null entry gracefully", () => {
  const out = devigImplied([0.4, null, 0.4]);
  assert(close(out[0] + out[1] + out[2], 1));
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

test("buildMarketProbabilityBundle dedups across sportsbooks via median", () => {
  const rows: NormalizedSoccerOddsRecord[] = [
    mkRow({ market: "match_result", selection: "home", odds_american: 200, sportsbook: "fanduel" }),
    mkRow({ market: "match_result", selection: "home", odds_american: 220, sportsbook: "bovada" }),
    mkRow({ market: "match_result", selection: "draw", odds_american: 250, sportsbook: "fanduel" }),
    mkRow({ market: "match_result", selection: "away", odds_american: 140, sportsbook: "fanduel" }),
    mkRow({ market: "match_result", selection: "away", odds_american: 145, sportsbook: "bovada" }),
  ];
  const b = buildMarketProbabilityBundle(rows, 2.5);
  const sum = b.devig["match_result|home"] + b.devig["match_result|draw"] + b.devig["match_result|away"];
  assert(close(sum, 1), `match_result devig sum = ${sum}`);
  assert(b.book_counts["match_result"] === 2, "2 distinct books counted");
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

console.log(`\n  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) { console.log("❌ market-comparison tests FAILED"); process.exit(1); }
console.log(`✅ All ${pass} tests passed.`);
