# EPL completed-status settlement v4

## Production finding

The 2026-08-21 Arsenal home match was present in production as game `46550` with a trusted 3-0
full-time score. Its four EPL prediction records were locked at `2026-08-21T18:07:35.867Z`, but
all four grades remained pending with `unknown game status=completed`.

The EPL score ingester intentionally maps BallDontLie's final state to `completed`. The shared
grader recognized MLB `final`, NBA `STATUS_FINAL`, and NHL `FINAL`/`OFF`, but not the exact EPL
terminal token. The hourly tracking job therefore ingested the result and then failed closed at
the settlement boundary.

## Correction

Settlement contract `tracking_settlement_v4_epl_completed_status_2026_08_22` normalizes final
status tokens and accepts `completed` as terminal in both the authoritative grader and bounded
stale-pending repair discovery. The exact 3-0 Match Result and BTTS No production cases are
covered by regression tests.

The existing sport-scoped `tracking_refresh` job remains the only writer under the shared
`prediction_pipeline` lease. There are no provider-budget, prediction, probability, projection,
side, price, play-grade, stake, lock, or model-release changes. Existing locked rows remain
immutable; the next authoritative settlement pass only updates their grade rows and member
tracking snapshot.

## Expected locked outcomes

- Match Result home: win.
- Double Chance home-or-draw: win (accuracy-tracked No Play).
- Total Over 2.5: win.
- BTTS No: win.

Rollback is settlement contract v3. Rollback would restore the known EPL pending-results defect
and is not recommended.
