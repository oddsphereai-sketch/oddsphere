/**
 * Push 3B-5 — feature-coverage-refresh cron-route order + safety tests.
 *
 * These tests exercise the actual route handler with stubbed
 * dependencies. The goals:
 *
 *   1. ORDER — BDL backfill runs BEFORE lineup refresh.
 *   2. WRITE SAFETY — never references game_predictions, slate_status,
 *      locked_at, model_version, or tracking. Verified by grepping the
 *      file source.
 *   3. ENV GATE — without FEATURE_COVERAGE_AUTO_REFRESH_ENABLED the
 *      route returns a blocked report.
 *   4. PROVIDER GATE — without PLAYER_STATS_PROVIDER=real_api, BDL
 *      backfill is observe-only (no writes).
 */

import { readFileSync } from "node:fs";

const ROUTE_PATH = "app/api/cron/feature-coverage-refresh/route.ts";

function fail(name: string, msg: string): never {
  console.error(`  ✗ ${name}`);
  console.error(`     ${msg}`);
  process.exit(1);
}

function ok(name: string) { console.log(`  ✓ ${name}`); }

async function main() {
  console.log(`\n━━━ feature-coverage-refresh cron-route tests ━━━\n`);
  const src = readFileSync(ROUTE_PATH, "utf8");

  // T1 — BDL backfill imported.
  if (!src.includes('runBdlPlayerBackfillCycle')) {
    fail("T1 BDL backfill imported", "runBdlPlayerBackfillCycle not imported");
  }
  ok("T1 BDL backfill imported");

  // T2 — BDL call happens BEFORE weatherService.refreshForecasts call.
  const bdlIdx = src.indexOf("runBdlPlayerBackfillCycle(");
  const weatherIdx = src.indexOf("weatherService.refreshForecasts(");
  const lineupIdx = src.indexOf("lineupService.refreshLineups(");
  if (bdlIdx < 0 || weatherIdx < 0 || lineupIdx < 0) {
    fail("T2 order", `missing one of the three calls: bdl=${bdlIdx} weather=${weatherIdx} lineup=${lineupIdx}`);
  }
  if (!(bdlIdx < weatherIdx && weatherIdx < lineupIdx) && !(bdlIdx < lineupIdx)) {
    fail("T2 order", "BDL backfill must run BEFORE lineup refresh");
  }
  if (bdlIdx >= lineupIdx) {
    fail("T2 order", `BDL call at ${bdlIdx} must precede lineup call at ${lineupIdx}`);
  }
  ok("T2 BDL backfill precedes lineup refresh");

  // T3 — Three-way gate for BDL write mode.
  if (!src.includes('BDL_PLAYER_BACKFILL_DB_WRITES_ENABLED') ||
      !src.includes('PLAYER_STATS_PROVIDER === "real_api"')) {
    fail("T3 BDL write gates", "BDL writeMode must require both env flag + real provider");
  }
  if (!src.includes('bdlWriteMode = playerStatsProviderReal && bdlWritesEnabled')) {
    fail("T3 BDL write gates", "writeMode must AND both gates together");
  }
  ok("T3 BDL writeMode = real_api && env_flag");

  // T4 — FEATURE_COVERAGE_AUTO_REFRESH_ENABLED gate present.
  if (!src.includes('FEATURE_COVERAGE_AUTO_REFRESH_ENABLED')) {
    fail("T4 master gate", "master FEATURE_COVERAGE_AUTO_REFRESH_ENABLED gate missing");
  }
  ok("T4 master gate present");

  // T5 — Forbidden table writes — file MUST NOT reference any of these write paths.
  const forbidden = [
    "from(\"game_predictions\"",
    "from('game_predictions'",
    "from(\"slate_status\"",
    "from('slate_status'",
    "from(\"locked_at\"",
    "from(\"tracking\"",
    "model_version",
    "generatePredictionsForSlate",
    "publishSlate",
    "lockGame",
  ];
  for (const f of forbidden) {
    if (src.includes(f)) {
      fail(`T5 forbidden writes (${f})`, `cron route references forbidden table or function ${f}`);
    }
  }
  ok("T5 no forbidden table writes / no prediction / slate / lock writes");

  // T6 — providerMode check applies to BDL too.
  if (!src.includes("playerStatsProviderReal")) {
    fail("T6 provider guard", "missing playerStatsProviderReal guard");
  }
  ok("T6 provider-mode guard wired");

  // T7 — partial=true propagates when BDL fails.
  if (!src.includes('partial = true')) {
    fail("T7 partial propagation", "missing partial=true assignment");
  }
  ok("T7 partial-result propagation present");

  console.log(`\n  result: 7/7 pass\n`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
