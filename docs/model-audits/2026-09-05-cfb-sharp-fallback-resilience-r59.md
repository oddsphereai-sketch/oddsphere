# CFB optional Sharp odds rejection isolation r59

Date: 2026-09-05

## Trigger

The first natural production invocation after CFB confidence release r58 failed before publication:
refresh log `112000`, run `16a6c0ff-081b-42ad-8e7e-f3726633e04f`, returned
`SharpAPI HTTP 400 on /odds`. The request belonged to the optional exact-event named-book recovery
lane. No partial evidence or member board was published.

## Predeclared correction

- Treat HTTP 400 and 404 from this optional recovery lane the same as its already-isolated network
  failure: publish primary-provider named books, leave fallback-dependent markets held, and attach
  `sharpapi_odds_fallback_request_failed` to the evidence and writer health report.
- Keep authentication, authorization, rate-limit, event-identity, pagination, and hard request-cap
  failures fail-closed.
- Do not change the r58 PMF, selected side, probability, projection, confidence policy, quote, EV,
  execution status, T-60 rule, tracking contract, or stake.

The change bumps only the sole writer and collector identifiers. It adds no writer, provider call,
model weighting, market signal, or fallback prediction.

## Acceptance

Focused CFB production tests must prove 400 isolation and structural cap rejection. The full model
change suite, typecheck, build, latest-main integration safety, protected preview, production
deployment, and a leased live writer retry must pass. Live acceptance requires r58 member evidence
to publish with an explicit fallback warning and all immutable prior-release T-60 rows preserved.
