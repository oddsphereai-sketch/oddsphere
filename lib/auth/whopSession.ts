/**
 * Whop lab-session cookie helper (Phase 6B.3a).
 *
 * Issued by /api/auth/whop/callback after a successful OAuth → access
 * check sequence. Recognised by middleware.ts alongside the beta
 * session as "this user can enter the Lab."
 *
 * Cookie shape:
 *   Name:  oddsphere_whop_session
 *   Value: base64url(payloadJSON) + "." + base64url(hmacSha256(payload, secret))
 *
 * Payload:
 *   {
 *     v: 1,                     // version, for forward compat
 *     uid: "user_xxx",          // Whop user ID — opaque, no PII
 *     acl: "customer"|"admin",  // access_level reported by Whop
 *     iat: <epoch seconds>,     // issued-at
 *     exp: <epoch seconds>      // expires-at (matches cookie Max-Age)
 *   }
 *
 * Security choices:
 *   • HMAC-SHA-256 with WHOP_SESSION_SECRET. The secret is required
 *     and validated by whopConfig (min length 32).
 *   • Payload is JSON-encoded, not encrypted. It contains only the
 *     Whop user ID + access level, no email/payment data.
 *   • Constant-time comparison on the signature.
 *   • Web Crypto so this works in both Edge (middleware) and Node
 *     (route handlers) runtimes — same as betaSession.
 *
 * Whop's access_token is intentionally NOT stored in the cookie. We
 * pull access_token at OAuth time, do the access check, then discard
 * it. This is "session-on-success" — the cookie is our own.
 */

import { constantTimeStringEq } from "./betaSession";
import { readWhopConfig } from "./whopConfig";

export const WHOP_SESSION_COOKIE_NAME = "oddsphere_whop_session";

/** 7 days, mirrors the beta session ceiling. */
export const WHOP_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

/**
 * Re-check Whop access at most this often. Older sessions still in
 * window are accepted as-is; older than this and we should ideally
 * re-verify (the V1 scaffold doesn't do this transparent re-check —
 * a separate /api/auth/whop/refresh endpoint can be added later).
 *
 * Today, the cookie's own exp is the upper bound on staleness.
 */
export const WHOP_ACCESS_REFRESH_INTERVAL_SECONDS = 60 * 60 * 6; // 6 hours

export type WhopSessionPayload = {
  v: 1;
  uid: string;
  acl: "customer" | "admin";
  iat: number;
  exp: number;
};

// ─── encode helpers (Edge-safe) ────────────────────────────────────────

function base64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecodeToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function encodeUtf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function decodeUtf8(b: Uint8Array): string {
  return new TextDecoder().decode(b);
}

// ─── HMAC ──────────────────────────────────────────────────────────────

async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encodeUtf8(secret) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encodeUtf8(message) as BufferSource);
  return new Uint8Array(sig);
}

// ─── sign / verify ─────────────────────────────────────────────────────

/**
 * Build a signed cookie value for the given payload. Returns null if
 * Whop config isn't fully present — callers should treat that as
 * "can't issue, refuse the login."
 */
export async function signWhopSession(payload: WhopSessionPayload): Promise<string | null> {
  const cfg = readWhopConfig();
  if (cfg === null) return null;
  const payloadJson = JSON.stringify(payload);
  const payloadB64 = base64urlEncode(encodeUtf8(payloadJson));
  const sig = await hmacSha256(cfg.sessionSecret, payloadB64);
  const sigB64 = base64urlEncode(sig);
  return `${payloadB64}.${sigB64}`;
}

/**
 * Verify a cookie value and return its payload, or null when the
 * cookie is malformed, tampered, or expired. Fail-closed: if Whop
 * config is missing we ALSO return null — never grant access from
 * a cookie we can't validate.
 */
export async function verifyWhopSession(cookieValue: string | undefined): Promise<WhopSessionPayload | null> {
  if (!cookieValue) return null;
  const cfg = readWhopConfig();
  if (cfg === null) return null;

  const dot = cookieValue.indexOf(".");
  if (dot <= 0 || dot >= cookieValue.length - 1) return null;
  const payloadB64 = cookieValue.slice(0, dot);
  const sigB64 = cookieValue.slice(dot + 1);

  const expectedSig = await hmacSha256(cfg.sessionSecret, payloadB64);
  const expectedSigB64 = base64urlEncode(expectedSig);
  if (!constantTimeStringEq(sigB64, expectedSigB64)) return null;

  let payload: WhopSessionPayload;
  try {
    const parsed = JSON.parse(decodeUtf8(base64urlDecodeToBytes(payloadB64)));
    if (
      typeof parsed !== "object" || parsed === null ||
      parsed.v !== 1 ||
      typeof parsed.uid !== "string" || parsed.uid.length === 0 ||
      (parsed.acl !== "customer" && parsed.acl !== "admin") ||
      typeof parsed.iat !== "number" ||
      typeof parsed.exp !== "number"
    ) {
      return null;
    }
    payload = parsed as WhopSessionPayload;
  } catch {
    return null;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.exp <= nowSec) return null;
  return payload;
}

/**
 * Convenience: build the Set-Cookie header for the Whop session.
 * Mirrors the beta-session cookie attributes so middleware can treat
 * either as equivalent for Lab access.
 */
export function buildWhopSessionSetCookie(cookieValue: string): string {
  const isProd = process.env.NODE_ENV === "production";
  const secureFlag = isProd ? "; Secure" : "";
  return (
    `${WHOP_SESSION_COOKIE_NAME}=${cookieValue}` +
    `; Path=/` +
    `; Max-Age=${WHOP_SESSION_MAX_AGE_SECONDS}` +
    `; HttpOnly` +
    `; SameSite=Lax` +
    secureFlag
  );
}

/** Set-Cookie that clears the Whop session. */
export function buildWhopSessionClearCookie(): string {
  const isProd = process.env.NODE_ENV === "production";
  const secureFlag = isProd ? "; Secure" : "";
  return (
    `${WHOP_SESSION_COOKIE_NAME}=` +
    `; Path=/` +
    `; Max-Age=0` +
    `; HttpOnly` +
    `; SameSite=Lax` +
    secureFlag
  );
}
