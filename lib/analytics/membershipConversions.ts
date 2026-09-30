import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const WHOP_API_VERSION = "2026-09-25";
export const WHOP_ACCOUNT_ID = "biz_NS0QQRENKrAf96";
export const WHOP_PRODUCT_ID = "prod_grypgrmtPLcQw";
export const WHOP_MONTHLY_PLAN_ID = "plan_zR8HdNVFZv5Sr";
export const WHOP_ANNUAL_PLAN_ID = "plan_Twz3lU0osOoyf";

export const TRIAL_CONVERSION_EVENT = "trial_activation_confirmed";
export const FIRST_PAID_CONVERSION_EVENT = "purchase";

const TRIAL_LENGTH_MS = 7 * 24 * 60 * 60 * 1000;
const TRIAL_LENGTH_TOLERANCE_MS = 10 * 60 * 1000;
const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export type JsonRecord = Record<string, unknown>;

export type ConversionCandidate = {
  kind: "trial" | "first_paid";
  conversionKey: string;
  membershipId: string;
  paymentId: string | null;
  planId: string;
  productId: string | null;
  occurredAt: string;
  whopUserId: string | null;
  metadata: JsonRecord;
  value: number | null;
  currency: string | null;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim().length > 0
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function eventType(payload: JsonRecord): string | null {
  return text(payload.type) ?? text(payload.action);
}

function eventData(payload: JsonRecord): JsonRecord {
  return record(payload.data);
}

function eventOccurredAt(payload: JsonRecord, data: JsonRecord): string | null {
  return text(data.paid_at)
    ?? text(data.current_period_start)
    ?? text(data.renewal_period_start)
    ?? text(payload.timestamp)
    ?? text(payload.created_at);
}

function userId(data: JsonRecord): string | null {
  return text(data.user_id)
    ?? text(record(data.user).id);
}

function planId(data: JsonRecord): string | null {
  return text(data.plan_id)
    ?? text(record(data.plan).id);
}

function productId(data: JsonRecord): string | null {
  return text(data.product_id)
    ?? text(record(data.product).id);
}

function membershipId(data: JsonRecord): string | null {
  return text(data.membership_id)
    ?? text(record(data.membership).id);
}

/**
 * Only a lifecycle event whose stored membership period is seven days and whose
 * Whop status is `trialing` can become a trial conversion. Page views, checkout
 * opens, and checkout configuration events have no path through this function.
 */
export function classifyConfirmedTrial(payload: JsonRecord): ConversionCandidate | null {
  if (eventType(payload) !== "membership.activated") return null;
  const data = eventData(payload);
  const id = text(data.id) ?? membershipId(data);
  const plan = planId(data);
  const status = text(data.status);
  // Whop v1 deliveries use renewal_period_*. Keep each pair together: do not
  // construct a period from a mixture of two different payload contracts.
  const hasCurrentPeriod = data.current_period_start != null || data.current_period_end != null;
  const start = text(hasCurrentPeriod ? data.current_period_start : data.renewal_period_start);
  const end = text(hasCurrentPeriod ? data.current_period_end : data.renewal_period_end);
  if (id === null || plan !== WHOP_MONTHLY_PLAN_ID || status !== "trialing" || start === null || end === null) {
    return null;
  }

  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  if (Math.abs((endMs - startMs) - TRIAL_LENGTH_MS) > TRIAL_LENGTH_TOLERANCE_MS) return null;

  return {
    kind: "trial",
    conversionKey: `trial:${id}`,
    membershipId: id,
    paymentId: null,
    planId: plan,
    productId: productId(data),
    occurredAt: eventOccurredAt(payload, data) ?? start,
    whopUserId: userId(data),
    metadata: record(data.metadata),
    value: 0,
    currency: null,
  };
}

const SUBSCRIPTION_BILLING_REASONS = new Set([
  "subscription",
  "subscription_create",
  "subscription_cycle",
  "subscription_update",
]);

/**
 * This is deliberately only a candidate. The webhook route must additionally
 * ask Whop for the membership's earliest successful payment and match its id.
 */
export function classifySuccessfulPayment(payload: JsonRecord): ConversionCandidate | null {
  if (eventType(payload) !== "payment.succeeded") return null;
  const data = eventData(payload);
  const payment = text(data.id);
  const membership = membershipId(data);
  const plan = planId(data);
  const status = text(data.status);
  const substatus = text(data.substatus);
  const reason = text(data.billing_reason);
  const total = finiteNumber(data.total);
  const occurredAt = eventOccurredAt(payload, data);

  if (
    payment === null ||
    membership === null ||
    plan === null ||
    ![WHOP_MONTHLY_PLAN_ID, WHOP_ANNUAL_PLAN_ID].includes(plan) ||
    status !== "paid" ||
    (substatus !== null && substatus !== "succeeded") ||
    reason === null ||
    !SUBSCRIPTION_BILLING_REASONS.has(reason) ||
    total === null ||
    total <= 0 ||
    occurredAt === null
  ) {
    return null;
  }

  return {
    kind: "first_paid",
    conversionKey: `paid:${membership}`,
    membershipId: membership,
    paymentId: payment,
    planId: plan,
    productId: productId(data),
    occurredAt,
    whopUserId: userId(data),
    metadata: record(data.metadata),
    value: total,
    currency: text(data.currency)?.toUpperCase() ?? "USD",
  };
}

export function earliestSuccessfulPaymentMatches(
  body: unknown,
  membershipIdValue: string,
  paymentIdValue: string,
): boolean | null {
  const data = record(body).data;
  if (!Array.isArray(data)) return null;
  const matching = data
    .map(record)
    .filter((payment) => membershipId(payment) === membershipIdValue)
    .filter((payment) => text(payment.status) === "paid")
    .filter((payment) => text(payment.substatus) === "succeeded")
    .filter((payment) => {
      const reason = text(payment.billing_reason);
      return reason !== null && SUBSCRIPTION_BILLING_REASONS.has(reason);
    })
    .sort((a, b) => Date.parse(text(a.paid_at) ?? "") - Date.parse(text(b.paid_at) ?? ""));
  const earliest = text(matching[0]?.id);
  return earliest === null ? null : earliest === paymentIdValue;
}

/** Verify the Standard Webhooks signature over the untouched request body. */
export function verifyWhopWebhook(input: {
  rawBody: string;
  webhookId: string | null;
  webhookTimestamp: string | null;
  webhookSignature: string | null;
  secret: string;
  nowSeconds?: number;
}): boolean {
  const { rawBody, webhookId, webhookTimestamp, webhookSignature, secret } = input;
  if (!webhookId || !webhookTimestamp || !webhookSignature || !secret) return false;
  const timestamp = Number(webhookTimestamp);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > WEBHOOK_TOLERANCE_SECONDS) return false;

  const signed = `${webhookId}.${webhookTimestamp}.${rawBody}`;
  const supplied = webhookSignature.split(" ").flatMap((part) => {
    const [version, signature] = part.split(",", 2);
    return version === "v1" && signature ? [signature] : [];
  });
  const expected = createHmac("sha256", secret).update(signed).digest("base64");
  for (const signature of supplied) {
    const expectedBuffer = Buffer.from(expected);
    const suppliedBuffer = Buffer.from(signature);
    if (expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer)) {
      return true;
    }
  }
  return false;
}

export function analyticsMetadataFromCookies(
  cookieHeader: string | null,
  measurementId: string | undefined,
): JsonRecord {
  if (!cookieHeader || !measurementId) return {};
  const cookies = new Map<string, string>();
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const raw = part.slice(separator + 1).trim();
    try {
      cookies.set(name, decodeURIComponent(raw));
    } catch {
      cookies.set(name, raw);
    }
  }
  const streamCookie = `_ga_${measurementId.replace(/^G-/, "").replace(/[^A-Za-z0-9]/g, "")}`;
  const clientId = cookies.get("_ga");
  const sessionId = cookies.get(streamCookie);
  const metadata: JsonRecord = {};
  if (clientId) metadata.oddsphere_ga_client_id = clientId.slice(0, 128);
  if (sessionId) metadata.oddsphere_ga_session_id = sessionId.slice(0, 256);
  if (clientId || sessionId) metadata.oddsphere_ga_measurement_id = measurementId;
  return metadata;
}

export function stableAnalyticsId(value: string, salt: string): string {
  return createHmac("sha256", salt).update(value).digest("hex");
}

export function fallbackClientId(membershipIdValue: string, salt: string): string {
  const digest = createHash("sha256").update(`${salt}:${membershipIdValue}`).digest();
  return `${digest.readUInt32BE(0)}.${digest.readUInt32BE(4)}`;
}

export function buildGoogleAnalyticsEvent(candidate: ConversionCandidate, salt: string) {
  const measurementId = text(candidate.metadata.oddsphere_ga_measurement_id);
  const configuredMeasurementId = process.env.GOOGLE_ANALYTICS_MEASUREMENT_ID;
  const metadataMatches = measurementId !== null && measurementId === configuredMeasurementId;
  const attributedClientId = metadataMatches ? text(candidate.metadata.oddsphere_ga_client_id) : null;
  const attributedSessionId = metadataMatches ? text(candidate.metadata.oddsphere_ga_session_id) : null;
  const clientId = attributedClientId ?? fallbackClientId(candidate.membershipId, salt);
  const userIdValue = candidate.whopUserId
    ? stableAnalyticsId(candidate.whopUserId, salt)
    : stableAnalyticsId(candidate.membershipId, salt);
  const occurredAtMs = Date.parse(candidate.occurredAt);
  const timestampMicros = Number.isFinite(occurredAtMs) && Date.now() - occurredAtMs <= 72 * 60 * 60 * 1000
    ? Math.trunc(occurredAtMs * 1000)
    : undefined;

  const commonParams: JsonRecord = {
    membership_id_hash: stableAnalyticsId(candidate.membershipId, salt),
    plan_id: candidate.planId,
    product_id: candidate.productId ?? WHOP_PRODUCT_ID,
    engagement_time_msec: 1,
  };
  if (attributedSessionId) commonParams.session_id = attributedSessionId;

  const event = candidate.kind === "trial"
    ? {
        name: TRIAL_CONVERSION_EVENT,
        params: { ...commonParams, trial_days: 7 },
      }
    : {
        name: FIRST_PAID_CONVERSION_EVENT,
        params: {
          ...commonParams,
          transaction_id: candidate.paymentId,
          currency: candidate.currency ?? "USD",
          value: candidate.value,
          customer_type: "new",
          billing_stage: "first_paid_subscription",
          items: [{ item_id: candidate.planId, item_name: "OddSphere subscription", quantity: 1 }],
        },
      };

  return {
    client_id: clientId,
    user_id: userIdValue,
    ...(timestampMicros ? { timestamp_micros: timestampMicros } : {}),
    events: [event],
  };
}
