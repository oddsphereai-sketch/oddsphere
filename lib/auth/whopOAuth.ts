/**
 * Whop OAuth helpers (Phase 6B.3a).
 *
 * PKCE-flavoured authorization-code flow per Whop developer docs:
 *   1. /api/auth/whop/start
 *      a. Generate random state + PKCE code_verifier
 *      b. Set short-lived HttpOnly cookies for state + verifier
 *      c. Redirect to https://api.whop.com/oauth/authorize?... with
 *         code_challenge derived from the verifier
 *   2. /api/auth/whop/callback
 *      a. Verify state matches the cookie
 *      b. Exchange code + verifier at https://api.whop.com/oauth/token
 *      c. Use access_token to read /oauth/userinfo for the user id
 *      d. Call /api/v1/users/{uid}/access/{resourceId} with the server
 *         API key to confirm has_access === true
 *      e. On success, mint our own signed session cookie
 *      f. Discard the Whop access_token (we never keep it)
 *
 * These helpers are runtime-agnostic (Web Crypto, no Node-only imports).
 */

import { readWhopConfig, WHOP_ENDPOINTS } from "./whopConfig";

export const WHOP_OAUTH_STATE_COOKIE = "oddsphere_whop_oauth_state";
export const WHOP_OAUTH_VERIFIER_COOKIE = "oddsphere_whop_oauth_verifier";
export const WHOP_OAUTH_NEXT_COOKIE = "oddsphere_whop_oauth_next";
/**
 * Required when we request the `openid` scope (OIDC nonce). Without
 * this Whop rejects the authorize request with:
 *   invalid_request -- nonce is required for openid scope
 *
 * The nonce is bound to a single OAuth start, stored HttpOnly, and
 * matched against the `nonce` claim in the returned id_token to
 * prevent replay.
 */
export const WHOP_OAUTH_NONCE_COOKIE = "oddsphere_whop_oauth_nonce";
/** 10 minutes — enough for a user to complete the Whop flow, not
 * long enough to be a useful CSRF foothold. */
export const WHOP_OAUTH_TEMP_COOKIE_MAX_AGE_SECONDS = 60 * 10;

const SCOPES = "openid profile email";

// ─── base64url helpers (same convention as whopSession.ts) ─────────────

function base64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ─── PKCE + state ──────────────────────────────────────────────────────

/** Cryptographically random URL-safe token. */
export function randomToken(byteLen = 32): string {
  const bytes = new Uint8Array(byteLen);
  crypto.getRandomValues(bytes);
  return base64urlEncode(bytes);
}

export async function pkceChallengeFromVerifier(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return base64urlEncode(new Uint8Array(hash));
}

// ─── Authorization URL ─────────────────────────────────────────────────

export function buildAuthorizationUrl(opts: {
  state: string;
  codeChallenge: string;
  /** OIDC nonce — required by Whop whenever the scope includes `openid`. */
  nonce: string;
}): string | null {
  const cfg = readWhopConfig();
  if (cfg === null) return null;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    scope: SCOPES,
    state: opts.state,
    nonce: opts.nonce,
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${WHOP_ENDPOINTS.authorize}?${params.toString()}`;
}

/**
 * Decode the claims (payload) of a JWT WITHOUT verifying its signature.
 *
 * Why no signature check: we receive the id_token over a TLS-protected
 * direct POST to https://api.whop.com/oauth/token — the transport
 * authenticates the issuer, so a forged id_token can't reach this code
 * path. The nonce check below catches the OAuth-flow attack we DO care
 * about (replay of an old id_token within a different OAuth session
 * for the same user).
 *
 * Returns null on any malformed input — callers should treat that as
 * "id_token absent" and fall back to access_token + userinfo, which is
 * the original 6B.3a happy path.
 */
export function decodeIdTokenPayload(idToken: string): Record<string, unknown> | null {
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  const payloadB64Url = parts[1];
  if (payloadB64Url === undefined || payloadB64Url.length === 0) return null;
  try {
    const b64 = payloadB64Url.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json = atob(padded);
    const parsed = JSON.parse(json) as unknown;
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Token exchange ───────────────────────────────────────────────────

export type WhopTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
};

export async function exchangeCodeForToken(opts: {
  code: string;
  codeVerifier: string;
}): Promise<WhopTokenResponse | null> {
  const cfg = readWhopConfig();
  if (cfg === null) return null;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: cfg.redirectUri,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code_verifier: opts.codeVerifier,
  });
  const res = await fetch(WHOP_ENDPOINTS.token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as WhopTokenResponse;
  if (typeof json.access_token !== "string" || json.access_token.length === 0) return null;
  return json;
}

// ─── User info ─────────────────────────────────────────────────────────

export type WhopUserInfo = {
  /** Per Whop docs, the `sub` claim carries the user_xxx id. */
  sub: string;
  email?: string;
  name?: string;
  username?: string;
};

export async function fetchWhopUserInfo(accessToken: string): Promise<WhopUserInfo | null> {
  const res = await fetch(WHOP_ENDPOINTS.userinfo, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as Record<string, unknown>;
  const sub = typeof json["sub"] === "string" ? (json["sub"] as string) : null;
  if (sub === null || sub.length === 0) return null;
  return {
    sub,
    email: typeof json["email"] === "string" ? (json["email"] as string) : undefined,
    name: typeof json["name"] === "string" ? (json["name"] as string) : undefined,
    username: typeof json["username"] === "string" ? (json["username"] as string) : undefined,
  };
}
