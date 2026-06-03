/**
 * Phase 4.2.A — Unit test for the daily-refresh tripwire guard.
 *
 * Confirms that hitting /api/cron/daily-refresh returns a 503 disabled
 * response and does NOT invoke any of the broken stats-refresh functions.
 *
 * The route is intentionally a no-op until Phase 4.3 lands. Importing
 * the route handler directly avoids needing a running dev server.
 *
 * Run: npx tsx --env-file=.env.local scripts/test-daily-refresh-tripwire.ts
 */

import { GET, POST } from "../app/api/cron/daily-refresh/route";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, hint?: string): void {
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

function section(label: string): void {
  console.log(`\n━━━ ${label} ━━━`);
}

async function testGetReturnsDisabledResponse() {
  section("GET /api/cron/daily-refresh returns 503 disabled");
  const req = new Request("http://localhost/api/cron/daily-refresh");
  const res = await GET(req);
  check("status code === 503", res.status === 503, `got ${res.status}`);
  const body = await res.json();
  check("body.ok === false", body.ok === false);
  check("body.disabled === true", body.disabled === true);
  check(
    "body.reason mentions Phase 4.3",
    typeof body.reason === "string" && body.reason.toLowerCase().includes("phase 4.3")
  );
  check(
    "body.tripwire flag is named",
    body.tripwire === "DAILY_REFRESH_DANGEROUS_ENABLE"
  );
  check("body.phase === '4.3'", body.phase === "4.3");
}

async function testPostBehavesAsGet() {
  section("POST /api/cron/daily-refresh mirrors GET behavior (cron parity)");
  const req = new Request("http://localhost/api/cron/daily-refresh", { method: "POST" });
  const res = await POST(req);
  check("POST status code === 503", res.status === 503, `got ${res.status}`);
  const body = await res.json();
  check("POST body.disabled === true", body.disabled === true);
}

async function testAuthBypass() {
  section("Tripwire fires even with valid CRON_SECRET (defense in depth)");
  // If the route were live, this would be the auth path. The tripwire
  // intentionally short-circuits BEFORE auth — the goal is to prevent
  // any execution, regardless of credentials.
  const req = new Request("http://localhost/api/cron/daily-refresh", {
    headers: { Authorization: `Bearer test-secret-value` },
  });
  const res = await GET(req);
  check("still 503 even with Authorization header", res.status === 503, `got ${res.status}`);
}

async function testQueryParamIgnored() {
  section("Tripwire fires regardless of ?date= override (no execution path)");
  const req = new Request("http://localhost/api/cron/daily-refresh?date=2026-06-03");
  const res = await GET(req);
  check("still 503 with ?date param", res.status === 503, `got ${res.status}`);
}

async function main() {
  console.log("Phase 4.2.A — daily-refresh tripwire tests");
  console.log("==========================================");

  await testGetReturnsDisabledResponse();
  await testPostBehavesAsGet();
  await testAuthBypass();
  await testQueryParamIgnored();

  console.log();
  console.log("==========================================");
  console.log(`Total: ${pass + fail}  pass: ${pass}  fail: ${fail}`);
  if (fail > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(f);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Test run crashed:", e);
  process.exit(1);
});
