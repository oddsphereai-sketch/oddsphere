import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  FIRST_PAID_CONVERSION_EVENT,
  TRIAL_CONVERSION_EVENT,
  analyticsMetadataFromCookies,
  buildGoogleAnalyticsEvent,
  classifyConfirmedTrial,
  classifySuccessfulPayment,
  earliestSuccessfulPaymentMatches,
  verifyWhopWebhook,
} from "../lib/analytics/membershipConversions";

const monthly = "plan_zR8HdNVFZv5Sr";

const trialPayload = {
  type: "membership.activated",
  created_at: "2026-09-28T12:00:00.000Z",
  data: {
    id: "mem_trial_1",
    user_id: "user_1",
    plan_id: monthly,
    product_id: "prod_grypgrmtPLcQw",
    status: "trialing",
    current_period_start: "2026-09-28T12:00:00.000Z",
    current_period_end: "2026-10-05T12:00:00.000Z",
    metadata: { oddsphere_attribution_id: "2e1d1e38-f856-4d3b-b6ba-5b87ef539df3" },
  },
};

const trial = classifyConfirmedTrial(trialPayload);
assert.ok(trial, "a signed lifecycle payload with a seven-day trial must classify");
assert.equal(trial.kind, "trial");
assert.equal(trial.conversionKey, "trial:mem_trial_1");
assert.equal(classifyConfirmedTrial({ ...trialPayload, type: "checkout.opened" }), null);
assert.equal(classifyConfirmedTrial({ ...trialPayload, type: "page.viewed" }), null);
assert.equal(classifyConfirmedTrial({
  ...trialPayload,
  data: { ...trialPayload.data, status: "active" },
}), null, "paid activation is not a trial");
assert.equal(classifyConfirmedTrial({
  ...trialPayload,
  data: { ...trialPayload.data, current_period_end: "2026-10-04T12:00:00.000Z" },
}), null, "a non-seven-day membership is not the advertised trial");
assert.equal(classifyConfirmedTrial({
  ...trialPayload,
  data: { ...trialPayload.data, plan_id: "plan_other" },
}), null, "another plan cannot become an OddSphere trial conversion");

const paymentPayload = {
  type: "payment.succeeded",
  created_at: "2026-10-05T12:00:00.000Z",
  data: {
    id: "pay_first",
    membership_id: "mem_trial_1",
    user_id: "user_1",
    plan_id: monthly,
    product_id: "prod_grypgrmtPLcQw",
    status: "paid",
    substatus: "succeeded",
    billing_reason: "subscription_cycle",
    total: 19.99,
    currency: "usd",
    paid_at: "2026-10-05T12:00:00.000Z",
    metadata: {},
  },
};
const payment = classifySuccessfulPayment(paymentPayload);
assert.ok(payment, "a successful positive subscription payment must become a candidate");
assert.equal(payment.conversionKey, "paid:mem_trial_1");
assert.equal(classifySuccessfulPayment({
  ...paymentPayload,
  data: { ...paymentPayload.data, total: 0 },
}), null, "the zero-dollar trial authorization is not a paid subscription");
assert.equal(classifySuccessfulPayment({
  ...paymentPayload,
  data: { ...paymentPayload.data, billing_reason: "one_time" },
}), null, "one-time payments are excluded");
const paymentList = { data: [
  { ...paymentPayload.data, id: "pay_first" },
  { ...paymentPayload.data, id: "pay_renewal", paid_at: "2026-11-05T12:00:00.000Z" },
] };
assert.equal(earliestSuccessfulPaymentMatches(paymentList, "mem_trial_1", "pay_first"), true);
assert.equal(earliestSuccessfulPaymentMatches(paymentList, "mem_trial_1", "pay_renewal"), false);
assert.equal(earliestSuccessfulPaymentMatches({ data: [] }, "mem_trial_1", "pay_first"), null);

const rawBody = JSON.stringify(trialPayload);
const secret = "test-secret-that-is-long-enough";
const timestamp = "1790596800";
const webhookId = "msg_1";
const signature = createHmac("sha256", secret)
  .update(`${webhookId}.${timestamp}.${rawBody}`)
  .digest("base64");
assert.equal(verifyWhopWebhook({
  rawBody,
  webhookId,
  webhookTimestamp: timestamp,
  webhookSignature: `v1,${signature}`,
  secret,
  nowSeconds: Number(timestamp),
}), true);
assert.equal(verifyWhopWebhook({
  rawBody: `${rawBody} `,
  webhookId,
  webhookTimestamp: timestamp,
  webhookSignature: `v1,${signature}`,
  secret,
  nowSeconds: Number(timestamp),
}), false, "body tampering must invalidate the signature");
assert.equal(verifyWhopWebhook({
  rawBody,
  webhookId,
  webhookTimestamp: timestamp,
  webhookSignature: `v1,${signature}`,
  secret,
  nowSeconds: Number(timestamp) + 301,
}), false, "stale signed deliveries must be rejected");

const metadata = analyticsMetadataFromCookies(
  "_ga=GA1.1.123.456; _ga_ABC123=GS2.1.s123$o1$g1$t123$j60$l0$h0",
  "G-ABC123",
);
assert.equal(metadata.oddsphere_ga_client_id, "GA1.1.123.456");
assert.match(String(metadata.oddsphere_ga_session_id), /^GS2/);

process.env.GOOGLE_ANALYTICS_MEASUREMENT_ID = "G-ABC123";
const gaTrial = buildGoogleAnalyticsEvent({ ...trial, metadata }, "x".repeat(32));
assert.equal(gaTrial.events[0].name, TRIAL_CONVERSION_EVENT);
assert.equal((gaTrial.events[0].params as Record<string, unknown>).trial_days, 7);
const gaPayment = buildGoogleAnalyticsEvent(payment, "x".repeat(32));
assert.equal(gaPayment.events[0].name, FIRST_PAID_CONVERSION_EVENT);
assert.equal((gaPayment.events[0].params as Record<string, unknown>).transaction_id, "pay_first");
assert.equal((gaPayment.events[0].params as Record<string, unknown>).billing_stage, "first_paid_subscription");

const checkoutSource = readFileSync(resolve("app/api/checkout/whop/route.ts"), "utf8");
assert.doesNotMatch(checkoutSource, /sendMembershipConversion|trial_activation_confirmed|name:\s*["']purchase/);
assert.match(checkoutSource, /oddsphere_attribution_id/);
assert.doesNotMatch(
  checkoutSource.match(/metadata:\s*\{[^}]+\}/)?.[0] ?? "",
  /ga_client_id|ga_session_id/,
  "Whop metadata must receive only the opaque attribution token",
);

const migration = readFileSync(resolve("lib/db/schema-migration-v41-membership-conversions.sql"), "utf8");
const webhookSource = readFileSync(resolve("app/api/webhooks/whop/route.ts"), "utf8");
assert.match(migration, /conversion_key text PRIMARY KEY/);
assert.match(migration, /ON CONFLICT \(conversion_key\)/);
assert.match(migration, /membership_conversion_events\.status = 'failed'/);
assert.match(webhookSource, /deliveryClaim\.status === "sent"/);
assert.match(webhookSource, /conversion_already_processing[^]*status: 503/);

console.log("membership conversion tracking tests passed");
