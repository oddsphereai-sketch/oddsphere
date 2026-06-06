/**
 * Push 2 tests — market-coverage classifier (fixture only).
 *
 * Tests the pure classification helpers exported from
 * marketCoverageAudit. The full auditMarketCoverage(opts) function
 * touches Supabase + SharpAPI so it's covered by the operator
 * dry-run, not by this unit test.
 */

import { __classifyDbMarketForTests as classifyDbMarket } from "../lib/services/marketCoverageAudit";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

type FixtureRow = { market_type: string; sportsbook: string; side: string; line_value: number | null };

// ── ML coverage classification ────────────────────────────────────
console.log("━━━ classifyDbMarket — moneyline ━━━");
{
  const empty: FixtureRow[] = [];
  const s = classifyDbMarket(empty, "moneyline");
  check("empty rows → rowCount=0, twoSided=false", s.rowCount === 0 && s.twoSided === false);
  check("empty rows → bookQuality='unknown'", s.bookQuality === "unknown");
}
{
  const oneSided: FixtureRow[] = [
    { market_type: "moneyline", sportsbook: "saba", side: "home", line_value: null },
  ];
  const s = classifyDbMarket(oneSided, "moneyline");
  check("1 saba home → rowCount=1, twoSided=false", s.rowCount === 1 && s.twoSided === false);
  check("1 saba (no away) → bookQuality='normal'", s.bookQuality === "normal");
}
{
  const twoSidedSameBook: FixtureRow[] = [
    { market_type: "moneyline", sportsbook: "saba", side: "home", line_value: null },
    { market_type: "moneyline", sportsbook: "saba", side: "away", line_value: null },
  ];
  const s = classifyDbMarket(twoSidedSameBook, "moneyline");
  check("saba home+away → rowCount=2, twoSided=true", s.rowCount === 2 && s.twoSided === true);
}
{
  const splitAcrossBooks: FixtureRow[] = [
    { market_type: "moneyline", sportsbook: "saba", side: "home", line_value: null },
    { market_type: "moneyline", sportsbook: "fliff", side: "away", line_value: null },
  ];
  const s = classifyDbMarket(splitAcrossBooks, "moneyline");
  check("split across saba+fliff → twoSided=false (de-vig needs same book)", s.twoSided === false);
  check("split across saba+fliff → bookQuality='normal'", s.bookQuality === "normal");
}
{
  const dkPlusKalshi: FixtureRow[] = [
    { market_type: "moneyline", sportsbook: "draftkings", side: "home", line_value: null },
    { market_type: "moneyline", sportsbook: "draftkings", side: "away", line_value: null },
    { market_type: "moneyline", sportsbook: "kalshi", side: "home", line_value: null },
    { market_type: "moneyline", sportsbook: "kalshi", side: "away", line_value: null },
  ];
  const s = classifyDbMarket(dkPlusKalshi, "moneyline");
  check("DK + Kalshi both two-sided → bookQuality='high' (DK wins)", s.bookQuality === "high");
  check("DK + Kalshi → twoSided=true", s.twoSided === true);
}

// ── Total coverage classification ──────────────────────────────────
console.log("\n━━━ classifyDbMarket — total (over/under) ━━━");
{
  const twoSided: FixtureRow[] = [
    { market_type: "total", sportsbook: "ballybet", side: "over", line_value: 7.5 },
    { market_type: "total", sportsbook: "ballybet", side: "under", line_value: 7.5 },
  ];
  const s = classifyDbMarket(twoSided, "total");
  check("over+under same book → twoSided=true", s.twoSided === true);
}
{
  const onlyOver: FixtureRow[] = [
    { market_type: "total", sportsbook: "saba", side: "over", line_value: 8.5 },
  ];
  const s = classifyDbMarket(onlyOver, "total");
  check("only over, no under → twoSided=false (one_sided_market_only)", s.twoSided === false);
}

// ── Spread classification ──────────────────────────────────────────
console.log("\n━━━ classifyDbMarket — spread (home/away) ━━━");
{
  const twoSided: FixtureRow[] = [
    { market_type: "spread", sportsbook: "fliff", side: "home", line_value: -1.5 },
    { market_type: "spread", sportsbook: "fliff", side: "away", line_value: 1.5 },
  ];
  const s = classifyDbMarket(twoSided, "spread");
  check("spread home+away same book → twoSided=true", s.twoSided === true);
}

// ── FI classification ──────────────────────────────────────────────
console.log("\n━━━ classifyDbMarket — first_inning_total ━━━");
{
  const twoSided: FixtureRow[] = [
    { market_type: "first_inning_total", sportsbook: "saba", side: "over", line_value: 0.5 },
    { market_type: "first_inning_total", sportsbook: "saba", side: "under", line_value: 0.5 },
  ];
  const s = classifyDbMarket(twoSided, "first_inning_total");
  check("FI over+under → twoSided=true", s.twoSided === true);
}

// ── Cross-market isolation (the property that prevents NRFI from blocking ML) ──
console.log("\n━━━ Cross-market isolation — missing FI must not affect ML ━━━");
{
  const mlOnly: FixtureRow[] = [
    { market_type: "moneyline", sportsbook: "draftkings", side: "home", line_value: null },
    { market_type: "moneyline", sportsbook: "draftkings", side: "away", line_value: null },
  ];
  const mlState = classifyDbMarket(mlOnly, "moneyline");
  const fiState = classifyDbMarket(mlOnly, "first_inning_total");
  check("ML state independent of FI absence → ML twoSided=true", mlState.twoSided === true);
  check("FI absence preserved → FI rowCount=0", fiState.rowCount === 0);
  check("FI absent doesn't downgrade ML quality → ML bookQuality='high'", mlState.bookQuality === "high");
}

// ── books list dedupe ──────────────────────────────────────────────
console.log("\n━━━ books list — dedupe ━━━");
{
  const dup: FixtureRow[] = [
    { market_type: "moneyline", sportsbook: "saba", side: "home", line_value: null },
    { market_type: "moneyline", sportsbook: "saba", side: "away", line_value: null },
    { market_type: "moneyline", sportsbook: "saba", side: "home", line_value: null }, // duplicate row, same key
  ];
  const s = classifyDbMarket(dup, "moneyline");
  check("duplicate rows → books.length === 1", s.books.length === 1);
  check("books contains 'saba'", s.books.includes("saba"));
}

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log("\n✅ All market coverage audit tests passed.");
