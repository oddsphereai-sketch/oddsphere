/**
 * POST /api/auth/logout — clear all lab session cookies (Phase 6B.3a).
 *
 * Clears the beta-session cookie AND the Whop-session cookie. Returns
 * 200 JSON `{ ok: true }`. Subsequent requests to gated routes fail
 * the middleware check and redirect to /login (page routes) or return
 * 401 JSON (API routes).
 *
 * Whop token revocation:
 *   We do NOT call Whop's token-revoke endpoint here — we never stored
 *   the user's Whop access_token (it was discarded after the callback's
 *   access check). The Whop session cookie we clear is our own signed
 *   value, not a Whop credential.
 */

import { BETA_SESSION_COOKIE_NAME } from "@/lib/auth/betaSession";
import { buildWhopSessionClearCookie } from "@/lib/auth/whopSession";

export async function POST(_request: Request) {
  const isProd = process.env.NODE_ENV === "production";
  const secureFlag = isProd ? "; Secure" : "";
  const betaClear =
    `${BETA_SESSION_COOKIE_NAME}=` +
    `; Path=/` +
    `; Max-Age=0` +
    `; HttpOnly` +
    `; SameSite=Lax` +
    secureFlag;
  const whopClear = buildWhopSessionClearCookie();

  const headers = new Headers({ "Content-Type": "application/json" });
  headers.append("Set-Cookie", betaClear);
  headers.append("Set-Cookie", whopClear);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers,
  });
}
