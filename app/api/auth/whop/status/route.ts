/**
 * GET /api/auth/whop/status — diagnostic / feature-flag probe.
 *
 * Originally introduced as a public-safe boolean probe (Phase 6B.3a).
 * Extended in 6B.3a.2 with redirect-URI + missing-envs diagnostics so
 * the operator can debug the most common live-launch failure mode:
 * Whop returning `{"error":"invalid_request","error_description":
 * "redirect_uri is invalid"}` because the URI we send doesn't match
 * what's registered in the Whop Developer App.
 *
 * What this endpoint exposes is intentionally non-secret:
 *   • whop_enabled / beta_fallback_enabled / checkout_url_configured
 *   • The full redirect_uri (already visible in the 302 to Whop)
 *   • A parsed host / path / protocol / trailing-slash breakdown
 *   • A first-8-chars preview of WHOP_CLIENT_ID (also visible in
 *     the OAuth redirect)
 *   • The NAMES (never values) of required envs that are missing
 *
 * What this endpoint does NOT expose:
 *   • WHOP_CLIENT_SECRET (any chars)
 *   • WHOP_API_KEY (any chars)
 *   • WHOP_SESSION_SECRET (any chars)
 *   • LAB_BETA_PASSWORD (any chars)
 *
 * Cache-Control: no-store so a redeploy with new env vars is reflected
 * on the very next call.
 */

import {
  describeRedirectUri,
  getCheckoutUrl,
  getClientIdPreview,
  getMissingWhopEnvs,
  isBetaFallbackEnabled,
  isBetaLoginPubliclyVisible,
  isWhopAccessEnabled,
} from "@/lib/auth/whopConfig";

export async function GET() {
  const missing = getMissingWhopEnvs();
  const redirect = describeRedirectUri();
  const clientIdPreview = getClientIdPreview();

  return Response.json(
    {
      whop_enabled: isWhopAccessEnabled(),
      beta_fallback_enabled: isBetaFallbackEnabled(),
      // Phase 6B.4 — exposes whether the beta password form is
      // publicly visible on /login. Server-only env flag controls
      // this; UI gating is in app/login/page.tsx.
      beta_login_publicly_visible: isBetaLoginPubliclyVisible(),
      checkout_url_configured: getCheckoutUrl() !== null,
      // Diagnostics for the "redirect_uri is invalid" error:
      whop_oauth_enabled_flag: missing.enabled_flag_set,
      missing_whop_envs: missing.missing,
      client_id_preview: clientIdPreview,
      redirect_uri: redirect,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
