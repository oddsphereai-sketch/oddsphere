/**
 * betaSession — pre-launch V1 access gate session helper.
 *
 * Pure functions used by both the Edge middleware (middleware.ts) and the
 * /api/auth/login + /api/auth/logout route handlers. Runs in both Edge and
 * Node runtimes — uses Web Crypto API (crypto.subtle.digest) for SHA-256
 * so the same helper works in both environments without import branching.
 *
 * Architecture:
 *   • LAB_BETA_PASSWORD env var holds the shared beta password
 *   • Cookie value = SHA-256(LAB_BETA_PASSWORD), set on successful login
 *   • Middleware re-derives expected hash from env, compares constant-time
 *   • Rotating LAB_BETA_PASSWORD invalidates all existing cookies — desired
 *   • If env var is missing, every validation fails (fail closed)
 *
 * Phase 7 (Whop OAuth) replaces this with real session-based auth. The
 * cookie name + flow shape are chosen to be drop-in-replaceable.
 */

export const BETA_SESSION_COOKIE_NAME = "oddsphere_beta_session";

/** 7 days in seconds — cookie Max-Age per Fix 5.1 Flag H1. */
export const BETA_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

/**
 * Web-Crypto SHA-256 → lowercase hex. Works in Edge runtime and Node 18+.
 * The lib/auth/* surface stays runtime-agnostic so both the middleware
 * (Edge) and the route handler (Node) can share it.
 */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(hashBuffer);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Constant-time string equality. Avoids leaking length information about
 * the valid hash via timing differences. We're not protecting against a
 * sophisticated remote-timing attacker (the cookie hash is essentially
 * a public derived value) but the discipline is cheap and right.
 */
export function constantTimeStringEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Compute the canonical cookie value for the current `LAB_BETA_PASSWORD`
 * env value. Returns `null` if the env var is missing or empty — in that
 * case the middleware should treat ALL requests as unauthenticated (fail
 * closed) and the login route should refuse to validate any password.
 */
export async function expectedCookieValue(): Promise<string | null> {
  const password = process.env.LAB_BETA_PASSWORD;
  if (!password || password.length === 0) return null;
  return sha256Hex(password);
}

/**
 * Validate a cookie value against the current expected value. Returns
 * `false` when either (a) the env var is missing (fail closed) or
 * (b) the cookie value does not match the expected hash.
 */
export async function isValidBetaSession(
  cookieValue: string | undefined
): Promise<boolean> {
  if (!cookieValue) return false;
  const expected = await expectedCookieValue();
  if (expected === null) return false;
  return constantTimeStringEq(cookieValue, expected);
}

/**
 * Sanitize the `next` URL parameter used during login redirects to
 * prevent open-redirect vulnerabilities. Returns the input unchanged
 * only if it's a same-origin path. Otherwise returns the default.
 *
 * Rejected shapes:
 *   • Absolute URLs (http://, https://)
 *   • Protocol-relative URLs (//evil.com)
 *   • Anything not starting with /
 *   • Empty/null/non-string values
 */
export function sanitizeNext(next: string | null | undefined): string {
  const DEFAULT_NEXT = "/lab/daily-edge";
  if (!next || typeof next !== "string") return DEFAULT_NEXT;
  // Must start with exactly one forward slash
  if (!next.startsWith("/")) return DEFAULT_NEXT;
  // Reject protocol-relative URLs (//evil.com)
  if (next.startsWith("//")) return DEFAULT_NEXT;
  // Reject anything with a colon in the first path segment (protocol
  // scheme, e.g. javascript:alert(1))
  const firstSegment = next.split("/")[1] ?? "";
  if (firstSegment.includes(":")) return DEFAULT_NEXT;
  return next;
}

/**
 * Validate a submitted login password against the configured
 * LAB_BETA_PASSWORD env var. Returns `true` only when both:
 *   1. The env var is set + non-empty
 *   2. The submitted password matches (constant-time)
 *
 * When the env var is missing, returns `false` AND signals to callers
 * (via `serverMisconfigured`) so they can return a 503 instead of a
 * 401 (the distinction matters for member-facing error UX).
 */
export type LoginValidationResult =
  | { ok: true }
  | { ok: false; reason: "server_misconfigured" }
  | { ok: false; reason: "invalid_password" };

export function validateLoginAttempt(
  submittedPassword: string
): LoginValidationResult {
  const envPassword = process.env.LAB_BETA_PASSWORD;
  if (!envPassword || envPassword.length === 0) {
    return { ok: false, reason: "server_misconfigured" };
  }
  if (!submittedPassword || typeof submittedPassword !== "string") {
    return { ok: false, reason: "invalid_password" };
  }
  if (constantTimeStringEq(submittedPassword, envPassword)) {
    return { ok: true };
  }
  return { ok: false, reason: "invalid_password" };
}
