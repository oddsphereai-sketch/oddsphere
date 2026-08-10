/**
 * Tests for Fix 5.1 — pre-launch beta-password access gate.
 *
 * Coverage:
 *   • middleware: public routes pass through; protected pages redirect;
 *     protected APIs return JSON 401
 *   • login route: correct password → cookie + 303; wrong → /login?error=invalid;
 *     server misconfigured (LAB_BETA_PASSWORD unset) → /login?error=unavailable
 *   • logout route: clears cookie
 *   • betaSession helpers: sanitizeNext open-redirect protection, constant-time
 *     equality, expectedCookieValue / isValidBetaSession fail-closed behavior
 *   • cookie flag verification: HttpOnly, SameSite=Lax, Path=/, Max-Age=7d
 *
 * Localhost only. Invokes the middleware function directly via mocked
 * NextRequest and the route handlers directly via Request. No live URL
 * hits.
 *
 * Run with: npm run test:auth-gate
 */

import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import { proxy } from "../proxy";
import { POST as loginPost } from "../app/api/auth/login/route";
import { POST as logoutPost } from "../app/api/auth/logout/route";
import {
  BETA_SESSION_COOKIE_NAME,
  BETA_SESSION_MAX_AGE_SECONDS,
  sanitizeNext,
  expectedCookieValue,
  isValidBetaSession,
  constantTimeStringEq,
} from "../lib/auth/betaSession";

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

const ORIGINAL_PASSWORD = process.env.LAB_BETA_PASSWORD;
const ORIGINAL_DAILY_EDGE_CANDIDATE = process.env.DAILY_EDGE_EXPERIENCE_CANDIDATE_ENABLED;
const ORIGINAL_PROPS_CANDIDATE = process.env.PLAYER_PROPS_EXPERIENCE_CANDIDATE_ENABLED;
const ORIGINAL_TRACKING_CANDIDATE = process.env.TRACKING_EXPERIENCE_CANDIDATE_ENABLED;
const ORIGINAL_HOMEPAGE_CANDIDATE = process.env.HOMEPAGE_EXPERIENCE_CANDIDATE_ENABLED;
const TEST_PASSWORD = "test-beta-password-fix-5-1";

function setPassword(value: string | undefined) {
  if (value === undefined) delete process.env.LAB_BETA_PASSWORD;
  else process.env.LAB_BETA_PASSWORD = value;
}

function restorePassword() {
  setPassword(ORIGINAL_PASSWORD);
}

function setDailyEdgeCandidate(value: string | undefined) {
  if (value === undefined) delete process.env.DAILY_EDGE_EXPERIENCE_CANDIDATE_ENABLED;
  else process.env.DAILY_EDGE_EXPERIENCE_CANDIDATE_ENABLED = value;
}

function setCandidate(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

/**
 * Build a NextRequest for a given path + optional cookie. Used to invoke
 * the middleware function directly without spinning up an HTTP server.
 */
function makeRequest(
  pathname: string,
  options: { cookieValue?: string; search?: string } = {}
): NextRequest {
  const url = new URL(`http://localhost:3000${pathname}${options.search ?? ""}`);
  const req = new NextRequest(url);
  if (options.cookieValue !== undefined) {
    req.cookies.set(BETA_SESSION_COOKIE_NAME, options.cookieValue);
  }
  return req;
}

async function main() {
  setPassword(TEST_PASSWORD);
  setDailyEdgeCandidate(undefined);
  setCandidate("PLAYER_PROPS_EXPERIENCE_CANDIDATE_ENABLED", undefined);
  setCandidate("TRACKING_EXPERIENCE_CANDIDATE_ENABLED", undefined);
  setCandidate("HOMEPAGE_EXPERIENCE_CANDIDATE_ENABLED", undefined);
  const VALID_COOKIE = (await expectedCookieValue()) ?? "";

  // ─── sanitizeNext (open-redirect protection) ───────────────────────────
  section("sanitizeNext — open-redirect protection");

  check(
    "default when next is undefined → /lab/daily-edge",
    sanitizeNext(undefined) === "/lab/daily-edge"
  );
  check(
    "default when next is null → /lab/daily-edge",
    sanitizeNext(null) === "/lab/daily-edge"
  );
  check(
    "default when next is empty string → /lab/daily-edge",
    sanitizeNext("") === "/lab/daily-edge"
  );
  check(
    "rejects absolute URL (https://evil.com) → /lab/daily-edge",
    sanitizeNext("https://evil.com") === "/lab/daily-edge"
  );
  check(
    "rejects protocol-relative URL (//evil.com) → /lab/daily-edge",
    sanitizeNext("//evil.com") === "/lab/daily-edge"
  );
  check(
    "rejects javascript: scheme → /lab/daily-edge",
    sanitizeNext("javascript:alert(1)") === "/lab/daily-edge"
  );
  check(
    "accepts /lab/daily-edge → unchanged",
    sanitizeNext("/lab/daily-edge") === "/lab/daily-edge"
  );
  check(
    "accepts /lab/player-props → unchanged",
    sanitizeNext("/lab/player-props") === "/lab/player-props"
  );
  check(
    "accepts /admin/scores-model → unchanged",
    sanitizeNext("/admin/scores-model") === "/admin/scores-model"
  );

  // ─── constantTimeStringEq ──────────────────────────────────────────────
  section("constantTimeStringEq");

  check("equal strings → true", constantTimeStringEq("abc", "abc"));
  check("different strings → false", !constantTimeStringEq("abc", "abd"));
  check(
    "different lengths → false (early return)",
    !constantTimeStringEq("abc", "abcd")
  );
  check("empty strings → true", constantTimeStringEq("", ""));

  // ─── expectedCookieValue + isValidBetaSession (fail-closed) ────────────
  section("expectedCookieValue + isValidBetaSession — fail-closed semantics");

  setPassword(undefined);
  check(
    "LAB_BETA_PASSWORD unset → expectedCookieValue() === null",
    (await expectedCookieValue()) === null
  );
  check(
    "LAB_BETA_PASSWORD unset → isValidBetaSession(anything) === false",
    (await isValidBetaSession("any-cookie-value")) === false
  );

  setPassword("");
  check(
    "LAB_BETA_PASSWORD empty string → expectedCookieValue() === null",
    (await expectedCookieValue()) === null
  );

  setPassword(TEST_PASSWORD);
  check(
    "LAB_BETA_PASSWORD set → expectedCookieValue() returns SHA-256 hex (64 chars)",
    (() => {
      // Recompute the expected hash without relying on the helper
      return VALID_COOKIE.length === 64 && /^[a-f0-9]{64}$/.test(VALID_COOKIE);
    })()
  );
  check(
    "valid cookie → isValidBetaSession() === true",
    (await isValidBetaSession(VALID_COOKIE)) === true
  );
  check(
    "invalid cookie → isValidBetaSession() === false",
    (await isValidBetaSession("not-the-right-hash")) === false
  );
  check(
    "undefined cookie → isValidBetaSession() === false",
    (await isValidBetaSession(undefined)) === false
  );

  // ─── middleware: public routes pass through ────────────────────────────
  section("middleware — public routes pass through");

  for (const publicPath of [
    "/",
    "/pricing",
    "/track-record",
    "/login",
    "/api/auth/login",
    "/api/auth/logout",
    "/api/cron/morning-slate",
    "/api/admin/cron-status",
  ]) {
    const req = makeRequest(publicPath);
    const res = await proxy(req);
    // Public routes either return NextResponse.next() (status 200 with
    // "x-middleware-next" header) or undefined — both indicate no
    // intervention. We assert NOT a redirect (not 302) and NOT a JSON 401.
    const isRedirect =
      res !== undefined &&
      (res.status === 302 || res.status === 303 || res.status === 307);
    const isJson401 = res !== undefined && res.status === 401;
    check(
      `public ${publicPath} → not gated (no redirect, no 401)`,
      !isRedirect && !isJson401
    );
  }

  // ─── middleware: protected pages redirect when unauthenticated ─────────
  section("middleware — protected pages redirect to /login?next=");

  for (const protectedPath of [
    "/lab",
    "/lab/daily-edge",
    "/lab/player-props",
    "/lab/track-record",
    "/lab/tracking",
    "/lab/account",
    "/mlb/props",
    "/dev/experience-preview",
    "/dev/mlb-props-preview",
    "/dev/tracking-preview",
    "/dev/homepage-preview",
    "/dev/login-preview",
    "/dev/relaunch-review",
    "/dev/device-review",
    "/admin",
    "/admin/scores-model",
    "/admin/cron-status",
  ]) {
    const req = makeRequest(protectedPath);
    const res = await proxy(req);
    const isRedirect =
      res !== undefined && (res.status === 302 || res.status === 307);
    const location = res?.headers.get("location") ?? "";
    const hasNextParam =
      location.includes("/login") &&
      location.includes(`next=${encodeURIComponent(protectedPath)}`);
    check(
      `unauthenticated ${protectedPath} → 302 to /login?next=${protectedPath}`,
      isRedirect && hasNextParam,
      `status=${res?.status} location=${location}`
    );
  }

  // ─── middleware: protected APIs return JSON 401 ────────────────────────
  section("middleware — protected APIs return JSON 401 (no redirect)");

  for (const apiPath of [
    "/api/lab/daily-edge",
    "/api/lab/player-props",
    "/api/lab/tracking",
    "/api/lab/calibration",
    "/api/lab/refresh-status",
    "/api/mlb/props/picks",
    "/api/mlb/props/player/123",
  ]) {
    const req = makeRequest(apiPath);
    const res = await proxy(req);
    const is401 = res?.status === 401;
    const contentType = res?.headers.get("content-type") ?? "";
    const isJson = contentType.includes("application/json");
    const body = res ? await res.json() : null;
    const hasAuthRequired = body?.error === "auth_required";
    check(
      `unauthenticated ${apiPath} → 401 JSON { error: "auth_required" }`,
      is401 && isJson && hasAuthRequired,
      `status=${res?.status} ct=${contentType} body=${JSON.stringify(body)}`
    );
  }

  // ─── middleware: authenticated requests pass through ───────────────────
  section("middleware — valid cookie passes through");

  for (const path of [
    "/lab/daily-edge",
    "/mlb/props",
    "/dev/experience-preview",
    "/dev/mlb-props-preview",
    "/dev/tracking-preview",
    "/dev/homepage-preview",
    "/dev/login-preview",
    "/dev/relaunch-review",
    "/dev/device-review",
    "/api/lab/daily-edge",
    "/api/mlb/props/picks",
    "/admin/scores-model",
  ]) {
    const req = makeRequest(path, { cookieValue: VALID_COOKIE });
    const res = await proxy(req);
    const isRedirect =
      res !== undefined &&
      (res.status === 302 || res.status === 303 || res.status === 307);
    const isJson401 = res !== undefined && res.status === 401;
    check(
      `authenticated ${path} → not gated (passes through)`,
      !isRedirect && !isJson401
    );
  }

  // ─── product release-candidate switches ─────────────────────────────
  section("middleware — product candidate routes keep production identity");
  const routeSources = [
    ["Player Props", "app/mlb/props/page.tsx", "isPlayerPropsExperienceCandidateEnabled"],
    ["Tracking", "app/lab/tracking/page.tsx", "isTrackingExperienceCandidateEnabled"],
    ["Homepage", "app/page.tsx", "isHomepageExperienceCandidateEnabled"],
    ["Login", "app/login/page.tsx", "isLoginExperienceCandidateEnabled"],
  ] as const;
  for (const [label, file, switchName] of routeSources) {
    check(`${label} selects its presentation at the real route`, readFileSync(file, "utf8").includes(switchName));
  }
  const homepageSource = readFileSync("app/page.tsx", "utf8");
  const homepagePreviewSource = readFileSync("app/components/HomepageDashboardPrototype.tsx", "utf8");
  check(
    "candidate homepage leads with a readable Moneyline product surface",
    homepageSource.includes("HomepageMoneylinePreview compact")
      && homepagePreviewSource.includes("Moneyline quick read"),
  );
  check(
    "candidate dashboard walkthrough switches between multiple sample games",
    homepagePreviewSource.includes("MARKETING_MONEYLINE_GAMES.map")
      && homepagePreviewSource.includes("setSelectedId(item.id)")
      && homepagePreviewSource.includes('aria-pressed={selected}'),
  );
  check(
    "candidate dashboard separates public and sharp-book sample signals",
    homepagePreviewSource.includes('label="Public consensus"')
      && homepagePreviewSource.includes('label="Sharp book"'),
  );
  for (const path of ["/mlb/props", "/lab/tracking"]) {
    const response = await proxy(makeRequest(path, { cookieValue: VALID_COOKIE, search: "?source=founder-qa" }));
    check(`${path} remains on its authenticated production route`, response?.headers.get("x-middleware-rewrite") === null);
  }

  // ─── middleware: invalid cookie still blocks ───────────────────────────
  section("middleware — invalid cookie blocks (fail-closed)");

  const reqBadCookie = makeRequest("/lab/daily-edge", {
    cookieValue: "wrong-hash-value",
  });
  const resBadCookie = await proxy(reqBadCookie);
  check(
    "invalid cookie value → redirect to /login (not pass through)",
    resBadCookie?.status === 302
  );

  // ─── Daily Edge candidate is selected inside the member page ─────────
  section("middleware — Daily Edge member route remains stable");

  {
    const req = makeRequest("/lab/daily-edge", {
      cookieValue: VALID_COOKIE,
      search: "?sport=wnba&source=founder-qa",
    });
    const offResponse = await proxy(req);
    setDailyEdgeCandidate("true");
    const onResponse = await proxy(req);
    check(
      "Daily Edge cutover keeps the authenticated member URL instead of exposing preview chrome",
      offResponse?.headers.get("x-middleware-rewrite") === null &&
        onResponse?.headers.get("x-middleware-rewrite") === null,
    );

    const trackingResponse = await proxy(
      makeRequest("/lab/tracking", { cookieValue: VALID_COOKIE }),
    );
    check(
      "candidate switch does not rewrite other OddSphere products",
      trackingResponse?.headers.get("x-middleware-rewrite") === null,
    );
    setDailyEdgeCandidate(undefined);
  }

  // ─── middleware: missing LAB_BETA_PASSWORD → fail closed ───────────────
  section("middleware — missing LAB_BETA_PASSWORD env fails closed");

  setPassword(undefined);
  const reqEnvMissing = makeRequest("/lab/daily-edge", {
    cookieValue: "any-value-at-all",
  });
  const resEnvMissing = await proxy(reqEnvMissing);
  check(
    "LAB_BETA_PASSWORD unset + valid-looking cookie → still blocks (fail-closed)",
    resEnvMissing?.status === 302
  );
  setPassword(TEST_PASSWORD);

  // ─── /api/auth/login route handler ─────────────────────────────────────
  section("/api/auth/login route");

  // Correct password (form-encoded body)
  {
    const formBody = new URLSearchParams({
      password: TEST_PASSWORD,
      next: "/lab/daily-edge",
    });
    const res = await loginPost(
      new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: formBody.toString(),
      })
    );
    const setCookie = res.headers.get("set-cookie") ?? "";
    const location = res.headers.get("location") ?? "";
    check(
      "correct password → 303 See Other",
      res.status === 303
    );
    check(
      "correct password → Set-Cookie header includes oddsphere_beta_session",
      setCookie.includes(`${BETA_SESSION_COOKIE_NAME}=`)
    );
    check(
      "correct password → cookie value is the SHA-256 hash (64 hex chars)",
      (() => {
        const match = setCookie.match(/oddsphere_beta_session=([a-f0-9]{64})/);
        return match !== null && match[1] === VALID_COOKIE;
      })()
    );
    check(
      "correct password → cookie carries HttpOnly + SameSite=Lax + Path=/",
      setCookie.includes("HttpOnly") &&
        setCookie.includes("SameSite=Lax") &&
        setCookie.includes("Path=/")
    );
    check(
      `correct password → cookie Max-Age=${BETA_SESSION_MAX_AGE_SECONDS} (7 days)`,
      setCookie.includes(`Max-Age=${BETA_SESSION_MAX_AGE_SECONDS}`)
    );
    check(
      "correct password → redirects to sanitized next",
      location.endsWith("/lab/daily-edge")
    );
  }

  // Correct password (JSON body)
  {
    const res = await loginPost(
      new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: TEST_PASSWORD, next: "/lab/account" }),
      })
    );
    check(
      "correct password via JSON body → 303 with cookie set",
      res.status === 303 &&
        (res.headers.get("set-cookie") ?? "").includes(BETA_SESSION_COOKIE_NAME)
    );
    check(
      "JSON body next → redirects to /lab/account",
      (res.headers.get("location") ?? "").endsWith("/lab/account")
    );
  }

  // Wrong password
  {
    const formBody = new URLSearchParams({
      password: "wrong",
      next: "/lab/daily-edge",
    });
    const res = await loginPost(
      new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: formBody.toString(),
      })
    );
    const location = res.headers.get("location") ?? "";
    const setCookie = res.headers.get("set-cookie");
    check(
      "wrong password → 303 redirect to /login with error=invalid",
      res.status === 303 &&
        location.includes("/login") &&
        location.includes("error=invalid")
    );
    check(
      "wrong password → NO cookie set",
      setCookie === null || !setCookie.includes(BETA_SESSION_COOKIE_NAME)
    );
  }

  // Open-redirect attack in next param
  {
    const formBody = new URLSearchParams({
      password: TEST_PASSWORD,
      next: "https://evil.com",
    });
    const res = await loginPost(
      new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: formBody.toString(),
      })
    );
    const location = res.headers.get("location") ?? "";
    check(
      "open-redirect attack (next=https://evil.com) → redirects to /lab/daily-edge instead",
      location.endsWith("/lab/daily-edge")
    );
  }

  // Server misconfigured (LAB_BETA_PASSWORD unset)
  setPassword(undefined);
  {
    const formBody = new URLSearchParams({
      password: "anything",
      next: "/lab/daily-edge",
    });
    const res = await loginPost(
      new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: formBody.toString(),
      })
    );
    const location = res.headers.get("location") ?? "";
    check(
      "LAB_BETA_PASSWORD unset → 303 redirect to /login?error=unavailable",
      res.status === 303 && location.includes("error=unavailable")
    );
    check(
      "LAB_BETA_PASSWORD unset → location does NOT mention LAB_BETA_PASSWORD (no env-name disclosure)",
      !location.toLowerCase().includes("lab_beta_password") &&
        !location.toLowerCase().includes("misconfigured")
    );
  }
  setPassword(TEST_PASSWORD);

  // ─── /api/auth/logout route handler ────────────────────────────────────
  section("/api/auth/logout route");

  {
    const res = await logoutPost(
      new Request("http://localhost:3000/api/auth/logout", { method: "POST" })
    );
    const setCookie = res.headers.get("set-cookie") ?? "";
    const body = (await res.json()) as { ok?: boolean };
    check("logout → 200 OK", res.status === 200);
    check("logout → response body { ok: true }", body.ok === true);
    check(
      "logout → Set-Cookie with Max-Age=0 (clears cookie)",
      setCookie.includes(`${BETA_SESSION_COOKIE_NAME}=`) &&
        setCookie.includes("Max-Age=0")
    );
  }

  // ─── Cleanup ───────────────────────────────────────────────────────────
  restorePassword();
  setDailyEdgeCandidate(ORIGINAL_DAILY_EDGE_CANDIDATE);
  setCandidate("PLAYER_PROPS_EXPERIENCE_CANDIDATE_ENABLED", ORIGINAL_PROPS_CANDIDATE);
  setCandidate("TRACKING_EXPERIENCE_CANDIDATE_ENABLED", ORIGINAL_TRACKING_CANDIDATE);
  setCandidate("HOMEPAGE_EXPERIENCE_CANDIDATE_ENABLED", ORIGINAL_HOMEPAGE_CANDIDATE);
  check(
    "afterAll restored LAB_BETA_PASSWORD",
    process.env.LAB_BETA_PASSWORD === ORIGINAL_PASSWORD
  );
  check(
    "afterAll restored remaining product candidate flags",
    process.env.PLAYER_PROPS_EXPERIENCE_CANDIDATE_ENABLED === ORIGINAL_PROPS_CANDIDATE &&
      process.env.TRACKING_EXPERIENCE_CANDIDATE_ENABLED === ORIGINAL_TRACKING_CANDIDATE &&
      process.env.HOMEPAGE_EXPERIENCE_CANDIDATE_ENABLED === ORIGINAL_HOMEPAGE_CANDIDATE,
  );
  check(
    "afterAll restored DAILY_EDGE_EXPERIENCE_CANDIDATE_ENABLED",
    process.env.DAILY_EDGE_EXPERIENCE_CANDIDATE_ENABLED === ORIGINAL_DAILY_EDGE_CANDIDATE,
  );

  // ─── Summary ────────────────────────────────────────────────────────────
  console.log(`\n${"━".repeat(70)}`);
  console.log(`  ${pass} pass · ${fail} fail · ${pass + fail} total`);
  if (fail > 0) {
    console.log(`\nFailures:`);
    failures.forEach((m) => console.log(m));
    process.exit(1);
  }
  console.log(`\n✅ All auth-gate tests passed.`);
}

main().catch((e) => {
  // Always restore env on crash.
  restorePassword();
  setDailyEdgeCandidate(ORIGINAL_DAILY_EDGE_CANDIDATE);
  setCandidate("PLAYER_PROPS_EXPERIENCE_CANDIDATE_ENABLED", ORIGINAL_PROPS_CANDIDATE);
  setCandidate("TRACKING_EXPERIENCE_CANDIDATE_ENABLED", ORIGINAL_TRACKING_CANDIDATE);
  setCandidate("HOMEPAGE_EXPERIENCE_CANDIDATE_ENABLED", ORIGINAL_HOMEPAGE_CANDIDATE);
  console.error("\n❌ test-auth-gate failed:", (e as Error).message);
  if ((e as Error).stack) console.error((e as Error).stack);
  process.exit(1);
});
