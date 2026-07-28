/**
 * Static regression checks for /api/cron/lineup-watch.
 *
 * Lineup-watch is the late-refresh path where MLB confirmed lineups
 * arrive. FI cards must not stay stuck on the earlier slate-cycle pass,
 * so this route must refresh FI-relevant inputs and rerun the automodel
 * for unlocked games.
 */

import { readFileSync } from "node:fs";

const ROUTE = readFileSync("app/api/cron/lineup-watch/route.ts", "utf8");
const LINEUP_SERVICE = readFileSync("lib/services/lineupService.ts", "utf8");
const VERCEL = readFileSync("vercel.json", "utf8");

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, msg?: string): void {
  if (cond) {
    console.log(`  ✓ ${name}`);
    pass++;
  } else {
    console.log(`  ✗ ${name}${msg ? `\n     ${msg}` : ""}`);
    fail++;
  }
}

console.log("\n━━━ lineup-watch FI refresh/rerun tests ━━━\n");

check(
  "imports game-line refresh service",
  ROUTE.includes('from "@/lib/services/linesService"') &&
    ROUTE.includes("refreshGameLinesV2"),
);

check(
  "imports first-inning stat refresh helper",
  ROUTE.includes("runFirstInningCycle") &&
    ROUTE.includes("backfill-first-inning-stats"),
);

check(
  "imports automodel slate generator",
  ROUTE.includes("generatePredictionsForSlate"),
);

check(
  "lineup service overlays official MLB lineups after provider refresh",
  LINEUP_SERVICE.includes("refreshMlbOfficialLineups") &&
    LINEUP_SERVICE.indexOf("officialMlb = await refreshMlbOfficialLineups") >
      LINEUP_SERVICE.indexOf('supabase.from("lineups").insert(allRows)'),
);

check(
  "MLB branch refreshes lines before automodel",
  ROUTE.indexOf("gameLines = await linesService.refreshGameLinesV2") > 0 &&
    ROUTE.indexOf("const modelRun = await generatePredictionsForSlate") >
      ROUTE.indexOf("gameLines = await linesService.refreshGameLinesV2"),
);

check(
  "MLB branch refreshes first-inning stats before automodel",
  ROUTE.indexOf("firstInning = await runFirstInningCycle") > 0 &&
    ROUTE.indexOf("const modelRun = await generatePredictionsForSlate") >
      ROUTE.indexOf("firstInning = await runFirstInningCycle"),
);

check(
  "automodel rerun respects locks",
  ROUTE.includes("respectLocks: true"),
);

check(
  "automodel writes are gated by AUTOMODEL_DB_WRITES_ENABLED",
  ROUTE.includes('process.env.AUTOMODEL_DB_WRITES_ENABLED === "true"') &&
    ROUTE.includes("skipped MLB automodel rerun"),
);

check(
  "MLB props delegate to the authoritative writer while non-MLB stays intact",
  ROUTE.includes('writer: "mlb_player_props_refresh"') &&
    ROUTE.includes('} else {') &&
    ROUTE.includes("predictionService.generatePropPredictions(sport, date)"),
);

check(
  "lineup-watch is scheduled in Vercel cron",
  VERCEL.includes('"/api/cron/lineup-watch"') &&
    VERCEL.includes('"13,43 13-23 * * *"') &&
    VERCEL.includes('"13,43 0-3 * * *"'),
);

check(
  "full props refresh does not collide with the :05 slate rebuild",
  VERCEL.includes('"/api/cron/mlb-player-props-refresh?full=true"') &&
    VERCEL.includes('"27 1,4,10,13,16,19,22 * * *"') &&
    !VERCEL.includes('"2 1,4,10,13,16,19,22 * * *"'),
);

console.log(`\n━━━ Results ━━━\n  ✓ ${pass}    ✗ ${fail}`);
if (fail > 0) process.exit(1);
