/**
 * Tests for lib/services/perMarketCopyGenerator.ts.
 *
 * Strategy: generate copy for every (market × verdict × sharpDirection)
 * combination. Each output:
 *   1. is non-empty
 *   2. passes the banned-terms linter
 *   3. for first_inning, never references public splits / sharps
 *
 * Plus targeted assertions on conditional inserts (modelDriver/riskDriver
 * presence, marketDataLimited phrasing for ML/Total).
 *
 * Run: npx tsx scripts/test-per-market-copy-generator.ts
 */

import {
  generatePerMarketCopy,
  type CopyMarket,
  type CopySharpDirection,
} from "../lib/services/perMarketCopyGenerator";
import {
  findFirstBannedTerm,
} from "../lib/services/bannedTermsLinter";
import type { Verdict } from "../lib/services/verdictDerivation";

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

const ALL_MARKETS: CopyMarket[] = ["moneyline", "total", "first_inning"];
const ALL_VERDICTS: Verdict[] = ["best_angle", "lean", "watchlist", "caution", "no_play"];
const ALL_SHARP_DIRS: CopySharpDirection[] = ["support", "push_against", "none"];

console.log("━━━ Exhaustive (market × verdict × sharpDirection) sweep ━━━");
let sweepCount = 0;
for (const market of ALL_MARKETS) {
  for (const verdict of ALL_VERDICTS) {
    for (const sd of ALL_SHARP_DIRS) {
      sweepCount++;
      const out = generatePerMarketCopy({
        market,
        verdict,
        pick: market === "first_inning" ? "NRFI" : market === "total" ? "Over 8.5" : "KC ML",
        confidence: 0.62,
        sharpDirection: sd,
        modelDriver: "starter ERA edge",
        riskDriver: "weak top-of-order",
        marketDataLimited: false,
      });
      const allFields = [out.guidedGuide, out.guidedWatchOut, out.whyLine, out.riskLine];
      const allNonEmpty = allFields.every((s) => s.trim().length > 0);
      const noBanned = allFields.every((s) => findFirstBannedTerm(s) === null);
      check(
        `${market} × ${verdict} × ${sd}: all 4 fields non-empty and clean`,
        allNonEmpty && noBanned
      );
    }
  }
}
console.log(`  swept ${sweepCount} combinations`);

console.log();
console.log("━━━ First-inning copy never references public splits or sharps ━━━");
for (const verdict of ALL_VERDICTS) {
  for (const sd of ALL_SHARP_DIRS) {
    const out = generatePerMarketCopy({
      market: "first_inning",
      verdict,
      pick: "NRFI",
      confidence: 0.6,
      sharpDirection: sd,
      modelDriver: null,
      riskDriver: null,
      marketDataLimited: true,            // even with this set, first_inning ignores it
    });
    const all = `${out.guidedGuide} ${out.guidedWatchOut} ${out.whyLine} ${out.riskLine}`.toLowerCase();
    const forbidden = ["public split", "public bet", "public money", "handle %", "bet %", "sharp action", "sharp money"];
    const dirty = forbidden.find((token) => all.includes(token));
    check(
      `first_inning (${verdict}, ${sd}): copy does not mention "${forbidden.join(" | ")}"`,
      dirty === undefined,
      dirty ? `contained "${dirty}"` : undefined
    );
  }
}

console.log();
console.log("━━━ modelDriver / riskDriver are inserted when provided ━━━");
const withDrivers = generatePerMarketCopy({
  market: "moneyline",
  verdict: "best_angle",
  pick: "KC ML",
  confidence: 0.66,
  sharpDirection: "support",
  modelDriver: "starter ERA edge",
  riskDriver: "weak bullpen depth",
  marketDataLimited: false,
});
check("whyLine includes modelDriver verbatim", withDrivers.whyLine.includes("starter ERA edge"));
check("riskLine includes riskDriver verbatim", withDrivers.riskLine.includes("weak bullpen depth"));

const noDrivers = generatePerMarketCopy({
  market: "moneyline",
  verdict: "best_angle",
  pick: "KC ML",
  confidence: 0.66,
  sharpDirection: "support",
  modelDriver: null,
  riskDriver: null,
  marketDataLimited: false,
});
check("whyLine has a sensible fallback when modelDriver is null", noDrivers.whyLine.length > 0 && !noDrivers.whyLine.includes("null"));
check("riskLine has a sensible fallback when riskDriver is null", noDrivers.riskLine.length > 0 && !noDrivers.riskLine.includes("null"));

console.log();
console.log("━━━ marketDataLimited phrasing (ML/Total only) ━━━");
const limited = generatePerMarketCopy({
  market: "moneyline",
  verdict: "lean",
  pick: "KC ML",
  confidence: 0.58,
  sharpDirection: "none",
  modelDriver: "starter ERA edge",
  riskDriver: null,
  marketDataLimited: true,
});
check(
  "marketDataLimited triggers 'limited market signal' phrasing",
  limited.guidedWatchOut.includes("limited market signal") || limited.riskLine.includes("limited market")
);

const limitedFI = generatePerMarketCopy({
  market: "first_inning",
  verdict: "lean",
  pick: "NRFI",
  confidence: 0.58,
  sharpDirection: "none",
  modelDriver: "FI starter strength",
  riskDriver: null,
  marketDataLimited: true,            // ignored for first_inning
});
check(
  "first_inning: 'limited market signal' phrasing does NOT appear (first_inning ignores marketDataLimited)",
  !limitedFI.guidedWatchOut.includes("limited market signal")
);

console.log();
console.log("━━━ Sharp support insertions (ML/Total only) ━━━");
const supportML = generatePerMarketCopy({
  market: "moneyline",
  verdict: "best_angle",
  pick: "KC ML",
  confidence: 0.66,
  sharpDirection: "support",
  modelDriver: null,
  riskDriver: null,
  marketDataLimited: false,
});
check(
  "moneyline best_angle + support: copy references market support",
  supportML.guidedGuide.toLowerCase().includes("market support") ||
    supportML.guidedGuide.toLowerCase().includes("same side")
);

const pushAgainstML = generatePerMarketCopy({
  market: "moneyline",
  verdict: "caution",
  pick: "KC ML",
  confidence: 0.66,
  sharpDirection: "push_against",
  modelDriver: null,
  riskDriver: "starter due for regression",
  marketDataLimited: false,
});
check(
  "moneyline caution + push_against: copy frames market action against the pick",
  pushAgainstML.guidedGuide.toLowerCase().includes("the other way") ||
    pushAgainstML.guidedGuide.toLowerCase().includes("pushing")
);

console.log();
console.log("━━━ Sample output spot-check ━━━");
console.log("  moneyline / best_angle / support / drivers present:");
console.log(`    guidedGuide:    "${supportML.guidedGuide}"`);
console.log(`    guidedWatchOut: "${supportML.guidedWatchOut}"`);
console.log(`    whyLine:        "${supportML.whyLine}"`);
console.log(`    riskLine:       "${supportML.riskLine}"`);
console.log("  first_inning / lean / drivers null / marketDataLimited:");
console.log(`    guidedGuide:    "${limitedFI.guidedGuide}"`);
console.log(`    guidedWatchOut: "${limitedFI.guidedWatchOut}"`);
console.log(`    whyLine:        "${limitedFI.whyLine}"`);
console.log(`    riskLine:       "${limitedFI.riskLine}"`);

console.log();
console.log("━━━ Test summary ━━━");
console.log(`  Passed: ${pass}`);
console.log(`  Failed: ${fail}`);
if (fail > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(f);
  process.exit(1);
}
