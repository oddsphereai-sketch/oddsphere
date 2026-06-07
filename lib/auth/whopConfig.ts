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
  /**
   * Public-mode OAuth apps have no client_secret — the PKCE
   * code_verifier carries the auth. We still read it if set (some
   * Whop endpoints, e.g. token revoke, may use it later) but the
   * token-exchange path does NOT send it.
   */
  clientSecret: string | null;
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
  const clientSecretEnv = process.env.WHOP_CLIENT_SECRET;
  const redirectUri   = process.env.WHOP_REDIRECT_URI;
  const apiKey        = process.env.WHOP_API_KEY;
  const resourceId    = process.env.WHOP_RESOURCE_ID;
  const sessionSecret = process.env.WHOP_SESSION_SECRET;

  // WHOP_CLIENT_SECRET is intentionally optional: Public-mode OAuth
  // apps (PKCE-only token exchange) don't have one. The remaining
  // five vars + session secret are still strictly required.
  if (
    !clientId      || clientId.length      === 0 ||
    !redirectUri   || redirectUri.length   === 0 ||
    !apiKey        || apiKey.length        === 0 ||
    !resourceId    || resourceId.length    === 0 ||
    !sessionSecret || sessionSecret.length < 32
  ) {
    return null;
  }

  const clientSecret = clientSecretEnv !== undefined && clientSecretEnv.length > 0 ? clientSecretEnv : null;
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

// ─── Diagnostics for /api/auth/whop/status ────────────────────────────
/**
 * The list of env vars Whop OAuth REQUIRES. Order matches the
 * isWhopAccessEnabled() readiness check. WHOP_OAUTH_ENABLED is
 * separate (it gates the whole feature, not "missing config").
 *
 * Phase 6B.3a.8 — WHOP_CLIENT_SECRET removed from this list because
 * the OAuth app is in Public mode (PKCE-only token exchange).
 */
export const WHOP_REQUIRED_ENV_NAMES = [
  "WHOP_CLIENT_ID",
  "WHOP_REDIRECT_URI",
  "WHOP_API_KEY",
  "WHOP_RESOURCE_ID",
  "WHOP_SESSION_SECRET",
] as const;

/**
 * Names of required env vars that are unset / empty / too-short
 * (WHOP_SESSION_SECRET needs ≥ 32 chars). Returns only NAMES, never
 * values — safe to expose publicly. WHOP_OAUTH_ENABLED is reported
 * separately so callers can distinguish "feature flag off" from
 * "feature flag on but missing keys".
 */
export function getMissingWhopEnvs(): {
  enabled_flag_set: boolean;
  missing: string[];
} {
  const enabled_flag_set = process.env.WHOP_OAUTH_ENABLED === "true";
  const missing: string[] = [];
  for (const name of WHOP_REQUIRED_ENV_NAMES) {
    const v = process.env[name];
    if (v === undefined || v.length === 0) {
      missing.push(name);
      continue;
    }
    if (name === "WHOP_SESSION_SECRET" && v.length < 32) {
      missing.push(`${name} (need ≥32 chars, have ${v.length})`);
    }
  }
  return { enabled_flag_set, missing };
}

/**
 * Safe shape exposing the redirect_uri the OAuth start route will
 * actually send to Whop. The full URI is already visible in the
 * 302 Location header during the OAuth handoff (and in browser dev
 * tools), so exposing it via /status is no additional disclosure —
 * but it lets operators diff against what's registered in Whop
 * without triggering a real OAuth round-trip.
 */
export type RedirectUriDiagnostic = {
  full: string;
  host: string;
  path: string;
  protocol: string;
  has_trailing_slash: boolean;
  parsed: true;
} | {
  full: string | null;
  parsed: false;
  reason: string;
};

export function describeRedirectUri(): RedirectUriDiagnostic {
  const raw = process.env.WHOP_REDIRECT_URI;
  if (raw === undefined || raw.length === 0) {
    return { full: null, parsed: false, reason: "WHOP_REDIRECT_URI not set" };
  }
  try {
    const u = new URL(raw);
    return {
      full: raw,
      host: u.host,
      path: u.pathname,
      protocol: u.protocol.replace(":", ""),
      has_trailing_slash: u.pathname.endsWith("/"),
      parsed: true,
    };
  } catch {
    return { full: raw, parsed: false, reason: "Could not parse as URL" };
  }
}

/**
 * First 8 chars of the OAuth client id, e.g. "app_abcd…". The full
 * client_id is sent to the browser in the OAuth redirect anyway — so
 * exposing a prefix here is not a new disclosure, just an aid for
 * operators verifying they're looking at the right Whop app.
 */
export function getClientIdPreview(): string | null {
  const raw = process.env.WHOP_CLIENT_ID;
  if (raw === undefined || raw.length === 0) return null;
  if (raw.length <= 8) return raw;
  return `${raw.slice(0, 8)}…`;
}
