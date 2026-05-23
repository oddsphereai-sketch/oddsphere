/**
 * Integration tests for Phase 4F foundational cron routes.
 *
 * Invokes each route's GET handler directly with a constructed Request.
 *
 *   • daily-refresh:        auth check, happy path, lock skip
 *   • morning-slate:        auth check, happy path with full pipeline,
 *                            partial:true when no scores model
 *   • post-game-results:    happy path, tracking + CLV refreshed
 *
 * Prerequisite: fresh `npm run seed`.
 * Run with: npm run test:foundational-crons
 */

import { supabase } from "../lib/db/supabase";
import { GET as dailyRefresh } from "../app/api/cron/daily-refresh/route";
import { GET as morningSlate } from "../app/api/cron/morning-slate/route";
import { GET as postGameResults } from "../app/api/cron/post-game-results/route";

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

const TEST_SECRET = "phase4f-test-secret";
const SLATE_DATE = "2026-05-22"; // seeded slate

function authedRequest(url = "https://x"): Request {
  return new Request(url, {
    headers: { Authorization: `Bearer ${TEST_SECRET}` },
  });
}
function unauthedRequest(): Request {
  return new Request("https://x", {
    headers: { Authorization: "Bearer wrong" },
  });
}

async function main() {
  const origSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = TEST_SECRET;

  // ─── daily-refresh ───────────────────────────────────────────────────────
  section("/api/cron/daily-refresh");

  // Bad auth
  const auth401 = await dailyRefresh(unauthedRequest());
  check("bad auth → 401", auth401.status === 401);

  // Clean up any lingering daily_refresh log rows
  await supabase.from("data_refresh_log").delete().eq("data_source", "daily_refresh");

  // Happy path
  const dailyRes = await dailyRefresh(authedRequest());
  check("daily-refresh → 200", dailyRes.status === 200);
  const dailyBody = (await dailyRes.json()) as {
    ok: boolean;
    runs: Array<{ sport: string; status: string; records_updated?: number; details?: Record<string, unknown> }>;
  };
  check("daily-refresh: ok=true", dailyBody.ok === true);
  check("daily-refresh: in-season sports iterated (>= 1)", dailyBody.runs.length >= 1);
  const mlbRun = dailyBody.runs.find((r) => r.sport === "mlb");
  check("daily-refresh: mlb run present", mlbRun !== undefined);
  check("daily-refresh: mlb status=ok", mlbRun?.status === "ok");
  check(
    `daily-refresh: mlb records_updated >= 800 (players+stats+splits+pitch+injuries)`,
    (mlbRun?.records_updated ?? 0) >= 800
  );
  const dailyDetails = (mlbRun?.details ?? {}) as {
    players?: number; season_stats?: number; splits?: number; pitch_stats?: number; injuries?: number;
  };
  check(`daily-refresh: details include all 5 stages`,
    typeof dailyDetails.players === "number" &&
    typeof dailyDetails.season_stats === "number" &&
    typeof dailyDetails.splits === "number" &&
    typeof dailyDetails.pitch_stats === "number" &&
    typeof dailyDetails.injuries === "number"
  );

  // Lock skip: pre-seed an in_progress row for MLB, invoke, expect MLB skipped
  await supabase.from("data_refresh_log").delete().eq("data_source", "daily_refresh");
  await supabase.from("data_refresh_log").insert({
    data_source: "daily_refresh",
    sport: "mlb",
    refresh_started_at: new Date(Date.now() - 2 * 60_000).toISOString(),
    refresh_status: "in_progress",
  });
  const lockedRes = await dailyRefresh(authedRequest());
  const lockedBody = (await lockedRes.json()) as { runs: Array<{ sport: string; status: string }> };
  const lockedMlbRun = lockedBody.runs.find((r) => r.sport === "mlb");
  check(
    "daily-refresh: locked MLB sport produces status='skipped'",
    lockedMlbRun?.status === "skipped"
  );
  await supabase.from("data_refresh_log").delete().eq("data_source", "daily_refresh");

  // ─── morning-slate ───────────────────────────────────────────────────────
  section("/api/cron/morning-slate");

  await supabase.from("data_refresh_log").delete().eq("data_source", "morning_slate");

  // Bad auth
  const ms401 = await morningSlate(unauthedRequest());
  check("morning-slate: bad auth → 401", ms401.status === 401);

  // Happy path — pass ?date= so morning-slate hits the seeded 2026-05-22 slate
  const msRes = await morningSlate(authedRequest(`https://x?date=${SLATE_DATE}`));
  check("morning-slate → 200 (data exists)", msRes.status === 200);
  const msBody = (await msRes.json()) as {
    ok: boolean;
    runs: Array<{ sport: string; status: string; records_updated?: number; details?: Record<string, unknown> }>;
  };
  check("morning-slate: in-season sports iterated (>= 1)", msBody.runs.length >= 1);
  const msMlb = msBody.runs.find((r) => r.sport === "mlb");
  check("morning-slate: mlb status ok or partial", msMlb?.status === "ok" || msMlb?.status === "partial");
  const msDetails = (msMlb?.details ?? {}) as Record<string, unknown>;
  check("morning-slate: details.games is populated", typeof msDetails.games === "number");
  check("morning-slate: details.game_lines is populated", typeof msDetails.game_lines === "number");
  check("morning-slate: details.weather is populated", typeof msDetails.weather === "number");
  check(
    "morning-slate: details.game_predictions = 12 (Daniel uploaded)",
    msDetails.game_predictions === 12
  );
  check(
    "morning-slate: details.prop_predictions = 39 (props generated)",
    msDetails.prop_predictions === 39
  );

  // Verify the writes landed in DB
  const { count: propCount } = await supabase
    .from("prop_predictions")
    .select("*", { count: "exact", head: true });
  check("DB: prop_predictions populated after morning-slate", (propCount ?? 0) >= 39);

  await supabase.from("data_refresh_log").delete().eq("data_source", "morning_slate");

  // ─── post-game-results ────────────────────────────────────────────────────
  section("/api/cron/post-game-results");

  await supabase.from("data_refresh_log").delete().eq("data_source", "post_game_results");

  // Bad auth
  const pgr401 = await postGameResults(unauthedRequest());
  check("post-game-results: bad auth → 401", pgr401.status === 401);

  // Happy path
  const pgrRes = await postGameResults(authedRequest());
  check("post-game-results → 200", pgrRes.status === 200);
  const pgrBody = (await pgrRes.json()) as {
    ok: boolean;
    records_updated?: number;
    details?: Record<string, unknown>;
  };
  check("post-game-results: ok=true", pgrBody.ok === true);
  const pgrDetails = (pgrBody.details ?? {}) as {
    resolved_per_sport?: Record<string, number>;
    tracking_aggregates?: number;
    clv_updated?: number;
    clv_silent?: number;
  };
  check(
    "post-game-results: resolved_per_sport.mlb = 0 (no finished games in V1 mock)",
    pgrDetails.resolved_per_sport?.mlb === 0
  );
  check(
    `post-game-results: tracking_aggregates >= 20 (cross-sport refresh; yesterday window may be empty)`,
    (pgrDetails.tracking_aggregates ?? 0) >= 20
  );
  check(
    `post-game-results: clv_updated >= 290 (historical picks past 30 days)`,
    (pgrDetails.clv_updated ?? 0) >= 290
  );
  check(
    `post-game-results: clv_silent >= 150 (last 30 days)`,
    (pgrDetails.clv_silent ?? 0) >= 150
  );

  await supabase.from("data_refresh_log").delete().eq("data_source", "post_game_results");

  // Restore env
  if (origSecret) process.env.CRON_SECRET = origSecret;
  else delete process.env.CRON_SECRET;

  // ─── Summary ─────────────────────────────────────────────────────────────
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All foundational-crons tests passed.`);
}

main().catch((e) => {
  console.error("\n❌ test-foundational-crons failed:", (e as Error).message);
  if ((e as Error).stack) console.error((e as Error).stack);
  process.exit(1);
});
