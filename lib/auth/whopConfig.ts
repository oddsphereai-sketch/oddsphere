/**
 * Whop integration env + endpoint config (Phase 6B.3a).
 *
 * Centralizes the env-var contract so every code path agrees on:
 *   • whether Whop is enabled at all (feature flag)
 *   • whether every required env var is present (fail closed)
 *   • which Whop endpoints to call
 *
 * Endpoint URLs verified against the public Whop developer docs:
 *   - Authorize:   https://api.whop.com/oauth/authorize
 *   - Token:       https://api.whop.com/oauth/token
 *   - Userinfo:    https://api.whop.com/oauth/userinfo
 *   - Access check: GET https://api.whop.com/api/v1/users/{userId}/access/{resourceId}
 *
 * Required env vars (all must be set when WHOP_OAUTH_ENABLED=true):
 *   WHOP_OAUTH_ENABLED       — feature flag, "true" enables the flow
 *   WHOP_CLIENT_ID           — "app_xxx" from Whop dashboard
 *   WHOP_CLIENT_SECRET       — issued with the OAuth app
 *   WHOP_REDIRECT_URI        — exact match URI registered with Whop
 *   WHOP_API_KEY             — server API key for access checks
 *   WHOP_RESOURCE_ID         — the resource to check access against:
 *                              prod_xxx (product), biz_xxx (company),
 *                              or exp_xxx (experience)
 *   WHOP_SESSION_SECRET      — HMAC key for signing the lab session
 *                              cookie. Min length 32 chars.
 *
 * Optional / informational:
 *   WHOP_CHECKOUT_URL        — public URL members visit to buy access.
 *                              Surfaced as the "Get Access" CTA when
 *                              configured; otherwise the CTA hides.
 *
 * Fail-closed posture:
 *   isWhopAccessEnabled() returns false unless WHOP_OAUTH_ENABLED is
 *   "true" AND every required env is set. Anywhere we'd issue or
 *   trust a Whop session, we call this first.
 */

export const WHOP_ENDPOINTS = {
  authorize: "https://api.whop.com/oauth/authorize",
  token:     "https://api.whop.com/oauth/token",
  userinfo:  "https://api.whop.com/oauth/userinfo",
  /** GET this with {userId} and {resourceId} substituted in. */
  accessTemplate: "https://api.whop.com/api/v1/users/{userId}/access/{resourceId}",
} as const;

export type WhopAccessConfig = {
  enabled: true;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  apiKey: string;
  resourceId: string;
  sessionSecret: string;
  checkoutUrl: string | null;
};

/**
 * Resolve config from env. Returns `null` when Whop is disabled or any
 * required env var is missing — callers MUST treat null as "Whop is not
 * available, fall back to beta or refuse access" (never as "let them in").
 */
export function readWhopConfig(): WhopAccessConfig | null {
  if (process.env.WHOP_OAUTH_ENABLED !== "true") return null;

  const clientId      = process.env.WHOP_CLIENT_ID;
  const clientSecret  = process.env.WHOP_CLIENT_SECRET;
  const redirectUri   = process.env.WHOP_REDIRECT_URI;
  const apiKey        = process.env.WHOP_API_KEY;
  const resourceId    = process.env.WHOP_RESOURCE_ID;
  const sessionSecret = process.env.WHOP_SESSION_SECRET;

  if (
    !clientId      || clientId.length      === 0 ||
    !clientSecret  || clientSecret.length  === 0 ||
    !redirectUri   || redirectUri.length   === 0 ||
    !apiKey        || apiKey.length        === 0 ||
    !resourceId    || resourceId.length    === 0 ||
    !sessionSecret || sessionSecret.length < 32
  ) {
    return null;
  }

  const checkoutUrl = process.env.WHOP_CHECKOUT_URL ?? null;
  return {
    enabled: true,
    clientId,
    clientSecret,
    redirectUri,
    apiKey,
    resourceId,
    sessionSecret,
    checkoutUrl: checkoutUrl !== null && checkoutUrl.length > 0 ? checkoutUrl : null,
  };
}

/**
 * Public-safe predicate: does this server have a usable Whop config?
 * Server-only — never expose anything that reveals the actual values.
 */
export function isWhopAccessEnabled(): boolean {
  return readWhopConfig() !== null;
}

/**
 * Public-safe predicate: is the beta-password fallback configured?
 * The login page surfaces beta access only when this is true.
 */
export function isBetaFallbackEnabled(): boolean {
  const pwd = process.env.LAB_BETA_PASSWORD;
  return pwd !== undefined && pwd.length > 0;
}

/**
 * Member-facing checkout URL when Whop is configured. Returns null
 * (and the UI hides the CTA) when not set — never returns a stale or
 * fabricated URL.
 */
export function getCheckoutUrl(): string | null {
  const cfg = readWhopConfig();
  return cfg?.checkoutUrl ?? null;
}
