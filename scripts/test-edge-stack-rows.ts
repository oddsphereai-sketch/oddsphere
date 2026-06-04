/**
 * Phase 4.2.C.1.R-16F-B — unit tests for the Edge Stack row builder
 * (app/lab/lib/edgeStackRows.ts).
 *
 * Pre-R-16F-B the Edge Stack and Market Value rows still read legacy
 * sharp_signals fields (`marketFairProb`, `pinnacleEvPct`) and printed
 * "market unavailable" / "Sharper price check unavailable" on
 * splits_consensus games where `marketImpliedPct` was actually
 * populated. These tests lock in the corrected behavior so future
 * refactors can't regress.
 *
 * No DB, no HTTP, no React. Pure helper exercise.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/test-edge-stack-rows.ts
 */

import {
  buildEdgeStackRows,
  marketSourceLabel,
} from "../app/lab/lib/edgeStackRows";
import type { MarketEdgeDto } from "../app/lab/lib/labTypes";

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

function section(label: string) {
  console.log(`\n━━━ ${label} ━━━`);
}

/**
 * Baseline market DTO with every market-relevant field nulled. Tests
 * override only the fields they care about — keeps each fixture small
 * and obvious about what it's exercising.
 */
function baseMarket(overrides: Partial<MarketEdgeDto> = {}): MarketEdgeDto {
  const base: MarketEdgeDto = {
    pick: "Home",
    confidence: 64,
    grade: null,
    signalType: null,
    marketSignal: null,
    sharpStatus: "mixed",
    held: false,
    verdict: { key: "watchlist", label: "Watchlist" },
    guidedGuide: "",
    guidedWatchOut: "",
    whyLine: "",
    riskLine: "",
    modelProb: null,
    marketFairProb: null,
    pinnacleEvPct: null,
    moneyPct: null,
    betsPct: null,
    publicSplits: [],
    priceAmerican: null,
    lineOpenAmerican: null,
    modelTotal: null,
    marketTotal: null,
    line: null,
    keyStats: [],
    modelTrustPct: null,
    marketImpliedPct: null,
    modelMarketGapPct: null,
    marketSource: null,
    marketDataQuality: "unavailable",
    reviewFlags: [],
    reviewActionSummary: "keep",
  };
  return { ...base, ...overrides };
}

// ─── marketSourceLabel helper ─────────────────────────────────────────

function testSourceLabelHelper() {
  section("marketSourceLabel helper");
  check(
    `"splits_consensus" → "splits consensus"`,
    marketSourceLabel("splits_consensus", "splits_consensus") === "splits consensus"
  );
  check(
    `"pinnacle_only" → "Pinnacle fair"`,
    marketSourceLabel("pinnacle_only", null) === "Pinnacle fair"
  );
  check(
    `"two_sided_consensus" with book → book name as-is`,
    marketSourceLabel("two_sided_consensus", "ballybet") === "ballybet"
  );
  check(
    `"single_book" with book → book name as-is`,
    marketSourceLabel("single_book", "draftkings") === "draftkings"
  );
  check(
    `"unavailable" → null`,
    marketSourceLabel("unavailable", null) === null
  );
  check(
    `splits_consensus NEVER impersonates a real book`,
    marketSourceLabel("splits_consensus", "splits_consensus") !== "splits_consensus"
  );
}

// ─── R-16F-B core: splits_consensus produces real Edge Stack rows ────

function testSplitsConsensusEdgeStack() {
  section("R-16F-B — splits_consensus produces honest Edge Stack rows");

  // SD@PHI-style fixture: model 64% home; market 66% from splits_consensus.
  // Pre-R-16F-B: this would have shown "64% · market unavailable" +
  // "Sharper price check unavailable" because marketFairProb and
  // pinnacleEvPct are both null. R-16F-B uses marketImpliedPct.
  const sdphi = baseMarket({
    pick: "Home",
    modelProb: 0.644,
    modelTrustPct: 64.4,
    marketImpliedPct: 65.6,
    modelMarketGapPct: -1.2,
    marketSource: "splits_consensus",
    marketDataQuality: "splits_consensus",
    // legacy sharp_signal fields null — the splits_consensus path must
    // succeed without them
    marketFairProb: null,
    pinnacleEvPct: null,
  });
  const rows = buildEdgeStackRows("moneyline", sdphi);
  const modelEdge = rows.find((r) => r.label === "Model Edge");
  const marketValue = rows.find((r) => r.label === "Market Value");

  check(
    `Model Edge: evidence does NOT contain "market unavailable"`,
    !modelEdge?.evidence.toLowerCase().includes("market unavailable"),
    `got: "${modelEdge?.evidence}"`
  );
  check(
    `Model Edge: evidence mentions both model + market %`,
    (modelEdge?.evidence ?? "").includes("Model 64%") &&
      (modelEdge?.evidence ?? "").includes("Market 66%"),
    `got: "${modelEdge?.evidence}"`
  );
  check(
    `Model Edge: evidence mentions "splits consensus" source label`,
    (modelEdge?.evidence ?? "").includes("splits consensus"),
    `got: "${modelEdge?.evidence}"`
  );
  check(
    `Model Edge: delta uses "pt" units (not legacy "%")`,
    (modelEdge?.delta ?? "").includes("pt"),
    `got: "${modelEdge?.delta}"`
  );
  check(
    `Model Edge: delta == "-1.2 pt" (from modelMarketGapPct)`,
    modelEdge?.delta === "-1.2 pt",
    `got: "${modelEdge?.delta}"`
  );

  check(
    `Market Value: evidence is NOT the legacy "Sharper price check"`,
    !(marketValue?.evidence ?? "").includes("Sharper"),
    `got: "${marketValue?.evidence}"`
  );
  check(
    `Market Value: evidence uses "Market price" + splits source`,
    marketValue?.evidence === "Market price · splits consensus",
    `got: "${marketValue?.evidence}"`
  );
  check(
    `Market Value: delta is "—" (no fake EV for splits_consensus)`,
    marketValue?.delta === "—",
    `got: "${marketValue?.delta}"`
  );
  check(
    `Market Value: delta is NOT "unavailable" anymore`,
    marketValue?.delta !== "unavailable",
    `got: "${marketValue?.delta}"`
  );
}

// ─── Real-book pair takes priority over splits_consensus ─────────────

function testRealBookPair() {
  section("Real book pair: two_sided_consensus retains book name");

  const kcmin = baseMarket({
    pick: "Away",
    modelProb: 0.5,
    modelTrustPct: 50,
    marketImpliedPct: 50,
    modelMarketGapPct: 0,
    marketSource: "ballybet",
    marketDataQuality: "two_sided_consensus",
    marketFairProb: null,
    pinnacleEvPct: null,
  });
  const rows = buildEdgeStackRows("moneyline", kcmin);
  const modelEdge = rows.find((r) => r.label === "Model Edge");
  const marketValue = rows.find((r) => r.label === "Market Value");

  check(
    `Model Edge: evidence includes book name "ballybet"`,
    (modelEdge?.evidence ?? "").includes("ballybet"),
    `got: "${modelEdge?.evidence}"`
  );
  check(
    `Model Edge: evidence does NOT include "splits consensus" for real book`,
    !(modelEdge?.evidence ?? "").includes("splits consensus"),
    `got: "${modelEdge?.evidence}"`
  );
  check(
    `Market Value: shows "Market price · ballybet" (no EV)`,
    marketValue?.evidence === "Market price · ballybet",
    `got: "${marketValue?.evidence}"`
  );
}

// ─── Pinnacle EV preserved when present ──────────────────────────────

function testPinnacleEvPreserved() {
  section("Pinnacle EV preserved when pinnacleEvPct is set");

  const withEv = baseMarket({
    pick: "Home",
    modelProb: 0.6,
    modelTrustPct: 60,
    marketImpliedPct: 55,
    modelMarketGapPct: 5,
    marketSource: "ballybet",
    marketDataQuality: "two_sided_consensus",
    pinnacleEvPct: 2.5,
  });
  const rows = buildEdgeStackRows("moneyline", withEv);
  const marketValue = rows.find((r) => r.label === "Market Value");

  check(
    `Market Value: shows EV when pinnacleEvPct is set`,
    marketValue?.delta === "+2.5%",
    `got: "${marketValue?.delta}"`
  );
  check(
    `Market Value: evidence is "Market price check" (renamed from "Sharper")`,
    marketValue?.evidence === "Market price check",
    `got: "${marketValue?.evidence}"`
  );
  check(
    `Market Value: tone is emerald (positive EV)`,
    marketValue?.tone === "emerald"
  );
}

// ─── Truly unavailable (everything null) ─────────────────────────────

function testTrulyUnavailable() {
  section("Truly unavailable: no market context anywhere");

  const empty = baseMarket({
    modelProb: 0.55,
    marketImpliedPct: null,
    marketFairProb: null,
    pinnacleEvPct: null,
    marketDataQuality: "unavailable",
  });
  const rows = buildEdgeStackRows("moneyline", empty);
  const modelEdge = rows.find((r) => r.label === "Model Edge");
  const marketValue = rows.find((r) => r.label === "Market Value");

  check(
    `Model Edge: shows "market unavailable" fallback`,
    (modelEdge?.evidence ?? "").includes("market unavailable")
  );
  check(
    `Market Value: shows "Market price check" + "unavailable"`,
    marketValue?.evidence === "Market price check" &&
      marketValue?.delta === "unavailable"
  );
  check(
    `Market Value: tone is gray for unavailable`,
    marketValue?.tone === "gray"
  );
}

// ─── Legacy marketFairProb path still works (backward compat) ────────

function testLegacyFairProbFallback() {
  section("Legacy marketFairProb fallback still works");

  // marketImpliedPct is null but marketFairProb has data. This shouldn't
  // happen in current pipeline but the legacy fallback must remain so
  // older DTO states don't break.
  const legacy = baseMarket({
    pick: "Home",
    modelProb: 0.6,
    marketImpliedPct: null,
    marketFairProb: 0.55,
    pinnacleEvPct: null,
    marketDataQuality: "unavailable",
  });
  const rows = buildEdgeStackRows("moneyline", legacy);
  const modelEdge = rows.find((r) => r.label === "Model Edge");

  check(
    `Model Edge: shows legacy "X% vs market Y%" format`,
    (modelEdge?.evidence ?? "").includes("60%") &&
      (modelEdge?.evidence ?? "").includes("55%"),
    `got: "${modelEdge?.evidence}"`
  );
  check(
    `Model Edge: legacy delta uses "%"`,
    (modelEdge?.delta ?? "").endsWith("%"),
    `got: "${modelEdge?.delta}"`
  );
}

// ─── Totals path unchanged (no R-16F-B regression on totals) ─────────

function testTotalsPathUnchanged() {
  section("Totals path: unchanged by R-16F-B");

  const total = baseMarket({
    pick: "Over",
    modelTotal: 8.7,
    marketTotal: 8.5,
    modelProb: 0.58,
    marketImpliedPct: 56,
    marketSource: "ballybet",
    marketDataQuality: "two_sided_consensus",
  });
  const rows = buildEdgeStackRows("total", total);
  const modelEdge = rows.find((r) => r.label === "Model Edge");

  check(
    `Model Edge (totals): uses modelTotal vs marketTotal format`,
    (modelEdge?.evidence ?? "").includes("Model 8.7") &&
      (modelEdge?.evidence ?? "").includes("market 8.5"),
    `got: "${modelEdge?.evidence}"`
  );
  check(
    `Model Edge (totals): delta in "runs" units`,
    (modelEdge?.delta ?? "").includes("runs"),
    `got: "${modelEdge?.delta}"`
  );
}

// ─── Totals splits_consensus: line stored, no fake no-vig ────────────

function testSplitsConsensusTotalNoFakeNoVig() {
  section("Totals splits_consensus: line displays, no fake no-vig");

  // /splits gives the total line but no juice; route emits marketTotal
  // (line value) but marketImpliedPct stays null for totals.
  const totalSplits = baseMarket({
    pick: "Over",
    modelTotal: 9.2,
    marketTotal: 8.5,
    modelProb: null,
    marketImpliedPct: null, // ← honest: no juice in /splits
    marketSource: null,
    marketDataQuality: "single_book", // route emits this when only line, no odds
    pinnacleEvPct: null,
  });
  const rows = buildEdgeStackRows("total", totalSplits);
  const modelEdge = rows.find((r) => r.label === "Model Edge");
  const marketValue = rows.find((r) => r.label === "Market Value");

  // Total line is still displayed via the totals path
  check(
    `Model Edge (totals): uses line values even with no juice`,
    (modelEdge?.evidence ?? "").includes("Model 9.2") &&
      (modelEdge?.evidence ?? "").includes("market 8.5")
  );
  // Market Value should be honest about no price-check data
  check(
    `Market Value: shows "unavailable" when no marketImpliedPct + no EV`,
    marketValue?.evidence === "Market price check" &&
      marketValue?.delta === "unavailable"
  );
}

// ─── Money vs Bets + Line Move unchanged ─────────────────────────────

function testUnchangedRows() {
  section("Money vs Bets + Line Move: unchanged by R-16F-B");

  const withSplits = baseMarket({
    moneyPct: 80,
    betsPct: 30,
    lineOpenAmerican: -110,
    priceAmerican: -120,
    marketImpliedPct: 55,
    marketDataQuality: "splits_consensus",
    marketSource: "splits_consensus",
  });
  const rows = buildEdgeStackRows("moneyline", withSplits);
  const moneyBets = rows.find((r) => r.label === "Money vs Bets");
  const lineMove = rows.find((r) => r.label === "Line Move");

  check(
    `Money vs Bets: evidence unchanged format`,
    (moneyBets?.evidence ?? "").includes("Money 80%") &&
      (moneyBets?.evidence ?? "").includes("Bets 30%")
  );
  check(
    `Line Move: present when both open and current exist`,
    lineMove?.delta !== undefined && lineMove?.evidence !== "Open → Current"
  );
}

// ─── Runner ──────────────────────────────────────────────────────────

async function main() {
  console.log("[test-edge-stack-rows] start");
  testSourceLabelHelper();
  testSplitsConsensusEdgeStack();
  testRealBookPair();
  testPinnacleEvPreserved();
  testTrulyUnavailable();
  testLegacyFairProbFallback();
  testTotalsPathUnchanged();
  testSplitsConsensusTotalNoFakeNoVig();
  testUnchangedRows();

  console.log();
  console.log("━━━ Summary ━━━");
  console.log(`  pass: ${pass}`);
  console.log(`  fail: ${fail}`);
  if (fail > 0) {
    console.log();
    console.log("Failures:");
    for (const f of failures) console.log(f);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
