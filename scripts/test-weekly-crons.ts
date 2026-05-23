/**
 * Tests for weekly cron routes (weekly-park-factors + weekly-calibration).
 *
 *   • Bad auth → 401
 *   • weekly-park-factors → 30 ballparks updated
 *   • weekly-calibration → calibration_buckets refreshed with displayable
 *     buckets > 0 (from the 450 seeded historical results)
 *
 * Run with: npm run test:weekly-crons
 */

import { GET as parkFactors } from "../app/api/cron/weekly-park-factors/route";
import { GET as calibration } from "../app/api/cron/weekly-calibration/route";
import { supabase } from "../lib/db/supabase";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; const msg = `  ✗ ${label}`; console.log(msg); failures.push(msg); }
}

function section(t: string) {
  console.log(`\n━━━ ${t} ━━━`);
}

const TEST_SECRET = "phase4h-weekly-secret";
function authed(): Request {
  return new Request("https://x", { headers: { Authorization: `Bearer ${TEST_SECRET}` } });
}
function unauthed(): Request {
  return new Request("https://x", { headers: { Authorization: "Bearer wrong" } });
}

async function main() {
  const origSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = TEST_SECRET;

  // Clean any lingering log rows
  for (const ds of ["weekly_park_factors", "weekly_calibration"]) {
    await supabase.from("data_refresh_log").delete().eq("data_source", ds);
  }

  // ─── weekly-park-factors ────────────────────────────────────────────────
  section("/api/cron/weekly-park-factors");

  check("bad auth → 401", (await parkFactors(unauthed())).status === 401);

  const pfRes = await parkFactors(authed());
  check("park-factors → 200", pfRes.status === 200);
  const pfBody = (await pfRes.json()) as { ok: boolean; records_updated?: number; details?: Record<string, unknown> };
  check("park-factors: ok=true", pfBody.ok === true);
  check(
    `park-factors: records_updated = 30 (one per MLB ballpark)`,
    pfBody.records_updated === 30
  );
  const pfDetails = pfBody.details as { factors_received?: number; ballparks_updated?: number } | undefined;
  check("park-factors: details.factors_received = 30", pfDetails?.factors_received === 30);
  check("park-factors: details.ballparks_updated = 30", pfDetails?.ballparks_updated === 30);

  // ─── weekly-calibration ─────────────────────────────────────────────────
  section("/api/cron/weekly-calibration");

  check("bad auth → 401", (await calibration(unauthed())).status === 401);

  const cRes = await calibration(authed());
  check("calibration → 200", cRes.status === 200);
  const cBody = (await cRes.json()) as { ok: boolean; records_updated?: number; details?: Record<string, unknown> };
  check("calibration: ok=true", cBody.ok === true);
  check(`calibration: records_updated > 0`, (cBody.records_updated ?? 0) > 0);
  const cDetails = cBody.details as { total_inputs?: number; displayable_buckets?: number } | undefined;
  check(
    `calibration: total_inputs >= 360 (historical game_predictions only — prop_predictions have no resolved results in V1 mock)`,
    (cDetails?.total_inputs ?? 0) >= 360
  );
  check(
    `calibration: displayable_buckets >= 1 (some n >= 30)`,
    (cDetails?.displayable_buckets ?? 0) >= 1
  );

  // Verify the headline calibration finding (game_ml 60-70 bucket overconfident)
  const { data: mlBucket } = await supabase
    .from("calibration_buckets")
    .select("predictions_in_bucket, actual_hit_rate, calibration_delta, is_displayable")
    .eq("sport", "mlb")
    .eq("prediction_type", "game_ml")
    .eq("market", "ml")
    .eq("confidence_bucket_lower", 60)
    .eq("time_window", "all_time")
    .single();
  check(
    `DB: game_ml 60-70 bucket exists with predictions_in_bucket > 100`,
    (mlBucket?.predictions_in_bucket ?? 0) > 100
  );
  check(
    `DB: game_ml 60-70 bucket is_displayable=true`,
    mlBucket?.is_displayable === true
  );

  // Cleanup
  for (const ds of ["weekly_park_factors", "weekly_calibration"]) {
    await supabase.from("data_refresh_log").delete().eq("data_source", ds);
  }

  if (origSecret) process.env.CRON_SECRET = origSecret;
  else delete process.env.CRON_SECRET;

  // ─── Summary ─────────────────────────────────────────────────────────────
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach(m => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All weekly-crons tests passed.`);
}

main().catch(e => {
  console.error("\n❌ test-weekly-crons failed:", (e as Error).message);
  if ((e as Error).stack) console.error((e as Error).stack);
  process.exit(1);
});
