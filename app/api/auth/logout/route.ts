/**
 * POST /api/auth/logout — clear the beta session cookie (Fix 5.1).
 *
 * Clears `oddsphere_beta_session` and returns 200 JSON `{ ok: true }`.
 * No body required. Subsequent requests to gated routes fail the middleware
 * check and redirect to /login (page routes) or return 401 JSON (API routes).
 *
 * Future UI: a logout link in `app/lab/components/LabAppNav.tsx` POSTs
 * here and then navigates to `/`. Not implementing the UI in Fix 5.1.
 */

import { BETA_SESSION_COOKIE_NAME } from "@/lib/auth/betaSession";

export async function POST(_request: Request) {
  const isProd = process.env.NODE_ENV === "production";
  const secureFlag = isProd ? "; Secure" : "";
  // Set Max-Age=0 to immediately expire the cookie. Path must match the
  // path used at set time (`/`) for the browser to clear it.
  const cookie =
    `${BETA_SESSION_COOKIE_NAME}=` +
    `; Path=/` +
    `; Max-Age=0` +
    `; HttpOnly` +
    `; SameSite=Lax` +
    secureFlag;
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": cookie,
    },
  });
}
