/**
 * Deterministic unit test for the Key Stats two-sided rendering fix.
 *
 * Regression guard for the ATL@NYM 2026-06-12 bug:
 *   • Lineup OPS with one missing side rendered a dangling unlabeled
 *     number (no team attribution).
 *   • Bullpen Quality vanished entirely when both raw factors were out of
 *     the trusted [0.5, 2.0] range (fmtFactor → null → both-null drop).
 *
 * Pure functions, no DB (keyStatsFormatter imports only bannedTermsLinter).
 * Run: npx tsx scripts/test-keystats-two-sided.ts
 */

import {
  formatKeyStats,
  keyStatIsTwoSided,
  TWO_SIDED_KEY_STAT_LABELS,
  type KeyStatRow,
} from "../lib/services/keyStatsFormatter";

let failures = 0;
function check(name: string, got: unknown, want: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    failures++;
    console.error(`✗ ${name}\n    got:  ${JSON.stringify(got)}\n    want: ${JSON.stringify(want)}`);
  } else {
    console.log(`✓ ${name}`);
  }
}
function rowFor(rows: KeyStatRow[], label: string): KeyStatRow | undefined {
  return rows.find((r) => r.label === label);
}

// ── keyStatIsTwoSided ───────────────────────────────────────────────
check("two-sided label, both present → two-sided", keyStatIsTwoSided("Lineup OPS (weighted)", "0.783", "0.741"), true);
check("two-sided label, away missing → STILL two-sided", keyStatIsTwoSided("Lineup OPS (weighted)", null, "0.809"), true);
check("two-sided label, home missing → STILL two-sided", keyStatIsTwoSided("Starter ERA", "4.00", null), true);
check("two-sided label, both missing → not two-sided", keyStatIsTwoSided("Bullpen quality", null, null), false);
check("non-two-sided label, one present → single", keyStatIsTwoSided("Park factor", null, "+5% runs"), false);
check("Bullpen quality is registered as two-sided", TWO_SIDED_KEY_STAT_LABELS.has("Bullpen quality"), true);

// ── formatKeyStats: ATL@NYM moneyline shape (real values) ───────────
// away lineup OPS null; bullpen factors both below the 0.5 clamp floor.
const atl = formatKeyStats(
  {
    away_starter_era: 4,
    home_starter_era: 3.98,
    away_lineup_weighted_ops: null,
    home_lineup_weighted_ops: 0.8087,
    away_bullpen_factor: 0.47,
    home_bullpen_factor: 0.468,
  },
  "moneyline",
);

const atlOps = rowFor(atl, "Lineup OPS (weighted)");
check("ATL Lineup OPS row present", atlOps !== undefined, true);
check("ATL Lineup OPS away is null (missing → UI shows TEAM —)", atlOps ? atlOps.awayValue : "NO ROW", null);
check("ATL Lineup OPS home value preserved", atlOps?.homeValue, "0.809");

const atlBp = rowFor(atl, "Bullpen quality");
check("ATL Bullpen row NOT dropped (out-of-range → honest —)", atlBp !== undefined, true);
check("ATL Bullpen away out-of-range → —", atlBp?.awayValue, "—");
check("ATL Bullpen home out-of-range → —", atlBp?.homeValue, "—");

// ── formatKeyStats: SEA@WSH stays the normal 3-row two-value shape ───
const sea = formatKeyStats(
  {
    away_starter_era: 1.33,
    home_starter_era: 4.76,
    away_lineup_weighted_ops: 0.783,
    home_lineup_weighted_ops: 0.7409,
    away_bullpen_factor: 0.801,
    home_bullpen_factor: 1,
  },
  "moneyline",
);
check("SEA@WSH has all 3 rows", sea.length, 3);
check("SEA Bullpen away formats normally", rowFor(sea, "Bullpen quality")?.awayValue, "20% better than league avg");
check("SEA Bullpen home formats normally", rowFor(sea, "Bullpen quality")?.homeValue, "league average");

const rookie = formatKeyStats(
  {
    away_starter_era: null,
    home_starter_era: 4.51,
    away_bullpen_factor: 1.01,
    home_bullpen_factor: 1,
  },
  "moneyline",
);
check(
  "mapped starter with no MLB ERA shows an explicit no-record state",
  rowFor(rookie, "Starter ERA")?.awayValue,
  "No MLB ERA on file",
);

// ── Bullpen genuinely absent (both raw null) → row omitted, no fake — ─
const noBp = formatKeyStats(
  {
    away_starter_era: 3.1,
    home_starter_era: 3.4,
    away_lineup_weighted_ops: 0.74,
    home_lineup_weighted_ops: 0.72,
    away_bullpen_factor: null,
    home_bullpen_factor: null,
  },
  "moneyline",
);
check("Bullpen omitted when both factors genuinely null", rowFor(noBp, "Bullpen quality"), undefined);

// ── Static guard: DailyEdgeShell wires the shared two-sided helper ──
// Protects the UI fix (interpretKeyStat) from silently regressing back to
// the single-value fallback. Source-text check — no React import needed.
import { readFileSync } from "node:fs";
const shellSrc = readFileSync("app/lab/components/daily-edge/DailyEdgeShell.tsx", "utf8");
check(
  "shell imports the shared key-stat helpers",
  shellSrc.includes("TWO_SIDED_KEY_STAT_LABELS") && shellSrc.includes("keyStatIsTwoSided"),
  true,
);
check(
  "shell forces two-sided render when one side is missing",
  shellSrc.includes("TWO_SIDED_KEY_STAT_LABELS.has(label)") &&
    /twoSided:\s*true/.test(shellSrc),
  true,
);
check(
  "shell fallback uses keyStatIsTwoSided (not raw both-present check)",
  shellSrc.includes("keyStatIsTwoSided(label, awayValue, homeValue)"),
  true,
);

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nAll Key Stats two-sided assertions passed.");
