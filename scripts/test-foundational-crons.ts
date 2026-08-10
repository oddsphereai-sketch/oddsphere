/**
 * Integration tests for Phase 4F foundational cron routes.
 *
 * Invokes each route's GET handler directly with a constructed Request.
 *
 *   • daily-refresh:        disabled corruption tripwire
 *   • morning-slate:        auth and fail-closed provider contract
 *   • post-game-results:    happy path, tracking + CLV refreshed
 *
 * Prerequisite: fresh `npm run seed`.
 * Run with: npm run test:foundational-crons
 */

import { supabase } from "../lib/db/supabase";
import { GET as dailyRefresh } from "../app/api/cron/daily-refresh/route";
import { GET as morningSlate } from "../app/api/cron/morning-slate/route";
import { GET as postGameResults } from "../app/api/cron/post-game-results/route";
import { restoreCuratedFixtures } from "./lib/restoreCuratedFixtures";

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
const SLATE_DATE = "2026-05-22"; // historical provider-safety fixture

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

  // The legacy BDL stats writer is an intentional 503 tripwire because its
  // provider/player namespace can corrupt seeded stats. Current refreshes are
  // owned by the leased slate-cycle routes, so the safe contract here is that
  // this obsolete endpoint refuses every invocation without touching data.
  const auth401 = await dailyRefresh(unauthedRequest());
  check("legacy writer refuses unauthenticated invocation", auth401.status === 503);
  const dailyRes = await dailyRefresh(authedRequest());
  check("legacy writer remains disabled for authenticated invocation", dailyRes.status === 503);
  const dailyBody = (await dailyRes.json()) as {
    ok: boolean;
    disabled?: boolean;
    tripwire?: string;
  };
  check("legacy writer advertises the corruption tripwire", dailyBody.ok === false && dailyBody.disabled === true && dailyBody.tripwire === "DAILY_REFRESH_DANGEROUS_ENABLE");

  // ─── morning-slate ───────────────────────────────────────────────────────
  section("/api/cron/morning-slate");

  await supabase.from("data_refresh_log").delete().eq("data_source", "morning_slate");

  // Bad auth
  const ms401 = await morningSlate(unauthedRequest());
  check("morning-slate: bad auth → 401", ms401.status === 401);

  // The historical fixture intentionally runs with MockOddsProvider. The
  // retired writer must fail closed instead of mixing mock odds into the real
  // pipeline. Current production refresh ownership is covered by the
  // slate-cycle/refresh-cycle suite.
  const msRes = await morningSlate(authedRequest(`https://x?date=${SLATE_DATE}`));
  check("morning-slate refuses non-real odds provider", msRes.status === 500);
  const msBody = (await msRes.json()) as {
    ok: boolean;
    runs: Array<{ sport: string; status: string; error?: string }>;
  };
  check("morning-slate reports at least one guarded run", msBody.runs.length >= 1);
  check("morning-slate guarded runs fail without writing", msBody.runs.every((run) => run.status === "failed"));
  check("morning-slate explains real-provider requirement", msBody.runs.some((run) => run.error?.includes("requires ODDS_PROVIDER=real_api")));

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
  check("post-game-results reports the aggregate write count honestly", typeof pgrDetails.tracking_aggregates === "number" && pgrDetails.tracking_aggregates >= 0);
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

  // 5F.3: restore the curated tonight_props fixture that the cron's
  // generatePropPredictions wiped. Self-healing so Daniel doesn't need to
  // `npm run seed` between cron-test runs and Lab browser QA.
  try {
    const r = await restoreCuratedFixtures("mlb");
    console.log(`\n  ↺ restored curated fixture: ${r.restored} props · ${r.signals_updated} signals re-derived`);
  } catch (e) {
    console.warn(`\n  ⚠ curated-fixture restore failed: ${(e as Error).message}`);
  }

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
