import "server-only";

import type { ConversionCandidate } from "./membershipConversions";
import { buildGoogleAnalyticsEvent } from "./membershipConversions";

export async function sendMembershipConversion(candidate: ConversionCandidate): Promise<void> {
  const measurementId = process.env.GOOGLE_ANALYTICS_MEASUREMENT_ID;
  const apiSecret = process.env.GOOGLE_ANALYTICS_API_SECRET;
  const salt = process.env.CONVERSION_TRACKING_SALT;
  if (!measurementId || !apiSecret || !salt || salt.length < 32) {
    throw new Error("Google Analytics conversion tracking is not fully configured");
  }

  const endpoint = new URL("https://www.google-analytics.com/mp/collect");
  endpoint.searchParams.set("measurement_id", measurementId);
  endpoint.searchParams.set("api_secret", apiSecret);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildGoogleAnalyticsEvent(candidate, salt)),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new Error(`Google Analytics Measurement Protocol returned HTTP ${response.status}`);
  }
}
