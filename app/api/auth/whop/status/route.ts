/**
 * GET /api/auth/whop/status — public-safe feature-flag probe.
 *
 * Tells the client (login page, marketing CTAs) whether Whop OAuth is
 * configured on this server. Returns only booleans — no secrets, no
 * resource IDs, no endpoint URLs. The login page uses this to decide
 * whether to surface the "Sign in with Whop" button.
 *
 * Public route, intentionally CDN-bypassed (no-store) so a deploy with
 * new env vars takes effect immediately.
 */

import {
  getCheckoutUrl,
  isBetaFallbackEnabled,
  isWhopAccessEnabled,
} from "@/lib/auth/whopConfig";

export async function GET() {
  return Response.json(
    {
      whop_enabled: isWhopAccessEnabled(),
      beta_fallback_enabled: isBetaFallbackEnabled(),
      checkout_url_configured: getCheckoutUrl() !== null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
