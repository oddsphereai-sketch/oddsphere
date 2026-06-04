/**
 * Phase 4.2.C.1.R-16F-D — unit tests for computeMarketImplied
 * (app/lab/lib/marketImplied.ts).
 *
 * Pre-R-16F-D the function had `if (market === "first_inning" ||
 * modelSide === null) return unavailable` — a hard short-circuit that
 * blocked FI no-vig computation even when the lines table had two-sided
 * first_inning_total rows (captured by R-16F-C). R-16F-D removed the
 * first_inning guard while preserving the modelSide=null guard. These
 * tests lock in the new behavior.
 *
 * No DB, no HTTP. Pure helper exercise.
 *
 * Run:
 *   npx tsx scripts/test-market-implied.ts
 */

import {
  computeMarketImplied,
  americanToImplied,
  NO_VIG_BOOK_PRIORITY,
  SPLITS_CONSENSUS_BOOK_NAME,
  type MarketImpliedLineRow,
} from "../app/lab/lib/marketImplied";

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

function line(
  market_type: string,
  sportsbook: string,
  side: string | null,
  odds_american: number | null
): MarketImpliedLineRow {
  return { market_type, sportsbook, side, odds_american };
}

// ─── americanToImplied basic sanity ──────────────────────────────────

function testAmericanToImplied() {
  section("americanToImplied — basic sanity");
  check("+100 → 0.5", americanToImplied(100) === 0.5);
  check("-100 → 0.5", americanToImplied(-100) === 0.5);
  check(
    "+200 → 0.333",
    Math.abs(americanToImplied(200) - 0.333) < 0.001
  );
  check(
    "-200 → 0.667",
    Math.abs(americanToImplied(-200) - 0.667) < 0.001
  );
}

// ─── R-16F-D core: FI no longer auto-unavailable ─────────────────────

function testR16FDFirstInningComputes() {
  section("R-16F-D — first_inning no longer auto-unavailable when sides exist");

  // LAD@ARI-style FI fixture: ballybet two-sided FI odds at line 0.5,
  // model picks YRFI ("over"). Pre-R-16F-D this returned unavailable.
  // Post-fix it must compute a real no-vig number.
  const fiLines: MarketImpliedLineRow[] = [
    line("first_inning_total", "ballybet", "over", -132),
    line("first_inning_total", "ballybet", "under", 102),
    // Distractor: full-game total rows in same payload should NOT pollute
    line("total", "ballybet", "over", -110),
    line("total", "ballybet", "under", -110),
  ];

  // Model picks YRFI → over
  const yrfi = computeMarketImplied(
    "first_inning",
    "first_inning_total",
    fiLines,
    "over",
    null
  );
  check(
    "R-16F-D FI YRFI: pickPct is non-null (not unavailable)",
    yrfi.pickPct !== null
  );
  check(
    "R-16F-D FI YRFI: source = ballybet (not splits_consensus)",
    yrfi.source === "ballybet"
  );
  check(
    "R-16F-D FI YRFI: quality = two_sided_consensus",
    yrfi.quality === "two_sided_consensus"
  );

  // Model picks NRFI → under
  const nrfi = computeMarketImplied(
    "first_inning",
    "first_inning_total",
    fiLines,
    "under",
    null
  );
  check(
    "R-16F-D FI NRFI: pickPct is non-null",
    nrfi.pickPct !== null
  );
  check(
    "R-16F-D FI NRFI: NRFI implied < YRFI implied (market favors YRFI)",
    (nrfi.pickPct ?? 100) < (yrfi.pickPct ?? 0),
    `nrfi=${nrfi.pickPct} yrfi=${yrfi.pickPct}`
  );
  // Sum should equal ~100% after de-vigging
  check(
    "R-16F-D FI: NRFI + YRFI ≈ 100% (de-vigged)",
    Math.abs((nrfi.pickPct ?? 0) + (yrfi.pickPct ?? 0) - 100) < 0.1,
    `sum=${(nrfi.pickPct ?? 0) + (yrfi.pickPct ?? 0)}`
  );
}

// ─── modelSide null guard still holds ────────────────────────────────

function testModelSideNullStillGuards() {
  section("modelSide = null still returns unavailable (held / toss-up)");

  const fiLines: MarketImpliedLineRow[] = [
    line("first_inning_total", "ballybet", "over", -132),
    line("first_inning_total", "ballybet", "under", 102),
  ];
  const heldFi = computeMarketImplied(
    "first_inning",
    "first_inning_total",
    fiLines,
    null,
    null
  );
  check(
    "FI held (modelSide=null) → unavailable even with two-sided lines",
    heldFi.pickPct === null && heldFi.quality === "unavailable"
  );

  const heldMl = computeMarketImplied(
    "moneyline",
    "moneyline",
    [
      line("moneyline", "ballybet", "home", -120),
      line("moneyline", "ballybet", "away", 110),
    ],
    null,
    null
  );
  check(
    "ML held (modelSide=null) → unavailable",
    heldMl.pickPct === null && heldMl.quality === "unavailable"
  );
}

// ─── FI with no FI lines → unavailable (no fabrication) ──────────────

function testFiNoLinesStaysUnavailable() {
  section("FI with no FI lines → unavailable (no /splits fallback for FI)");

  // Only ML + total lines in payload, no first_inning_total.
  const noFiLines: MarketImpliedLineRow[] = [
    line("moneyline", "ballybet", "home", -120),
    line("moneyline", "ballybet", "away", 110),
    line("total", "ballybet", "over", -110),
    line("total", "ballybet", "under", -110),
  ];
  const fi = computeMarketImplied(
    "first_inning",
    "first_inning_total",
    noFiLines,
    "over",
    null
  );
  check(
    "FI quality = unavailable when no first_inning_total rows present",
    fi.quality === "unavailable"
  );
  check("FI pickPct = null", fi.pickPct === null);
}

// ─── FI must NOT use full-game total odds ────────────────────────────

function testFiDoesNotUseFullGameTotalOdds() {
  section("FI must NOT use full-game total odds");

  // Mixed payload: full-game total has odds; FI has zero rows. Even
  // though dbMarket filters by market_type, this anti-regression test
  // confirms no FI result is produced.
  const lines: MarketImpliedLineRow[] = [
    line("total", "ballybet", "over", -110),
    line("total", "ballybet", "under", -110),
  ];
  const fi = computeMarketImplied(
    "first_inning",
    "first_inning_total",
    lines,
    "over",
    null
  );
  check(
    "FI does not borrow full-game total odds",
    fi.pickPct === null && fi.quality === "unavailable"
  );
}

// ─── FI splits_consensus would route through correctly if rows existed
// (R-16E doesn't produce FI splits — /splits has no FI section — but
// the function logic must still work the same way for any provenance) ─

function testFiSplitsConsensusFallback() {
  section("FI splits_consensus path: route flags quality=splits_consensus");

  // Synthetic case — /splits has no FI section, but if a future provider
  // ever synthesized FI splits_consensus rows, the function must label
  // them honestly.
  const lines: MarketImpliedLineRow[] = [
    line("first_inning_total", "splits_consensus", "over", -130),
    line("first_inning_total", "splits_consensus", "under", 105),
  ];
  const fi = computeMarketImplied(
    "first_inning",
    "first_inning_total",
    lines,
    "over",
    null
  );
  check(
    "splits_consensus FI source labeled correctly",
    fi.source === SPLITS_CONSENSUS_BOOK_NAME
  );
  check(
    "splits_consensus FI quality = splits_consensus",
    fi.quality === "splits_consensus"
  );
  check(
    "splits_consensus FI pickPct computed (not unavailable)",
    fi.pickPct !== null
  );
}

// ─── Real book pair always wins over splits_consensus for FI ─────────

function testFiRealBookBeatsSplits() {
  section("FI: real book pair takes priority over splits_consensus");

  // Both a real book and splits_consensus have two-sided FI rows. Real
  // book must win (lower priority for splits_consensus = used only as
  // last resort).
  const lines: MarketImpliedLineRow[] = [
    line("first_inning_total", "ballybet", "over", -130),
    line("first_inning_total", "ballybet", "under", 105),
    line("first_inning_total", "splits_consensus", "over", -150),
    line("first_inning_total", "splits_consensus", "under", 115),
  ];
  const fi = computeMarketImplied(
    "first_inning",
    "first_inning_total",
    lines,
    "over",
    null
  );
  check(
    "FI source = ballybet when real book pair exists",
    fi.source === "ballybet"
  );
  check(
    "FI quality = two_sided_consensus, NOT splits_consensus",
    fi.quality === "two_sided_consensus"
  );
}

// ─── FI single-side returns single_book (no fake no-vig) ─────────────

function testFiSingleSideOnly() {
  section("FI single-side only → single_book (no fabrication)");

  const lines: MarketImpliedLineRow[] = [
    line("first_inning_total", "ballybet", "over", -130),
    // No under side
  ];
  const fi = computeMarketImplied(
    "first_inning",
    "first_inning_total",
    lines,
    "over",
    null
  );
  check(
    "FI single-side: quality = single_book",
    fi.quality === "single_book"
  );
  check("FI single-side: pickPct = null (no fake no-vig)", fi.pickPct === null);
}

// ─── ML / Total behavior unchanged ───────────────────────────────────

function testMlAndTotalUnchanged() {
  section("ML + Total no-vig behavior unchanged");

  const mlLines: MarketImpliedLineRow[] = [
    line("moneyline", "ballybet", "home", -120),
    line("moneyline", "ballybet", "away", 110),
  ];
  const ml = computeMarketImplied("moneyline", "moneyline", mlLines, "home", null);
  check(
    "ML two-sided: produces non-null pickPct + ballybet source",
    ml.pickPct !== null &&
      ml.source === "ballybet" &&
      ml.quality === "two_sided_consensus"
  );

  const totalLines: MarketImpliedLineRow[] = [
    line("total", "ballybet", "over", -110),
    line("total", "ballybet", "under", -110),
  ];
  const tot = computeMarketImplied("total", "total", totalLines, "over", null);
  check(
    "Total two-sided: produces ~50% pickPct (de-vigged from -110/-110)",
    tot.pickPct !== null && Math.abs((tot.pickPct ?? 0) - 50) < 0.1
  );

  // Pinnacle fair fallback for ML when no lines
  const mlPinFair = computeMarketImplied(
    "moneyline",
    "moneyline",
    [],
    "home",
    0.55
  );
  check(
    "ML no lines + pinnacle_fair → quality = pinnacle_only",
    mlPinFair.quality === "pinnacle_only" &&
      mlPinFair.pickPct !== null &&
      Math.abs(mlPinFair.pickPct - 55) < 0.01
  );
}

// ─── F3/F5/3-way ML market_types are not picked up via FI dbMarket ───

function testFiDoesNotPickUpOtherInningMarkets() {
  section("FI does not borrow F3/F5/1st-inning 3-way ML rows");

  // Distractor rows with similar-looking market types — none should be
  // picked up because they don't match dbMarket exactly.
  const lines: MarketImpliedLineRow[] = [
    line("1st_3_innings_total_runs", "ballybet", "over", -130),
    line("1st_3_innings_total_runs", "ballybet", "under", 105),
    line("1st_5_innings_total_runs", "ballybet", "over", -125),
    line("1st_5_innings_total_runs", "ballybet", "under", 110),
    line("1st_inning_moneyline_3-way", "ballybet", "home", 150),
    line("1st_inning_moneyline_3-way", "ballybet", "away", 200),
  ];
  const fi = computeMarketImplied(
    "first_inning",
    "first_inning_total",
    lines,
    "over",
    null
  );
  check(
    "FI ignores F3/F5/3-way ML rows when no first_inning_total rows present",
    fi.quality === "unavailable" && fi.pickPct === null
  );
}

// ─── NO_VIG_BOOK_PRIORITY: splits_consensus is last ──────────────────

function testBookPriorityOrdering() {
  section("NO_VIG_BOOK_PRIORITY: splits_consensus stays last");
  check(
    "splits_consensus is the last entry in priority list",
    NO_VIG_BOOK_PRIORITY[NO_VIG_BOOK_PRIORITY.length - 1] === "splits_consensus"
  );
  check(
    "pinnacle is first in priority",
    NO_VIG_BOOK_PRIORITY[0] === "pinnacle"
  );
}

// ─── Runner ──────────────────────────────────────────────────────────

async function main() {
  console.log("[test-market-implied] start");
  testAmericanToImplied();
  testR16FDFirstInningComputes();
  testModelSideNullStillGuards();
  testFiNoLinesStaysUnavailable();
  testFiDoesNotUseFullGameTotalOdds();
  testFiSplitsConsensusFallback();
  testFiRealBookBeatsSplits();
  testFiSingleSideOnly();
  testMlAndTotalUnchanged();
  testFiDoesNotPickUpOtherInningMarkets();
  testBookPriorityOrdering();

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
