/**
 * Unit + integration tests for Phase 4C cron infrastructure.
 *
 *   • validateCronAuth (pure)
 *   • fetchWithRetry (pure, with mocked global.fetch)
 *   • refreshLogger (live Supabase — start, complete, isAnotherRunActive, getLastCompleted)
 *   • cronHandler + cronHandlerPerSport (live Supabase — wires auth + lock + log)
 *
 * Run with: npm run test:cron-infra
 */

import { validateCronAuth } from "../lib/cron/auth";
import {
  fetchWithRetry,
  NonRetryableHttpError,
} from "../lib/cron/fetchWithRetry";
import { refreshLogger } from "../lib/services/refreshLogger";
import {
  cronHandler,
  cronHandlerPerSport,
} from "../lib/cron/runCron";
import { supabase } from "../lib/db/supabase";

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

async function checkThrows(label: string, fn: () => Promise<unknown>, expectedSubstring?: string) {
  try {
    await fn();
    fail++;
    console.log(`  ✗ ${label} did NOT throw`);
    failures.push(label);
  } catch (e) {
    const msg = (e as Error).message;
    const ok = !expectedSubstring || msg.includes(expectedSubstring);
    if (ok) {
      pass++;
      console.log(`  ✓ ${label} threw "${msg.slice(0, 70)}..."`);
    } else {
      fail++;
      console.log(`  ✗ ${label} threw wrong: ${msg}`);
      failures.push(label);
    }
  }
}

function section(t: string) {
  console.log(`\n━━━ ${t} ━━━`);
}

async function main() {
// ─── validateCronAuth (pure) ─────────────────────────────────────────────
section("validateCronAuth");

{
  const ORIGINAL_SECRET = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "test-secret-abc123";

  const goodRequest = new Request("https://x", {
    headers: { Authorization: "Bearer test-secret-abc123" },
  });
  check("correct Bearer token → ok", validateCronAuth(goodRequest).ok === true);

  const wrongTokenRequest = new Request("https://x", {
    headers: { Authorization: "Bearer wrong-secret" },
  });
  const wrongResult = validateCronAuth(wrongTokenRequest);
  check("wrong token → 401", !wrongResult.ok && wrongResult.response.status === 401);

  const missingHeader = new Request("https://x");
  const missingResult = validateCronAuth(missingHeader);
  check("missing Authorization → 401", !missingResult.ok && missingResult.response.status === 401);

  const malformedHeader = new Request("https://x", {
    headers: { Authorization: "test-secret-abc123" }, // missing "Bearer "
  });
  const malformedResult = validateCronAuth(malformedHeader);
  check("missing 'Bearer ' prefix → 401", !malformedResult.ok && malformedResult.response.status === 401);

  delete process.env.CRON_SECRET;
  const unsetResult = validateCronAuth(goodRequest);
  check("CRON_SECRET unset → 500", !unsetResult.ok && unsetResult.response.status === 500);

  // Restore
  if (ORIGINAL_SECRET) process.env.CRON_SECRET = ORIGINAL_SECRET;
}

// ─── fetchWithRetry (mocked global.fetch) ─────────────────────────────────
section("fetchWithRetry");

function mockFetch(responses: Array<Response | (() => Response)>) {
  const realFetch = global.fetch;
  let i = 0;
  global.fetch = (async () => {
    const next = responses[i++];
    if (next === undefined) throw new Error(`mockFetch exhausted at call ${i}`);
    return typeof next === "function" ? next() : next;
  }) as typeof fetch;
  return () => {
    global.fetch = realFetch;
  };
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

const noSleep = async () => {};

// 1. Success on first try
{
  const restore = mockFetch([jsonResponse({ ok: 1 })]);
  try {
    const res = await fetchWithRetry("https://x", {}, { sleep: noSleep });
    check("success on first try", res.ok && res.status === 200);
  } finally { restore(); }
}

// 2. Success on retry after 503
{
  const restore = mockFetch([
    new Response("server boom", { status: 503 }),
    jsonResponse({ ok: 1 }),
  ]);
  try {
    const res = await fetchWithRetry("https://x", {}, { sleep: noSleep, initialBackoffMs: 1 });
    check("503 → retry → success", res.ok);
  } finally { restore(); }
}

// 3. Success on retry after 429
{
  const restore = mockFetch([
    new Response("slow down", { status: 429 }),
    jsonResponse({ ok: 1 }),
  ]);
  try {
    const res = await fetchWithRetry("https://x", {}, { sleep: noSleep, initialBackoffMs: 1 });
    check("429 → retry → success", res.ok);
  } finally { restore(); }
}

// 4. Non-retryable 4xx — immediate throw
{
  const restore = mockFetch([
    new Response("bad auth", { status: 401 }),
    jsonResponse({ ok: 1 }), // would succeed if we retried
  ]);
  try {
    await checkThrows(
      "non-retryable 401 throws immediately",
      () => fetchWithRetry("https://x", {}, { sleep: noSleep, initialBackoffMs: 1 }),
      "401"
    );
  } finally { restore(); }
}

// 5. Max retries exceeded — throws after maxRetries attempts
{
  const restore = mockFetch([
    new Response("boom1", { status: 503 }),
    new Response("boom2", { status: 503 }),
    new Response("boom3", { status: 503 }),
  ]);
  try {
    await checkThrows(
      "max retries exceeded on persistent 503",
      () => fetchWithRetry("https://x", {}, { sleep: noSleep, maxRetries: 3, initialBackoffMs: 1 }),
      "503"
    );
  } finally { restore(); }
}

// 6. Network error retries
{
  const restore = mockFetch([
    () => { throw new TypeError("network down"); },
    jsonResponse({ ok: 1 }),
  ]);
  try {
    const res = await fetchWithRetry("https://x", {}, { sleep: noSleep, initialBackoffMs: 1 });
    check("network error → retry → success", res.ok);
  } finally { restore(); }
}

// 7. NonRetryableHttpError class is exported and instanceof works
{
  const restore = mockFetch([new Response("not found", { status: 404 })]);
  try {
    let caught: unknown;
    try {
      await fetchWithRetry("https://x", {}, { sleep: noSleep, initialBackoffMs: 1 });
    } catch (e) { caught = e; }
    check("404 → NonRetryableHttpError", caught instanceof NonRetryableHttpError && (caught as NonRetryableHttpError).status === 404);
  } finally { restore(); }
}

// ─── refreshLogger (live Supabase) ───────────────────────────────────────
section("refreshLogger (live Supabase)");

const TEST_DATA_SOURCE = "test_cron_infra";

// Clean up any leftover test rows first
await supabase.from("data_refresh_log").delete().eq("data_source", TEST_DATA_SOURCE);

// start → returns id; getLastCompleted returns null (no completed runs yet)
const initialLastCompleted = await refreshLogger.getLastCompleted(TEST_DATA_SOURCE, null);
check("getLastCompleted before any runs → null", initialLastCompleted === null);

const logId1 = await refreshLogger.start(TEST_DATA_SOURCE, null);
check("start returns numeric id", typeof logId1 === "number" && logId1 > 0);

// Active immediately after start
const active1 = await refreshLogger.isAnotherRunActive(TEST_DATA_SOURCE, null, 5);
check("isAnotherRunActive=true while in_progress", active1 === true);

// complete with success
await refreshLogger.complete(logId1, { success: true, records_updated: 42, api_calls_made: 7 });

// Now NOT active
const active2 = await refreshLogger.isAnotherRunActive(TEST_DATA_SOURCE, null, 5);
check("isAnotherRunActive=false after complete", active2 === false);

// getLastCompleted returns recent timestamp
const lastDone = await refreshLogger.getLastCompleted(TEST_DATA_SOURCE, null);
check("getLastCompleted returns Date after complete", lastDone instanceof Date && Math.abs(Date.now() - lastDone.getTime()) < 60_000);

// failed completion
const logId2 = await refreshLogger.start(TEST_DATA_SOURCE, null);
await refreshLogger.complete(logId2, { success: false, error_message: "synthetic failure" });
const { data: failedRow } = await supabase
  .from("data_refresh_log")
  .select("refresh_status, error_message")
  .eq("id", logId2)
  .single();
check("failed status written", failedRow?.refresh_status === "failed");
check("error_message persisted", failedRow?.error_message === "synthetic failure");

// partial completion
const logId3 = await refreshLogger.start(TEST_DATA_SOURCE, null);
await refreshLogger.complete(logId3, { success: true, partial: true });
const { data: partialRow } = await supabase
  .from("data_refresh_log")
  .select("refresh_status")
  .eq("id", logId3)
  .single();
check("partial status written", partialRow?.refresh_status === "partial");

// sport-scoped locks: same data_source different sports don't collide
const logMlb = await refreshLogger.start(TEST_DATA_SOURCE, "mlb");
const activeNba = await refreshLogger.isAnotherRunActive(TEST_DATA_SOURCE, "nba", 5);
check("MLB in_progress does NOT block NBA lock check", activeNba === false);
const activeMlb = await refreshLogger.isAnotherRunActive(TEST_DATA_SOURCE, "mlb", 5);
check("MLB in_progress DOES block its own sport check", activeMlb === true);
await refreshLogger.complete(logMlb, { success: true });

// Cleanup test rows
await supabase.from("data_refresh_log").delete().eq("data_source", TEST_DATA_SOURCE);
console.log("  (test rows cleaned up)");

// ─── cronHandler (live Supabase) ─────────────────────────────────────────
section("cronHandler (live Supabase)");

const TEST_SECRET = "phase4c-test-secret";
const ORIG_SECRET = process.env.CRON_SECRET;
process.env.CRON_SECRET = TEST_SECRET;

function authedRequest(): Request {
  return new Request("https://x", {
    headers: { Authorization: `Bearer ${TEST_SECRET}` },
  });
}

// Happy path
{
  await supabase.from("data_refresh_log").delete().eq("data_source", "test_cronHandler");
  const res = await cronHandler(
    authedRequest(),
    "test_cronHandler",
    async ({ logId }) => {
      check("handler receives non-null logId", typeof logId === "number");
      return { records_updated: 13, api_calls_made: 4 };
    }
  );
  check("cronHandler success → 200", res.status === 200);
  const body = (await res.json()) as { ok: boolean; status: string; records_updated: number };
  check("response.ok=true", body.ok === true);
  check("response.status=ok", body.status === "ok");
  check("records_updated echoed", body.records_updated === 13);

  // Row written
  const { data: row } = await supabase
    .from("data_refresh_log")
    .select("refresh_status, records_updated, api_calls_made")
    .eq("data_source", "test_cronHandler")
    .single();
  check("refresh_status=success", row?.refresh_status === "success");
  check("records_updated=13", row?.records_updated === 13);
  check("api_calls_made=4", row?.api_calls_made === 4);
  await supabase.from("data_refresh_log").delete().eq("data_source", "test_cronHandler");
}

// Bad auth
{
  const res = await cronHandler(
    new Request("https://x", { headers: { Authorization: "Bearer wrong" } }),
    "test_cronHandler",
    async () => ({ records_updated: 0 })
  );
  check("bad auth → 401", res.status === 401);
}

// Handler throws → 500 + failed status persisted
{
  await supabase.from("data_refresh_log").delete().eq("data_source", "test_cron_throw");
  const res = await cronHandler(
    authedRequest(),
    "test_cron_throw",
    async () => { throw new Error("synthetic boom"); }
  );
  check("handler throw → 500", res.status === 500);
  const { data: row } = await supabase
    .from("data_refresh_log")
    .select("refresh_status, error_message")
    .eq("data_source", "test_cron_throw")
    .single();
  check("failed status written on throw", row?.refresh_status === "failed");
  check("error_message captured", (row?.error_message ?? "").includes("synthetic boom"));
  await supabase.from("data_refresh_log").delete().eq("data_source", "test_cron_throw");
}

// Lock skip
{
  await supabase.from("data_refresh_log").delete().eq("data_source", "test_cron_lock");
  // Pre-seed an in_progress row to simulate a previous run still active
  await supabase.from("data_refresh_log").insert({
    data_source: "test_cron_lock",
    sport: null,
    refresh_started_at: new Date(Date.now() - 2 * 60_000).toISOString(),  // 2 min ago
    refresh_status: "in_progress",
  });
  let handlerCalled = false;
  const res = await cronHandler(
    authedRequest(),
    "test_cron_lock",
    async () => { handlerCalled = true; return {}; }
  );
  check("locked → handler NOT called", !handlerCalled);
  check("locked → 200 with skipped:true", res.status === 200);
  const body = (await res.json()) as { skipped?: boolean; reason?: string };
  check("response.skipped=true", body.skipped === true);
  await supabase.from("data_refresh_log").delete().eq("data_source", "test_cron_lock");
}

// Partial result
{
  await supabase.from("data_refresh_log").delete().eq("data_source", "test_cron_partial");
  await cronHandler(
    authedRequest(),
    "test_cron_partial",
    async () => ({ partial: true, records_updated: 5 })
  );
  const { data: row } = await supabase
    .from("data_refresh_log")
    .select("refresh_status")
    .eq("data_source", "test_cron_partial")
    .single();
  check("partial result → refresh_status=partial", row?.refresh_status === "partial");
  await supabase.from("data_refresh_log").delete().eq("data_source", "test_cron_partial");
}

// ─── cronHandlerPerSport ─────────────────────────────────────────────────
section("cronHandlerPerSport (live Supabase)");

{
  await supabase.from("data_refresh_log").delete().eq("data_source", "test_cron_per_sport");
  const sportsHandled: string[] = [];
  const res = await cronHandlerPerSport(
    authedRequest(),
    "test_cron_per_sport",
    ["mlb", "nba"],
    async ({ sport }) => {
      sportsHandled.push(sport ?? "null");
      return { records_updated: sport === "mlb" ? 100 : 50 };
    }
  );
  check("per-sport: 200 status when all succeed", res.status === 200);
  check("per-sport: iterates both sports", sportsHandled.length === 2 && sportsHandled.includes("mlb") && sportsHandled.includes("nba"));
  const body = (await res.json()) as { runs: Array<{ sport: string; status: string; records_updated: number }> };
  check("per-sport: response.runs has 2 entries", body.runs.length === 2);
  check("per-sport: both runs are ok", body.runs.every((r) => r.status === "ok"));
  await supabase.from("data_refresh_log").delete().eq("data_source", "test_cron_per_sport");
}

// Per-sport with one sport failing
{
  await supabase.from("data_refresh_log").delete().eq("data_source", "test_cron_mixed");
  const res = await cronHandlerPerSport(
    authedRequest(),
    "test_cron_mixed",
    ["mlb", "nba"],
    async ({ sport }) => {
      if (sport === "nba") throw new Error("nba failure");
      return { records_updated: 100 };
    }
  );
  check("per-sport: 500 when any sport fails", res.status === 500);
  const body = (await res.json()) as { ok: boolean; runs: Array<{ sport: string; status: string; error?: string }> };
  check("per-sport: ok=false on any failure", body.ok === false);
  const mlbRun = body.runs.find((r) => r.sport === "mlb");
  const nbaRun = body.runs.find((r) => r.sport === "nba");
  check("per-sport: mlb still succeeded despite nba failure", mlbRun?.status === "ok");
  check("per-sport: nba marked failed", nbaRun?.status === "failed" && (nbaRun.error ?? "").includes("nba failure"));
  await supabase.from("data_refresh_log").delete().eq("data_source", "test_cron_mixed");
}

// Restore env
if (ORIG_SECRET) process.env.CRON_SECRET = ORIG_SECRET;
else delete process.env.CRON_SECRET;

// ─── Summary ─────────────────────────────────────────────────────────────
console.log(`\n${"━".repeat(70)}`);
console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
if (fail > 0) {
  console.log(`\nFailures:`);
  failures.forEach((m) => console.log(m));
  process.exit(1);
}
console.log(`\n✅ All cron-infra tests passed.`);
}

main().catch((e) => {
  console.error("\n❌ test-cron-infra failed:", (e as Error).message);
  if ((e as Error).stack) console.error((e as Error).stack);
  process.exit(1);
});
