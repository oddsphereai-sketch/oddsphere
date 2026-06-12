/**
 * Deterministic unit test for the approved bullpen ERA shrinkage
 * (WC/MLB stabilization 2026-06-12).
 *
 * James-Stein shrinkage toward league-average ERA (4.0), weighted by total
 * bullpen IP (k = SHRINKAGE_K_BULLPEN_ERA = 150). Stabilizes the bullpen
 * factor (= shrunkEra / 4.0) so legitimately low early-season pens (ATL/NYM
 * ≈ 0.47 raw) no longer fall below the trusted [0.5, 2.0] display band.
 *
 * Pure — imports only constants from types.ts (no DB).
 * Run: npx tsx scripts/test-bullpen-shrinkage.ts
 */

import { shrinkBullpenEra, LEAGUE_CONSTANTS_V1 } from "../lib/automodel/types";

const AVG = LEAGUE_CONSTANTS_V1.AVG_ERA; // 4.0
const factor = (era: number) => era / AVG;
const inRange = (f: number) => f >= 0.5 && f <= 2.0;

let failures = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`✓ ${name}`);
  else { failures++; console.error(`✗ ${name}${detail ? `  — ${detail}` : ""}`); }
}
function close(name: string, got: number, want: number, tol = 0.01): void {
  ok(name, Math.abs(got - want) <= tol, `got ${got.toFixed(4)}, want ≈ ${want}`);
}

// Test 4 — a normal, full-volume, league-average pen is essentially
// unchanged (raw ERA == league avg → shrunk == league avg → factor 1.0).
close("normal league-avg pen unchanged (era 4.0, ip 200 → 4.0)", shrinkBullpenEra(4.0, 200), 4.0);
ok("normal pen factor ≈ 1.0 and in range", inRange(factor(shrinkBullpenEra(4.0, 200))));

// A normal slightly-above pen moves only mildly.
close("mild pen (era 4.5, ip 200 → 4.286)", shrinkBullpenEra(4.5, 200), 4.2857);
ok("mild pen stays in range", inRange(factor(shrinkBullpenEra(4.5, 200))));

// Test 5/6 — out-of-range raw (ATL / NYM real data) is rescued into range.
const atl = shrinkBullpenEra(1.88, 142);
close("ATL shrunk era (1.88, ip 142 → 2.969)", atl, 2.969);
ok("ATL raw factor 0.470 is OUT of range", !inRange(factor(1.88)));
ok("ATL shrunk factor 0.742 is IN range", inRange(factor(atl)), `factor=${factor(atl).toFixed(3)}`);

const nym = shrinkBullpenEra(1.87, 87);
close("NYM shrunk era (1.87, ip 87 → 3.218)", nym, 3.218);
ok("NYM raw factor 0.468 is OUT of range", !inRange(factor(1.87)));
ok("NYM shrunk factor 0.804 is IN range", inRange(factor(nym)), `factor=${factor(nym).toFixed(3)}`);

// Lower IP → stronger pull toward league avg (NYM has less IP than ATL but
// nearly the same raw, so its shrunk ERA is HIGHER / closer to 4.0).
ok("less IP shrinks harder toward league avg", nym > atl, `nym=${nym.toFixed(3)} atl=${atl.toFixed(3)}`);

// Monotonic: more IP → closer to the raw observation.
ok(
  "more IP → less shrinkage (closer to raw)",
  Math.abs(shrinkBullpenEra(2.0, 400) - 2.0) < Math.abs(shrinkBullpenEra(2.0, 100) - 2.0),
);

// Test 7 — no source: the shrinkage is only invoked when RP ERA data
// exists; with zero IP it collapses to the league prior (caller treats a
// null raw proxy as "no data" and the Key Stats row shows "—" — covered by
// test-keystats-two-sided). Here we assert the degenerate ip=0 → league avg.
close("zero IP → league prior (no fabricated extreme)", shrinkBullpenEra(1.0, 0), 4.0);

// No fake data / no masking: for a REALISTIC sustained bullpen ERA band
// (2.0–6.5 — no MLB pen holds below ~2.0 over meaningful IP) at any IP,
// shrinkage lands the factor inside [0.5, 2.0]. Genuinely extreme inputs
// (a 0.50 ERA over a full season, or a catastrophic 12.00 ERA) are
// INTENTIONALLY left out of range — shrinkage must not mask a real extreme.
let allRealisticInRange = true;
for (const era of [2.0, 2.5, 3, 3.5, 4, 4.5, 5, 6, 6.5]) {
  for (const ip of [10, 50, 100, 150, 250, 500]) {
    if (!inRange(factor(shrinkBullpenEra(era, ip)))) allRealisticInRange = false;
  }
}
ok("realistic sustained bullpen ERAs (2.0–6.5) shrink into [0.5,2.0]", allRealisticInRange);
ok("catastrophic 12.00 ERA pen stays OUT of range (not masked)", !inRange(factor(shrinkBullpenEra(12, 250))));

if (failures > 0) { console.error(`\n${failures} assertion(s) failed.`); process.exit(1); }
console.log("\nAll bullpen shrinkage assertions passed.");
