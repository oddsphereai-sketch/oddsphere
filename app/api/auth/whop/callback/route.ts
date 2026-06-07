/**
 * GET /api/auth/whop/callback — finish the Whop OAuth flow.
 *
 * Verifies state + PKCE, exchanges the code for an access token, fetches
 * the Whop user id, calls the access API to confirm an active paid
 * membership against the configured WHOP_RESOURCE_ID, then mints our
 * own signed lab session cookie. The Whop access_token is discarded —
 * the cookie is purely a "we already verified you" marker.
 *
 * Failure modes:
 *   • Whop disabled                     → /login?error=whop_disabled
 *   • State mismatch / cookies missing  → /login?error=whop_state
 *   • Code missing / token exchange bad → /login?error=whop_token
 *   • Userinfo bad                      → /login?error=whop_userinfo
 *   • Access check failed (no membership) → /pricing  (or checkout URL)
 *   • Access check API error            → /login?error=whop_access_error
 *
 * Every failure path clears the temporary OAuth cookies so a retry
 * starts clean.
 */

import { sanitizeNext } from "@/lib/auth/betaSession";
import {
  WHOP_SESSION_MAX_AGE_SECONDS,
  buildWhopSessionSetCookie,
  signWhopSession,
} from "@/lib/auth/whopSession";
import {
  getCheckoutUrl,
  isWhopAccessEnabled,
} from "@/lib/auth/whopConfig";
import { checkWhopAccess } from "@/lib/auth/whopAccess";
import {
  WHOP_OAUTH_NEXT_COOKIE,
  WHOP_OAUTH_STATE_COOKIE,
  WHOP_OAUTH_VERIFIER_COOKIE,
  exchangeCodeForToken,
  fetchWhopUserInfo,
} from "@/lib/auth/whopOAuth";

function clearTempCookie(name: string): string {
  const isProd = process.env.NODE_ENV === "production";
  const secure = isProd ? "; Secure" : "";
  return `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;
}

function readCookieValue(cookieHeader: string | null, name: string): string | null {
  if (cookieHeader === null) return null;
  const prefix = `${name}=`;
  for (const part of cookieHeader.split(";")) {
    const t = part.trim();
    if (t.startsWith(prefix)) return t.slice(prefix.length);
  }
  return null;
}

/**
 * Whop's authorize endpoint can return any RFC-6749 OAuth error.
 * Mapping to OddSphere-side codes so the login UI can surface a
 * specific cause instead of bucketing everything as "cancelled".
 *
 *   access_denied             — user clicked Deny on the consent
 *                                screen (or Whop blocked the user)
 *   invalid_request           — our authorize URL params are wrong
 *   unauthorized_client       — the Whop OAuth app is not allowed to
 *                                use this flow (most often: OAuth
 *                                not enabled, app is in draft, or
 *                                redirect_uri not approved)
 *   unsupported_response_type — we asked for something other than `code`
 *   invalid_scope             — at least one scope we requested
 *                                ("openid profile email") is not
 *                                enabled in the developer-app config
 *   server_error              — Whop-side 5xx (transient)
 *   temporarily_unavailable   — Whop-side maintenance (transient)
 *
 * Anything we don't recognise lands as `whop_oauth_err` and the raw
 * code is still forwarded so the operator can diagnose.
 */
const WHOP_ERR_TO_KEY: Record<string, string> = {
  access_denied: "whop_denied",
  invalid_request: "whop_oauth_request",
  unauthorized_client: "whop_oauth_unauthorized",
  unsupported_response_type: "whop_oauth_unsupported",
  invalid_scope: "whop_oauth_scope",
  server_error: "whop_oauth_server",
  temporarily_unavailable: "whop_oauth_unavailable",
};

function redirectWithError(
  request: Request,
  error: string,
  detail?: { code?: string | null; description?: string | null },
  status = 302,
): Response {
  const url = new URL("/login", request.url);
  url.searchParams.set("error", error);
  // Pass the raw Whop error code through as `wd` so the login page
  // can show "Whop responded: <code>". The error code is not a
  // secret — Whop already put it in the URL it redirected the user
  // through. Cap length so a hostile/very long description can't
  // bloat the URL or our DOM.
  if (detail?.code !== null && detail?.code !== undefined && detail.code.length > 0) {
    url.searchParams.set("wd", detail.code.slice(0, 64));
  }
  if (detail?.description !== null && detail?.description !== undefined && detail.description.length > 0) {
    url.searchParams.set("wdd", detail.description.slice(0, 200));
  }
  const headers = new Headers({ Location: url.toString() });
  headers.append("Set-Cookie", clearTempCookie(WHOP_OAUTH_STATE_COOKIE));
  headers.append("Set-Cookie", clearTempCookie(WHOP_OAUTH_VERIFIER_COOKIE));
  headers.append("Set-Cookie", clearTempCookie(WHOP_OAUTH_NEXT_COOKIE));
  return new Response(null, { status, headers });
}

export async function GET(request: Request) {
  if (!isWhopAccessEnabled()) {
    return redirectWithError(request, "whop_disabled");
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");
  const whopError = url.searchParams.get("error");
  const whopErrorDescription = url.searchParams.get("error_description");
  if (whopError !== null) {
    const mapped = WHOP_ERR_TO_KEY[whopError] ?? "whop_oauth_err";
    return redirectWithError(request, mapped, {
      code: whopError,
      description: whopErrorDescription,
    });
  }
  if (code === null || stateParam === null) {
    return redirectWithError(request, "whop_state");
  }

  const cookieHeader = request.headers.get("cookie");
  const stateCookie = readCookieValue(cookieHeader, WHOP_OAUTH_STATE_COOKIE);
  const verifierCookie = readCookieValue(cookieHeader, WHOP_OAUTH_VERIFIER_COOKIE);
  const nextCookieRaw = readCookieValue(cookieHeader, WHOP_OAUTH_NEXT_COOKIE);
  const nextPath = sanitizeNext(
    nextCookieRaw !== null ? decodeURIComponent(nextCookieRaw) : undefined,
  );

  if (stateCookie === null || verifierCookie === null) {
    return redirectWithError(request, "whop_state");
  }
  if (stateCookie !== stateParam) {
    return redirectWithError(request, "whop_state");
  }

  const tokenResp = await exchangeCodeForToken({ code, codeVerifier: verifierCookie });
  if (tokenResp === null) {
    return redirectWithError(request, "whop_token");
  }

  const userInfo = await fetchWhopUserInfo(tokenResp.access_token);
  if (userInfo === null) {
    return redirectWithError(request, "whop_userinfo");
  }

  const access = await checkWhopAccess({ userId: userInfo.sub });
  if (!access.has_access) {
    if (access.reason === "denied") {
      // Member-facing: send to the checkout URL if configured, else
      // /pricing. The latter explains "Get Access" without faking a
      // checkout button.
      const checkout = getCheckoutUrl();
      const target = checkout !== null ? checkout : new URL("/pricing", request.url).toString();
      const headers = new Headers({ Location: target });
      headers.append("Set-Cookie", clearTempCookie(WHOP_OAUTH_STATE_COOKIE));
      headers.append("Set-Cookie", clearTempCookie(WHOP_OAUTH_VERIFIER_COOKIE));
      headers.append("Set-Cookie", clearTempCookie(WHOP_OAUTH_NEXT_COOKIE));
      return new Response(null, { status: 302, headers });
    }
    return redirectWithError(request, "whop_access_error");
  }

  // Mint our lab session.
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1 as const,
    uid: userInfo.sub,
    acl: access.access_level,
    iat: nowSec,
    exp: nowSec + WHOP_SESSION_MAX_AGE_SECONDS,
  };
  const cookieValue = await signWhopSession(payload);
  if (cookieValue === null) {
    return redirectWithError(request, "whop_session_error");
  }

  const target = new URL(nextPath, request.url);
  const headers = new Headers({ Location: target.toString() });
  headers.append("Set-Cookie", buildWhopSessionSetCookie(cookieValue));
  headers.append("Set-Cookie", clearTempCookie(WHOP_OAUTH_STATE_COOKIE));
  headers.append("Set-Cookie", clearTempCookie(WHOP_OAUTH_VERIFIER_COOKIE));
  headers.append("Set-Cookie", clearTempCookie(WHOP_OAUTH_NEXT_COOKIE));
  return new Response(null, { status: 302, headers });
}
