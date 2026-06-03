/**
 * Tests for lib/services/bannedTermsLinter.ts.
 *
 * Run: npx tsx scripts/test-banned-terms-linter.ts
 */

import {
  assertNoBannedTerms,
  findFirstBannedTerm,
  BannedTermError,
  __TEST__,
} from "../lib/services/bannedTermsLinter";

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

function expectThrows(label: string, fn: () => void) {
  try {
    fn();
    fail++;
    console.log(`  ✗ ${label} — expected throw, got none`);
    failures.push(label);
  } catch (e) {
    if (e instanceof BannedTermError) {
      pass++;
      console.log(`  ✓ ${label} (term=${e.term})`);
    } else {
      fail++;
      console.log(`  ✗ ${label} — wrong error type: ${e}`);
      failures.push(label);
    }
  }
}

console.log("━━━ Banned terms — every pattern fires ━━━");
const examplesByTerm: Record<string, string> = {
  Pinnacle: "Per Pinnacle, the line is sharp.",
  EV: "This is a +EV bet.",                            // matches "+EV"
  "+EV": "Plus EV opportunity here.",                  // also catches "+ EV"
  "expected value": "Strong expected value tonight.",
  vig: "After accounting for vig, the edge is real.",
  vigorish: "Strip out the vigorish first.",
  juice: "Books are charging juice on totals.",
  "no-vig": "The no-vig price is 1.92.",
  "de-vig": "We de-vig the implied probability.",
  consensus: "The consensus market price moved.",
  RLM: "Clear RLM on the under.",
  "reverse line movement": "Strong reverse line movement here.",
  CLV: "Targeting CLV pays off.",
  "closing line value": "Beat the closing line value by 10 cents.",
  "book hold": "The book hold is 4%.",
  arbitrage: "An arbitrage opportunity exists.",
  arb: "Quick arb between two books.",
};

for (const [_term, txt] of Object.entries(examplesByTerm)) {
  expectThrows(`detects banned term in: "${txt}"`, () =>
    assertNoBannedTerms(txt, "test")
  );
}

console.log();
console.log("━━━ Allowed phrasing passes cleanly ━━━");
const allowedPhrases = [
  "Soft lean toward KC ML at 56% confidence.",
  "Strong angle: model has a clean case for the over.",
  "Where it gets less clean: weak top-of-order lineup.",
  "Pittsburgh's bullpen has been a problem in late innings.",
  "Sharper price check shows the model on the same side.",
  "Market value sits with the underdog tonight.",
  "Market support is consistent with the pick.",
  "Line moved against the public — usually a tell.",
  "Driver: starter ERA edge and park factor.",
  "Risk: lineup changes after the post.",
  "Lineup OPS (weighted) — a stat that doesn't trigger.",  // "weight" not in banned list
  "evident effort — this is the every-night routine.",      // "ev" inside "every" should not trigger
  "previously, the line was tighter.",                       // "vig" inside "previously" should not trigger
  "level the playing field.",                                // "ev" inside "level" should not trigger
];

for (const txt of allowedPhrases) {
  check(`passes: "${txt}"`, findFirstBannedTerm(txt) === null);
}

console.log();
console.log("━━━ Case-insensitivity ━━━");
expectThrows("uppercase Pinnacle detected", () =>
  assertNoBannedTerms("PINNACLE confirms.", "test")
);
expectThrows("mixed-case Vig detected", () =>
  assertNoBannedTerms("After accounting for Vig.", "test")
);
expectThrows("RLM (uppercase only — exact case)", () =>
  assertNoBannedTerms("Clear RLM here.", "test")
);

console.log();
console.log("━━━ Error metadata ━━━");
try {
  assertNoBannedTerms("Pinnacle confirms the pick.", "guidedGuide");
  fail++;
  console.log(`  ✗ expected throw`);
} catch (e) {
  if (e instanceof BannedTermError) {
    check("BannedTermError carries fieldName", e.fieldName === "guidedGuide");
    check("BannedTermError carries term", e.term === "Pinnacle");
    check("BannedTermError carries fullText", e.fullText === "Pinnacle confirms the pick.");
  } else {
    fail++;
    console.log(`  ✗ wrong error type`);
  }
}

console.log();
console.log("━━━ Pattern coverage sanity ━━━");
check(
  "BANNED_TERM_PATTERNS exposes at least 16 patterns",
  __TEST__.BANNED_TERM_PATTERNS.length >= 16
);

console.log();
console.log(`━━━ Test summary ━━━`);
console.log(`  Passed: ${pass}`);
console.log(`  Failed: ${fail}`);
if (fail > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(f);
  process.exit(1);
}
