# Player-prop reader failure diagnostics — November 8

Base: `dcf3a8747da061102693fdc0e96a5b7086ae805a`.

The scheduled producer currently collapses source-load and pre-claim preparation
errors to an unavailable game ID. This diagnostic-only change adds allowlisted
error categories and `player_props_ai_operations_2026_11_08_r1_safe_failure_codes`
to the existing console summary. Raw exception messages, API bodies, credentials
and player input are never logged. Input-count HTTP status, safe identity/clock
categories, timeout and capacity cases can be distinguished; unknown errors remain
unclassified. No new request or persisted prediction field is introduced.

Prediction inputs, eligibility, numerical law, grades, prices, lock fields,
review claims, wallet, scheduling, sole writer and leases remain exact. Forecast
R15, NFL source decision R6/writer R71/member R55/lifecycle R37, familiar reader
R4, wallet R4 and schedule R3 remain unchanged. Board promotions/demotions: 0/0.
Existing stored locked payloads are untouched.

Focused failure-code security controls and site/capacity/cadence/rendered-reader
checks, lint/TypeScript/production build and clean latest-main protected PR are
required. Observe the next ordinary producer; do not trigger paid model testing.
The diagnostics expose the remaining blocker; they are not proof of full coverage.
