/**
 * MLB-P0 morning slate-publish fix — EV-opportunity feed must not slate-block.
 *
 * Proves the two new gate helpers + the exact prod scenario that left the
 * slate empty every morning (BDL 15 ↔ SharpAPI EV 4):
 *   • reconcileBdlVsSharpEv(15, 4) is fail_closed (the symptom) ...
 *   • ... but isReconciliationHardBlock() treats it as NON-blocking (BDL present)
 *   • shouldSoftenAlignmentForModelGate softens a fail_closed alignment in both modes
 *   • empty BDL is STILL a hard block (genuine emptiness)
 *
 * Run: npx tsx scripts/test-slate-publish-ev-soften.ts
 */
import {
  shouldSoftenAlignmentForModelGate,
  isReconciliationHardBlock,
  shouldDemoteAlignmentForGate,
} from "../lib/services/automationOrchestratorGates";
import { reconcileBdlVsSharpEv } from "../lib/services/slateReconciliation";

let failures = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) console.log(`✓ ${n}`);
  else { failures++; console.error(`✗ ${n}${d ? ` — ${d}` : ""}`); }
};

// ── The exact prod morning scenario: BDL 15 games, SharpAPI EV 4 opportunities.
const bdl = ["AAA@BBB", "CCC@DDD", "EEE@FFF", "GGG@HHH", "III@JJJ", "KKK@LLL",
  "MMM@NNN", "OOO@PPP", "QQQ@RRR", "SSS@TTT", "UUU@VVV", "WWW@XXX", "YYY@ZZZ",
  "A1@B1", "C1@D1"].map((m) => { const [a, h] = m.split("@"); return { away_abbr: a, home_abbr: h }; });
const ev4 = ["AAA@BBB", "CCC@DDD", "EEE@FFF", "GGG@HHH"].map((m) => { const [a, h] = m.split("@"); return { away: a, home: h }; });

const recon = reconcileBdlVsSharpEv(bdl, ev4);
console.log(`reconcile(BDL=15, EV=4): status=${recon.status} overlap=${recon.overlapPct}% matched=${recon.matchedCount}`);
ok("reconcile(15,4) is fail_closed (the morning symptom)", recon.status === "fail_closed");
ok("reconcile(15,4) overlap ≈ 26.7%", Math.abs(recon.overlapPct - 26.7) < 0.5);
// The FIX: a non-empty BDL slate with sparse EV is NOT a hard block.
ok("isReconciliationHardBlock false for sparse EV on non-empty BDL", isReconciliationHardBlock({ status: recon.status, bdlCount: recon.bdlCount }) === false);

// Empty BDL stays a hard block (genuine emptiness).
const reconEmpty = reconcileBdlVsSharpEv([], ev4);
ok("reconcile(empty BDL) is fail_closed", reconEmpty.status === "fail_closed");
ok("isReconciliationHardBlock TRUE for empty BDL", isReconciliationHardBlock({ status: reconEmpty.status, bdlCount: reconEmpty.bdlCount }) === true);

// A healthy slate (15/15) is ok and obviously not a hard block.
const reconOk = reconcileBdlVsSharpEv(bdl, bdl.map((g) => ({ away: g.away_abbr, home: g.home_abbr })));
ok("reconcile(15,15) is ok", reconOk.status === "ok");
ok("isReconciliationHardBlock false for ok", isReconciliationHardBlock({ status: reconOk.status, bdlCount: reconOk.bdlCount }) === false);

// ── Alignment soften for the MODEL gate — both modes.
ok("alignment soften: fail_closed → true (model gate)", shouldSoftenAlignmentForModelGate({ alignmentStatus: "fail_closed" }) === true);
ok("alignment soften: ok → false", shouldSoftenAlignmentForModelGate({ alignmentStatus: "ok" }) === false);
ok("alignment soften: warn → false", shouldSoftenAlignmentForModelGate({ alignmentStatus: "warn" }) === false);
ok("alignment soften: null → false", shouldSoftenAlignmentForModelGate({ alignmentStatus: null }) === false);

// ── Publish-HOLD semantics unchanged: intraday holds, morning does not.
ok("publish-hold: intraday + fail_closed → true", shouldDemoteAlignmentForGate({ intradayMode: true, alignmentStatus: "fail_closed" }) === true);
ok("publish-hold: morning + fail_closed → false (morning publishes)", shouldDemoteAlignmentForGate({ intradayMode: false, alignmentStatus: "fail_closed" }) === false);

// ── Composite: the morning prod state no longer slate-wide-blocks.
//   alignment fail_closed → softened for gate (gateBlocking from alignment cleared)
//   reconciliation fail_closed on BDL=15 → NOT a hard block (publish not held)
//   publish-hold (intraday) not set in morning.
const morningGateSoftened = shouldSoftenAlignmentForModelGate({ alignmentStatus: "fail_closed" });
const morningReconHardBlock = isReconciliationHardBlock({ status: recon.status, bdlCount: recon.bdlCount });
const morningPublishHeldByAlignment = shouldDemoteAlignmentForGate({ intradayMode: false, alignmentStatus: "fail_closed" });
ok("MORNING composite: model gate softened, no recon hard-block, publish not held",
  morningGateSoftened === true && morningReconHardBlock === false && morningPublishHeldByAlignment === false);

if (failures > 0) { console.error(`\n${failures} assertion(s) failed.`); process.exit(1); }
console.log("\nAll MLB-P0 morning slate-publish EV-soften assertions passed.");
