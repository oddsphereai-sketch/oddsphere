/**
 * Tests for the production data-mode filter (Gap-23 fix).
 *
 * Framework reference: planning-docs/SHARP_SIGNAL_FRAMEWORK.md
 * §"Signal Source Quality":
 *   "mock data NEVER ships to production member surfaces."
 *
 * Verifies:
 *   1. isProductionDataMode() reads ODDSPHERE_DATA_MODE correctly
 *   2. applyProductionSourceFilter is a no-op in dev / preview
 *   3. filterMockSourceRows is a no-op in dev / preview
 *   4. Both helpers exclude mock rows when ODDSPHERE_DATA_MODE=production
 *   5. End-to-end: /api/lab/daily-edge filters out the seed slate's mock
 *      games in production mode, returns them in dev mode
 *   6. End-to-end: /api/lab/player-props and /api/lab/tracking respect the
 *      same flag
 *
 * Test design: mutates process.env.ODDSPHERE_DATA_MODE inline and restores
 * it in afterAll(). Standard pattern for env-conditional code. Other suites
 * never read this env var so cross-suite interference is impossible.
 *
 * Run with: npm run test:production-source-filter
 */

import {
  isProductionDataMode,
  applyProductionSourceFilter,
  filterMockSourceRows,
} from "../lib/db/productionFilter";
import { supabase } from "../lib/db/supabase";
import { GET as dailyEdge } from "../app/api/lab/daily-edge/route";
import { GET as playerProps } from "../app/api/lab/player-props/route";
import { GET as tracking } from "../app/api/lab/tracking/route";
import type {
  DailyEdgeResponse,
  PlayerPropsResponse,
  TrackingResponse,
} from "../app/lab/lib/labTypes";

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

function section(t: string) {
  console.log(`\n━━━ ${t} ━━━`);
}

const ORIGINAL_MODE = process.env.ODDSPHERE_DATA_MODE;

function setMode(value: string | undefined) {
  if (value === undefined) delete process.env.ODDSPHERE_DATA_MODE;
  else process.env.ODDSPHERE_DATA_MODE = value;
}

function restoreMode() {
  setMode(ORIGINAL_MODE);
}

async function main() {
  // ─── isProductionDataMode env-var reading ─────────────────────────────────
  section("isProductionDataMode env-var reading");

  setMode(undefined);
  check(
    "unset ODDSPHERE_DATA_MODE → isProductionDataMode() === false",
    isProductionDataMode() === false
  );

  setMode("development");
  check(
    "ODDSPHERE_DATA_MODE='development' → false",
    isProductionDataMode() === false
  );

  setMode("preview");
  check(
    "ODDSPHERE_DATA_MODE='preview' → false (only 'production' activates)",
    isProductionDataMode() === false
  );

  setMode("PRODUCTION");
  check(
    "ODDSPHERE_DATA_MODE='PRODUCTION' (uppercase) → false (case-sensitive)",
    isProductionDataMode() === false
  );

  setMode("production");
  check(
    "ODDSPHERE_DATA_MODE='production' → true",
    isProductionDataMode() === true
  );

  // ─── applyProductionSourceFilter behavior ─────────────────────────────────
  section("applyProductionSourceFilter — query builder chain");

  // Mock the query builder shape — we only care that .neq() is called or not.
  function makeMockBuilder() {
    const calls: Array<{ col: string; val: string }> = [];
    const builder = {
      neq(col: string, val: string) {
        calls.push({ col, val });
        return builder;
      },
    };
    return { builder, calls };
  }

  setMode("development");
  {
    const { builder, calls } = makeMockBuilder();
    const returned = applyProductionSourceFilter(builder);
    check(
      "dev mode: no-op (no .neq call, returns builder unchanged)",
      calls.length === 0 && returned === builder
    );
  }

  setMode("production");
  {
    const { builder, calls } = makeMockBuilder();
    const returned = applyProductionSourceFilter(builder);
    check(
      "prod mode: chains .neq('source_type', 'mock')",
      calls.length === 1 &&
        calls[0]!.col === "source_type" &&
        calls[0]!.val === "mock" &&
        returned === builder
    );
  }

  // ─── filterMockSourceRows behavior ────────────────────────────────────────
  section("filterMockSourceRows — array post-filter");

  type Row = { id: number; source_type: string | null };
  const sample: Row[] = [
    { id: 1, source_type: "mock" },
    { id: 2, source_type: "real_api" },
    { id: 3, source_type: "manual" },
    { id: 4, source_type: null },
    { id: 5, source_type: "mock" },
  ];

  setMode("development");
  {
    const out = filterMockSourceRows(sample, (r) => r.source_type);
    check(
      "dev mode: array unchanged",
      out.length === sample.length && out[0]?.id === 1 && out[4]?.id === 5
    );
  }

  setMode("production");
  {
    const out = filterMockSourceRows(sample, (r) => r.source_type);
    check(
      "prod mode: drops mock rows, keeps real_api / manual / null",
      out.length === 3 &&
        out.every((r) => r.source_type !== "mock") &&
        out.some((r) => r.source_type === "real_api") &&
        out.some((r) => r.source_type === "manual") &&
        out.some((r) => r.source_type === null)
    );
  }

  // ─── End-to-end: /api/lab/daily-edge ──────────────────────────────────────
  section("E2E /api/lab/daily-edge across modes");

  // The seed slate is all-mock. In production mode the route should return
  // zero games for it; in dev mode it returns the full 12-game slate.

  setMode("development");
  {
    const res = await dailyEdge(
      new Request("http://localhost/api/lab/daily-edge?sport=mlb&date=2026-05-22")
    );
    const body = (await res.json()) as DailyEdgeResponse;
    check(
      "dev mode: daily-edge surfaces the seed slate (12 games)",
      body.games.length === 12,
      `got ${body.games.length}`
    );
  }

  setMode("production");
  {
    const res = await dailyEdge(
      new Request("http://localhost/api/lab/daily-edge?sport=mlb&date=2026-05-22")
    );
    const body = (await res.json()) as DailyEdgeResponse;
    check(
      "prod mode: daily-edge filters all mock games → empty",
      body.games.length === 0,
      `got ${body.games.length}`
    );
    check(
      "prod mode: response shape preserved (no DTO meta field added)",
      typeof body.date === "string" &&
        Array.isArray(body.games) &&
        body.games.length === 0 &&
        !("data_source" in body) &&
        !("data_mode" in body)
    );
  }

  // ─── E2E /api/lab/player-props ────────────────────────────────────────────
  section("E2E /api/lab/player-props across modes");

  setMode("development");
  {
    const res = await playerProps(
      new Request("http://localhost/api/lab/player-props?sport=mlb&date=2026-05-22")
    );
    const body = (await res.json()) as PlayerPropsResponse;
    const devCount = body.entries.length;
    check(
      "dev mode: player-props returns mock entries (count > 0 on seed)",
      devCount > 0,
      `got ${devCount}`
    );

    setMode("production");
    const res2 = await playerProps(
      new Request("http://localhost/api/lab/player-props?sport=mlb&date=2026-05-22")
    );
    const body2 = (await res2.json()) as PlayerPropsResponse;
    check(
      "prod mode: player-props filters mock entries (count === 0 on seed)",
      body2.entries.length === 0,
      `got ${body2.entries.length}`
    );
  }

  // ─── E2E /api/lab/tracking ────────────────────────────────────────────────
  section("E2E /api/lab/tracking across modes");

  setMode("development");
  {
    const res = await tracking(new Request("http://localhost/api/lab/tracking"));
    const body = (await res.json()) as TrackingResponse;
    const devTotal = body.allTimeAggregate.totalPredictions;
    check(
      "dev mode: tracking includes mock prediction_results (totalPredictions > 0 on seed)",
      devTotal > 0,
      `got ${devTotal}`
    );

    setMode("production");
    const res2 = await tracking(
      new Request("http://localhost/api/lab/tracking")
    );
    const body2 = (await res2.json()) as TrackingResponse;
    check(
      "prod mode: tracking excludes mock results (totalPredictions === 0 on seed)",
      body2.allTimeAggregate.totalPredictions === 0,
      `got ${body2.allTimeAggregate.totalPredictions}`
    );
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────────
  restoreMode();
  check(
    "afterAll restored ODDSPHERE_DATA_MODE to original value",
    process.env.ODDSPHERE_DATA_MODE === ORIGINAL_MODE
  );

  // ─── DB sanity — confirm seed slate is all-mock so the E2E asserts make
  // sense. If a future seed introduces real_api rows this assertion catches
  // the divergence.
  section("DB sanity");
  const { data: games } = await supabase
    .from("games")
    .select("id")
    .eq("sport", "mlb")
    .eq("slate_date", "2026-05-22");
  const gameIds = (games ?? []).map((g: { id: number }) => g.id);
  if (gameIds.length > 0) {
    const { data: preds } = await supabase
      .from("game_predictions")
      .select("source_type")
      .in("game_id", gameIds);
    const totalPreds = (preds ?? []).length;
    const mockPreds = ((preds ?? []) as Array<{ source_type: string }>).filter(
      (p) => p.source_type === "mock"
    ).length;
    check(
      "seed slate game_predictions are all source_type='mock' (precondition for E2E asserts)",
      totalPreds > 0 && mockPreds === totalPreds,
      `total=${totalPreds} mock=${mockPreds}`
    );
  }

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All production-source-filter tests passed.`);
}

main().catch((e) => {
  // Always restore env on crash so subsequent suites aren't poisoned.
  restoreMode();
  console.error("\n❌ test-production-source-filter failed:", (e as Error).message);
  if ((e as Error).stack) console.error((e as Error).stack);
  process.exit(1);
});
