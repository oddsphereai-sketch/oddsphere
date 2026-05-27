/**
 * POST /api/auth/login — pre-launch V1 beta-password login (Fix 5.1).
 *
 * Validates a submitted password against `LAB_BETA_PASSWORD`. On success
 * sets the `oddsphere_beta_session` cookie and redirects to the
 * sanitized `next` path. On failure redirects back to /login with the
 * error param.
 *
 * Body shapes accepted:
 *   • application/x-www-form-urlencoded (HTML form submission)
 *   • application/json (programmatic clients / smoke tests)
 *
 * Both shapes carry `{ password: string, next?: string }`.
 *
 * Response shapes:
 *   • 303 See Other → next (sanitized) + Set-Cookie on success
 *   • 302 Found → /login?next=...&error=invalid on bad password
 *   • 503 → /login?next=...&error=unavailable when LAB_BETA_PASSWORD
 *     env var is missing (fail closed; doesn't leak the var name to
 *     anonymous visitors)
 *
 * Phase 7 (Whop OAuth) replaces this route entirely. The /login page +
 * cookie shape are chosen to be drop-in-replaceable.
 */

import {
  BETA_SESSION_COOKIE_NAME,
  BETA_SESSION_MAX_AGE_SECONDS,
  expectedCookieValue,
  sanitizeNext,
  validateLoginAttempt,
} from "@/lib/auth/betaSession";

type LoginBody = {
  password?: string;
  next?: string;
};

/**
 * Parse the request body whether it's form-urlencoded or JSON. Returns an
 * empty object on parse failure (caller handles missing password as
 * invalid).
 */
async function readBody(request: Request): Promise<LoginBody> {
  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      return (await request.json()) as LoginBody;
    }
    // Default to form-encoded — what an HTML form submission sends.
    const formData = await request.formData();
    return {
      password: (formData.get("password") as string | null) ?? undefined,
      next: (formData.get("next") as string | null) ?? undefined,
    };
  } catch {
    return {};
  }
}

export async function POST(request: Request) {
  const body = await readBody(request);
  const nextPath = sanitizeNext(body.next);
  const validation = validateLoginAttempt(body.password ?? "");

  // Server misconfigured (LAB_BETA_PASSWORD unset). Member-facing redirect
  // with a non-disclosing error param. Never reveal the env var name to
  // anonymous visitors.
  if (!validation.ok && validation.reason === "server_misconfigured") {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", nextPath);
    loginUrl.searchParams.set("error", "unavailable");
    return Response.redirect(loginUrl.toString(), 303);
  }

  // Invalid password.
  if (!validation.ok) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", nextPath);
    loginUrl.searchParams.set("error", "invalid");
    return Response.redirect(loginUrl.toString(), 303);
  }

  // Success — build cookie value, set it, redirect to `next`.
  const cookieValue = await expectedCookieValue();
  if (cookieValue === null) {
    // Should be unreachable (validateLoginAttempt already guarded on
    // missing env var) — defensive 503.
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", nextPath);
    loginUrl.searchParams.set("error", "unavailable");
    return Response.redirect(loginUrl.toString(), 303);
  }

  // Construct the Set-Cookie header. `Secure` only in production so local
  // `npm run dev` (HTTP) can also exercise the gate end-to-end.
  const isProd = process.env.NODE_ENV === "production";
  const secureFlag = isProd ? "; Secure" : "";
  const cookie =
    `${BETA_SESSION_COOKIE_NAME}=${cookieValue}` +
    `; Path=/` +
    `; Max-Age=${BETA_SESSION_MAX_AGE_SECONDS}` +
    `; HttpOnly` +
    `; SameSite=Lax` +
    secureFlag;

  // 303 See Other — correct semantic for POST → GET redirect after form
  // submission. Browsers and curl both follow it.
  const target = new URL(nextPath, request.url);
  return new Response(null, {
    status: 303,
    headers: {
      Location: target.toString(),
      "Set-Cookie": cookie,
    },
  });
}
