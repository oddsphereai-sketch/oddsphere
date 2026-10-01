import assert from "node:assert/strict";
import { serializeAnalyticsConsent } from "../lib/analytics/consent";
import { WHOP_MONTHLY_PLAN_ID, WHOP_ANNUAL_PLAN_ID, WHOP_API_VERSION } from "../lib/analytics/membershipConversions";

// All requests are intercepted; this test never contacts Whop, Google or a DB.
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://checkout-test.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-key";
process.env.WHOP_API_KEY = "test-only-whop-key";
process.env.GOOGLE_ANALYTICS_MEASUREMENT_ID = "G-TEST123";
const salt = "test-salt-that-is-more-than-thirty-two-characters";
process.env.CONVERSION_TRACKING_SALT = salt;
const consentId = "b3d52fea-bbb1-4c79-8e51-a467d23898fd";
const originalFetch = globalThis.fetch;
const originalWarn = console.warn;
let choice = "granted";
let failure: number | "throw" | "invalid_url" | null = null;
let whopCalls = 0;
let writes = 0;
let lastBody: Record<string, unknown> = {};
const diagnostics: unknown[][] = [];
console.warn = (...args: unknown[]) => { diagnostics.push(args); };
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin === "https://checkout-test.invalid") {
    if (url.pathname === "/rest/v1/analytics_consent_choices") return Response.json({ choice });
    if (url.pathname === "/rest/v1/checkout_attributions" && init?.method === "POST") {
      writes++;
      return new Response(null, { status: 201 });
    }
  }
  if (url.href === "https://api.whop.com/api/v1/checkout_configurations") {
    whopCalls++;
    assert.equal(init?.method, "POST");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("Api-Version-Date"), WHOP_API_VERSION);
    assert.equal(headers.has("whop-version"), false);
    lastBody = JSON.parse(String(init?.body));
    assert.deepEqual(Object.keys(lastBody).sort(), ["metadata", "mode", "plan_id"]);
    assert.equal(lastBody.mode, "payment");
    const metadata = lastBody.metadata as Record<string, unknown>;
    assert.deepEqual(Object.keys(metadata), ["oddsphere_attribution_id"]);
    assert.match(String(metadata.oddsphere_attribution_id), /^[0-9a-f-]{36}$/);
    if (failure === "throw") throw new Error("test-only timeout");
    if (typeof failure === "number") return Response.json({ error: "test-only" }, { status: failure });
    return Response.json({ purchase_url: failure === "invalid_url"
      ? "https://other.invalid/checkout/ch_test" : "https://whop.com/checkout/ch_test/" });
  }
  throw new Error(`Unexpected network call: ${url.origin}${url.pathname}`);
};

async function main() {
  const { GET } = await import("../app/api/checkout/whop/route");
  const consentCookie = serializeAnalyticsConsent({ id: consentId, choice: "granted" }, salt);
  const cookie = `oddsphere_analytics_choice=granted; oddsphere_analytics_consent=${encodeURIComponent(consentCookie)}; _ga=GA1.1.123.456`;
  const request = (plan: string, headersCookie = cookie) => new Request(`https://www.oddsphereai.com/api/checkout/whop?plan=${plan}`, { headers: { cookie: headersCookie } });
  const redirect = async (req: Request) => {
    const response = await GET(req);
    assert.equal(response.status, 302);
    return response.headers.get("location");
  };
  assert.equal(await redirect(request("monthly", "")), `https://whop.com/checkout/${WHOP_MONTHLY_PLAN_ID}`);
  assert.equal(await redirect(request("annual", "oddsphere_analytics_choice=denied")), `https://whop.com/checkout/${WHOP_ANNUAL_PLAN_ID}`);
  choice = "denied";
  assert.equal(await redirect(request("monthly")), `https://whop.com/checkout/${WHOP_MONTHLY_PLAN_ID}`, "withdrawal overrides the old signed cookie");
  assert.equal(whopCalls, 0);
  assert.equal(writes, 0);
  choice = "granted";
  assert.equal(await redirect(request("monthly")), "https://whop.com/checkout/ch_test/");
  assert.equal(lastBody.plan_id, WHOP_MONTHLY_PLAN_ID);
  assert.equal(await redirect(request("annual")), "https://whop.com/checkout/ch_test/");
  assert.equal(lastBody.plan_id, WHOP_ANNUAL_PLAN_ID);
  for (const error of [400, 401, 403, 422, 500, "throw", "invalid_url"] as const) {
    failure = error;
    assert.equal(await redirect(request("monthly")), `https://whop.com/checkout/${WHOP_MONTHLY_PLAN_ID}`);
  }
  assert.equal(diagnostics.length, 7);
  const logged = JSON.stringify(diagnostics);
  assert.ok(!logged.includes("test-only-whop-key") && !logged.includes(consentId) && !logged.includes("GA1.1"));
  console.log("Whop checkout relay tests passed (all network mocked)");
}

main().finally(() => { globalThis.fetch = originalFetch; console.warn = originalWarn; }).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
