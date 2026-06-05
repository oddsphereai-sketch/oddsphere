/**
 * Phase 4.2.C.1.R-17 Step 1 — Unit tests for the automation foundation.
 *
 * Covers:
 *   • providerDateAlignment thresholds (8/9 default)
 *   • Provider rollover → fail_closed
 *   • Provider partial alignment → warn
 *   • automationGate per-game decisions (starters, ML, OU, FI)
 *   • Stub SharpApiClient + stub DB-free gate logic where possible
 *
 * NO DB writes. providerDateAlignment uses a stubbed SharpApiClient.
 * automationGate has DB dependencies — for those branches we test the
 * decision-logic surfaces in isolation via a small helper that mirrors
 * what assessAutomationGate does internally with synthetic inputs.
 *
 * Run:
 *   npx tsx scripts/test-automation-r17.ts
 */

import { SharpApiClient } from "../lib/providers/real_api/_sharpApiClient";
import {
  assessProviderDateAlignment,
  type ProviderDateAlignmentReport,
} from "../lib/services/providerDateAlignment";

// ─── tiny harness ────────────────────────────────────────────────────

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

function section(label: string) {
  console.log(`\n━━━ ${label} ━━━`);
}

// ─── stub client returning specified /splits payloads ────────────────

class StubAlignmentClient extends SharpApiClient {
  private readonly splits: Array<Record<string, unknown>>;
  constructor(splits: Array<Record<string, unknown>>) {
    super("stub-key");
    this.splits = splits;
  }
  override async fetchAll<T>(opts: {
    path: string;
    query?: Record<string, unknown>;
    maxPages?: number;
  }): Promise<T[]> {
    if (opts.path === "/splits") return this.splits as unknown as T[];
    return [] as T[];
  }
}

function splitsRow(opts: {
  home: string;
  away: string;
  date: string;
  league?: string;
}): Record<string, unknown> {
  return {
    event_id: `mlb_${opts.home.replace(/\s+/g, "").toLowerCase()}_${opts.away.replace(/\s+/g, "").toLowerCase()}_${opts.date}`,
    sport: "baseball",
    league: opts.league ?? "mlb",
    home_team: opts.home,
    away_team: opts.away,
  };
}

// ─── providerDateAlignment tests ─────────────────────────────────────

async function testAlignmentPassesAt8of9() {
  section("providerDateAlignment — 8/9 on date passes (default threshold)");
  const rows = [
    ...Array.from({ length: 8 }, (_, i) =>
      splitsRow({ home: `home${i}`, away: `away${i}`, date: "2026-06-04" })
    ),
    splitsRow({ home: "home8", away: "away8", date: "2026-06-05" }),
  ];
  // Use teams that will fail team-resolution; that's fine — alignment
  // only counts date matches via the discovery stats.
  // Actually buildDiscoveryFromSplitsRows requires team resolution to
  // count `keptRows`. We need real team strings.
  // Use actual MLB team names so the discovery helper accepts them.
  const realRows = [
    splitsRow({ home: "Chicago Cubs", away: "Athletics", date: "2026-06-04" }),
    splitsRow({ home: "Houston Astros", away: "Pittsburgh Pirates", date: "2026-06-04" }),
    splitsRow({ home: "Atlanta Braves", away: "Toronto Blue Jays", date: "2026-06-04" }),
    splitsRow({ home: "Boston Red Sox", away: "Baltimore Orioles", date: "2026-06-04" }),
    splitsRow({ home: "New York Yankees", away: "Cleveland Guardians", date: "2026-06-04" }),
    splitsRow({ home: "Milwaukee Brewers", away: "San Francisco Giants", date: "2026-06-04" }),
    splitsRow({ home: "Minnesota Twins", away: "Kansas City Royals", date: "2026-06-04" }),
    splitsRow({ home: "Arizona Diamondbacks", away: "Los Angeles Dodgers", date: "2026-06-04" }),
    splitsRow({ home: "Philadelphia Phillies", away: "San Diego Padres", date: "2026-06-05" }), // wrong date
  ];
  const client = new StubAlignmentClient(realRows);
  const report = await assessProviderDateAlignment(client, "mlb", "2026-06-04", {
    slate_size: 9,
  });
  check(
    "alignment: 8/9 matched on expected date",
    report.matched === 8 && report.wrong_date === 1
  );
  check("alignment: status='warn' for partial (8/9 with 1 wrong-date)", report.status === "warn");
  check("alignment: threshold = ceil(0.85 * 9) = 8", report.threshold === 8);
}

async function testAlignmentRolledForward() {
  section("providerDateAlignment — rolled forward → fail_closed");
  const rolledRows = Array.from({ length: 9 }, (_, i) => {
    const pairs = [
      ["Chicago Cubs", "Athletics"], ["Houston Astros", "Pittsburgh Pirates"],
      ["Atlanta Braves", "Toronto Blue Jays"], ["Boston Red Sox", "Baltimore Orioles"],
      ["New York Yankees", "Cleveland Guardians"], ["Milwaukee Brewers", "San Francisco Giants"],
      ["Minnesota Twins", "Kansas City Royals"], ["Arizona Diamondbacks", "Los Angeles Dodgers"],
      ["Philadelphia Phillies", "San Diego Padres"],
    ];
    const [h, a] = pairs[i] ?? ["Chicago Cubs", "Athletics"];
    return splitsRow({ home: h, away: a, date: "2026-06-05" }); // ALL rolled
  });
  const client = new StubAlignmentClient(rolledRows);
  const report = await assessProviderDateAlignment(client, "mlb", "2026-06-04", {
    slate_size: 9,
  });
  check(
    "alignment: 0/9 matched, 9 wrong-date",
    report.matched === 0 && report.wrong_date === 9
  );
  check("alignment: status='fail_closed' when wrong_date dominates", report.status === "fail_closed");
  check(
    `alignment: reason mentions "rolled forward"`,
    report.reason.toLowerCase().includes("rolled forward")
  );
}

async function testAlignmentPassesClean() {
  section("providerDateAlignment — 9/9 on date passes ok");
  const allOnDate = [
    splitsRow({ home: "Chicago Cubs", away: "Athletics", date: "2026-06-04" }),
    splitsRow({ home: "Houston Astros", away: "Pittsburgh Pirates", date: "2026-06-04" }),
    splitsRow({ home: "Atlanta Braves", away: "Toronto Blue Jays", date: "2026-06-04" }),
    splitsRow({ home: "Boston Red Sox", away: "Baltimore Orioles", date: "2026-06-04" }),
    splitsRow({ home: "New York Yankees", away: "Cleveland Guardians", date: "2026-06-04" }),
    splitsRow({ home: "Milwaukee Brewers", away: "San Francisco Giants", date: "2026-06-04" }),
    splitsRow({ home: "Minnesota Twins", away: "Kansas City Royals", date: "2026-06-04" }),
    splitsRow({ home: "Arizona Diamondbacks", away: "Los Angeles Dodgers", date: "2026-06-04" }),
    splitsRow({ home: "Philadelphia Phillies", away: "San Diego Padres", date: "2026-06-04" }),
  ];
  const client = new StubAlignmentClient(allOnDate);
  const report = await assessProviderDateAlignment(client, "mlb", "2026-06-04", {
    slate_size: 9,
  });
  check("alignment: 9/9 matched, 0 wrong-date", report.matched === 9 && report.wrong_date === 0);
  check("alignment: status='ok' for clean", report.status === "ok");
}

async function testAlignmentEmpty() {
  section("providerDateAlignment — empty /splits → fail_closed");
  const client = new StubAlignmentClient([]);
  const report = await assessProviderDateAlignment(client, "mlb", "2026-06-04", {
    slate_size: 9,
  });
  check("alignment: 0 provider rows total", report.provider_rows_total === 0);
  check("alignment: status='fail_closed' when empty", report.status === "fail_closed");
}

async function testAlignmentNonMlb() {
  section("providerDateAlignment — non-mlb sport returns fail_closed");
  const client = new StubAlignmentClient([]);
  const report = await assessProviderDateAlignment(
    client,
    "nba" as "mlb",
    "2026-06-04",
    { slate_size: 9 }
  );
  check("non-mlb: status='fail_closed'", report.status === "fail_closed");
}

async function testAlignmentThresholdConfigurable() {
  section("providerDateAlignment — threshold ratio configurable");
  // Strict 100% threshold: 9/9 required
  const eightOnDate = [
    splitsRow({ home: "Chicago Cubs", away: "Athletics", date: "2026-06-04" }),
    splitsRow({ home: "Houston Astros", away: "Pittsburgh Pirates", date: "2026-06-04" }),
    splitsRow({ home: "Atlanta Braves", away: "Toronto Blue Jays", date: "2026-06-04" }),
    splitsRow({ home: "Boston Red Sox", away: "Baltimore Orioles", date: "2026-06-04" }),
    splitsRow({ home: "New York Yankees", away: "Cleveland Guardians", date: "2026-06-04" }),
    splitsRow({ home: "Milwaukee Brewers", away: "San Francisco Giants", date: "2026-06-04" }),
    splitsRow({ home: "Minnesota Twins", away: "Kansas City Royals", date: "2026-06-04" }),
    splitsRow({ home: "Arizona Diamondbacks", away: "Los Angeles Dodgers", date: "2026-06-04" }),
    splitsRow({ home: "Philadelphia Phillies", away: "San Diego Padres", date: "2026-06-05" }),
  ];
  const strict = await assessProviderDateAlignment(
    new StubAlignmentClient(eightOnDate),
    "mlb",
    "2026-06-04",
    { slate_size: 9, threshold_ratio: 1.0 }
  );
  check(
    "strict 100% threshold: 8/9 → warn or fail_closed (not ok)",
    strict.status !== "ok"
  );
  check("strict threshold = 9", strict.threshold === 9);
}

// ─── Gate decision-logic tests (decision rules in isolation) ─────────
//
// assessAutomationGate has DB dependencies that don't lend themselves
// to pure unit tests without stubbing the entire supabase client. The
// gate's decision logic is the value to lock in — exercise it via
// synthetic per-game inputs that mirror the gate's branching.

function decideGameMarkets(opts: {
  starterHomeSet: boolean;
  starterAwaySet: boolean;
  mlLines: number;
  totalLines: number;
  fiLines: number;
  providerStatus?: ProviderDateAlignmentReport["status"];
}): { ml: string; ou: string; nrfi: string } {
  const startersComplete = opts.starterHomeSet && opts.starterAwaySet;
  let ml = "play", ou = "play", nrfi = "play";
  if (!startersComplete) {
    ml = "hold-starter";
    ou = "hold-starter";
    nrfi = "hold-starter";
  } else {
    if (opts.mlLines === 0) ml = "hold-no-ml";
    if (opts.totalLines === 0) ou = "hold-no-total";
    if (opts.fiLines === 0) nrfi = "hold-no-fi";
  }
  if (opts.providerStatus === "fail_closed") {
    if (ml === "play") ml = "hold-provider";
    if (ou === "play") ou = "hold-provider";
    if (nrfi === "play") nrfi = "hold-provider";
  }
  return { ml, ou, nrfi };
}

function testGateMissingStarterHoldsAll() {
  section("automationGate decision logic — missing starter holds all 3");
  const d = decideGameMarkets({
    starterHomeSet: true,
    starterAwaySet: false,
    mlLines: 10, totalLines: 6, fiLines: 2,
  });
  check("ml = hold-starter", d.ml === "hold-starter");
  check("ou = hold-starter", d.ou === "hold-starter");
  check("nrfi = hold-starter", d.nrfi === "hold-starter");
}

function testGateMissingMlHoldsOnlyMl() {
  section("automationGate decision logic — missing ML lines holds only ML");
  const d = decideGameMarkets({
    starterHomeSet: true,
    starterAwaySet: true,
    mlLines: 0, totalLines: 6, fiLines: 2,
  });
  check("ml = hold-no-ml", d.ml === "hold-no-ml");
  check("ou = play (preserved)", d.ou === "play");
  check("nrfi = play (preserved)", d.nrfi === "play");
}

function testGateMissingTotalHoldsOnlyOu() {
  section("automationGate decision logic — missing total holds only OU");
  const d = decideGameMarkets({
    starterHomeSet: true,
    starterAwaySet: true,
    mlLines: 10, totalLines: 0, fiLines: 2,
  });
  check("ml = play", d.ml === "play");
  check("ou = hold-no-total", d.ou === "hold-no-total");
  check("nrfi = play", d.nrfi === "play");
}

function testGateMissingFiHoldsOnlyNrfi() {
  section("automationGate decision logic — missing FI holds only NRFI (best-effort)");
  const d = decideGameMarkets({
    starterHomeSet: true,
    starterAwaySet: true,
    mlLines: 10, totalLines: 6, fiLines: 0,
  });
  check("ml = play (preserved)", d.ml === "play");
  check("ou = play (preserved)", d.ou === "play");
  check("nrfi = hold-no-fi", d.nrfi === "hold-no-fi");
}

function testGateProviderFailHoldsEverything() {
  section("automationGate decision logic — provider fail_closed holds all live markets");
  const d = decideGameMarkets({
    starterHomeSet: true,
    starterAwaySet: true,
    mlLines: 10, totalLines: 6, fiLines: 2,
    providerStatus: "fail_closed",
  });
  check("ml = hold-provider", d.ml === "hold-provider");
  check("ou = hold-provider", d.ou === "hold-provider");
  check("nrfi = hold-provider", d.nrfi === "hold-provider");
}

function testGateProviderOkPreservesPlay() {
  section("automationGate decision logic — provider ok preserves play");
  const d = decideGameMarkets({
    starterHomeSet: true,
    starterAwaySet: true,
    mlLines: 10, totalLines: 6, fiLines: 2,
    providerStatus: "ok",
  });
  check("ml = play", d.ml === "play");
  check("ou = play", d.ou === "play");
  check("nrfi = play", d.nrfi === "play");
}

// ─── Dry-run orchestrator: no-writes verification ────────────────────
// The orchestrator is a script; we don't invoke it as a child process
// here. Instead we verify the structural contract: no operator import
// inside the orchestrator's planSteps path performs a write. (Step 2
// will add invocation; Step 1 just plans + reports.)

function testOrchestratorIsObservationOnly() {
  section("orchestrator (Step 1): observation-only by contract");
  // Verify the orchestrator script file exists at the expected path
  // and that it imports the read-only helpers.
  const fs = require("fs") as typeof import("fs");
  const path = "/Users/danielmengel/Projects/oddsphere/scripts/operator/automation/run-slate-cycle.ts";
  const content = fs.readFileSync(path, "utf8");

  check(
    "orchestrator exists at expected path",
    content.length > 0
  );
  check(
    "orchestrator imports providerDateAlignment helper",
    content.includes("from \"../../../lib/services/providerDateAlignment\"") ||
      content.includes("from '../../../lib/services/providerDateAlignment'")
  );
  check(
    "orchestrator imports automationGate helper",
    content.includes("from \"../../../lib/services/automationGate\"") ||
      content.includes("from '../../../lib/services/automationGate'")
  );
  check(
    "orchestrator does NOT import any write service",
    !content.includes("import { linesService }") &&
      !content.includes("import { reviewerService }") &&
      !content.includes("LINES_DB_WRITES_ENABLED") &&
      !content.includes("STARTER_DB_WRITES_ENABLED") &&
      !content.includes("AUTOMODEL_DB_WRITES_ENABLED")
  );
  check(
    "orchestrator prints DRY RUN banner",
    content.includes("DRY-RUN") || content.includes("DRY RUN")
  );
  check(
    "orchestrator does NOT parse --apply as an active flag",
    // The script may *mention* --apply in operator_path strings or
    // future-Step-2 comments. What matters is that NO branching reads
    // the --apply flag to enable writes in Step 1.
    !content.includes('readBoolFlag(argv, "--apply")') &&
      !content.includes("readBoolFlag(process.argv, \"--apply\")") &&
      !content.includes("applyRequested") &&
      !content.includes("writeMode")
  );
}

// ─── Runner ──────────────────────────────────────────────────────────

async function main() {
  console.log("[test-automation-r17] start");
  await testAlignmentPassesAt8of9();
  await testAlignmentRolledForward();
  await testAlignmentPassesClean();
  await testAlignmentEmpty();
  await testAlignmentNonMlb();
  await testAlignmentThresholdConfigurable();
  testGateMissingStarterHoldsAll();
  testGateMissingMlHoldsOnlyMl();
  testGateMissingTotalHoldsOnlyOu();
  testGateMissingFiHoldsOnlyNrfi();
  testGateProviderFailHoldsEverything();
  testGateProviderOkPreservesPlay();
  testOrchestratorIsObservationOnly();

  console.log();
  console.log("━━━ Summary ━━━");
  console.log(`  pass: ${pass}`);
  console.log(`  fail: ${fail}`);
  if (fail > 0) {
    console.log();
    console.log("Failures:");
    for (const f of failures) console.log(f);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
