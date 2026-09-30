import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  analyticsAllowed,
  analyticsConsentFromCookieHeader,
  googleAnalyticsCookieNames,
  parseAnalyticsConsent,
  serializeAnalyticsConsent,
} from "../lib/analytics/consent";
import {
  analyticsBrowserTagAllowed,
  browserAnalyticsChoice,
} from "../lib/analytics/consentBrowser";
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
const consentSalt = "consent-test-salt-that-is-at-least-32-characters";
const consentId = "b3d52fea-bbb1-4c79-8e51-a467d23898fd";

assert.equal(
  analyticsAllowed(analyticsConsentFromCookieHeader(null, consentSalt)),
  false,
  "no analytics choice must default to denied",
);
const deniedConsentCookie = serializeAnalyticsConsent({ id: consentId, choice: "denied" }, consentSalt);
assert.equal(
  analyticsAllowed(analyticsConsentFromCookieHeader(
    `oddsphere_analytics_consent=${encodeURIComponent(deniedConsentCookie)}`,
    consentSalt,
  )),
  false,
  "an explicit decline must keep analytics disabled",
);
const grantedConsentCookie = serializeAnalyticsConsent({ id: consentId, choice: "granted" }, consentSalt);
const grantedConsent = analyticsConsentFromCookieHeader(
  `other=value; oddsphere_analytics_consent=${encodeURIComponent(grantedConsentCookie)}`,
  consentSalt,
);
assert.equal(analyticsAllowed(grantedConsent), true, "an authentic accepted choice may enable analytics");
assert.equal(grantedConsent?.id, consentId);
assert.equal(
  parseAnalyticsConsent(`${grantedConsentCookie.slice(0, -1)}x`, consentSalt),
  null,
  "a modified consent cookie must fail closed",
);
assert.deepEqual(googleAnalyticsCookieNames("G-ABC123"), ["_ga", "_ga_ABC123"]);
assert.equal(browserAnalyticsChoice(""), null);
assert.equal(
  analyticsBrowserTagAllowed(null, "G-ABC123"),
  false,
  "no browser choice must not load the Google tag",
);
assert.equal(
  analyticsBrowserTagAllowed(browserAnalyticsChoice("oddsphere_analytics_choice=denied"), "G-ABC123"),
  false,
  "decline must not load the Google tag",
);
assert.equal(
  analyticsBrowserTagAllowed(browserAnalyticsChoice("oddsphere_analytics_choice=granted"), "G-ABC123"),
  true,
  "accept may load the configured Google tag",
);
assert.equal(
  analyticsBrowserTagAllowed(browserAnalyticsChoice("oddsphere_analytics_choice=granted"), null),
  false,
  "accept must remain inert while analytics is unconfigured",
);

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
// Sanitized shape of the real September 30 v1 activation deliveries.
const renewalTrialPayload = {
  type: "membership.activated",
  timestamp: "2026-09-30T20:14:47.262Z",
  data: {
    id: "mem_fixture_v1",
    plan: { id: monthly },
    product: { id: "prod_grypgrmtPLcQw" },
    status: "trialing",
    initial_price_paid: "$0.00",
    renewal_period_start: "2026-09-30T20:14:43.581Z",
    renewal_period_end: "2026-10-07T20:14:43.585Z",
    metadata: {},
    checkout_configuration_id: null,
  },
};
const renewalTrial = classifyConfirmedTrial(renewalTrialPayload);
assert.ok(renewalTrial, "v1 seven-day periods with millisecond jitter must classify");
assert.equal(renewalTrial.occurredAt, renewalTrialPayload.data.renewal_period_start);
assert.equal(renewalTrial.conversionKey, "trial:mem_fixture_v1");
assert.deepEqual(classifyConfirmedTrial(renewalTrialPayload), renewalTrial, "repeat delivery keeps the same deduplication key");
assert.equal(classifyConfirmedTrial({ ...renewalTrialPayload, data: {
  ...renewalTrialPayload.data, renewal_period_end: "2026-10-06T20:14:43.585Z",
}}), null);
assert.equal(classifyConfirmedTrial({ ...renewalTrialPayload, data: {
  ...renewalTrialPayload.data, status: "active",
}}), null);
assert.equal(classifyConfirmedTrial({ ...renewalTrialPayload, data: {
  ...renewalTrialPayload.data, plan: { id: "plan_other" },
}}), null);
assert.equal(classifyConfirmedTrial({ ...renewalTrialPayload, data: {
  ...renewalTrialPayload.data, current_period_start: "2026-09-30T20:14:43.581Z",
}}), null, "partial current-period fields must not borrow a renewal end");
assert.equal(classifyConfirmedTrial({ ...renewalTrialPayload, data: {
  ...renewalTrialPayload.data, renewal_period_start: "invalid",
}}), null);
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
assert.match(checkoutSource, /analyticsAllowed\(consent\)/);
assert.match(checkoutSource, /currentConsent\?\.choice !== "granted"/);
assert.match(checkoutSource, /return fallback\(plan\)/, "analytics refusal must retain direct Whop checkout");

const migration = readFileSync(resolve("lib/db/schema-migration-v41-membership-conversions.sql"), "utf8");
const consentMigration = readFileSync(resolve("lib/db/schema-migration-v42-analytics-consent.sql"), "utf8");
const webhookSource = readFileSync(resolve("app/api/webhooks/whop/route.ts"), "utf8");
assert.ok(webhookSource.includes('"Api-Version-Date": WHOP_API_VERSION'), "first-paid verification must pin the supported Whop API version");
assert.ok(!webhookSource.includes('"whop-version"'), "first-paid verification must not send the ignored version header");
const layoutSource = readFileSync(resolve("app/layout.tsx"), "utf8");
const consentUiSource = readFileSync(resolve("app/components/AnalyticsConsent.tsx"), "utf8");
const consentRouteSource = readFileSync(resolve("app/api/privacy/analytics-consent/route.ts"), "utf8");
assert.match(migration, /conversion_key text PRIMARY KEY/);
assert.match(migration, /ON CONFLICT \(conversion_key\)/);
assert.match(migration, /membership_conversion_events\.status = 'failed'/);
assert.match(webhookSource, /deliveryClaim\.status === "sent"/);
assert.match(webhookSource, /conversion_already_processing[^]*status: 503/);
assert.match(consentMigration, /analytics_consent_choices/);
assert.match(consentMigration, /consent_choice_id uuid/);
assert.match(webhookSource, /consent\?\.choice !== "granted"/);
assert.match(webhookSource, /analytics_consent_not_granted/);
assert.match(layoutSource, /<AnalyticsConsent measurementId=\{validMeasurementId\}/);
assert.match(consentUiSource, /analyticsBrowserTagAllowed\(choice, measurementId\)/);
assert.match(consentUiSource, /ad_storage:'denied'/);
assert.match(consentUiSource, /"Decline"/);
assert.match(consentUiSource, /"Accept"/);
assert.match(consentUiSource, /Declining does not affect membership access,/);
assert.match(consentUiSource, /Current choice:/);
assert.match(consentRouteSource, /analytics_consent_choices/);
assert.match(consentRouteSource, /serializeAnalyticsConsent/);
assert.match(consentRouteSource, /ANALYTICS_CHOICE_COOKIE/);

console.log("membership conversion tracking tests passed");
