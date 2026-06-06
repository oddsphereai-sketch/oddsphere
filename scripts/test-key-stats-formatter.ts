/**
 * Tests for lib/services/keyStatsFormatter.ts.
 *
 * Uses fixture auto_factors objects that mirror real sport_specific.auto_factors
 * data (per 4.1.9.B probe results) — both happy-path and degraded cases.
 *
 * Run: npx tsx scripts/test-key-stats-formatter.ts
 */

import { formatKeyStats } from "../lib/services/keyStatsFormatter";

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

// Full happy-path fixture — every relevant field populated. Includes
// the FI-specific keys added 2026-06-02 (FI ERA / FI starts / FI WHIP /
// top-order OPS / starter throws) so the first-inning happy path shows
// real model-consumed stats instead of falling back to season ERA.
const FULL = {
  home_starter_era: 3.42,
  away_starter_era: 4.18,
  home_starter_era_factor: 0.92,
  away_starter_era_factor: 1.13,
  home_lineup_weighted_ops: 0.741,
  away_lineup_weighted_ops: 0.683,
  home_lineup_ops_factor_adjusted: 1.08,
  away_lineup_ops_factor_adjusted: 0.97,
  home_bullpen_factor: 1.12,
  away_bullpen_factor: 0.95,
  park_factor_runs: 1.08,
  weather_total_adjust: -0.35,
  nrfi_expected_runs: 0.85,
  nrfi_used_top_of_order_data: true,
  // FI-specific (sufficient sample on both sides)
  home_first_inning_era: 2.85,
  away_first_inning_era: 3.91,
  home_first_inning_starts: 10,
  away_first_inning_starts: 12,
  home_first_inning_whip: 1.05,
  away_first_inning_whip: 1.32,
  home_top_order_ops: 0.852,
  away_top_order_ops: 0.711,
  home_starter_throws: "R",
  away_starter_throws: "L",
};

console.log("━━━ Moneyline: full fixture ━━━");
{
  const rows = formatKeyStats(FULL, "moneyline");
  check("returns exactly 3 rows", rows.length === 3);
  check("row 1 label = 'Starter ERA'", rows[0]?.label === "Starter ERA");
  check("row 1 away = '4.18'", rows[0]?.awayValue === "4.18");
  check("row 1 home = '3.42'", rows[0]?.homeValue === "3.42");
  check("row 2 label = 'Lineup OPS (weighted)'", rows[1]?.label === "Lineup OPS (weighted)");
  check("row 2 away = '0.683'", rows[1]?.awayValue === "0.683");
  check("row 2 home = '0.741'", rows[1]?.homeValue === "0.741");
  check("row 3 label = 'Bullpen quality'", rows[2]?.label === "Bullpen quality");
  check("row 3 home (factor 1.12) → '12% worse than league avg'", rows[2]?.homeValue === "12% worse than league avg");
  check("row 3 away (factor 0.95) → '5% better than league avg'", rows[2]?.awayValue === "5% better than league avg");
}

console.log();
console.log("━━━ Total: full fixture ━━━");
{
  const rows = formatKeyStats(FULL, "total");
  check("returns exactly 3 rows", rows.length === 3);
  check("row 1 = 'Park factor'", rows[0]?.label === "Park factor");
  check("row 1 home (1.08) → '+8% runs'", rows[0]?.homeValue === "+8% runs");
  check("row 2 = 'Weather adjust'", rows[1]?.label === "Weather adjust");
  check("row 2 home (-0.35) → '-0.3 runs' or similar", rows[1]?.homeValue === "-0.3 runs" || rows[1]?.homeValue === "-0.4 runs");
  check("row 3 = 'Lineup vs starter'", rows[2]?.label === "Lineup vs starter");
  check("row 3 away (0.97) → '3% weaker than league avg'", rows[2]?.awayValue === "3% weaker than league avg");
  check("row 3 home (1.08) → '8% stronger than league avg'", rows[2]?.homeValue === "8% stronger than league avg");
}

console.log();
console.log("━━━ First-inning: full fixture (FI stats present, all above sample gate) ━━━");
{
  const rows = formatKeyStats(FULL, "first_inning");
  // 4 rows: Projected runs, FI ERA, FI WHIP, Top-of-order OPS. Season
  // ERA fallback is NOT shown because real FI ERA is present.
  check("returns exactly 4 rows", rows.length === 4);
  check("row 1 = 'Projected 1st-inning runs'", rows[0]?.label === "Projected 1st-inning runs");
  // Phase 6B.1.6j — Projected runs now labels as "<value> combined".
  check("row 1 home = '0.85 combined'", rows[0]?.homeValue === "0.85 combined");
  check("row 2 = 'Starter 1st-inning ERA'", rows[1]?.label === "Starter 1st-inning ERA");
  check("row 2 home shows value + starts footnote", rows[1]?.homeValue === "2.85 (10 starts)");
  check("row 2 away shows value + starts footnote", rows[1]?.awayValue === "3.91 (12 starts)");
  check("row 3 = 'Starter 1st-inning WHIP'", rows[2]?.label === "Starter 1st-inning WHIP");
  check("row 3 home shows WHIP + starts footnote", rows[2]?.homeValue === "1.05 (10 starts)");
  check("row 3 away shows WHIP + starts footnote", rows[2]?.awayValue === "1.32 (12 starts)");
  check("row 4 = 'Top-of-order OPS'", rows[3]?.label === "Top-of-order OPS");
  // home_top_order_ops 0.852 faces away starter throws=L → "vs LHP"
  check("row 4 home shows OPS + handedness context", rows[3]?.homeValue === "0.852 vs LHP");
  // away_top_order_ops 0.711 faces home starter throws=R → "vs RHP"
  check("row 4 away shows OPS + handedness context", rows[3]?.awayValue === "0.711 vs RHP");
  // Critical: no "Starter ERA" season row when FI ERA is present
  check("no fallback 'Starter ERA (season)' row when FI ERA present",
    !rows.some((r) => r.label === "Starter ERA (season)"));
}

console.log();
console.log("━━━ First-inning: thin-sample FI stats (starts < 3 gate) ━━━");
{
  const thin = {
    ...FULL,
    home_first_inning_starts: 2,
    away_first_inning_starts: 1,
  };
  const rows = formatKeyStats(thin, "first_inning");
  const eraRow = rows.find((r) => r.label === "Starter 1st-inning ERA");
  const whipRow = rows.find((r) => r.label === "Starter 1st-inning WHIP");
  check("thin-sample ERA home shows 'thin sample' badge",
    eraRow?.homeValue === "2.85 (thin sample · 2 starts)");
  check("thin-sample ERA away shows 'thin sample · 1 start' (singular)",
    eraRow?.awayValue === "3.91 (thin sample · 1 start)");
  check("thin-sample WHIP home shows 'thin sample' badge",
    whipRow?.homeValue === "1.05 (thin sample · 2 starts)");
}

console.log();
console.log("━━━ First-inning: missing FI data → falls back to full-season Starter ERA ━━━");
{
  // Strip all FI ERA/WHIP fields. Top-order OPS is also stripped to
  // simulate the "no FI data at all" worst case.
  const noFi = {
    ...FULL,
    home_first_inning_era: null,
    away_first_inning_era: null,
    home_first_inning_starts: null,
    away_first_inning_starts: null,
    home_first_inning_whip: null,
    away_first_inning_whip: null,
    home_top_order_ops: null,
    away_top_order_ops: null,
  };
  const rows = formatKeyStats(noFi, "first_inning");
  // Only 2 rows: Projected runs (still derived from nrfi_expected_runs)
  // + fallback "Starter ERA (season)" row.
  check("missing FI data → exactly 2 rows", rows.length === 2);
  check("row 1 = 'Projected 1st-inning runs'", rows[0]?.label === "Projected 1st-inning runs");
  check("row 2 = 'Starter ERA (season)' fallback fires", rows[1]?.label === "Starter ERA (season)");
  check("season ERA row shows full-season values",
    rows[1]?.homeValue === "3.42" && rows[1]?.awayValue === "4.18");
  check("no 'Starter 1st-inning ERA' row when FI data missing",
    !rows.some((r) => r.label === "Starter 1st-inning ERA"));
  check("no 'Starter 1st-inning WHIP' row when FI data missing",
    !rows.some((r) => r.label === "Starter 1st-inning WHIP"));
  check("no 'Top-of-order OPS' row when no OPS data",
    !rows.some((r) => r.label === "Top-of-order OPS"));
}

console.log();
console.log("━━━ First-inning: one starter has FI data, other does not ━━━");
{
  const mixed = {
    ...FULL,
    away_first_inning_era: null,
    away_first_inning_starts: null,
    away_first_inning_whip: null,
  };
  const rows = formatKeyStats(mixed, "first_inning");
  const eraRow = rows.find((r) => r.label === "Starter 1st-inning ERA");
  const whipRow = rows.find((r) => r.label === "Starter 1st-inning WHIP");
  check("ERA row still shown when only one side has data",
    eraRow !== undefined);
  // Phase 6B.1.6j — missing side carries an explicit "no FI sample"
  // sentinel so the renderer shows the team abbreviation alongside it
  // instead of dropping the team label entirely.
  check("ERA home value shown, away gets explicit 'no FI sample' sentinel",
    eraRow?.homeValue === "2.85 (10 starts)" && eraRow?.awayValue === "no FI sample");
  check("WHIP row still shown when only one side has data",
    whipRow !== undefined);
  check("WHIP home value shown, away gets 'no FI sample' sentinel",
    whipRow?.homeValue === "1.05 (10 starts)" && whipRow?.awayValue === "no FI sample");
  // Season ERA fallback should NOT fire — at least one side has FI ERA
  check("no season-ERA fallback when one side has FI data",
    !rows.some((r) => r.label === "Starter ERA (season)"));
}

console.log();
console.log("━━━ First-inning: top-order OPS without starter throws (no handedness context) ━━━");
{
  const noThrows = {
    ...FULL,
    home_starter_throws: null,
    away_starter_throws: null,
  };
  const rows = formatKeyStats(noThrows, "first_inning");
  const topRow = rows.find((r) => r.label === "Top-of-order OPS");
  check("top OPS home shows raw value, no handedness context",
    topRow?.homeValue === "0.852");
  check("top OPS away shows raw value, no handedness context",
    topRow?.awayValue === "0.711");
}

console.log();
console.log("━━━ First-inning: nrfi_used_top_of_order_data flag no longer surfaces as a row ━━━");
{
  // The legacy "Top-of-order data: Available" row is gone. Confirm
  // that toggling the boolean flag has zero effect on the rendered
  // rows now that we show actual top-order OPS values.
  const withFlag = formatKeyStats(FULL, "first_inning");
  const noFlag = formatKeyStats({ ...FULL, nrfi_used_top_of_order_data: false }, "first_inning");
  check("'Top-of-order data' label no longer in output",
    !withFlag.some((r) => r.label === "Top-of-order data"));
  check("toggling boolean flag does not change rendered row count",
    withFlag.length === noFlag.length);
}

console.log();
console.log("━━━ Beginner formatting: neutral factors ━━━");
{
  const rows = formatKeyStats({ ...FULL, park_factor_runs: 1.0 }, "total");
  const park = rows.find((r) => r.label === "Park factor");
  check("factor 1.0 → 'neutral'", park?.homeValue === "neutral");
}
{
  const rows = formatKeyStats({ ...FULL, weather_total_adjust: 0.02 }, "total");
  const w = rows.find((r) => r.label === "Weather adjust");
  check("weather |v|<0.05 → 'neutral'", w?.homeValue === "neutral");
}

console.log();
console.log("━━━ Missing data drops rows ━━━");
{
  // Moneyline: only starter ERA present, lineup + bullpen missing
  const partial = {
    home_starter_era: 3.42,
    away_starter_era: 4.18,
    // lineup / bullpen fields absent
  };
  const rows = formatKeyStats(partial, "moneyline");
  check("only 1 row available → returns [] (fewer than 2)", rows.length === 0);
}
{
  // Moneyline: 2 rows available — keep both
  const partial = {
    home_starter_era: 3.42,
    away_starter_era: 4.18,
    home_lineup_weighted_ops: 0.741,
    away_lineup_weighted_ops: 0.683,
  };
  const rows = formatKeyStats(partial, "moneyline");
  check("2 rows available → returns both (not 3)", rows.length === 2);
}

console.log();
console.log("━━━ Null/undefined auto_factors ━━━");
check("null autoFactors → []", formatKeyStats(null, "moneyline").length === 0);
check("undefined autoFactors → []", formatKeyStats(undefined, "moneyline").length === 0);
check("empty object → []", formatKeyStats({}, "moneyline").length === 0);

console.log();
console.log("━━━ Raw multipliers never appear in output ━━━");
{
  const rows = formatKeyStats(FULL, "total");
  const allValues = rows.flatMap((r) => [r.awayValue ?? "", r.homeValue ?? ""]).join(" ");
  // A raw multiplier like "1.08" or "0.95" would only appear if formatting failed.
  // Allowed in ERA / OPS rows; those are in moneyline/first_inning, not total.
  check("total rows do not contain raw '1.08'", !allValues.includes("1.08"));
  check("total rows do not contain raw '0.95'", !allValues.includes("0.95"));
}

console.log();
console.log("━━━ Sample output dump (for visual review) ━━━");
console.log("  moneyline:", JSON.stringify(formatKeyStats(FULL, "moneyline"), null, 0));
console.log("  total:    ", JSON.stringify(formatKeyStats(FULL, "total"), null, 0));
console.log("  first_inning:", JSON.stringify(formatKeyStats(FULL, "first_inning"), null, 0));

console.log();
console.log("━━━ Test summary ━━━");
console.log(`  Passed: ${pass}`);
console.log(`  Failed: ${fail}`);
if (fail > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(f);
  process.exit(1);
}
