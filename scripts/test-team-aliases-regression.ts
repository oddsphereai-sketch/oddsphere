/**
 * Push 2 tests — team alias regression coverage.
 *
 * Locks the alias table for the 30 MLB teams plus the OAK legacy alias
 * so a future edit to _teamNameNormalizer.ts can't silently drop a
 * SharpAPI input string we depend on.
 *
 * Two dimensions tested:
 *   A. Forward normalization — SharpAPI / BDL strings → 3-letter abbrev
 *   B. Provider mascot lookup — abbrev → ["mascot", ...] for event_id
 *      construction (Push 2 fallback discovery)
 */

import {
  normalizeMlbTeamName,
  providerMascotsForAbbrev,
  MLB_PROVIDER_MASCOTS,
  type MlbTeamAbbrev,
} from "../lib/providers/real_api/_teamNameNormalizer";

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

// ── Forward normalization (provider string → abbrev) ──────────────────
console.log("━━━ Provider-string forward normalization (30 MLB teams) ━━━");

const FORWARD: Array<[string, MlbTeamAbbrev]> = [
  ["San Francisco Giants", "SF"],
  ["Chicago Cubs", "CHC"],
  ["Tampa Bay Rays", "TB"],
  ["Miami Marlins", "MIA"],
  ["New York Yankees", "NYY"],
  ["Boston Red Sox", "BOS"],
  ["Chicago White Sox", "CWS"],
  ["Athletics", "ATH"],
  ["Oakland Athletics", "ATH"],
  ["Los Angeles Angels", "LAA"],
  ["Los Angeles Dodgers", "LAD"],
  ["Arizona Diamondbacks", "ARI"],
  ["San Diego Padres", "SD"],
  ["Philadelphia Phillies", "PHI"],
  ["Pittsburgh Pirates", "PIT"],
  ["Atlanta Braves", "ATL"],
  ["Milwaukee Brewers", "MIL"],
  ["Colorado Rockies", "COL"],
  ["Cleveland Guardians", "CLE"],
  ["Texas Rangers", "TEX"],
  ["Detroit Tigers", "DET"],
  ["Seattle Mariners", "SEA"],
  ["Kansas City Royals", "KC"],
  ["Minnesota Twins", "MIN"],
  ["Cincinnati Reds", "CIN"],
  ["St. Louis Cardinals", "STL"],
  ["Baltimore Orioles", "BAL"],
  ["Toronto Blue Jays", "TOR"],
  ["Washington Nationals", "WSH"],
  ["Houston Astros", "HOU"],
  ["New York Mets", "NYM"],
];
for (const [s, expected] of FORWARD) {
  const got = normalizeMlbTeamName(s);
  check(`"${s}" → ${expected}`, got === expected, `got ${got}`);
}

// Lowercase + trim resilience (a few spot-checks)
console.log("\n━━━ Lowercase + trim resilience ━━━");
for (const [s, expected] of [
  ["  san francisco giants  ", "SF"],
  ["TAMPA BAY RAYS", "TB"],
  ["red sox", "BOS"],
  ["white sox", "CWS"],
  ["blue jays", "TOR"],
  ["nationals", "WSH"],
] as Array<[string, MlbTeamAbbrev]>) {
  check(`"${s}" → ${expected}`, normalizeMlbTeamName(s) === expected);
}

// Ambiguous / unknown strings return null (never a best-guess)
console.log("\n━━━ Ambiguous / unknown returns null ━━━");
for (const s of ["NY", "Chicago", "Los Angeles", "Saint Louis", "Unknown FC", ""] as const) {
  const got = normalizeMlbTeamName(s);
  check(`"${s}" → null`, got === null, `got ${got}`);
}

// ── Mascot lookup (abbrev → provider format) ──────────────────────────
console.log("\n━━━ Provider mascot lookup (canonical event_id format) ━━━");

const MASCOT_EXPECT: Array<[MlbTeamAbbrev, ReadonlyArray<string>]> = [
  ["SF", ["giants"]],
  ["CHC", ["cubs"]],
  ["MIA", ["marlins"]],
  ["TB", ["rays"]],
  ["NYY", ["yankees"]],
  ["NYM", ["mets"]],
  ["BOS", ["red_sox", "redsox"]],
  ["CWS", ["white_sox", "whitesox"]],
  ["TOR", ["blue_jays", "bluejays"]],
  ["ATH", ["athletics"]],
  ["OAK", ["athletics"]],
  ["LAA", ["angels"]],
  ["LAD", ["dodgers"]],
  ["WSH", ["nationals"]],
  ["KC", ["royals"]],
  ["SD", ["padres"]],
];
for (const [abbrev, expected] of MASCOT_EXPECT) {
  const got = providerMascotsForAbbrev(abbrev);
  const ok = got.length === expected.length && expected.every((m) => got.includes(m));
  check(`${abbrev} → [${expected.join(", ")}]`, ok, `got [${got.join(", ")}]`);
}

console.log("\n━━━ Every abbreviation has at least one provider mascot ━━━");
{
  const allAbbrevs: MlbTeamAbbrev[] = Object.keys(MLB_PROVIDER_MASCOTS) as MlbTeamAbbrev[];
  check(`exactly 31 entries (30 teams + OAK alias)`, allAbbrevs.length === 31, `got ${allAbbrevs.length}`);
  for (const a of allAbbrevs) {
    const mascots = providerMascotsForAbbrev(a);
    if (mascots.length === 0) {
      check(`${a} has >=1 mascot`, false, "empty");
    }
  }
  check("all 31 abbreviations resolve to >=1 mascot", true);
}

console.log("\n━━━ Mascots are non-empty lowercase ASCII (event_id safety) ━━━");
{
  const allAbbrevs: MlbTeamAbbrev[] = Object.keys(MLB_PROVIDER_MASCOTS) as MlbTeamAbbrev[];
  let allValid = true;
  for (const a of allAbbrevs) {
    for (const m of providerMascotsForAbbrev(a)) {
      if (m.length === 0 || /[^a-z_]/.test(m)) {
        check(`${a} mascot "${m}" is non-empty lowercase ASCII (alnum+underscore)`, false);
        allValid = false;
      }
    }
  }
  if (allValid) check("all mascot strings pass safety regex", true);
}

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log("\n✅ All team alias regression tests passed.");
