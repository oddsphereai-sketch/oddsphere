import { randomUUID } from "node:crypto";

import {
  ANALYTICS_CHOICE_COOKIE,
  analyticsAllowed,
  analyticsConsentFromCookieHeader,
  cookieValue,
} from "@/lib/analytics/consent";
import {
  WHOP_ANNUAL_PLAN_ID,
  WHOP_API_VERSION,
  WHOP_MONTHLY_PLAN_ID,
  analyticsMetadataFromCookies,
} from "@/lib/analytics/membershipConversions";
import { supabase } from "@/lib/db/supabase";

export const dynamic = "force-dynamic";

const DIRECT_CHECKOUT_URLS = {
  monthly: `https://whop.com/checkout/${WHOP_MONTHLY_PLAN_ID}`,
  annual: `https://whop.com/checkout/${WHOP_ANNUAL_PLAN_ID}`,
} as const;

type PlanName = keyof typeof DIRECT_CHECKOUT_URLS;

function selectedPlan(url: URL): PlanName {
  return url.searchParams.get("plan") === "annual" ? "annual" : "monthly";
}

function planId(plan: PlanName): string {
  return plan === "annual" ? WHOP_ANNUAL_PLAN_ID : WHOP_MONTHLY_PLAN_ID;
}

function fallback(plan: PlanName): Response {
  return Response.redirect(DIRECT_CHECKOUT_URLS[plan], 302);
}

/**
 * Preserve attribution without declaring a conversion. Whop receives only a
 * random lookup token; the GA identifiers remain in OddSphere's private DB.
 */
export async function GET(request: Request): Promise<Response> {
  const plan = selectedPlan(new URL(request.url));
  const apiKey = process.env.WHOP_API_KEY;
  const measurementId = process.env.GOOGLE_ANALYTICS_MEASUREMENT_ID;
  const salt = process.env.CONVERSION_TRACKING_SALT;
  if (!apiKey || !measurementId || !salt) return fallback(plan);

  const cookieHeader = request.headers.get("cookie");
  if (cookieValue(cookieHeader, ANALYTICS_CHOICE_COOKIE) !== "granted") return fallback(plan);
  const consent = analyticsConsentFromCookieHeader(cookieHeader, salt);
  if (!analyticsAllowed(consent)) return fallback(plan);
  const { data: currentConsent, error: consentError } = await supabase
    .from("analytics_consent_choices")
    .select("choice")
    .eq("id", consent.id)
    .maybeSingle();
  if (consentError || currentConsent?.choice !== "granted") return fallback(plan);

  const analytics = analyticsMetadataFromCookies(cookieHeader, measurementId);
  const clientId = analytics.oddsphere_ga_client_id;
  if (typeof clientId !== "string") return fallback(plan);

  const attributionId = randomUUID();
  const { error: attributionError } = await supabase.from("checkout_attributions").insert({
    id: attributionId,
    ga_client_id: clientId,
    ga_session_id: typeof analytics.oddsphere_ga_session_id === "string"
      ? analytics.oddsphere_ga_session_id
      : null,
    ga_measurement_id: measurementId,
    consent_choice_id: consent.id,
  });
  if (attributionError) return fallback(plan);

  try {
    const response = await fetch("https://api.whop.com/api/v1/checkout_configurations", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
        "whop-version": WHOP_API_VERSION,
      },
      body: JSON.stringify({
        // Reference the existing plan; never create or override billing terms.
        plan_id: planId(plan),
        mode: "payment",
        metadata: { oddsphere_attribution_id: attributionId },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      // Do not log the response body, credentials, consent or attribution IDs.
      console.warn("Whop checkout attribution fallback", { reason: "whop_http_error", status: response.status });
      return fallback(plan);
    }
    const body = await response.json() as { purchase_url?: unknown };
    const purchaseUrl = typeof body.purchase_url === "string" ? new URL(body.purchase_url) : null;
    if (!purchaseUrl || purchaseUrl.origin !== "https://whop.com" || purchaseUrl.username || purchaseUrl.password) {
      console.warn("Whop checkout attribution fallback", { reason: "invalid_purchase_url" });
      return fallback(plan);
    }
    return Response.redirect(purchaseUrl.toString(), 302);
  } catch {
    // Attribution must never make checkout unavailable.
    console.warn("Whop checkout attribution fallback", { reason: "request_or_response_failure" });
    return fallback(plan);
  }
}
