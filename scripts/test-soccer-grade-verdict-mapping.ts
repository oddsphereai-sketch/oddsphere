/**
 * Deterministic unit test for the WC grade-casing fix.
 *
 * Regression guard for the P0 stabilization (2026-06-12): the soccer
 * writer persists Title-Case grades ("Watchlist", "Lean", "Caution",
 * "Best Angle") but the adapter's gradeToVerdict only matched snake_case,
 * so every valid graded row fell through to No Play. These assertions pin
 * the normalized mapping so the bug cannot silently return.
 *
 * Pure-function assertions. The adapter module eagerly constructs a
 * Supabase client at import time, so we load .env.local and dynamic-import
 * after — the DB is never queried by these tests.
 *
 * Run: npx tsx scripts/test-soccer-grade-verdict-mapping.ts
 */

import { readFileSync } from "node:fs";

const envFile = readFileSync(".env.local", "utf8");
for (const line of envFile.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}

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

async function main() {
  const { gradeToVerdict, normalizeGradeKey } = await import(
    "../lib/services/soccer/buildSoccerDailyEdgeAdapted"
  );

  // normalizeGradeKey — handles Title Case + spaces + whitespace + null.
  check("normalize 'Watchlist'", normalizeGradeKey("Watchlist"), "watchlist");
  check("normalize 'Lean'", normalizeGradeKey("Lean"), "lean");
  check("normalize 'Caution'", normalizeGradeKey("Caution"), "caution");
  check("normalize 'Best Angle'", normalizeGradeKey("Best Angle"), "best_angle");
  check("normalize already-snake 'best_angle'", normalizeGradeKey("best_angle"), "best_angle");
  check("normalize '  Caution  ' (trim)", normalizeGradeKey("  Caution  "), "caution");
  check("normalize null", normalizeGradeKey(null), null);
  check("normalize '' (empty)", normalizeGradeKey(""), null);

  // Test 1-3: Title Case grades map to the right verdict for NON-held rows.
  check("Watchlist → watchlist", gradeToVerdict("Watchlist", false), { key: "watchlist", label: "Watchlist" });
  check("Lean → lean", gradeToVerdict("Lean", false), { key: "lean", label: "Lean" });
  check("Caution → caution", gradeToVerdict("Caution", false), { key: "caution", label: "Caution" });

  // Best Angle mapping reflects the stored grade (WC model downgrades Best
  // Angle → Lean upstream under external_priors_only, so this branch is not
  // reachable for WC; mapping it here does NOT unlock anything new).
  check("Best Angle → best_angle", gradeToVerdict("Best Angle", false), { key: "best_angle", label: "Best Angle" });

  // Test 4: a valid non-held Watchlist row must NOT become No Play.
  check("non-held Watchlist is not No Play", gradeToVerdict("Watchlist", false).key !== "no_play", true);

  // True blockers still win: held rows show Held regardless of grade.
  check("held Caution → Held", gradeToVerdict("Caution", true), { key: "no_play", label: "Held" });
  check("held Watchlist → Held", gradeToVerdict("Watchlist", true), { key: "no_play", label: "Held" });

  // Unknown / null grade falls back to No Play (non-held).
  check("null grade → No Play", gradeToVerdict(null, false), { key: "no_play", label: "No Play" });
  check("unknown grade → No Play", gradeToVerdict("garbage", false), { key: "no_play", label: "No Play" });

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll grade-verdict mapping assertions passed.");
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("ERROR", e);
  process.exit(1);
});
