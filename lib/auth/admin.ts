/**
 * Admin authentication helper (V1).
 *
 * V1 is intentionally simple per Daniel's H-decision: email allowlist +
 * shared admin token. Phase 8 replaces this with proper Whop session-based
 * admin role checks.
 *
 * Two env vars drive the check:
 *   ADMIN_TOKEN                — shared secret sent in `x-admin-token` header
 *   ADMIN_EMAIL_ALLOWLIST      — comma-separated emails sent via `x-admin-email`
 *
 * Both must be present + match for auth to succeed. The endpoint returns
 * structured AuthResult so callers can choose 401 (auth failure) vs 403
 * (authenticated but not in allowlist).
 */

export type AdminAuthResult =
  | { ok: true; email: string }
  | { ok: false; response: Response };

export function validateAdminAuth(request: Request): AdminAuthResult {
  const token = process.env.ADMIN_TOKEN;
  const allowlist = process.env.ADMIN_EMAIL_ALLOWLIST;
  if (!token || !allowlist) {
    return {
      ok: false,
      response: new Response(
        "Server misconfiguration: ADMIN_TOKEN and/or ADMIN_EMAIL_ALLOWLIST not set",
        { status: 500 }
      ),
    };
  }

  const providedToken = request.headers.get("x-admin-token");
  if (providedToken !== token) {
    return {
      ok: false,
      response: new Response("Unauthorized", { status: 401 }),
    };
  }

  const providedEmail = (request.headers.get("x-admin-email") ?? "")
    .trim()
    .toLowerCase();
  const allowedEmails = allowlist
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);

  if (!providedEmail || !allowedEmails.includes(providedEmail)) {
    return {
      ok: false,
      response: new Response(
        `Forbidden: '${providedEmail}' is not in the admin allowlist`,
        { status: 403 }
      ),
    };
  }

  return { ok: true, email: providedEmail };
}
