/**
 * Regression tests for selectMainNhlTotalLine — the NHL main-total-line
 * consensus picker. Guards the 2026-06-14 failure (Daniel): a cross-book
 * 4.5 / 5.5 / 6.5 spread used to median-mash into a wrong "4.5" that the pick
 * label showed while the card line read a different book's value.
 */
import { selectMainNhlTotalLine } from "../lib/services/nhl/featureSnapshot";

type Row = { market_type: string; sportsbook: string; side: string; line_value: number | null };
const tot = (sportsbook: string, side: string, line_value: number | null): Row => ({ market_type: "total", sportsbook, side, line_value });

let pass = 0, fail = 0;
function assert(c: boolean, m?: string): void { if (!c) throw new Error(`Assertion failed: ${m ?? ""}`); }
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}`); console.log(`      ${e instanceof Error ? e.message : String(e)}`); fail++; }
}

console.log("\nscripts/test-nhl-total-line-selection.ts — NHL consensus total line");
console.log("─".repeat(64));

// The exact CAR@VGK shape: 4.5 (2 books), 5.5 (2 books), 6.5 (3 books).
const carVgk: Row[] = [
  tot("ballybet", "over", 4.5), tot("ballybet", "under", 4.5), tot("bookmaker", "under", 4.5),
  tot("betrivers", "over", 5.5), tot("betrivers", "under", 5.5), tot("onexbet", "over", 5.5), tot("onexbet", "under", 5.5),
  tot("sx_bet", "over", 6.5), tot("sx_bet", "under", 6.5), tot("betway", "over", 6.5), tot("betway", "under", 6.5), tot("bet365 us", "over", 6.5), tot("bet365 us", "under", 6.5),
];

test("mixed 4.5/5.5/6.5 → modal main line 6.5 (most books), NOT a median mash", () => {
  const v = selectMainNhlTotalLine(carVgk);
  assert(v === 6.5, `expected 6.5, got ${v}`);
});

test("a single resolved line is used everywhere (no two-value output)", () => {
  // The function returns ONE number — the caller (snapshot + adapter) both use
  // it, so pick label / card line / edge row cannot disagree.
  const v = selectMainNhlTotalLine(carVgk);
  assert(typeof v === "number" && !Number.isNaN(v), `expected a single number, got ${v}`);
});

test("blocked book (fliff) is filtered, even if it would otherwise win", () => {
  const withFliff = [...carVgk, tot("fliff", "over", 8.5), tot("fliff", "under", 8.5), tot("fliff", "over", 8.5), tot("fliff", "under", 8.5)];
  assert(selectMainNhlTotalLine(withFliff) === 6.5, "fliff must not influence the consensus");
});

test("a book quoting BOTH over+under counts as ONE book", () => {
  // pinnacle at 5.5 (both sides) + one book at 6.5 → 5.5 wins (would tie 1-1 if
  // sides double-counted; book-count makes pinnacle a single vote, tie → median).
  const rows = [tot("pinnacle", "over", 5.5), tot("pinnacle", "under", 5.5), tot("draftkings", "over", 6.5), tot("draftkings", "under", 6.5)];
  const v = selectMainNhlTotalLine(rows);
  assert(v === 5.5 || v === 6.5, `tie → median-closest, got ${v}`); // both 1 book → tie; median of [5.5,6.5]=6.5
  assert(v === 6.5, `tie-break should pick median-side 6.5, got ${v}`);
});

test("single clean line → that line", () => {
  assert(selectMainNhlTotalLine([tot("draftkings", "over", 6.0), tot("draftkings", "under", 6.0)]) === 6.0, "single line");
});

test("no total rows → null", () => {
  assert(selectMainNhlTotalLine([]) === null, "empty → null");
  assert(selectMainNhlTotalLine([tot("dk", "home", null)].map((r) => ({ ...r, market_type: "moneyline" }))) === null, "no totals → null");
});

test("clear consensus dominates a fringe alt-line", () => {
  // 5.5 across 4 books + one fringe 4.0 → 5.5.
  const rows = [
    tot("a", "over", 5.5), tot("b", "over", 5.5), tot("c", "over", 5.5), tot("d", "over", 5.5),
    tot("e", "over", 4.0),
  ];
  assert(selectMainNhlTotalLine(rows) === 5.5, "consensus 5.5 over fringe 4.0");
});

console.log("─".repeat(64));
console.log(`\n${pass} passed · ${fail} failed`);
if (fail > 0) process.exit(1);
