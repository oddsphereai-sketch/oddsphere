/**
 * GET /api/auth/whop/start — kick off the Whop OAuth flow.
 *
 * Generates random state + PKCE verifier, stashes them in short-lived
 * HttpOnly cookies, then 302s to https://api.whop.com/oauth/authorize.
 *
 * Honors a `next` query parameter (sanitized to a same-origin path) so
 * the callback can return the member to the Lab page they originally
 * requested.
 *
 * Fail-closed: when Whop isn't configured, redirects to /login with
 * an error param. We never expose the OAuth surface unless every env
 * needed to complete the round-trip is set.
 */

import { sanitizeNext } from "@/lib/auth/betaSession";
import { isWhopAccessEnabled } from "@/lib/auth/whopConfig";
import {
  WHOP_OAUTH_NEXT_COOKIE,
  WHOP_OAUTH_STATE_COOKIE,
  WHOP_OAUTH_TEMP_COOKIE_MAX_AGE_SECONDS,
  WHOP_OAUTH_VERIFIER_COOKIE,
  buildAuthorizationUrl,
  pkceChallengeFromVerifier,
  randomToken,
} from "@/lib/auth/whopOAuth";

function tempCookie(name: string, value: string): string {
  const isProd = process.env.NODE_ENV === "production";
  const secure = isProd ? "; Secure" : "";
  return (
    `${name}=${value}` +
    `; Path=/` +
    `; Max-Age=${WHOP_OAUTH_TEMP_COOKIE_MAX_AGE_SECONDS}` +
    `; HttpOnly` +
    `; SameSite=Lax` +
    secure
  );
}

export async function GET(request: Request) {
  if (!isWhopAccessEnabled()) {
    const url = new URL("/login", request.url);
    url.searchParams.set("error", "whop_disabled");
    return Response.redirect(url.toString(), 302);
  }

  const url = new URL(request.url);
  const nextRaw = url.searchParams.get("next") ?? undefined;
  const nextPath = sanitizeNext(nextRaw);

  const state = randomToken(32);
  const verifier = randomToken(48);
  const challenge = await pkceChallengeFromVerifier(verifier);
  const authorizeUrl = buildAuthorizationUrl({ state, codeChallenge: challenge });
  if (authorizeUrl === null) {
    const errUrl = new URL("/login", request.url);
    errUrl.searchParams.set("error", "whop_disabled");
    return Response.redirect(errUrl.toString(), 302);
  }

  const headers = new Headers();
  headers.append("Set-Cookie", tempCookie(WHOP_OAUTH_STATE_COOKIE, state));
  headers.append("Set-Cookie", tempCookie(WHOP_OAUTH_VERIFIER_COOKIE, verifier));
  headers.append("Set-Cookie", tempCookie(WHOP_OAUTH_NEXT_COOKIE, encodeURIComponent(nextPath)));
  headers.set("Location", authorizeUrl);
  return new Response(null, { status: 302, headers });
}
