# Whop → Google Analytics membership conversions

## Audited starting state

- The production site had no Google tag, `gtag`, Google Tag Manager container,
  or conversion events.
- The Whop account had no registered webhooks.
- OddSphere's existing Whop integration covered OAuth and access checks only.
- The monthly Whop plan is a seven-day trial followed by a $19.99 recurring
  charge. The annual plan charges $199 immediately and has no trial.

## Event contract

| GA4 event | Emission boundary | Deduplication |
| --- | --- | --- |
| `trial_activation_confirmed` | A valid signed `membership.activated` webhook for the OddSphere monthly plan, status `trialing`, whose stored period is seven days | One ledger key per membership: `trial:<membership_id>` |
| `purchase` | A valid signed `payment.succeeded` webhook with a positive subscription charge, after Whop's payments API confirms that payment is the membership's earliest successful payment | One ledger key per membership plus GA's `transaction_id=<payment_id>` purchase deduplication |

A page view, pricing-page visit, CTA click, checkout redirect, checkout open,
zero-dollar trial authorization, renewal, one-time payment, or merely active
membership cannot satisfy these event contracts.

Checkout creates a random attribution UUID. Only that opaque UUID is copied
into Whop metadata. GA browser/session identifiers remain in the private
`checkout_attributions` table and are joined only after a verified webhook.

## Consent boundary

- No choice and **Decline** both mean no Google browser tag, no checkout
  attribution, and no Whop-to-GA4 trial or purchase event.
- **Accept** is stored in a signed, HTTP-only first-party cookie and a private
  `analytics_consent_choices` row. The checkout relay works only when both
  records currently say `granted`.
- A webhook re-checks the current database choice before claiming or sending a
  conversion. Withdrawing consent therefore suppresses later trial or payment
  delivery even when the Whop membership still carries an older attribution
  token.
- Consent never gates the direct Whop checkout fallback, membership access,
  billing, or authentication.

## Production setup (after merge)

1. Apply `lib/db/schema-migration-v41-membership-conversions.sql`, followed by
   `lib/db/schema-migration-v42-analytics-consent.sql`.
2. Set `GOOGLE_ANALYTICS_MEASUREMENT_ID`, a Measurement Protocol
   `GOOGLE_ANALYTICS_API_SECRET`, `WHOP_WEBHOOK_SECRET`, `WHOP_ACCOUNT_ID`, and
   a 32+ character `CONVERSION_TRACKING_SALT` in production.
3. In Whop, register
   `https://www.oddsphereai.com/api/webhooks/whop` for
   `membership.activated` and `payment.succeeded` and copy its signing secret
   into `WHOP_WEBHOOK_SECRET`.
4. Verify the no-choice and declined states load no Google script and return a
   direct Whop checkout without creating an attribution. Verify the accepted
   state loads the tag and creates a consent-bound attribution, then withdraw
   consent and confirm the webhook is acknowledged without a GA delivery.
5. Complete a controlled seven-day-trial activation and verify exactly one
   `trial_activation_confirmed` row is `sent`. Replay the same webhook and
   verify it is reported as a duplicate without a second GA event.
6. Use a controlled first paid charge and verify one GA `purchase` with the
   Whop payment id as `transaction_id`; verify a renewal is ignored.

Do not configure or launch an ad campaign as part of this setup.

## Google Ads conversion choice

Import the GA4 key event named **`trial_activation_confirmed`** into Google Ads
and make that exact action primary when the bidding goal is qualified trial
activation. Keep `purchase` as a separate secondary/observation conversion
until paid conversion volume and value-based bidding justify changing the
campaign goal. Do not use `page_view`, pricing views, or checkout clicks as the
trial conversion.

References: [Whop webhook guide](https://docs.whop.com/developer/guides/webhooks),
[GA4 Measurement Protocol](https://developers.google.com/analytics/devguides/collection/protocol/ga4),
[GA4 purchase deduplication](https://support.google.com/analytics/answer/12313109).
