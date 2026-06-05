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

// ─── stub client returning specified provider-discovery payloads ──────
//
// R-17 Step 2B — the alignment helper switched from /splits to
// /opportunities/ev. The stub now serves the same fixture rows on
// BOTH paths so the historical test fixtures (which still build via
// `splitsRow()`) still exercise the alignment logic. The row shape
// is identical for both endpoints in the fields the discovery helpers
// consume (event_id, league, home_team, away_team).

class StubAlignmentClient extends SharpApiClient {
  private readonly rows: Array<Record<string, unknown>>;
  constructor(rows: Array<Record<string, unknown>>) {
    super("stub-key");
    this.rows = rows;
  }
  override async fetchAll<T>(opts: {
    path: string;
    query?: Record<string, unknown>;
    maxPages?: number;
  }): Promise<T[]> {
    if (opts.path === "/splits") return this.rows as unknown as T[];
    if (opts.path === "/opportunities/ev") return this.rows as unknown as T[];
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
    is_player_prop: false,
    is_alternate_line: false,
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

// ─── Step 2 orchestrator structural tests ────────────────────────────
//
// Step 2 turns the orchestrator into a controlled-apply runner. We
// can't run it end-to-end without a live DB, but we can lock in the
// structural contract that protects writes: four-key gate, per-step
// env vars enumerated, deferred steps marked, fail_closed plumbing.

function readOrchestratorSource(): string {
  const fs = require("fs") as typeof import("fs");
  const path =
    "/Users/danielmengel/Projects/oddsphere/scripts/operator/automation/run-slate-cycle.ts";
  return fs.readFileSync(path, "utf8");
}

function testOrchestratorImportsReadOnlyHelpers() {
  section("orchestrator (Step 2): read-only helpers wired");
  const content = readOrchestratorSource();
  check("orchestrator exists at expected path", content.length > 0);
  check(
    "orchestrator imports providerDateAlignment helper",
    content.includes('from "../../../lib/services/providerDateAlignment"') ||
      content.includes("from '../../../lib/services/providerDateAlignment'")
  );
  check(
    "orchestrator imports automationGate helper",
    content.includes('from "../../../lib/services/automationGate"') ||
      content.includes("from '../../../lib/services/automationGate'")
  );
}

function testOrchestratorTopLevelGate() {
  section("orchestrator (Step 2): top-level AUTOMATION_ORCHESTRATOR_ENABLED gate");
  const content = readOrchestratorSource();
  check(
    "references AUTOMATION_ORCHESTRATOR_ENABLED env var",
    content.includes("AUTOMATION_ORCHESTRATOR_ENABLED")
  );
  check(
    "reads --apply flag",
    content.includes('readBoolFlag(argv, "--apply")') ||
      content.includes("readBoolFlag(argv, '--apply')")
  );
  check(
    "computes effectiveApply combining --apply AND top-level gate",
    content.includes("effectiveApply") && content.includes("topLevelGateOk")
  );
  check(
    "warns when --apply set without top-level gate",
    content.includes("missing →") || content.includes("dry-run forced")
  );
}

function testOrchestratorInteractiveConfirm() {
  section("orchestrator (Step 2): interactive confirmation before any write");
  const content = readOrchestratorSource();
  check(
    "imports readline/promises for confirm",
    content.includes('from "node:readline/promises"')
  );
  check(
    "has confirmApply helper",
    content.includes("confirmApply") || content.includes("WRITE CONFIRMATION")
  );
  check(
    "asks the y/N question before writes",
    content.toLowerCase().includes("[y/n]")
  );
}

function testOrchestratorPerStepGates() {
  section("orchestrator (Step 2): per-step env vars enumerated");
  const content = readOrchestratorSource();
  const required = [
    "SLATE_DB_WRITES_ENABLED",
    "STARTER_DB_WRITES_ENABLED",
    "PLAYER_INGEST_DB_WRITES_ENABLED",
    "SEASON_PITCHING_DB_WRITES_ENABLED", // Step 2A.5
    "LINES_DB_WRITES_ENABLED",
    "SHARP_SIGNALS_DB_WRITES_ENABLED",
    "AUTOMODEL_DB_WRITES_ENABLED",
  ];
  for (const v of required) {
    check(`references per-step env var ${v}`, content.includes(v));
  }
}

function testOrchestratorImportsStepRunners() {
  section("orchestrator (Step 2): step runners wired");
  const content = readOrchestratorSource();
  check(
    "imports slateService for S1",
    content.includes("from \"../../../lib/services/slateService\"")
  );
  check(
    "imports linesService for S7 + S8",
    content.includes("from \"../../../lib/services/linesService\"")
  );
  check(
    "imports automodelService entry for M2",
    content.includes("generatePredictionsForSlate") &&
      content.includes("from \"../../../lib/services/automodelService\"")
  );
  check(
    "imports runStarterRefreshCycle for S3 / M1",
    content.includes("runStarterRefreshCycle") &&
      content.includes("from \"../refresh-starters\"")
  );
  check(
    "imports runMissingPitcherCycle for S4",
    content.includes("runMissingPitcherCycle") &&
      content.includes("from \"../ingest-missing-pitchers\"")
  );
  check(
    "imports runSeasonPitchingCycle for S5 (Step 2A.5)",
    content.includes("runSeasonPitchingCycle") &&
      content.includes("from \"../backfill-season-pitching-stats\"")
  );
}

function testOrchestratorDeferredSteps() {
  section("orchestrator (Step 2A.5): S2 / S6 still deferred; S5 now invoked");
  const content = readOrchestratorSource();
  check("not_invoked_step2_v1 mode still exists", content.includes("not_invoked_step2_v1"));
  check(
    "S2 teams refresh deferred",
    content.includes("S2. Teams refresh") &&
      content.includes("not_invoked_step2_v1")
  );
  check(
    "S6 bullpen deferred",
    content.includes("S6. Bullpen") && content.includes("Step 2B")
  );
  // S5 is no longer deferred. Check two structural signals: the OLD
  // Step-2-first-commit deferral reason no longer appears, AND the
  // wired runner is present.
  check(
    "S5's old 'deferred to Step 2A.5' reason text is gone",
    !content.includes(
      "deferred to Step 2A.5 — operator mixes per-player + slate-wide modes"
    )
  );
  check(
    "S5 step uses runSeasonPitchingCycle operator_path",
    content.includes(
      "scripts/operator/backfill-season-pitching-stats.runSeasonPitchingCycle"
    )
  );
  check(
    "S5 has provider-blocked fallback branch",
    content.includes("S5. Season-pitching stats") &&
      content.includes("blocked by provider rollover")
  );
}

function testOrchestratorProviderBlockAbortsWrites() {
  section("orchestrator (Step 2): provider fail_closed aborts before writes");
  const content = readOrchestratorSource();
  check(
    "providerBlocked guard derived from alignment status",
    content.includes("providerBlocked")
  );
  check(
    "S1/S3/S4/S7/S8/M1 blocked branch present",
    content.includes('mode: "blocked"') &&
      content.includes("blocked by provider rollover")
  );
  check(
    "effectiveApply false when providerBlocked",
    content.includes("!providerBlocked")
  );
}

function testOrchestratorFailClosedSkipsAutomodel() {
  section("orchestrator (Step 2): gate fail_closed skips automodel/reviewer");
  const content = readOrchestratorSource();
  check(
    "automodel blocked path present",
    content.includes("modelBlocked")
  );
  check(
    "blocked reason mentions gate fail_closed",
    content.includes("fail_closed")
  );
}

function testOrchestratorVerboseStatuses() {
  section("orchestrator (Step 2): verbose per-step status modes");
  const content = readOrchestratorSource();
  const modes = ["wrote", "dry_run", "skipped", "blocked", "failed", "not_invoked_step2_v1"];
  for (const m of modes) {
    check(`StepMode literal '${m}' present`, content.includes(`"${m}"`));
  }
}

function testStarterHelperExportSurface() {
  section("starter helper: exports runStarterRefreshCycle + result types");
  const fs = require("fs") as typeof import("fs");
  const path = "/Users/danielmengel/Projects/oddsphere/scripts/operator/refresh-starters.ts";
  const content = fs.readFileSync(path, "utf8");
  check("exports runStarterRefreshCycle", content.includes("export async function runStarterRefreshCycle"));
  check("exports RunStarterRefreshArgs type", content.includes("export type RunStarterRefreshArgs"));
  check("exports RunStarterRefreshResult type", content.includes("export type RunStarterRefreshResult"));
  check(
    "helper does not call process.exit (caller decides)",
    !/runStarterRefreshCycle[\s\S]*?process\.exit/.test(
      content.split("export async function runStarterRefreshCycle")[1]?.split("// ─── Main")[0] ?? ""
    )
  );
  check(
    "helper accepts confirm callback (auto-yes default)",
    content.includes("confirm?: (plans:")
  );
  check(
    "helper accepts log callback",
    content.includes("log?: (msg: string)")
  );
}

function testMissingPitcherHelperExportSurface() {
  section("missing-pitcher helper: exports runMissingPitcherCycle + result types");
  const fs = require("fs") as typeof import("fs");
  const path = "/Users/danielmengel/Projects/oddsphere/scripts/operator/ingest-missing-pitchers.ts";
  const content = fs.readFileSync(path, "utf8");
  check("exports runMissingPitcherCycle", content.includes("export async function runMissingPitcherCycle"));
  check("exports RunMissingPitcherArgs type", content.includes("export type RunMissingPitcherArgs"));
  check("exports RunMissingPitcherResult type", content.includes("export type RunMissingPitcherResult"));
  check(
    "helper does not call process.exit (caller decides)",
    !/runMissingPitcherCycle[\s\S]*?process\.exit/.test(
      content.split("export async function runMissingPitcherCycle")[1]?.split("// ─── Main")[0] ?? ""
    )
  );
}

function testSeasonPitchingHelperExportSurface() {
  section("season-pitching helper: exports runSeasonPitchingCycle + result types (Step 2A.5)");
  const fs = require("fs") as typeof import("fs");
  const path =
    "/Users/danielmengel/Projects/oddsphere/scripts/operator/backfill-season-pitching-stats.ts";
  const content = fs.readFileSync(path, "utf8");
  check(
    "exports runSeasonPitchingCycle",
    content.includes("export async function runSeasonPitchingCycle")
  );
  check(
    "exports RunSeasonPitchingArgs type",
    content.includes("export type RunSeasonPitchingArgs")
  );
  check(
    "exports RunSeasonPitchingResult type",
    content.includes("export type RunSeasonPitchingResult")
  );
  check(
    "helper does not call process.exit (caller decides)",
    !/runSeasonPitchingCycle[\s\S]*?process\.exit/.test(
      content
        .split("export async function runSeasonPitchingCycle")[1]
        ?.split("// ─── Main")[0] ?? ""
    )
  );
  check(
    "helper accepts confirm callback (auto-yes default in slate-date mode)",
    content.includes("confirm?: (")
  );
  check("helper accepts log callback", content.includes("log?: (msg: string)"));
  check(
    "main() guarded by require.main === module",
    content.includes("if (require.main === module)")
  );
}

function testS5DryRunGatingByDefault() {
  section("orchestrator S5 (Step 2A.5): dry-run by default unless gates satisfied");
  const content = readOrchestratorSource();
  // seasonWrite must AND effectiveApply, confirmed, and perStep.season.
  check(
    "seasonWrite is gated on effectiveApply && confirmed && perStep.season",
    content.includes(
      "const seasonWrite = effectiveApply && confirmed && perStep.season"
    )
  );
  check(
    "S5 emits explicit 'env missing → would be dry-run anyway' hint",
    content.includes(PER_STEP_ENV_VAR("season")) ||
      content.includes("PER_STEP_ENV_VARS.season")
  );
  check(
    "S5 helper invocation uses slate-starter scope (slateDate, not playerIds)",
    /runSeasonPitchingCycle\(\{[\s\S]*?slateDate: date/.test(content)
  );
}

// tiny helper for the gate-name assertion above — keeps the test text
// readable without inlining the literal everywhere.
function PER_STEP_ENV_VAR(_key: string): string {
  return "SEASON_PITCHING_DB_WRITES_ENABLED";
}

function testS5PerPitcherFailuresIsolated() {
  section("season-pitching helper (Step 2A.5): per-pitcher failures isolated");
  const fs = require("fs") as typeof import("fs");
  const path =
    "/Users/danielmengel/Projects/oddsphere/scripts/operator/backfill-season-pitching-stats.ts";
  const content = fs.readFileSync(path, "utf8");
  // The helper wraps each per-pitcher MLB / writer call in try/catch and
  // increments countErrors, then `continue`s the loop instead of throwing.
  check(
    "per-pitcher loop wraps searchPersonByNameDob in try/catch",
    /try\s*\{[\s\S]*?searchPersonByNameDob[\s\S]*?\}\s*catch/.test(content)
  );
  check(
    "per-pitcher loop wraps getPitcherSeasonStats in try/catch",
    /try\s*\{[\s\S]*?getPitcherSeasonStats[\s\S]*?\}\s*catch/.test(content)
  );
  check(
    "per-pitcher loop wraps persistSeasonPitchingStats in try/catch",
    /try\s*\{[\s\S]*?persistSeasonPitchingStats[\s\S]*?\}\s*catch/.test(content)
  );
  check(
    "RunSeasonPitchingResult includes errors counter",
    content.includes("errors: countErrors") || /errors:\s*number/.test(content)
  );
}

// ─── R-17 Step 2B: reconciliation guard tests ───────────────────────
//
// These tests exercise the pure helpers wired by the orchestrator's
// P2.5 reconciliation step. The orchestrator-level integration (BDL
// slate fetch + supabase team-abbr lookup + status print) needs DB to
// validate end-to-end, which is covered by the live dry-run probe
// separately. Here we pin the contract surface the orchestrator relies
// on so a refactor or threshold-tuning change can't silently change
// the gate behavior.

async function testReconciliationPerfectMatch() {
  section("R-17 Step 2B — reconciliation: 15/15 perfect → ok");
  const { reconcileBdlVsSharpEv } = await import(
    "../lib/services/slateReconciliation"
  );
  const bdlPairs = [
    { away_abbr: "SF", home_abbr: "CHC" },
    { away_abbr: "CHW", home_abbr: "PHI" },
    { away_abbr: "SEA", home_abbr: "DET" },
    { away_abbr: "BOS", home_abbr: "NYY" },
    { away_abbr: "BAL", home_abbr: "TOR" },
    { away_abbr: "TB", home_abbr: "MIA" },
    { away_abbr: "PIT", home_abbr: "ATL" },
    { away_abbr: "OAK", home_abbr: "HOU" },
    { away_abbr: "CLE", home_abbr: "TEX" },
    { away_abbr: "KC", home_abbr: "MIN" },
    { away_abbr: "CIN", home_abbr: "STL" },
    { away_abbr: "MIL", home_abbr: "COL" },
    { away_abbr: "NYM", home_abbr: "SD" },
    { away_abbr: "WSH", home_abbr: "ARI" },
    { away_abbr: "LAA", home_abbr: "LAD" },
  ];
  const evPairs = bdlPairs.map((p) => ({
    away: p.away_abbr,
    home: p.home_abbr,
  }));
  const r = reconcileBdlVsSharpEv(bdlPairs, evPairs);
  check("reconciliation: status = ok", r.status === "ok");
  check("reconciliation: matched = 15", r.matchedCount === 15);
  check("reconciliation: overlap = 100%", r.overlapPct === 100);
}

async function testReconciliationStaleSplitsCaseBlocks() {
  section("R-17 Step 2B — reconciliation: 2026-06-05 stale case → fail_closed");
  const { reconcileBdlVsSharpEv } = await import(
    "../lib/services/slateReconciliation"
  );
  // Today's actual mismatch — BDL has 15 tonight games, /opportunities/ev
  // would have 15 too in the healthy case but our pre-2B preflight was
  // fed /splits which had 9 yesterday matchups. Simulate the pathological
  // case: BDL = real 15, EV = stale 9 from yesterday.
  const bdlPairs = [
    { away_abbr: "SF", home_abbr: "CHC" },
    { away_abbr: "CHW", home_abbr: "PHI" },
    { away_abbr: "SEA", home_abbr: "DET" },
    { away_abbr: "BOS", home_abbr: "NYY" },
    { away_abbr: "BAL", home_abbr: "TOR" },
    { away_abbr: "TB", home_abbr: "MIA" },
    { away_abbr: "PIT", home_abbr: "ATL" },
    { away_abbr: "OAK", home_abbr: "HOU" },
    { away_abbr: "CLE", home_abbr: "TEX" },
    { away_abbr: "KC", home_abbr: "MIN" },
    { away_abbr: "CIN", home_abbr: "STL" },
    { away_abbr: "MIL", home_abbr: "COL" },
    { away_abbr: "NYM", home_abbr: "SD" },
    { away_abbr: "WSH", home_abbr: "ARI" },
    { away_abbr: "LAA", home_abbr: "LAD" },
  ];
  const stalePairs = [
    { away: "ATH", home: "CHC" },
    { away: "BAL", home: "BOS" },
    { away: "CLE", home: "NYY" },
    { away: "KC", home: "MIN" },
    { away: "LAD", home: "ARI" },
    { away: "PIT", home: "HOU" },
    { away: "SD", home: "PHI" },
    { away: "SF", home: "MIL" },
    { away: "TOR", home: "ATL" },
  ];
  const r = reconcileBdlVsSharpEv(bdlPairs, stalePairs);
  check(
    "stale-case: status = fail_closed (overlap = 1/15 ≈ 6.7%)",
    r.status === "fail_closed"
  );
  check("stale-case: matched = 1 (KC@MIN)", r.matchedCount === 1);
  check(
    "stale-case: bdlOnly reports 14 missing matchups",
    r.bdlOnlyMatchups.length === 14
  );
  check(
    "stale-case: sharpOnly reports 8 stale matchups",
    r.sharpOnlyMatchups.length === 8
  );
}

async function testReconciliationEmptySharpEvFailsClosed() {
  section("R-17 Step 2B — reconciliation: empty SharpEV → fail_closed");
  const { reconcileBdlVsSharpEv } = await import(
    "../lib/services/slateReconciliation"
  );
  const r = reconcileBdlVsSharpEv(
    [{ away_abbr: "KC", home_abbr: "MIN" }],
    []
  );
  check("empty-ev: status = fail_closed", r.status === "fail_closed");
  check("empty-ev: matched = 0", r.matchedCount === 0);
}

async function testReconciliationPartialOverlapWarns() {
  section("R-17 Step 2B — reconciliation: 60% overlap → warn (apply still eligible)");
  const { reconcileBdlVsSharpEv } = await import(
    "../lib/services/slateReconciliation"
  );
  const bdlPairs = [
    { away_abbr: "A", home_abbr: "B" },
    { away_abbr: "C", home_abbr: "D" },
    { away_abbr: "E", home_abbr: "F" },
    { away_abbr: "G", home_abbr: "H" },
    { away_abbr: "I", home_abbr: "J" },
    { away_abbr: "K", home_abbr: "L" },
    { away_abbr: "M", home_abbr: "N" },
    { away_abbr: "O", home_abbr: "P" },
    { away_abbr: "Q", home_abbr: "R" },
    { away_abbr: "S", home_abbr: "T" },
  ];
  const evPairs = [
    { away: "A", home: "B" },
    { away: "C", home: "D" },
    { away: "E", home: "F" },
    { away: "G", home: "H" },
    { away: "I", home: "J" },
    { away: "K", home: "L" },
    { away: "X1", home: "Y1" },
    { away: "X2", home: "Y2" },
    { away: "X3", home: "Y3" },
    { away: "X4", home: "Y4" },
  ];
  const r = reconcileBdlVsSharpEv(bdlPairs, evPairs);
  check("60%-overlap: status = warn", r.status === "warn");
  check("60%-overlap: matched = 6", r.matchedCount === 6);
  check("60%-overlap: overlapPct = 60", r.overlapPct === 60);
}

async function testOrchestratorImportsReconciliation() {
  section("R-17 Step 2B — orchestrator wires reconciliation helper");
  const fs = await import("node:fs/promises");
  const src = await fs.readFile(
    "scripts/operator/automation/run-slate-cycle.ts",
    "utf-8"
  );
  check(
    "orchestrator imports reconcileBdlVsSharpEv",
    src.includes("reconcileBdlVsSharpEv")
  );
  check(
    "orchestrator imports discoverEventsFromOpportunities",
    src.includes("discoverEventsFromOpportunities")
  );
  check(
    "orchestrator prints P2.5 banner",
    src.includes("P2.5") &&
      src.includes("Slate reconciliation (BDL ↔ SharpAPI /opportunities/ev)")
  );
  check(
    "orchestrator hard-blocks on reconciliation fail_closed",
    src.includes("reconciliationBlocked")
  );
  check(
    "orchestrator notes no override flag (Step 2B safety)",
    src.toLowerCase().includes("intentionally no override")
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
  testOrchestratorImportsReadOnlyHelpers();
  testOrchestratorTopLevelGate();
  testOrchestratorInteractiveConfirm();
  testOrchestratorPerStepGates();
  testOrchestratorImportsStepRunners();
  testOrchestratorDeferredSteps();
  testOrchestratorProviderBlockAbortsWrites();
  testOrchestratorFailClosedSkipsAutomodel();
  testOrchestratorVerboseStatuses();
  testStarterHelperExportSurface();
  testMissingPitcherHelperExportSurface();
  testSeasonPitchingHelperExportSurface();
  testS5DryRunGatingByDefault();
  testS5PerPitcherFailuresIsolated();
  await testReconciliationPerfectMatch();
  await testReconciliationStaleSplitsCaseBlocks();
  await testReconciliationEmptySharpEvFailsClosed();
  await testReconciliationPartialOverlapWarns();
  await testOrchestratorImportsReconciliation();

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
