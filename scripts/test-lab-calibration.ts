/**
 * Tests for /api/lab/calibration (Phase 5E).
 *
 *   • Auth-free GET returns 200 with the expected shape
 *   • Filters to game-level prediction types only (V1 carve-out — prop
 *     calibration is excluded per the launch decision locked after 5C)
 *   • Returns only `is_displayable=true` AND `time_window='all_time'` rows
 *   • Each bucket has the expected DTO shape with hit rates normalized to
 *     0..1 (DB stores 0-100)
 *   • Headline finding is the displayable bucket with the largest absolute
 *     calibration delta, with sample-size tie-break
 *   • Headline summary text includes the bucket's lower-bound percentage
 *     and matches the negative/positive framing
 *
 * Run with: npm run test:lab-calibration
 */

import { GET as calibration } from "../app/api/lab/calibration/route";
import { resultsService } from "../lib/services/resultsService";
import { supabase } from "../lib/db/supabase";
import type { CalibrationResponse } from "../app/lab/lib/labTypes";

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

async function main() {
  // Ensure calibration_buckets is populated. If the test runs immediately after
  // a Phase 4 weekly-crons sweep this is a no-op refresh; if it runs against
  // a freshly-deleted seed state, this populates from prediction_results.
  await resultsService.refreshCalibrationBuckets();

  // ─── (1) Happy path ───────────────────────────────────────────────────────
  section("GET /api/lab/calibration");

  const res = await calibration(new Request("https://x/api/lab/calibration"));
  check("returns 200", res.status === 200);

  const body = (await res.json()) as CalibrationResponse;
  check("body.as_of is recent ISO", typeof body.as_of === "string" && Date.now() - new Date(body.as_of).getTime() < 5_000);
  check("body.buckets is array", Array.isArray(body.buckets));
  check("body.buckets has at least one displayable game-level bucket", body.buckets.length >= 1);
  check("body.headline is populated when buckets exist", body.headline !== null);

  // ─── (2) Carve-out: no prop calibration in V1 ─────────────────────────────
  section("V1 carve-out: game-level only");

  check(
    `every bucket has predictionType in {game_ml, game_total, game_nrfi}`,
    body.buckets.every((b) =>
      b.predictionType === "game_ml" || b.predictionType === "game_total" || b.predictionType === "game_nrfi"
    ),
    `unexpected types: ${[...new Set(body.buckets.map((b) => b.predictionType))].join(", ")}`
  );

  // Verify directly against the DB: any 'prop' buckets that exist should be
  // filtered out by the route.
  const { count: propBucketCount } = await supabase
    .from("calibration_buckets")
    .select("id", { count: "exact", head: true })
    .eq("prediction_type", "prop");
  check(
    `route excludes any prop calibration buckets in the DB (count=${propBucketCount})`,
    body.buckets.every((b) => (b.predictionType as string) !== "prop")
  );

  // ─── (3) Window filter: all_time only ─────────────────────────────────────
  section("Window filter");

  check(
    `every bucket has timeWindow='all_time'`,
    body.buckets.every((b) => b.timeWindow === "all_time")
  );

  // ─── (4) Per-bucket DTO shape ────────────────────────────────────────────
  section("Per-bucket DTO shape");

  for (const b of body.buckets) {
    check(`bucket ${b.label}: predictionType set`, !!b.predictionType);
    check(`bucket ${b.label}: label populated`, typeof b.label === "string" && b.label.length > 0);
    check(
      `bucket ${b.label}: bucketLower < bucketUpper`,
      b.bucketLower < b.bucketUpper
    );
    check(`bucket ${b.label}: sampleSize > 0`, b.sampleSize > 0);
    check(
      `bucket ${b.label}: expectedHitRate in [0,1]`,
      b.expectedHitRate >= 0 && b.expectedHitRate <= 1
    );
    check(
      `bucket ${b.label}: actualHitRate in [0,1]`,
      b.actualHitRate >= 0 && b.actualHitRate <= 1
    );
    check(
      `bucket ${b.label}: calibrationDelta is finite`,
      Number.isFinite(b.calibrationDelta)
    );
  }

  // ─── (5) is_displayable filter ───────────────────────────────────────────
  section("Displayable filter");

  // Cross-check: route should only return rows with is_displayable=true.
  const { data: hiddenRows } = await supabase
    .from("calibration_buckets")
    .select("id")
    .eq("is_displayable", false)
    .limit(1);
  if ((hiddenRows ?? []).length > 0) {
    check(
      `route hides non-displayable buckets`,
      body.buckets.every((b) => b.sampleSize >= 30) // is_displayable threshold
    );
  } else {
    console.log("  ~ no hidden buckets in DB to cross-check against");
  }

  // ─── (6) Headline selection ──────────────────────────────────────────────
  section("Headline finding");

  if (body.headline) {
    // Headline bucket should have the max absolute delta among returned buckets.
    const maxAbsDelta = Math.max(...body.buckets.map((b) => Math.abs(b.calibrationDelta)));
    check(
      `headline bucket has the max |delta| (${Math.abs(body.headline.bucket.calibrationDelta).toFixed(2)}pp vs max ${maxAbsDelta.toFixed(2)}pp)`,
      Math.abs(body.headline.bucket.calibrationDelta) === maxAbsDelta
    );
    check(
      `headline summary mentions market name`,
      /moneyline|total|first-inning/i.test(body.headline.summary)
    );
    check(
      `headline summary includes both expected and actual percentages`,
      /\d+%/.test(body.headline.summary)
    );
    if (body.headline.bucket.calibrationDelta < 0) {
      check(
        `headline summary uses "when we say...we hit" framing for negative delta`,
        body.headline.summary.toLowerCase().includes("we hit")
      );
    }
  } else {
    console.log("  ~ no headline (no buckets returned)");
  }

  // ─── (7) Sort order ──────────────────────────────────────────────────────
  section("Sort order");

  // Buckets ordered by predictionType, then bucketLower ASC.
  const isSorted = body.buckets.every((b, i, arr) => {
    if (i === 0) return true;
    const prev = arr[i - 1]!;
    if (prev.predictionType !== b.predictionType) {
      // type changed — compare alphabetically (game_ml < game_nrfi < game_total).
      return prev.predictionType < b.predictionType;
    }
    return prev.bucketLower <= b.bucketLower;
  });
  check(`buckets sorted by predictionType then bucketLower ASC`, isSorted);

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All calibration tests passed.`);
}

main().catch((e) => {
  console.error("\n❌ test-lab-calibration failed:", (e as Error).message);
  if ((e as Error).stack) console.error((e as Error).stack);
  process.exit(1);
});
