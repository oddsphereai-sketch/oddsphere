/**
 * Tests for display-projection reconciliation
 * (lib/services/displayProjectionReconciliation.ts).
 *
 * Contract (v2): the visible projected score must support the visible ML and
 * O/U picks. Raw model internals stay in game_predictions / snapshot_json; this
 * layer adjusts only the member-facing score when it would contradict the card.
 * Env-free. Run: npx tsx scripts/test-display-projection-reconciliation.ts
 */
import { reconcileDisplayProjection } from "../lib/services/displayProjectionReconciliation";

let pass = 0, fail = 0;
const failures: string[] = [];
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; failures.push(`${label}${detail ? ` — ${detail}` : ""}`); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

console.log("━━━ reconcileDisplayProjection (v2) ━━━");

// CLE@CWS: raw CLE(away) 4.77, CWS(home) 3.87 (CLE wins). Final ML pick = CWS
// (flipped). Card must show CWS winning, total held at raw 8.64, small margin.
{
  const r = reconcileDisplayProjection({ rawAway: 4.77, rawHome: 3.87, mlPick: "home", ouPick: "over", line: 7.5 });
  check("CLE@CWS: home(CWS) shown winning", r.home > r.away, `away=${r.away} home=${r.home}`);
  check("CLE@CWS: total held at raw 8.64", Math.abs(r.total - 8.64) <= 0.1, `total=${r.total}`);
  check("CLE@CWS: reconciled=true (ML margin sign flipped)", r.reconciled === true);
  check("CLE@CWS: minimal winning margin (~0.3, one-decimal rounded)", Math.abs(r.home - r.away) <= 0.5, `margin=${(r.home - r.away).toFixed(2)}`);
}

// ML flip preserves the displayed TOTAL exactly (only redistributes runs).
{
  const r = reconcileDisplayProjection({ rawAway: 4.88, rawHome: 4.49, mlPick: "home", ouPick: "over", line: 8.5 });
  check("ML flip (away→home): total preserved near raw 9.37", Math.abs(r.total - 9.37) <= 0.15, `total=${r.total}`);
  check("ML flip: home now shown winning", r.home > r.away, `away=${r.away} home=${r.home}`);
  check("ML flip: scores sum to displayed total", Math.abs((r.away + r.home) - r.total) < 0.05);
}

// Totals reconcile when the visible score would contradict the visible O/U pick.
{
  const r = reconcileDisplayProjection({ rawAway: 4.88, rawHome: 4.49, mlPick: "away", ouPick: "under", line: 8.5 });
  check("Under pick + raw 9.37: total bent below 8.5", r.total < 8.5, `total=${r.total}`);
  check("Under pick: away(BAL) still shown winning (ML coherent, no-op)", r.away > r.home, `away=${r.away} home=${r.home}`);
  check("Under pick: reconciled=true (total adjusted)", r.reconciled === true);
}

// Coherent game (ML pick matches raw margin): no change at all.
{
  const r = reconcileDisplayProjection({ rawAway: 4.0, rawHome: 5.0, mlPick: "home", ouPick: "over", line: 8.5 });
  check("coherent game: unchanged (4.0 / 5.0 / 9.0, reconciled=false)", r.away === 4.0 && r.home === 5.0 && r.total === 9.0 && r.reconciled === false);
}

// Null ML pick → raw shape, no reconciliation.
{
  const r = reconcileDisplayProjection({ rawAway: 4.77, rawHome: 3.87, mlPick: null, ouPick: null, line: null });
  check("null picks → raw away 4.8 home 3.9, reconciled=false", r.away === 4.8 && r.home === 3.9 && r.reconciled === false);
}

// Away-pick flip: raw home winning, final pick away → away shown winning, total held.
{
  const r = reconcileDisplayProjection({ rawAway: 3.87, rawHome: 4.77, mlPick: "away", ouPick: "over", line: 7.5 });
  check("away flip: away shown winning", r.away > r.home, `away=${r.away} home=${r.home}`);
  check("away flip: total held at raw 8.64", Math.abs(r.total - 8.64) <= 0.1, `total=${r.total}`);
  check("away flip: reconciled=true", r.reconciled === true);
}

// Near-pickem (PHI@WSH): raw 4.95 / 4.97, ML pick home. Without a floor this
// rounds to a 5.0/5.0 tie and hides the pick — the displayed margin must keep
// home strictly ahead while the total stays at the raw sum.
{
  const r = reconcileDisplayProjection({ rawAway: 4.95, rawHome: 4.97, mlPick: "home", ouPick: "over", line: 9.5 });
  check("near-pickem: home shown STRICTLY winning (no 5.0/5.0 tie)", r.home > r.away, `away=${r.away} home=${r.home}`);
  check("near-pickem: total held at raw 9.92", Math.abs(r.total - 9.92) <= 0.11, `total=${r.total}`);
  check("near-pickem: reconciled=true (margin floored)", r.reconciled === true);
}
// And the away side of the same near-pickem.
{
  const r = reconcileDisplayProjection({ rawAway: 4.97, rawHome: 4.95, mlPick: "away", ouPick: "over", line: 9.5 });
  check("near-pickem(away): away shown STRICTLY winning", r.away > r.home, `away=${r.away} home=${r.home}`);
}

// SWEEP: displayed score obeys both visible ML and visible O/U picks.
{
  let allCoherent = true;
  for (const ou of ["over", "under"] as const) {
    for (const ml of ["home", "away"] as const) {
      for (const [a, h, line] of [[4.77, 3.87, 7.5], [4.88, 4.49, 8.5], [3.0, 3.2, 9.5], [5.5, 5.0, 9.0]] as const) {
        const r = reconcileDisplayProjection({ rawAway: a, rawHome: h, mlPick: ml, ouPick: ou, line });
        if (ml === "home" && !(r.home > r.away)) allCoherent = false;
        if (ml === "away" && !(r.away > r.home)) allCoherent = false;
        if (ou === "over" && !(r.total > line)) allCoherent = false;
        if (ou === "under" && !(r.total < line)) allCoherent = false;
      }
    }
  }
  check("SWEEP: displayed score supports every ML/O/U pick", allCoherent);
}

console.log(`\n  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) { console.log("\nFAILURES:\n" + failures.map((f) => "  - " + f).join("\n")); process.exit(1); }
console.log("\n✅ Display-projection reconciliation tests passed.");
