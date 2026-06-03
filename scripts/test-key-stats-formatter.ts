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

// Full happy-path fixture — every relevant field populated
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
console.log("━━━ First-inning: full fixture ━━━");
{
  const rows = formatKeyStats(FULL, "first_inning");
  check("returns exactly 3 rows", rows.length === 3);
  check("row 1 = 'Projected 1st-inning runs'", rows[0]?.label === "Projected 1st-inning runs");
  check("row 1 home = '0.85'", rows[0]?.homeValue === "0.85");
  check("row 2 = 'Top-of-order data'", rows[1]?.label === "Top-of-order data");
  check("row 2 home = 'Available'", rows[1]?.homeValue === "Available");
  check("row 3 = 'Starter ERA'", rows[2]?.label === "Starter ERA");
}

console.log();
console.log("━━━ Top-of-order false → 'Unavailable' ━━━");
{
  const rows = formatKeyStats({ ...FULL, nrfi_used_top_of_order_data: false }, "first_inning");
  const topOrderRow = rows.find((r) => r.label === "Top-of-order data");
  check("top-of-order=false → 'Unavailable'", topOrderRow?.homeValue === "Unavailable");
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
