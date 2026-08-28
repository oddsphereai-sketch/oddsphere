/**
 * Phase 6B.13 — tests for the shared pick-relative line move helper.
 *
 * Locks the contract that the compact reader and the expanded Edge
 * Stack share a single tone source. The bug this prevents:
 *   • Favorite -170 → -157 rendered emerald in the expanded view
 *     (raw arrow direction) and amber in the compact reader
 *     (implied-prob direction).
 */

import {
  americanToImpliedProb,
  classifyPickRelativeLineMove,
  lineMoveTone,
  lineMoveArrow,
} from "../app/lab/lib/lineMoveTone";
import { buildEdgeStackRows } from "../app/lab/lib/edgeStackRows";
import type { MarketEdgeDto } from "../app/lab/lib/labTypes";

let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push(`${label}${detail ? ` — ${detail}` : ""}`); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

console.log("━━━ americanToImpliedProb ━━━");
check("null in → null out", americanToImpliedProb(null) === null);
check("zero in → null out", americanToImpliedProb(0) === null);
check("NaN in → null out", americanToImpliedProb(Number.NaN) === null);
check("+100 → 0.5", americanToImpliedProb(100) === 0.5);
check("-100 → 0.5", americanToImpliedProb(-100) === 0.5);
{
  const p = americanToImpliedProb(-170);
  check("-170 → 0.6296 (favorite)", p !== null && Math.abs(p - 0.6296296) < 0.001);
}
{
  const p = americanToImpliedProb(150);
  check("+150 → 0.40 (underdog)", p !== null && Math.abs(p - 0.4) < 0.001);
}

console.log("\n━━━ classifyPickRelativeLineMove — favorites ━━━");
// User's exact example: -170 → -157.
// Favorite's implied prob drops 62.96% → 61.09%. Market is fading us.
// Expected: against → amber.
check(
  "favorite -170 → -157 classified as 'against'",
  classifyPickRelativeLineMove(-170, -157) === "against",
);
check(
  "favorite -170 → -157 tone = amber",
  lineMoveTone(classifyPickRelativeLineMove(-170, -157)) === "amber",
);
check(
  "favorite -170 → -157 arrow = ↘",
  lineMoveArrow(classifyPickRelativeLineMove(-170, -157)) === "↘",
);
// Reverse: -170 → -200 — favorite getting more expensive (market more confident in pick).
check(
  "favorite -170 → -200 classified as 'toward'",
  classifyPickRelativeLineMove(-170, -200) === "toward",
);
check(
  "NRFI -135 → -150 classified as 'toward'",
  classifyPickRelativeLineMove(-135, -150) === "toward",
);
check(
  "favorite -170 → -200 tone = emerald",
  lineMoveTone(classifyPickRelativeLineMove(-170, -200)) === "emerald",
);

console.log("\n━━━ classifyPickRelativeLineMove — underdogs ━━━");
// Underdog +150 → +130: implied prob rises 40% → 43.5%. Market is supporting us.
check(
  "underdog +150 → +130 classified as 'toward'",
  classifyPickRelativeLineMove(150, 130) === "toward",
);
check(
  "underdog +150 → +130 tone = emerald",
  lineMoveTone(classifyPickRelativeLineMove(150, 130)) === "emerald",
);
// Underdog +150 → +180: implied prob falls 40% → 35.7%. Market is fading us.
check(
  "underdog +150 → +180 classified as 'against'",
  classifyPickRelativeLineMove(150, 180) === "against",
);
check(
  "underdog +150 → +180 tone = amber",
  lineMoveTone(classifyPickRelativeLineMove(150, 180)) === "amber",
);

console.log("\n━━━ flat / null handling ━━━");
check("flat — identical prices → flat", classifyPickRelativeLineMove(-150, -150) === "flat");
check("sub-threshold (4 American gap) → flat", classifyPickRelativeLineMove(-150, -146) === "flat");
check("null open → flat", classifyPickRelativeLineMove(null, -150) === "flat");
check("null current → flat", classifyPickRelativeLineMove(-150, null) === "flat");
check("flat tone = gray", lineMoveTone("flat") === "gray");
check("flat arrow = →", lineMoveArrow("flat") === "→");

console.log("\n━━━ buildEdgeStackRows uses shared helper ━━━");
// Build a fake MarketEdgeDto where line move is the user's example
// (favorite -170 → -157). Pre-6B.13 this rendered emerald; post-6B.13
// it must render amber and arrow ↘.
function fakeMarket(overrides: Partial<MarketEdgeDto>): MarketEdgeDto {
  const base: MarketEdgeDto = {
    pick: "BAL",
    confidence: 0.62,
    grade: "lean" as any,
    signalType: null,
    marketSignal: null,
    sharpStatus: "none" as any,
    held: false,
    verdict: { key: "lean" as any, label: "Lean" },
    guidedGuide: "",
    guidedWatchOut: "",
    whyLine: "",
    riskLine: "",
    modelProb: 0.62,
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
    modelTrustPct: 62,
    marketImpliedPct: 55,
    modelMarketGapPct: 7,
    recommendationConfidence: 60,
    marketSource: "ballybet",
    marketDataQuality: "two_sided_consensus",
    reviewFlags: [],
    reviewActionSummary: "keep" as any,
    ...overrides,
  };
  return base;
}

{
  const m = fakeMarket({
    lineOpenAmerican: -170,
    priceAmerican: -157,
  });
  const rows = buildEdgeStackRows("moneyline", m);
  const lineRow = rows.find((r) => r.label === "Line Move");
  check("Line Move row exists", lineRow !== undefined);
  check(
    "Line Move tone = amber for fav -170 → -157",
    lineRow?.tone === "amber",
  );
  check("Line Move arrow = ↘", lineRow?.delta === "↘");
}
{
  const m = fakeMarket({
    lineOpenAmerican: -170,
    priceAmerican: -200,
  });
  const rows = buildEdgeStackRows("moneyline", m);
  const lineRow = rows.find((r) => r.label === "Line Move");
  check(
    "Line Move tone = emerald for fav -170 → -200",
    lineRow?.tone === "emerald",
  );
  check("Line Move arrow = ↗", lineRow?.delta === "↗");
}
{
  const m = fakeMarket({
    lineOpenAmerican: null,
    priceAmerican: -150,
  });
  const rows = buildEdgeStackRows("moneyline", m);
  const lineRow = rows.find((r) => r.label === "Line Move");
  check(
    "Line Move unavailable when open is null",
    lineRow?.delta === "unavailable" && lineRow?.tone === "gray",
  );
}

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log("\n✅ All line move tone tests passed.");
