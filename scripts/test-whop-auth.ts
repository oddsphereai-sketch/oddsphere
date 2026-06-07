/**
 * Phase 6B.3a — Whop access integration tests.
 *
 * Two layers:
 *   (a) Pure assertions on whopConfig / whopSession logic — runs in any
 *       env, mutates process.env to simulate configured / unconfigured
 *       posture.
 *   (b) Grep-based structural checks on the route handlers + login page
 *       to lock the fail-closed contract (no broken Whop button when
 *       disabled, endpoints match Whop docs, middleware accepts either
 *       session).
 *
 * Hard-restriction asserts:
 *   • No raw secrets in committed files (env values are templates only).
 *   • Whop session cookie is HttpOnly + SameSite=Lax.
 *   • Login page never renders an enabled Whop button without flag.
 *   • Middleware verifies Whop cookie before accepting.
 *   • Whop session does NOT grant admin role (acl flows through but
 *     /admin/* keeps its own validateAdminAuth).
 *   • Endpoints match the documented Whop URLs verbatim.
 */

import { readFileSync } from "node:fs";

const ENV_EXAMPLE = readFileSync(".env.example", "utf8");
const CONFIG = readFileSync("lib/auth/whopConfig.ts", "utf8");
const SESSION = readFileSync("lib/auth/whopSession.ts", "utf8");
const OAUTH = readFileSync("lib/auth/whopOAuth.ts", "utf8");
const ACCESS = readFileSync("lib/auth/whopAccess.ts", "utf8");
const MIDDLEWARE = readFileSync("middleware.ts", "utf8");
const LOGIN_PAGE = readFileSync("app/login/page.tsx", "utf8");
const PRICING_PAGE = readFileSync("app/pricing/page.tsx", "utf8");
const START_ROUTE = readFileSync("app/api/auth/whop/start/route.ts", "utf8");
const CALLBACK_ROUTE = readFileSync("app/api/auth/whop/callback/route.ts", "utf8");
const LOGOUT_ROUTE = readFileSync("app/api/auth/logout/route.ts", "utf8");
const STATUS_ROUTE = readFileSync("app/api/auth/whop/status/route.ts", "utf8");

let pass = 0, fail = 0;
function check(name: string, cond: boolean, msg?: string) {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}${msg ? `\n     ${msg}` : ""}`); fail++; }
}

async function asyncCheck(name: string, fn: () => Promise<boolean>, msg?: string) {
  try {
    const ok = await fn();
    if (ok) { console.log(`  ✓ ${name}`); pass++; }
    else { console.log(`  ✗ ${name}${msg ? `\n     ${msg}` : ""}`); fail++; }
  } catch (e) {
    console.log(`  ✗ ${name}\n     ${(e as Error).message}`);
    fail++;
  }
}

async function main() {
console.log(`\n━━━ Whop access integration tests ━━━\n`);

// ── Endpoint constants verified against Whop docs ─────────────────────

check("Authorize URL points to api.whop.com/oauth/authorize",
  CONFIG.includes('authorize: "https://api.whop.com/oauth/authorize"'));
check("Token URL points to api.whop.com/oauth/token",
  CONFIG.includes('token:     "https://api.whop.com/oauth/token"'));
check("Userinfo URL points to api.whop.com/oauth/userinfo",
  CONFIG.includes('userinfo:  "https://api.whop.com/oauth/userinfo"'));
check("Access-check URL pattern matches docs",
  CONFIG.includes('"https://api.whop.com/api/v1/users/{userId}/access/{resourceId}"'));

// ── Fail-closed predicates ────────────────────────────────────────────

async function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T> | T): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    prev[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k]!;
  }
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(prev)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k]!;
    }
  }
}

await asyncCheck("isWhopAccessEnabled() is FALSE when WHOP_OAUTH_ENABLED is not 'true'", async () => {
  const m = await import("../lib/auth/whopConfig");
  return await withEnv({ WHOP_OAUTH_ENABLED: undefined }, () => !m.isWhopAccessEnabled());
});

await asyncCheck("isWhopAccessEnabled() is FALSE when any required env is missing", async () => {
  const m = await import("../lib/auth/whopConfig");
  return await withEnv({
    WHOP_OAUTH_ENABLED: "true",
    WHOP_CLIENT_ID: "app_test",
    WHOP_CLIENT_SECRET: "secret",
    WHOP_REDIRECT_URI: "https://oddsphereai.com/api/auth/whop/callback",
    WHOP_API_KEY: "key",
    WHOP_RESOURCE_ID: "prod_test",
    WHOP_SESSION_SECRET: undefined,
  }, () => !m.isWhopAccessEnabled());
});

await asyncCheck("isWhopAccessEnabled() requires WHOP_SESSION_SECRET min 32 chars", async () => {
  const m = await import("../lib/auth/whopConfig");
  return await withEnv({
    WHOP_OAUTH_ENABLED: "true",
    WHOP_CLIENT_ID: "app_test",
    WHOP_CLIENT_SECRET: "secret",
    WHOP_REDIRECT_URI: "https://oddsphereai.com/api/auth/whop/callback",
    WHOP_API_KEY: "key",
    WHOP_RESOURCE_ID: "prod_test",
    WHOP_SESSION_SECRET: "short",
  }, () => !m.isWhopAccessEnabled());
});

await asyncCheck("isWhopAccessEnabled() returns TRUE only when full config present", async () => {
  const m = await import("../lib/auth/whopConfig");
  return await withEnv({
    WHOP_OAUTH_ENABLED: "true",
    WHOP_CLIENT_ID: "app_test",
    WHOP_CLIENT_SECRET: "secret",
    WHOP_REDIRECT_URI: "https://oddsphereai.com/api/auth/whop/callback",
    WHOP_API_KEY: "key",
    WHOP_RESOURCE_ID: "prod_test",
    WHOP_SESSION_SECRET: "x".repeat(32),
  }, () => m.isWhopAccessEnabled());
});

// ── Whop session round-trip ───────────────────────────────────────────

await asyncCheck("signWhopSession + verifyWhopSession round-trip succeeds", async () => {
  const sess = await import("../lib/auth/whopSession");
  return await withEnv({
    WHOP_OAUTH_ENABLED: "true",
    WHOP_CLIENT_ID: "app_test",
    WHOP_CLIENT_SECRET: "secret",
    WHOP_REDIRECT_URI: "https://oddsphereai.com/api/auth/whop/callback",
    WHOP_API_KEY: "key",
    WHOP_RESOURCE_ID: "prod_test",
    WHOP_SESSION_SECRET: "x".repeat(32),
  }, async () => {
    const now = Math.floor(Date.now() / 1000);
    const cookie = await sess.signWhopSession({
      v: 1, uid: "user_abc", acl: "customer", iat: now, exp: now + 60,
    });
    if (cookie === null) return false;
    const verified = await sess.verifyWhopSession(cookie);
    return verified !== null && verified.uid === "user_abc" && verified.acl === "customer";
  });
});

await asyncCheck("verifyWhopSession REJECTS tampered cookie", async () => {
  const sess = await import("../lib/auth/whopSession");
  return await withEnv({
    WHOP_OAUTH_ENABLED: "true",
    WHOP_CLIENT_ID: "app_test",
    WHOP_CLIENT_SECRET: "secret",
    WHOP_REDIRECT_URI: "https://oddsphereai.com/api/auth/whop/callback",
    WHOP_API_KEY: "key",
    WHOP_RESOURCE_ID: "prod_test",
    WHOP_SESSION_SECRET: "x".repeat(32),
  }, async () => {
    const now = Math.floor(Date.now() / 1000);
    const cookie = await sess.signWhopSession({
      v: 1, uid: "user_abc", acl: "customer", iat: now, exp: now + 60,
    });
    if (cookie === null) return false;
    const tampered = cookie.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    const verified = await sess.verifyWhopSession(tampered);
    return verified === null;
  });
});

await asyncCheck("verifyWhopSession REJECTS when config missing (fail closed)", async () => {
  const sess = await import("../lib/auth/whopSession");
  // Build a cookie under full config, then verify under no config.
  const cookie = await withEnv({
    WHOP_OAUTH_ENABLED: "true",
    WHOP_CLIENT_ID: "app_test",
    WHOP_CLIENT_SECRET: "secret",
    WHOP_REDIRECT_URI: "https://oddsphereai.com/api/auth/whop/callback",
    WHOP_API_KEY: "key",
    WHOP_RESOURCE_ID: "prod_test",
    WHOP_SESSION_SECRET: "x".repeat(32),
  }, async () => {
    const now = Math.floor(Date.now() / 1000);
    return await sess.signWhopSession({
      v: 1, uid: "user_abc", acl: "customer", iat: now, exp: now + 60,
    });
  });
  if (cookie === null) return false;
  return await withEnv({ WHOP_OAUTH_ENABLED: undefined }, async () => {
    return (await sess.verifyWhopSession(cookie)) === null;
  });
});

await asyncCheck("verifyWhopSession REJECTS expired cookie", async () => {
  const sess = await import("../lib/auth/whopSession");
  return await withEnv({
    WHOP_OAUTH_ENABLED: "true",
    WHOP_CLIENT_ID: "app_test",
    WHOP_CLIENT_SECRET: "secret",
    WHOP_REDIRECT_URI: "https://oddsphereai.com/api/auth/whop/callback",
    WHOP_API_KEY: "key",
    WHOP_RESOURCE_ID: "prod_test",
    WHOP_SESSION_SECRET: "x".repeat(32),
  }, async () => {
    const now = Math.floor(Date.now() / 1000);
    const cookie = await sess.signWhopSession({
      v: 1, uid: "user_abc", acl: "customer", iat: now - 200, exp: now - 100,
    });
    if (cookie === null) return false;
    return (await sess.verifyWhopSession(cookie)) === null;
  });
});

// ── Access check fail-closed behavior ────────────────────────────────

await asyncCheck("checkWhopAccess returns config_missing when env not set", async () => {
  const a = await import("../lib/auth/whopAccess");
  return await withEnv({ WHOP_OAUTH_ENABLED: undefined }, async () => {
    const res = await a.checkWhopAccess({ userId: "user_x" });
    return !res.has_access && res.reason === "config_missing";
  });
});

await asyncCheck("checkWhopAccess returns denied for empty user id", async () => {
  const a = await import("../lib/auth/whopAccess");
  return await withEnv({
    WHOP_OAUTH_ENABLED: "true",
    WHOP_CLIENT_ID: "app_test",
    WHOP_CLIENT_SECRET: "secret",
    WHOP_REDIRECT_URI: "https://oddsphereai.com/api/auth/whop/callback",
    WHOP_API_KEY: "key",
    WHOP_RESOURCE_ID: "prod_test",
    WHOP_SESSION_SECRET: "x".repeat(32),
  }, async () => {
    const res = await a.checkWhopAccess({ userId: "" });
    return !res.has_access && res.reason === "denied";
  });
});

// ── Route shape + safety asserts ──────────────────────────────────────

check("Middleware verifies the Whop session BEFORE beta session",
  /verifyWhopSession[\s\S]{0,400}isValidBetaSession/.test(MIDDLEWARE));
check("Logout route clears beta session cookie",
  LOGOUT_ROUTE.includes(`${"oddsphere_beta_session"}=`) || LOGOUT_ROUTE.includes("BETA_SESSION_COOKIE_NAME"));
check("Logout route clears Whop session cookie",
  LOGOUT_ROUTE.includes("buildWhopSessionClearCookie"));
check("Start route fails closed when Whop disabled",
  /isWhopAccessEnabled\(\)[\s\S]{0,200}whop_disabled/.test(START_ROUTE));
check("Callback route fails closed when Whop disabled",
  /isWhopAccessEnabled\(\)[\s\S]{0,200}whop_config_missing/.test(CALLBACK_ROUTE));
check("Callback verifies state cookie matches state param",
  /stateCookie !== stateParam[\s\S]{0,200}whop_state/.test(CALLBACK_ROUTE));
check("Callback uses PKCE code_verifier from cookie",
  /codeVerifier:\s*verifierCookie/.test(CALLBACK_ROUTE));
check("Callback discards Whop access_token after access check",
  // We never store the raw access_token in our session payload —
  // verify our payload only carries uid + acl + iat + exp.
  /signWhopSession\(payload\)/.test(CALLBACK_ROUTE) &&
  !/access_token:\s*tokenResp\.access_token/.test(CALLBACK_ROUTE),
);

// ── Login page UX gating ─────────────────────────────────────────────

check("Login page reads whop/beta flags from server config",
  LOGIN_PAGE.includes("isWhopAccessEnabled") && LOGIN_PAGE.includes("isBetaFallbackEnabled"));
check("Login page only renders Whop button when whopEnabled",
  /whopEnabled\s*&&\s*\(\s*<a[\s\S]{0,400}href=\{whopStartHref\}/.test(LOGIN_PAGE) &&
  LOGIN_PAGE.includes("/api/auth/whop/start"));
check("Login page Whop button is NOT disabled when enabled",
  !/Continue with Whop[\s\S]{0,400}disabled/.test(LOGIN_PAGE));
check("Login page surfaces beta form only when beta enabled",
  /betaEnabled\s*&&\s*\(\s*<form[\s\S]{0,200}\/api\/auth\/login/.test(LOGIN_PAGE));
check("Login page shows neither-enabled fallback copy",
  /!whopEnabled[\s\S]{0,200}!betaEnabled[\s\S]{0,200}temporarily unavailable/.test(LOGIN_PAGE));

// ── Pricing CTA wires checkout URL when configured ───────────────────

check("Pricing imports getCheckoutUrl",
  PRICING_PAGE.includes("getCheckoutUrl"));
check("Pricing CTA opens Whop checkout in new tab when configured",
  /checkoutUrl[\s\S]{0,300}target="_blank"[\s\S]{0,300}Join through Whop/.test(PRICING_PAGE));
check("Pricing CTA falls back to /login (never fakes a Whop URL)",
  /checkoutUrl === null[\s\S]{0,400}href="\/login"/.test(PRICING_PAGE) ||
  /href="\/login"[\s\S]{0,400}Continue to Sign In/.test(PRICING_PAGE));

// ── Cookie attribute safety ──────────────────────────────────────────

check("Whop session cookie is HttpOnly",
  SESSION.includes("HttpOnly"));
check("Whop session cookie uses SameSite=Lax",
  SESSION.includes("SameSite=Lax"));
check("Whop session uses HMAC-SHA-256",
  /HMAC[\s\S]{0,40}SHA-256/.test(SESSION));
check("OAuth start sets state, verifier, and next cookies HttpOnly",
  /HttpOnly[\s\S]{0,800}SameSite=Lax/.test(START_ROUTE));

// ── No raw secrets committed ─────────────────────────────────────────

check(".env.example uses blank placeholders for Whop secrets",
  /WHOP_CLIENT_SECRET=\s*$/m.test(ENV_EXAMPLE) &&
  /WHOP_API_KEY=\s*$/m.test(ENV_EXAMPLE) &&
  /WHOP_SESSION_SECRET=\s*$/m.test(ENV_EXAMPLE));
check(".env.example defaults WHOP_OAUTH_ENABLED to false",
  /WHOP_OAUTH_ENABLED=false/.test(ENV_EXAMPLE));

// ── Status diagnostics (6B.3a.2) ─────────────────────────────────────

check("Status exposes redirect_uri diagnostic",
  STATUS_ROUTE.includes("describeRedirectUri") && STATUS_ROUTE.includes("redirect_uri:"));
check("Status exposes missing_whop_envs list",
  STATUS_ROUTE.includes("missing_whop_envs"));
check("Status exposes client_id preview (not full)",
  STATUS_ROUTE.includes("client_id_preview"));
check("Status exposes whop_oauth_enabled_flag",
  STATUS_ROUTE.includes("whop_oauth_enabled_flag"));
check("Status does NOT expose client_secret",
  !STATUS_ROUTE.includes("client_secret") && !STATUS_ROUTE.includes("clientSecret"));
check("Status does NOT expose api_key",
  !/api_key|apiKey/.test(STATUS_ROUTE));
check("Status does NOT expose session_secret",
  !/session_secret|sessionSecret/.test(STATUS_ROUTE));

await asyncCheck("getMissingWhopEnvs lists ALL required vars when none set", async () => {
  const m = await import("../lib/auth/whopConfig");
  return await withEnv({
    WHOP_OAUTH_ENABLED: "true",
    WHOP_CLIENT_ID: undefined,
    WHOP_CLIENT_SECRET: undefined,
    WHOP_REDIRECT_URI: undefined,
    WHOP_API_KEY: undefined,
    WHOP_RESOURCE_ID: undefined,
    WHOP_SESSION_SECRET: undefined,
  }, () => {
    const r = m.getMissingWhopEnvs();
    return r.enabled_flag_set === true && r.missing.length === 6;
  });
});

await asyncCheck("getMissingWhopEnvs flags too-short session secret", async () => {
  const m = await import("../lib/auth/whopConfig");
  return await withEnv({
    WHOP_OAUTH_ENABLED: "true",
    WHOP_CLIENT_ID: "app_test",
    WHOP_CLIENT_SECRET: "secret",
    WHOP_REDIRECT_URI: "https://oddsphereai.com/api/auth/whop/callback",
    WHOP_API_KEY: "key",
    WHOP_RESOURCE_ID: "prod_test",
    WHOP_SESSION_SECRET: "short",
  }, () => {
    const r = m.getMissingWhopEnvs();
    return r.missing.some((s) => s.startsWith("WHOP_SESSION_SECRET"));
  });
});

await asyncCheck("describeRedirectUri parses host + path + protocol + trailing slash", async () => {
  const m = await import("../lib/auth/whopConfig");
  return await withEnv({
    WHOP_REDIRECT_URI: "https://oddsphereai.com/api/auth/whop/callback",
  }, () => {
    const r = m.describeRedirectUri();
    return r.parsed === true && r.host === "oddsphereai.com" &&
      r.path === "/api/auth/whop/callback" && r.protocol === "https" &&
      r.has_trailing_slash === false;
  });
});

await asyncCheck("describeRedirectUri flags trailing slash mismatch", async () => {
  const m = await import("../lib/auth/whopConfig");
  return await withEnv({
    WHOP_REDIRECT_URI: "https://oddsphereai.com/api/auth/whop/callback/",
  }, () => {
    const r = m.describeRedirectUri();
    return r.parsed === true && r.has_trailing_slash === true;
  });
});

await asyncCheck("describeRedirectUri reports unset state safely", async () => {
  const m = await import("../lib/auth/whopConfig");
  return await withEnv({ WHOP_REDIRECT_URI: undefined }, () => {
    const r = m.describeRedirectUri();
    return r.parsed === false && r.full === null;
  });
});

await asyncCheck("getClientIdPreview masks after 8 chars", async () => {
  const m = await import("../lib/auth/whopConfig");
  return await withEnv({ WHOP_CLIENT_ID: "app_abcdefghij" }, () => {
    const p = m.getClientIdPreview();
    return p === "app_abcd…";
  });
});

await asyncCheck("getClientIdPreview returns null when unset", async () => {
  const m = await import("../lib/auth/whopConfig");
  return await withEnv({ WHOP_CLIENT_ID: undefined }, () => {
    return m.getClientIdPreview() === null;
  });
});

// ── OIDC nonce (6B.3a.4) ─────────────────────────────────────────────

const WHOP_OAUTH_LIB = readFileSync("lib/auth/whopOAuth.ts", "utf8");
const START_ROUTE_AGAIN = readFileSync("app/api/auth/whop/start/route.ts", "utf8");
const CALLBACK_ROUTE_AGAIN = readFileSync("app/api/auth/whop/callback/route.ts", "utf8");

check("Library exports WHOP_OAUTH_NONCE_COOKIE constant",
  WHOP_OAUTH_LIB.includes('WHOP_OAUTH_NONCE_COOKIE = "oddsphere_whop_oauth_nonce"'));
check("buildAuthorizationUrl accepts a nonce argument",
  /buildAuthorizationUrl[\s\S]{0,400}nonce:\s*string/.test(WHOP_OAUTH_LIB));
check("Authorize URL includes nonce= param",
  /URLSearchParams[\s\S]{0,500}nonce:\s*opts\.nonce/.test(WHOP_OAUTH_LIB));
check("decodeIdTokenPayload helper exists and returns payload claims",
  /export function decodeIdTokenPayload[\s\S]{0,800}return parsed as Record/.test(WHOP_OAUTH_LIB));
check("decodeIdTokenPayload rejects malformed JWTs",
  /parts\.length !== 3/.test(WHOP_OAUTH_LIB) && /return null/.test(WHOP_OAUTH_LIB));

check("Start route imports WHOP_OAUTH_NONCE_COOKIE",
  START_ROUTE_AGAIN.includes("WHOP_OAUTH_NONCE_COOKIE"));
check("Start route generates a nonce via randomToken",
  /const nonce = randomToken\(/.test(START_ROUTE_AGAIN));
check("Start route sets the nonce cookie via tempCookie helper",
  /tempCookie\(WHOP_OAUTH_NONCE_COOKIE,\s*nonce\)/.test(START_ROUTE_AGAIN));
check("Start route passes nonce to buildAuthorizationUrl",
  /buildAuthorizationUrl\(\{[\s\S]{0,200}nonce[\s\S]{0,40}\}\)/.test(START_ROUTE_AGAIN));

check("Callback imports WHOP_OAUTH_NONCE_COOKIE",
  CALLBACK_ROUTE_AGAIN.includes("WHOP_OAUTH_NONCE_COOKIE"));
check("Callback imports decodeIdTokenPayload",
  CALLBACK_ROUTE_AGAIN.includes("decodeIdTokenPayload"));
check("Callback reads nonce cookie before verification",
  /const nonceCookie = readCookieValue\(cookieHeader,\s*WHOP_OAUTH_NONCE_COOKIE\)/.test(CALLBACK_ROUTE_AGAIN));
check("Callback verifies id_token nonce claim equals stored nonce",
  /idTokenNonce !== nonceCookie/.test(CALLBACK_ROUTE_AGAIN) &&
  /"whop_nonce_mismatch"/.test(CALLBACK_ROUTE_AGAIN));
check("Callback only nonce-checks when id_token is present (graceful fallback)",
  /tokens\.id_token !== undefined[\s\S]{0,100}id_token\.length > 0/.test(CALLBACK_ROUTE_AGAIN));

// Nonce cookie cleared on every exit path
const callbackNonceClears = (CALLBACK_ROUTE_AGAIN.match(/clearTempCookie\(WHOP_OAUTH_NONCE_COOKIE\)/g) ?? []).length;
check("Nonce cookie cleared on at least 3 exit paths (error helper + checkout + success)",
  callbackNonceClears >= 3);

check("Login page has copy for whop_nonce",
  LOGIN_PAGE.includes("whop_nonce:"));

// ── Granular Whop OAuth error mapping (6B.3a.3) ──────────────────────

check("Callback maps Whop access_denied to whop_denied",
  /access_denied:\s*"whop_denied"/.test(CALLBACK_ROUTE));
check("Callback maps Whop unauthorized_client to whop_oauth_unauthorized",
  /unauthorized_client:\s*"whop_oauth_unauthorized"/.test(CALLBACK_ROUTE));
check("Callback maps Whop invalid_scope to whop_oauth_scope",
  /invalid_scope:\s*"whop_oauth_scope"/.test(CALLBACK_ROUTE));
check("Callback maps Whop invalid_request to whop_oauth_request",
  /invalid_request:\s*"whop_oauth_request"/.test(CALLBACK_ROUTE));
check("Callback maps Whop server_error to whop_oauth_server",
  /server_error:\s*"whop_oauth_server"/.test(CALLBACK_ROUTE));
check("Callback maps Whop temporarily_unavailable to whop_oauth_unavailable",
  /temporarily_unavailable:\s*"whop_oauth_unavailable"/.test(CALLBACK_ROUTE));
check("Callback falls back to whop_oauth_err for unknown Whop error codes",
  /WHOP_ERR_TO_KEY\[whopError\]\s*\?\?\s*"whop_oauth_err"/.test(CALLBACK_ROUTE));
check("Callback forwards raw error code as wd param",
  /url\.searchParams\.set\("wd"/.test(CALLBACK_ROUTE));
check("Callback forwards error_description as wdd param",
  /url\.searchParams\.set\("wdd"/.test(CALLBACK_ROUTE));
check("Callback truncates Whop error code to <= 64 chars",
  /\.slice\(0,\s*64\)/.test(CALLBACK_ROUTE));
check("Callback truncates Whop error_description to <= 200 chars",
  /\.slice\(0,\s*200\)/.test(CALLBACK_ROUTE));

// Login page surfaces the granular codes
for (const key of [
  "whop_oauth_request",
  "whop_oauth_unauthorized",
  "whop_oauth_scope",
  "whop_oauth_server",
  "whop_oauth_unavailable",
  "whop_oauth_err",
]) {
  check(`Login page has copy for '${key}'`, LOGIN_PAGE.includes(`${key}:`));
}

check("Login page reads `wd` diagnostic param",
  /params\.wd/.test(LOGIN_PAGE) || /searchParams.*wd/.test(LOGIN_PAGE));
check("Login page reads `wdd` description param",
  /params\.wdd/.test(LOGIN_PAGE) || /searchParams.*wdd/.test(LOGIN_PAGE));
check("Login page renders 'Whop responded:' diagnostic line",
  /Whop responded:/.test(LOGIN_PAGE));
check("Login page truncates wd / wdd lengths defensively",
  /\.slice\(0,\s*64\)/.test(LOGIN_PAGE) && /\.slice\(0,\s*200\)/.test(LOGIN_PAGE));

// Distinguishes user-cancellation from app-config failure
check("Login copy distinguishes user-cancel from misconfig",
  /Sign-in was cancelled on the Whop consent screen/.test(LOGIN_PAGE) &&
  /Whop OAuth app is not authorized/.test(LOGIN_PAGE));

// ── Callback-stage diagnostics (6B.3a.5) ──────────────────────────────

check("Library exports TokenExchangeResult typed result",
  WHOP_OAUTH_LIB.includes("export type TokenExchangeResult"));
check("Library exports UserInfoResult typed result",
  WHOP_OAUTH_LIB.includes("export type UserInfoResult"));
check("Token exchange forwards Whop OAuth error fields safely",
  /extractWhopOAuthError[\s\S]{0,800}whopError[\s\S]{0,200}whopDescription/.test(WHOP_OAUTH_LIB));
check("Token exchange truncates whopError to 64 chars",
  /\.slice\(0,\s*64\)/.test(WHOP_OAUTH_LIB));
check("Token exchange truncates whopDescription to 200 chars",
  /\.slice\(0,\s*200\)/.test(WHOP_OAUTH_LIB));
check("Token exchange catches network errors with safe message",
  /reason:\s*"network_error"/.test(WHOP_OAUTH_LIB));

// ── Whop OAuth 2.1 + PKCE request shape (6B.3a.6) ─────────────────────
// Match Whop's documented snippet exactly: JSON body, NO client_secret,
// PKCE code_verifier carries the auth.
check("Token exchange uses Content-Type: application/json (not form-urlencoded)",
  /"Content-Type":\s*"application\/json"/.test(WHOP_OAUTH_LIB));
check("Token exchange does NOT send Content-Type form-urlencoded",
  !/"Content-Type":\s*"application\/x-www-form-urlencoded"/.test(WHOP_OAUTH_LIB));
check("Token exchange body is JSON-stringified (not URLSearchParams)",
  /JSON\.stringify\(body\)/.test(WHOP_OAUTH_LIB));
check("Token exchange body includes grant_type / code / redirect_uri / client_id / code_verifier",
  /grant_type:\s*"authorization_code"/.test(WHOP_OAUTH_LIB) &&
  /code:\s*opts\.code/.test(WHOP_OAUTH_LIB) &&
  /redirect_uri:\s*cfg\.redirectUri/.test(WHOP_OAUTH_LIB) &&
  /client_id:\s*cfg\.clientId/.test(WHOP_OAUTH_LIB) &&
  /code_verifier:\s*opts\.codeVerifier/.test(WHOP_OAUTH_LIB));
check("Token exchange body does NOT include client_secret (PKCE-only per Whop docs)",
  // Allow mention in comments but not as a body field
  !/client_secret:\s*cfg\.clientSecret/.test(WHOP_OAUTH_LIB) &&
  !/client_secret:\s*opts\.clientSecret/.test(WHOP_OAUTH_LIB));
check("extractWhopOAuthError only forwards `error` and `error_description` fields",
  // Defensive: confirm we don't blindly dump the whole body
  /obj\["error"\][\s\S]{0,200}obj\["error_description"\]/.test(WHOP_OAUTH_LIB));

const CALLBACK_NEW = readFileSync("app/api/auth/whop/callback/route.ts", "utf8");

check("Callback wraps handler in try/catch safety net",
  /try \{[\s\S]{0,400}await handleCallback\(request\)[\s\S]{0,400}whop_unexpected_callback_error/.test(CALLBACK_NEW));

// Each specific failure path emits its mapped code
for (const code of [
  "whop_config_missing",
  "whop_missing_code",
  "whop_state_mismatch",
  "whop_token_exchange_failed",
  "whop_missing_access_token",
  "whop_nonce_mismatch",
  "whop_missing_user",
  "whop_access_check_failed",
  "whop_no_resource_access",
  "whop_session_write_failed",
  "whop_unexpected_callback_error",
]) {
  check(`Callback emits '${code}' on its failure path`, CALLBACK_NEW.includes(`"${code}"`));
}

// Login page has copy for every new code
for (const code of [
  "whop_config_missing",
  "whop_missing_code",
  "whop_state_mismatch",
  "whop_token_exchange_failed",
  "whop_missing_access_token",
  "whop_nonce_mismatch",
  "whop_missing_user",
  "whop_access_check_failed",
  "whop_no_resource_access",
  "whop_session_write_failed",
  "whop_unexpected_callback_error",
]) {
  check(`Login page has ERROR_COPY for '${code}'`, LOGIN_PAGE.includes(`${code}:`));
}

// Old codes still mapped (backwards compat for any in-flight redirects)
for (const code of ["whop_state", "whop_token", "whop_userinfo", "whop_nonce"]) {
  check(`Backwards-compat: '${code}' still has copy`, LOGIN_PAGE.includes(`${code}:`));
}

// No-resource-access path stamps /pricing with the diagnostic too
check("No-resource-access path forwards diagnostic to /pricing",
  /\/pricing[\s\S]{0,400}whop_no_resource_access[\s\S]{0,200}no_membership/.test(CALLBACK_NEW));

// Token exchange http_error path forwards Whop's standard fields
check("Token-exchange http_error forwards whopError / whopDescription as wd / wdd",
  /tokenResult\.whopError[\s\S]{0,200}tokenResult\.whopDescription/.test(CALLBACK_NEW));

// Defensive: token-exchange never forwards the access_token itself.
// The only places we touch `tokens.access_token` are the legitimate
// fetchWhopUserInfo() call and nowhere else; check that no diagnostic
// param (`wd` / `wdd` / `code` / `description`) is set from it.
check("Callback never forwards access_token to /login URL",
  !/searchParams\.set\(\s*"wd"\s*,\s*tokens\.access_token/.test(CALLBACK_NEW) &&
  !/searchParams\.set\(\s*"wdd"\s*,\s*tokens\.access_token/.test(CALLBACK_NEW) &&
  !/code:\s*tokens\.access_token/.test(CALLBACK_NEW) &&
  !/description:\s*tokens\.access_token/.test(CALLBACK_NEW));

// ── Whop membership does NOT grant admin ─────────────────────────────

check("Middleware does not branch on Whop acl for /admin",
  // Middleware reuses the same auth as before for /admin; access_level
  // from Whop is recorded on the session but never used for routing.
  !/payload\.acl[\s\S]{0,200}admin[\s\S]{0,200}admin/.test(MIDDLEWARE));
check("Whop access response 'admin' level does NOT trigger admin route bypass",
  // /api/admin/* is excluded from middleware entirely and uses
  // validateAdminAuth at the handler — confirm middleware excludes it
  // by virtue of the PROTECTED_API_PREFIXES list (no /api/admin).
  !/\/api\/admin/.test(MIDDLEWARE) ||
  MIDDLEWARE.includes("PROTECTED_API_PREFIXES = [\"/api/lab\"]"));

console.log(`\n  result: ${pass}/${pass + fail} pass`);
if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
