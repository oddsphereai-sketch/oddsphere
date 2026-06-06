/**
 * Push 2 tests — SharpAPI event_id candidate generator.
 *
 * Locks the 2026-06-06 regression fixtures (SF@CHC + TB@MIA) in unit
 * tests so the next time discovery misses a game, candidate generation
 * is provably correct without a live SharpAPI hit.
 */

import {
  generateMlbEventIdCandidates,
} from "../lib/providers/real_api/sharpApiEventIdCandidates";

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

console.log("━━━ SF@CHC 2026-06-06 fixture (THE regression that motivated Push 2) ━━━");
{
  const ids = generateMlbEventIdCandidates("CHC", "SF", "2026-06-06");
  check(
    "includes mlb_cubs_giants_2026-06-06_b3 (the variant SharpAPI actually publishes)",
    ids.includes("mlb_cubs_giants_2026-06-06_b3"),
  );
  check(
    "includes mlb_cubs_giants_2026-06-06_b0 (alt bucket)",
    ids.includes("mlb_cubs_giants_2026-06-06_b0"),
  );
  check(
    "includes mlb_giants_cubs_2026-06-06_b3 (reverse order)",
    ids.includes("mlb_giants_cubs_2026-06-06_b3"),
  );
  check(
    "includes mlb_giants_cubs_2026-06-06_b0 (reverse order, alt bucket)",
    ids.includes("mlb_giants_cubs_2026-06-06_b0"),
  );
  check(
    "exactly 4 candidates for single-word mascot matchup",
    ids.length === 4,
    `got ${ids.length}: ${ids.join(", ")}`,
  );
}

console.log("\n━━━ TB@MIA 2026-06-06 fixture (Push 1 B1 second recovery) ━━━");
{
  const ids = generateMlbEventIdCandidates("MIA", "TB", "2026-06-06");
  check(
    "includes mlb_marlins_rays_2026-06-06_b3 (the variant SharpAPI actually publishes)",
    ids.includes("mlb_marlins_rays_2026-06-06_b3"),
  );
  check(
    "includes mlb_rays_marlins_2026-06-06_b3 (reverse order)",
    ids.includes("mlb_rays_marlins_2026-06-06_b3"),
  );
  check(
    "exactly 4 candidates for single-word mascot matchup",
    ids.length === 4,
  );
}

console.log("\n━━━ Multi-word mascot expansion (BOS @ NYY) ━━━");
{
  const ids = generateMlbEventIdCandidates("NYY", "BOS", "2026-06-06");
  check("includes mlb_yankees_red_sox_2026-06-06_b0", ids.includes("mlb_yankees_red_sox_2026-06-06_b0"));
  check("includes mlb_yankees_red_sox_2026-06-06_b3", ids.includes("mlb_yankees_red_sox_2026-06-06_b3"));
  check("includes mlb_yankees_redsox_2026-06-06_b0 (concatenated variant)", ids.includes("mlb_yankees_redsox_2026-06-06_b0"));
  check("includes mlb_yankees_redsox_2026-06-06_b3 (concatenated variant)", ids.includes("mlb_yankees_redsox_2026-06-06_b3"));
  check("includes mlb_red_sox_yankees_2026-06-06_b3 (reverse order)", ids.includes("mlb_red_sox_yankees_2026-06-06_b3"));
  check("includes mlb_redsox_yankees_2026-06-06_b3 (reverse order, concatenated)", ids.includes("mlb_redsox_yankees_2026-06-06_b3"));
  check("8 candidates when one team has 2 mascot variants", ids.length === 8, `got ${ids.length}`);
}

console.log("\n━━━ Multi-word × Multi-word (BOS @ TOR) ━━━");
{
  const ids = generateMlbEventIdCandidates("TOR", "BOS", "2026-06-06");
  check("includes mlb_blue_jays_red_sox_2026-06-06_b3", ids.includes("mlb_blue_jays_red_sox_2026-06-06_b3"));
  check("includes mlb_blue_jays_redsox_2026-06-06_b3", ids.includes("mlb_blue_jays_redsox_2026-06-06_b3"));
  check("includes mlb_bluejays_red_sox_2026-06-06_b3", ids.includes("mlb_bluejays_red_sox_2026-06-06_b3"));
  check("includes mlb_bluejays_redsox_2026-06-06_b3", ids.includes("mlb_bluejays_redsox_2026-06-06_b3"));
  check("16 candidates when both teams have 2 mascot variants", ids.length === 16, `got ${ids.length}`);
}

console.log("\n━━━ CWS @ CHC (same city different mascots) ━━━");
{
  const ids = generateMlbEventIdCandidates("CHC", "CWS", "2026-06-06");
  check("includes mlb_cubs_white_sox_2026-06-06_b3", ids.includes("mlb_cubs_white_sox_2026-06-06_b3"));
  check("includes mlb_cubs_whitesox_2026-06-06_b3", ids.includes("mlb_cubs_whitesox_2026-06-06_b3"));
  check("8 candidates (1 home × 2 away mascots × 2 orderings × 2 buckets)", ids.length === 8);
}

console.log("\n━━━ Determinism ━━━");
{
  const a = generateMlbEventIdCandidates("CHC", "SF", "2026-06-06");
  const b = generateMlbEventIdCandidates("CHC", "SF", "2026-06-06");
  check("same inputs produce same ordered output", JSON.stringify(a) === JSON.stringify(b));
}

console.log("\n━━━ Date format validation ━━━");
{
  let threw = false;
  try { generateMlbEventIdCandidates("CHC", "SF", "2026/06/06"); }
  catch { threw = true; }
  check("rejects YYYY/MM/DD", threw);

  threw = false;
  try { generateMlbEventIdCandidates("CHC", "SF", "2026-6-6"); }
  catch { threw = true; }
  check("rejects YYYY-M-D (single-digit)", threw);

  threw = false;
  try { generateMlbEventIdCandidates("CHC", "SF", ""); }
  catch { threw = true; }
  check("rejects empty string", threw);
}

console.log("\n━━━ All abbreviations resolve to >=1 candidate ━━━");
{
  const abbrevs = [
    "ARI","ATH","ATL","BAL","BOS","CHC","CWS","CIN","CLE","COL",
    "DET","HOU","KC","LAA","LAD","MIA","MIL","MIN","NYM","NYY",
    "OAK","PHI","PIT","SD","SEA","SF","STL","TB","TEX","TOR","WSH",
  ] as const;
  // OAK and ATH are the same franchise (post-relocation alias) and
  // share the "athletics" mascot — they would never play each other
  // and the generator correctly dedupes their cross-pair down to 2.
  // Skip that pair from the >=4 candidate assertion.
  const SAME_FRANCHISE_ALIAS_PAIRS = new Set<string>(["OAK::ATH", "ATH::OAK"]);
  for (const home of abbrevs) {
    for (const away of abbrevs) {
      if (home === away) continue;
      if (SAME_FRANCHISE_ALIAS_PAIRS.has(`${home}::${away}`)) continue;
      const ids = generateMlbEventIdCandidates(home as never, away as never, "2026-06-06");
      if (ids.length < 4) {
        check(`${away}@${home} produces >=4 candidates`, false, `got ${ids.length}`);
      }
    }
  }
  check(`all 31×30 = ${31 * 30} valid abbrev pairs produce candidates`, true);
}

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log("\n✅ All sharpApi event_id candidate tests passed.");
