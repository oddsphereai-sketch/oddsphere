import {
  type ConversionCandidate,
  type JsonRecord,
  WHOP_ACCOUNT_ID,
  WHOP_API_VERSION,
  classifyConfirmedTrial,
  classifySuccessfulPayment,
  earliestSuccessfulPaymentMatches,
  verifyWhopWebhook,
} from "@/lib/analytics/membershipConversions";
import { sendMembershipConversion } from "@/lib/analytics/googleAnalytics";
import { supabase } from "@/lib/db/supabase";

export const dynamic = "force-dynamic";

function object(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function accountMatches(payload: JsonRecord): boolean {
  const data = object(payload.data);
  const received = text(payload.account_id)
    ?? text(data.account_id)
    ?? text(data.company_id);
  return received === null || received === (process.env.WHOP_ACCOUNT_ID || WHOP_ACCOUNT_ID);
}

async function isFirstSuccessfulPayment(candidate: ConversionCandidate): Promise<boolean> {
  if (!candidate.paymentId) return false;
  const apiKey = process.env.WHOP_API_KEY;
  if (!apiKey) throw new Error("WHOP_API_KEY is not configured");

  const url = new URL("https://api.whop.com/api/v1/payments");
  url.searchParams.set("account_id", process.env.WHOP_ACCOUNT_ID || WHOP_ACCOUNT_ID);
  url.searchParams.set("query", candidate.membershipId);
  url.searchParams.append("statuses", "paid");
  url.searchParams.append("substatuses", "succeeded");
  url.searchParams.set("order", "paid_at");
  url.searchParams.set("direction", "asc");
  url.searchParams.set("first", "10");
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${apiKey}`,
      "whop-version": WHOP_API_VERSION,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new Error(`Whop payment verification returned HTTP ${response.status}`);
  }
  const match = earliestSuccessfulPaymentMatches(
    await response.json(),
    candidate.membershipId,
    candidate.paymentId,
  );
  if (match === null) {
    throw new Error("Whop did not return an earliest successful payment");
  }
  return match;
}

async function attachPrivateAttribution(candidate: ConversionCandidate): Promise<{
  candidate: ConversionCandidate;
  consentGranted: boolean;
}> {
  const attributionId = text(candidate.metadata.oddsphere_attribution_id);
  if (!attributionId || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(attributionId)) {
    return { candidate, consentGranted: false };
  }

  const { data, error } = await supabase
    .from("checkout_attributions")
    .select("ga_client_id,ga_session_id,ga_measurement_id,consent_choice_id")
    .eq("id", attributionId)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw new Error(`Could not resolve private checkout attribution: ${error.message}`);
  if (!data?.consent_choice_id) return { candidate, consentGranted: false };

  const { data: consent, error: consentError } = await supabase
    .from("analytics_consent_choices")
    .select("choice")
    .eq("id", data.consent_choice_id)
    .maybeSingle();
  if (consentError) throw new Error(`Could not resolve analytics consent: ${consentError.message}`);
  if (consent?.choice !== "granted") return { candidate, consentGranted: false };

  return {
    consentGranted: true,
    candidate: {
      ...candidate,
      metadata: {
        ...candidate.metadata,
        oddsphere_ga_client_id: data.ga_client_id,
        oddsphere_ga_session_id: data.ga_session_id,
        oddsphere_ga_measurement_id: data.ga_measurement_id,
      },
    },
  };
}

async function claim(
  candidate: ConversionCandidate,
  webhookId: string,
): Promise<{ claimed: boolean; status: string | null }> {
  const { data, error } = await supabase.rpc("claim_membership_conversion_event", {
    p_conversion_key: candidate.conversionKey,
    p_conversion_kind: candidate.kind,
    p_source_webhook_id: webhookId,
    p_membership_id: candidate.membershipId,
    p_payment_id: candidate.paymentId,
    p_plan_id: candidate.planId,
    p_product_id: candidate.productId,
    p_occurred_at: candidate.occurredAt,
  });
  if (error) throw new Error(`Could not claim conversion: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : null;
  return {
    claimed: row?.claimed === true,
    status: typeof row?.current_status === "string" ? row.current_status : null,
  };
}

async function updateDelivery(
  candidate: ConversionCandidate,
  status: "sent" | "failed",
  errorMessage?: string,
): Promise<void> {
  const { error } = await supabase
    .from("membership_conversion_events")
    .update({
      status,
      sent_at: status === "sent" ? new Date().toISOString() : null,
      last_error: errorMessage?.slice(0, 500) ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("conversion_key", candidate.conversionKey)
    .eq("status", "processing");
  if (error) throw new Error(`Could not update conversion delivery: ${error.message}`);
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.WHOP_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "webhook_not_configured" }, { status: 503 });

  const rawBody = await request.text();
  const webhookId = request.headers.get("webhook-id");
  const valid = verifyWhopWebhook({
    rawBody,
    webhookId,
    webhookTimestamp: request.headers.get("webhook-timestamp"),
    webhookSignature: request.headers.get("webhook-signature"),
    secret,
  });
  if (!valid || webhookId === null) {
    return Response.json({ error: "invalid_signature" }, { status: 401 });
  }

  let payload: JsonRecord;
  try {
    payload = object(JSON.parse(rawBody));
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!accountMatches(payload)) return Response.json({ error: "wrong_account" }, { status: 403 });

  let candidate = classifyConfirmedTrial(payload) ?? classifySuccessfulPayment(payload);
  if (!candidate) return Response.json({ accepted: true, conversion: null });

  try {
    const attribution = await attachPrivateAttribution(candidate);
    candidate = attribution.candidate;
    if (!attribution.consentGranted) {
      return Response.json({
        accepted: true,
        conversion: null,
        reason: "analytics_consent_not_granted",
      });
    }
    if (candidate.kind === "first_paid" && !(await isFirstSuccessfulPayment(candidate))) {
      return Response.json({ accepted: true, conversion: null, reason: "not_first_payment" });
    }
    const deliveryClaim = await claim(candidate, webhookId);
    if (!deliveryClaim.claimed) {
      if (deliveryClaim.status === "sent") {
        return Response.json({ accepted: true, conversion: candidate.kind, duplicate: true });
      }
      // A prior worker may have stopped after claiming but before sending. A
      // non-2xx keeps Whop retrying until the five-minute stale claim can be
      // recovered; acknowledging it here would strand the conversion forever.
      return Response.json({ error: "conversion_already_processing" }, { status: 503 });
    }
    try {
      await sendMembershipConversion(candidate);
      await updateDelivery(candidate, "sent");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown conversion delivery error";
      await updateDelivery(candidate, "failed", message);
      throw error;
    }
    return Response.json({ accepted: true, conversion: candidate.kind });
  } catch (error) {
    console.error("Whop conversion webhook failed", {
      webhookId,
      conversionKind: candidate.kind,
      message: error instanceof Error ? error.message : "unknown",
    });
    return Response.json({ error: "conversion_delivery_failed" }, { status: 503 });
  }
}
