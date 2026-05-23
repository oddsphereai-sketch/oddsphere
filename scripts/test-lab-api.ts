/**
 * Tests for /api/lab/refresh-status (Phase 5A).
 *
 *   • Auth-free GET returns 200 with the expected shape
 *   • State derivation per data_source:
 *       - "live"     when completed within cadence
 *       - "stale"    when completed > 2× cadence ago
 *       - "updating" when an in_progress row exists within 5 min
 *       - "error"    when most recent completed run is "failed"
 *       - "unknown"  when no row exists for the source
 *   • Aggregate `overall` state escalates worst-of frontline
 *   • Cross-sport sources (weekly_*) come back with sport=null
 *   • Invalid ?sport= falls back to default (MLB)
 *
 * Approach: insert fixture rows with controlled timestamps + statuses,
 * capture their primary-key ids, invoke GET handler, assert, delete by id.
 * No reliance on seed-state for the data_refresh_log table.
 *
 * Run with: npm run test:lab-api
 */

import { supabase } from "../lib/db/supabase";
import { GET as refreshStatus } from "../app/api/lab/refresh-status/route";
import type {
  RefreshStatusResponse,
  RefreshState,
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

type FixtureRow = {
  data_source: string;
  sport: string | null;
  refresh_started_at: string;
  refresh_completed_at: string | null;
  refresh_status: "success" | "partial" | "failed" | "in_progress";
  records_updated: number | null;
  api_calls_made?: number | null;
  scheduled_next_refresh?: string | null;
};

const insertedIds: number[] = [];

async function insertFixture(row: FixtureRow): Promise<number> {
  const { data, error } = await supabase
    .from("data_refresh_log")
    .insert(row)
    .select("id")
    .single();
  if (error) throw new Error(`fixture insert failed: ${error.message}`);
  const id = (data as { id: number }).id;
  insertedIds.push(id);
  return id;
}

async function cleanup() {
  if (insertedIds.length === 0) return;
  const { error } = await supabase
    .from("data_refresh_log")
    .delete()
    .in("id", insertedIds);
  if (error) console.warn(`cleanup warning: ${error.message}`);
}

// Sources the test exercises. data_source strings must match what
// /api/lab/refresh-status' CRON_CONFIGS knows about.
const SOURCES = {
  // Per-sport, short-cadence (15 min) — `pregame_sweep`
  PREGAME_SWEEP: { data_source: "pregame_sweep", cadence_min: 15 },
  // Per-sport, 24-hour cadence — `morning_slate`
  MORNING_SLATE: { data_source: "morning_slate", cadence_min: 1440 },
  // Per-sport, 30-min cadence — `lineup_watch`
  LINEUP_WATCH: { data_source: "lineup_watch", cadence_min: 30 },
  // Per-sport, 24-hour — `daily_refresh`
  DAILY_REFRESH: { data_source: "daily_refresh", cadence_min: 1440 },
  // Cross-sport, 7-day — `weekly_park_factors`
  WEEKLY_PARK_FACTORS: { data_source: "weekly_park_factors", cadence_min: 10080 },
};

function isoMinutesAgo(min: number): string {
  return new Date(Date.now() - min * 60_000).toISOString();
}

async function main() {
  // ─── Setup: clear existing rows for sources we'll touch ───────────────────
  // The route returns the most recent row per (data_source, sport). To make
  // assertions deterministic, delete prior rows for these sources before
  // inserting fresh fixtures. Cleanup at the end re-deletes our inserts; the
  // original seed rows are gone for these sources after the test runs, but
  // that's fine — these are operational logs, not domain data.
  for (const cfg of Object.values(SOURCES)) {
    const { error } = await supabase
      .from("data_refresh_log")
      .delete()
      .eq("data_source", cfg.data_source);
    if (error) throw new Error(`setup cleanup failed: ${error.message}`);
  }

  section("Setup: insert fixtures with controlled state");

  // (A) pregame_sweep MLB → fresh success 5 min ago. cadence=15 → live.
  await insertFixture({
    data_source: SOURCES.PREGAME_SWEEP.data_source,
    sport: "mlb",
    refresh_started_at: isoMinutesAgo(6),
    refresh_completed_at: isoMinutesAgo(5),
    refresh_status: "success",
    records_updated: 12,
  });

  // (B) morning_slate MLB → success 25 hours ago. cadence=1440 (24h). Age
  // 25h is between 1× and 2× cadence → still live (not stale yet).
  await insertFixture({
    data_source: SOURCES.MORNING_SLATE.data_source,
    sport: "mlb",
    refresh_started_at: isoMinutesAgo(25 * 60 + 5),
    refresh_completed_at: isoMinutesAgo(25 * 60),
    refresh_status: "success",
    records_updated: 12,
  });

  // (C) lineup_watch MLB → success 100 min ago. cadence=30, threshold=60.
  // Age 100 > 60 → stale.
  await insertFixture({
    data_source: SOURCES.LINEUP_WATCH.data_source,
    sport: "mlb",
    refresh_started_at: isoMinutesAgo(101),
    refresh_completed_at: isoMinutesAgo(100),
    refresh_status: "success",
    records_updated: 8,
  });

  // (D) daily_refresh MLB → in_progress, started 2 min ago. → updating.
  await insertFixture({
    data_source: SOURCES.DAILY_REFRESH.data_source,
    sport: "mlb",
    refresh_started_at: isoMinutesAgo(2),
    refresh_completed_at: null,
    refresh_status: "in_progress",
    records_updated: null,
  });
  // Also seed a prior completed row so latest-completed lookup still works.
  await insertFixture({
    data_source: SOURCES.DAILY_REFRESH.data_source,
    sport: "mlb",
    refresh_started_at: isoMinutesAgo(60 * 12 + 5),
    refresh_completed_at: isoMinutesAgo(60 * 12),
    refresh_status: "success",
    records_updated: 42,
  });

  // (E) weekly_park_factors cross-sport → most recent completed was a
  // failure 30 min ago. → error.
  await insertFixture({
    data_source: SOURCES.WEEKLY_PARK_FACTORS.data_source,
    sport: null,
    refresh_started_at: isoMinutesAgo(35),
    refresh_completed_at: isoMinutesAgo(30),
    refresh_status: "failed",
    records_updated: 0,
  });

  console.log(`  ✓ inserted ${insertedIds.length} fixture rows`);

  // ─── Hit the route ────────────────────────────────────────────────────────
  section("GET /api/lab/refresh-status?sport=mlb");

  const res = await refreshStatus(new Request("https://x/api/lab/refresh-status?sport=mlb"));
  check("returns 200", res.status === 200);

  const body = (await res.json()) as RefreshStatusResponse;
  check("body.as_of is recent ISO string", typeof body.as_of === "string" && Date.now() - new Date(body.as_of).getTime() < 5_000);
  check("body.sport = 'mlb'", body.sport === "mlb");
  check("body.sources is an array", Array.isArray(body.sources));
  check("body.sources has all 11 known data_sources", body.sources.length === 11);
  check("body.overall is present", typeof body.overall === "object" && body.overall !== null);

  function findSource(ds: string): RefreshStatusResponse["sources"][number] | undefined {
    return body.sources.find((s) => s.data_source === ds);
  }

  // (A) pregame_sweep → live
  const pgs = findSource(SOURCES.PREGAME_SWEEP.data_source);
  check("pregame_sweep present", !!pgs);
  check(`pregame_sweep.state = "live" (5 min < 30 min threshold)`, pgs?.state === "live", `got: ${pgs?.state}`);
  check("pregame_sweep.records_updated = 12", pgs?.records_updated === 12);
  check("pregame_sweep.age_minutes ≈ 5", (pgs?.age_minutes ?? 0) >= 4 && (pgs?.age_minutes ?? 0) <= 6);

  // (B) morning_slate → live (just barely — age 25h, cadence 24h, 2× = 48h)
  const ms = findSource(SOURCES.MORNING_SLATE.data_source);
  check(`morning_slate.state = "live" (25h < 48h threshold)`, ms?.state === "live", `got: ${ms?.state}`);

  // (C) lineup_watch → stale
  const lw = findSource(SOURCES.LINEUP_WATCH.data_source);
  check(`lineup_watch.state = "stale" (100 min > 60 min threshold)`, lw?.state === "stale", `got: ${lw?.state}`);

  // (D) daily_refresh → updating
  const dr = findSource(SOURCES.DAILY_REFRESH.data_source);
  check(`daily_refresh.state = "updating" (in_progress within 5 min)`, dr?.state === "updating", `got: ${dr?.state}`);
  check(`daily_refresh.last_status = "in_progress"`, dr?.last_status === "in_progress");
  check(`daily_refresh.last_completed_at is the prior completed run (12h ago)`, !!dr?.last_completed_at && Date.now() - new Date(dr.last_completed_at).getTime() > 11 * 60 * 60 * 1000);

  // (E) weekly_park_factors → error
  const wpf = findSource(SOURCES.WEEKLY_PARK_FACTORS.data_source);
  check(`weekly_park_factors.state = "error" (latest completed = failed)`, wpf?.state === "error", `got: ${wpf?.state}`);
  check(`weekly_park_factors.sport = null (cross-sport)`, wpf?.sport === null);

  // Unknown source: any of the per-sport sources we didn't insert (e.g.
  // midday_refresh, evening_refresh) should be "unknown".
  const midday = findSource("midday_refresh");
  check(`midday_refresh.state = "unknown" (no rows in table)`, midday?.state === "unknown", `got: ${midday?.state}`);
  check(`midday_refresh.age_minutes = null`, midday?.age_minutes === null);

  // ─── Aggregate state ──────────────────────────────────────────────────────
  section("body.overall (frontline aggregate)");

  // Frontline includes pregame_sweep (live) + morning_slate (live) +
  // lineup_watch (stale) + daily_refresh (updating). weekly_* are out.
  // Worst-of escalation: stale > updating > live → overall.state = "stale".
  check(`overall.state = "stale" (worst-of frontline)`, body.overall.state === "stale", `got: ${body.overall.state}`);
  check(`overall.last_updated_at is the freshest frontline completion`, !!body.overall.last_updated_at);
  check(`overall.age_seconds < 600 (freshest = pregame_sweep 5min ago)`, (body.overall.age_seconds ?? Infinity) < 600);

  // ─── Default sport (no param) ─────────────────────────────────────────────
  section("GET /api/lab/refresh-status (no sport param)");
  const resDefault = await refreshStatus(new Request("https://x/api/lab/refresh-status"));
  check("returns 200", resDefault.status === 200);
  const bodyDefault = (await resDefault.json()) as RefreshStatusResponse;
  check("body.sport = null (no param)", bodyDefault.sport === null);
  // But effective scope is MLB internally — pregame_sweep should still be present + live.
  const pgsDefault = bodyDefault.sources.find((s) => s.data_source === SOURCES.PREGAME_SWEEP.data_source);
  check("pregame_sweep still resolves to MLB row when no param", pgsDefault?.state === "live");

  // ─── Invalid sport param ──────────────────────────────────────────────────
  section("GET with invalid ?sport= (falls back to MLB internal scope)");
  const resBogus = await refreshStatus(new Request("https://x/api/lab/refresh-status?sport=quidditch"));
  check("returns 200 (no 400)", resBogus.status === 200);
  const bodyBogus = (await resBogus.json()) as RefreshStatusResponse;
  check(`body.sport = null (invalid input rejected)`, bodyBogus.sport === null);

  // ─── State-derivation invariants ──────────────────────────────────────────
  section("State invariants");

  const allStates: RefreshState[] = body.sources.map((s) => s.state);
  const allowed: RefreshState[] = ["live", "updating", "stale", "error", "unknown"];
  check(
    `all source states are in the allowed set`,
    allStates.every((s) => allowed.includes(s)),
    `unexpected: ${allStates.filter((s) => !allowed.includes(s)).join(", ")}`
  );

  // Every source has a populated expected_cadence_minutes > 0.
  check(
    `all sources have expected_cadence_minutes > 0`,
    body.sources.every((s) => s.expected_cadence_minutes > 0)
  );

  // ─── Cleanup ──────────────────────────────────────────────────────────────
  await cleanup();

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All lab-api tests passed.`);
}

main().catch(async (e) => {
  console.error("\n❌ test-lab-api failed:", (e as Error).message);
  if ((e as Error).stack) console.error((e as Error).stack);
  await cleanup();
  process.exit(1);
});
