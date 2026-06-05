/**
 * Phase 4.2.C.1.R-17 Step 2B — pure unit tests for
 * `slateReconciliation.reconcileBdlVsSharpEv`.
 *
 * Fixtures only. No network, no DB. Covers:
 *   • 100% / 80% / 60% / 7% / 0% overlap paths
 *   • Empty either side → fail_closed
 *   • Asymmetric counts (BDL 15 / Sharp 9)
 *   • Case-insensitive matchup keying
 *   • Sort order of bdlOnly + sharpOnly arrays
 *
 * Run: npx tsx scripts/test-slate-reconciliation.ts
 */

import {
  reconcileBdlVsSharpEv,
  type BdlSlateRowInput,
  type SharpEventInput,
} from "../lib/services/slateReconciliation";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, hint?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    const m = `  ✗ ${label}${hint ? ` — ${hint}` : ""}`;
    console.log(m);
    failures.push(m);
  }
}

function section(t: string) {
  console.log(`\n━━━ ${t} ━━━`);
}

function bdl(away: string, home: string): BdlSlateRowInput {
  return { away_abbr: away, home_abbr: home };
}
function sharp(away: string, home: string): SharpEventInput {
  return { away, home };
}

function main() {
  section("15/15 perfect match → ok @ 100%");
  {
    const bdlSlate = [
      bdl("SF", "CHC"), bdl("CHW", "PHI"), bdl("SEA", "DET"),
      bdl("BOS", "NYY"), bdl("BAL", "TOR"), bdl("TB", "MIA"),
      bdl("PIT", "ATL"), bdl("OAK", "HOU"), bdl("CLE", "TEX"),
      bdl("KC", "MIN"),  bdl("CIN", "STL"), bdl("MIL", "COL"),
      bdl("NYM", "SD"),  bdl("WSH", "ARI"), bdl("LAA", "LAD"),
    ];
    const sharpEv: SharpEventInput[] = bdlSlate.map((g) =>
      sharp(g.away_abbr, g.home_abbr)
    );
    const r = reconcileBdlVsSharpEv(bdlSlate, sharpEv);
    check("status = ok", r.status === "ok");
    check("bdlCount = 15", r.bdlCount === 15);
    check("sharpEvCount = 15", r.sharpEvCount === 15);
    check("matchedCount = 15", r.matchedCount === 15);
    check("overlapPct = 100", r.overlapPct === 100);
    check("bdlOnly empty", r.bdlOnlyMatchups.length === 0);
    check("sharpOnly empty", r.sharpOnlyMatchups.length === 0);
  }

  section("Today's slate shape — 15 BDL / 9 SharpEV / 1 overlap → fail_closed");
  {
    // This is the 2026-06-05 audit case.
    const bdlSlate = [
      bdl("SF", "CHC"), bdl("CHW", "PHI"), bdl("SEA", "DET"),
      bdl("BOS", "NYY"), bdl("BAL", "TOR"), bdl("TB", "MIA"),
      bdl("PIT", "ATL"), bdl("OAK", "HOU"), bdl("CLE", "TEX"),
      bdl("KC", "MIN"),  bdl("CIN", "STL"), bdl("MIL", "COL"),
      bdl("NYM", "SD"),  bdl("WSH", "ARI"), bdl("LAA", "LAD"),
    ];
    const sharpEv = [
      sharp("ATH", "CHC"), sharp("BAL", "BOS"), sharp("CLE", "NYY"),
      sharp("KC", "MIN"),  sharp("LAD", "ARI"), sharp("PIT", "HOU"),
      sharp("SD", "PHI"),  sharp("SF", "MIL"),  sharp("TOR", "ATL"),
    ];
    const r = reconcileBdlVsSharpEv(bdlSlate, sharpEv);
    check("status = fail_closed", r.status === "fail_closed");
    check("matched = 1 (KC@MIN only)", r.matchedCount === 1);
    check(
      "overlapPct ≈ 6.7% (1/15 with denom = max)",
      r.overlapPct > 6 && r.overlapPct < 7
    );
    check("bdlOnly has 14", r.bdlOnlyMatchups.length === 14);
    check("sharpOnly has 8", r.sharpOnlyMatchups.length === 8);
    check(
      "bdlOnly includes BOS@NYY",
      r.bdlOnlyMatchups.includes("BOS@NYY")
    );
    check(
      "sharpOnly includes PIT@HOU",
      r.sharpOnlyMatchups.includes("PIT@HOU")
    );
  }

  section("12 BDL / 12 SharpEV / 12 overlap → ok @ 100%");
  {
    const slate = [
      bdl("A","B"),bdl("C","D"),bdl("E","F"),bdl("G","H"),
      bdl("I","J"),bdl("K","L"),bdl("M","N"),bdl("O","P"),
      bdl("Q","R"),bdl("S","T"),bdl("U","V"),bdl("W","X"),
    ];
    const ev: SharpEventInput[] = slate.map((g) => sharp(g.away_abbr, g.home_abbr));
    const r = reconcileBdlVsSharpEv(slate, ev);
    check("status = ok", r.status === "ok");
    check("matched = 12", r.matchedCount === 12);
    check("overlap = 100", r.overlapPct === 100);
  }

  section("10 BDL / 10 SharpEV / 8 overlap → ok (≥ 80%)");
  {
    const slate = [
      bdl("A","B"),bdl("C","D"),bdl("E","F"),bdl("G","H"),bdl("I","J"),
      bdl("K","L"),bdl("M","N"),bdl("O","P"),bdl("Q","R"),bdl("S","T"),
    ];
    const ev: SharpEventInput[] = [
      // 8 match + 2 different
      sharp("A","B"),sharp("C","D"),sharp("E","F"),sharp("G","H"),
      sharp("I","J"),sharp("K","L"),sharp("M","N"),sharp("O","P"),
      sharp("XX","YY"),sharp("ZZ","WW"),
    ];
    const r = reconcileBdlVsSharpEv(slate, ev);
    check(
      "status = ok (overlap = 8/10 = 80%)",
      r.status === "ok"
    );
    check("overlapPct = 80", r.overlapPct === 80);
    check("bdlOnly has 2", r.bdlOnlyMatchups.length === 2);
    check("sharpOnly has 2", r.sharpOnlyMatchups.length === 2);
  }

  section("10 BDL / 10 SharpEV / 6 overlap → warn (50-80%)");
  {
    const slate = [
      bdl("A","B"),bdl("C","D"),bdl("E","F"),bdl("G","H"),bdl("I","J"),
      bdl("K","L"),bdl("M","N"),bdl("O","P"),bdl("Q","R"),bdl("S","T"),
    ];
    const ev: SharpEventInput[] = [
      sharp("A","B"),sharp("C","D"),sharp("E","F"),sharp("G","H"),
      sharp("I","J"),sharp("K","L"),
      sharp("X1","Y1"),sharp("X2","Y2"),sharp("X3","Y3"),sharp("X4","Y4"),
    ];
    const r = reconcileBdlVsSharpEv(slate, ev);
    check("status = warn", r.status === "warn");
    check("overlap = 60%", r.overlapPct === 60);
  }

  section("10 BDL / 10 SharpEV / 4 overlap → fail_closed (< 50%)");
  {
    const slate = [
      bdl("A","B"),bdl("C","D"),bdl("E","F"),bdl("G","H"),bdl("I","J"),
      bdl("K","L"),bdl("M","N"),bdl("O","P"),bdl("Q","R"),bdl("S","T"),
    ];
    const ev: SharpEventInput[] = [
      sharp("A","B"),sharp("C","D"),sharp("E","F"),sharp("G","H"),
      sharp("X1","Y1"),sharp("X2","Y2"),sharp("X3","Y3"),
      sharp("X4","Y4"),sharp("X5","Y5"),sharp("X6","Y6"),
    ];
    const r = reconcileBdlVsSharpEv(slate, ev);
    check("status = fail_closed", r.status === "fail_closed");
    check("overlap = 40%", r.overlapPct === 40);
  }

  section("Empty BDL → fail_closed");
  {
    const r = reconcileBdlVsSharpEv([], [sharp("KC", "MIN")]);
    check("status = fail_closed", r.status === "fail_closed");
    check("bdlCount = 0", r.bdlCount === 0);
    check("sharpEvCount = 1", r.sharpEvCount === 1);
    check(
      "reason mentions empty BDL",
      r.reason.toLowerCase().includes("bdl") &&
        r.reason.toLowerCase().includes("empty")
    );
  }

  section("Empty SharpAPI EV → fail_closed");
  {
    const r = reconcileBdlVsSharpEv([bdl("KC", "MIN")], []);
    check("status = fail_closed", r.status === "fail_closed");
    check("bdlCount = 1", r.bdlCount === 1);
    check("sharpEvCount = 0", r.sharpEvCount === 0);
    check(
      "reason mentions empty SharpAPI",
      r.reason.toLowerCase().includes("sharpapi") &&
        r.reason.toLowerCase().includes("zero")
    );
  }

  section("Both empty → fail_closed");
  {
    const r = reconcileBdlVsSharpEv([], []);
    check("status = fail_closed", r.status === "fail_closed");
  }

  section("Case-insensitive matchup key (kc/KC, min/MIN)");
  {
    const r = reconcileBdlVsSharpEv(
      [bdl("kc", "min")],
      [sharp("KC", "MIN")]
    );
    check("matched = 1", r.matchedCount === 1);
    check("overlap = 100", r.overlapPct === 100);
  }

  section("Asymmetric — 5 BDL / 10 SharpEV / 5 overlap → 50% warn");
  {
    // BDL = 5; SharpAPI has 10 (5 match + 5 extras). Denominator = max = 10.
    // overlap = 5/10 = 50% → warn (lands exactly on the boundary).
    const r = reconcileBdlVsSharpEv(
      [bdl("A","B"),bdl("C","D"),bdl("E","F"),bdl("G","H"),bdl("I","J")],
      [
        sharp("A","B"),sharp("C","D"),sharp("E","F"),sharp("G","H"),sharp("I","J"),
        sharp("X1","Y1"),sharp("X2","Y2"),sharp("X3","Y3"),sharp("X4","Y4"),sharp("X5","Y5"),
      ]
    );
    check("denom = 10, matched = 5, overlap = 50%", r.overlapPct === 50);
    check("status = warn (50% is the lower bound for warn)", r.status === "warn");
  }

  section("Sort order — bdlOnly and sharpOnly are alphabetical");
  {
    const r = reconcileBdlVsSharpEv(
      [bdl("ZZ","AA"), bdl("AA","BB"), bdl("MM","CC")],
      [sharp("KC","MIN")]
    );
    check(
      "bdlOnly is alphabetical",
      r.bdlOnlyMatchups[0] === "AA@BB" &&
        r.bdlOnlyMatchups[1] === "MM@CC" &&
        r.bdlOnlyMatchups[2] === "ZZ@AA"
    );
  }

  section("Empty-string abbreviations dropped");
  {
    const r = reconcileBdlVsSharpEv(
      [{ away_abbr: "", home_abbr: "MIN" }, bdl("KC", "MIN")],
      [sharp("KC", "MIN")]
    );
    check("bdlCount = 1 (empty-pair dropped)", r.bdlCount === 1);
    check("matched = 1", r.matchedCount === 1);
  }

  // ── Summary ──────────────────────────────────────────────────────
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All slate-reconciliation tests passed.`);
}

main();
