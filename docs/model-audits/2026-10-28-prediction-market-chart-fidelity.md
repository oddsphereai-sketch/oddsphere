# Prediction-market chart fidelity correction

Starting production base: `3e64ed8372d9b70d18254a57479bc1dcbda42040`.
Branch: `codex/prediction-market-chart-fidelity-20261028`.

## Reproduced member defect

The owner reported Minnesota's Circa movement −155 → −160 rendered flat.
SELECT-only inspection of the current stored NBA reader confirms:

- −155 at 2026-10-28 09:12:34 UTC (05:12 Eastern)
- −160 at 2026-10-28 13:12:42 UTC (09:12 Eastern)
- −160 current quote at 2026-10-28 20:45:01 UTC

The old chart discarded every sportsbook observation older than eight hours.
In the afternoon this removed −155 while retaining two −160 points. The flat
line was therefore a display-window defect, not absent source movement.
Spurs–Jazz also lost its real earlier Circa observations through that filter.

## Correction

Keep up to 24 hours of one-book observations, including the actual earliest
anchor, without moving a quote to an invented boundary timestamp. Preserve
the original American odds alongside the implied-price ordinate. Show a compact
same-book first → latest price summary and the number of recorded moves.
Zero price changes are explicitly identified instead of suggesting missing data.

The sportsbook path steps at recorded changes; it is not smoothed into a price
that was never quoted. One shared percent scale has data-dependent padding.
Hover/tap/keyboard inspection exposes both series, each with its own actual
timestamp, and never borrows a later observation. Source timestamps and locked
endpoints remain explicit. Kalshi gaps and actual volume intervals are unchanged.

Restore the latest approved compact mockup's mint `#7de3c1` and violet `#b7a0f4`
series, solid book line, left-hand desktop legend, compact mobile footer and
always-open graph. Keep desktop bottom placement and mobile placement below
sharp splits. No matchup, projected score, odds tracker, splits, stats or internal
market-reader changes. This is a real-code correction, not another mockup.

## Safety boundary

No provider polling, capture writer, schedule, feed schema, model input/output,
projection, probability, grade, stake, calibration, lock or tracking mutation.
The displayed book curve remains labeled moneyline odds-implied context,
including bookmaker margin; it is never relabeled model confidence or a no-vig
probability. Stored/locked reader values are consumed without modification.

Required acceptance: Minnesota exact-price/timestamp regression, immutable-input
and no-book-mixing tests, existing reader/capture tests, TypeScript/ESLint/build,
full safety checks, actual desktop/mobile preview, fresh-main clean integration,
protected PR and exact live deployment/UI verification.

## Prepublication verification

Focused regressions, all 228 existing reader tests, split-capture tests,
TypeScript, focused ESLint, full model-change safety suite and production
webpack build passed. The optional local Market Brain PostgreSQL proof is not
configured; no Market Brain/model code is changed.

The actual built Minnesota reader renders −155 at y=29.477 and −160 at y=16.154
on the shared percent axis (13.3 CSS pixels of visible change). Home/End keyboard
inspection returns −155 / 05:12 and −160 / 16:45 from their real observations;
the earlier book quote correctly has no contemporaneous Kalshi quote.
Both restored colors, the same-book movement summary and compact placement were
checked on desktop and phone. The phone panel fits without horizontal overflow
and stays below sharp splits and before Key Stats. No source values were edited.
