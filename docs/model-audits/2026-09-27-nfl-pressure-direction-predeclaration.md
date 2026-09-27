# NFL pressure-direction margin predeclaration

Date: 2026-09-27

Candidate: `nfl_pressure_direction_margin_2026_09_27_r1`

Scope: NFL regular-season Daily Edge score, Moneyline, and Spread forecasts;
the existing sole NFL evidence writer and `prediction_pipeline:nfl` lease only.

## Problem and objective

The released weekly score path includes prior-week possession and efficiency,
but its home-margin center is still 90% target-excluded market and has no
independently trained direction residual. The owner directed Oddsphere to make
the score projection itself more predictive while preserving the established
market-reading marriage, one coherent displayed score, immutable locks, and the
member product's existing presentation.

The objective is lower chronological margin error and better against-market
direction without a side quota, threshold-only grade repair, hidden board
flattening, stake change, or user-facing copy/label/layout change.

## Frozen candidate

1. Fit an L2 logistic direction head using only pregame opponent-adjusted sack
   and turnover matchup states. Training for each evaluated season ends before
   that season; 2022-2023 is selection and untouched 2024-2025 is confirmation.
2. Carry end-2025 team states into 2026 at the released 0.65 offseason weight,
   then update them only from completed prior weeks with the released fast and
   slow exponential rates. No current game result can enter its forecast.
3. Translate the calibrated home-cover probability into a signed margin
   residual at 0.5 scale, capped at three points, and add it to the existing
   10% independent / 90% target-excluded-market margin center.
4. Keep the existing Total center and Total market-reading behavior unchanged.
   The researched quarterback Total residual remains shadow-only until exact
   current-slate runtime input parity is independently proven.
5. Continue the existing downstream coherent distribution, target exclusion,
   opening/current line and price reading, split evidence, exact-price decision,
   representative-score, lock, and tracking paths.

The runtime artifact is immutable, trained through 2025, and read locally. The
candidate adds no provider call, database read, writer, cron, lease, member
request, or per-card computation path.

## Release gates

The fixed candidate must improve selection and confirmation margin MAE versus
the market center, exceed 50% against-market direction in each pooled period,
avoid winner-accuracy regression, produce corrections in both directions, and
have zero score/prediction coherence contradictions. The exact current-board
replay must preserve every lock, retain all 48 market forecasts, report
promotions and demotions, and avoid an actionable-board collapse.

Every affected model, calibration, decision, grade, member, collector, writer,
fixture, snapshot, and tracking identifier advances together. Publication also
requires the focused NFL suite, TypeScript, `npm run verify:model-change`, the
production build, current-main integration safety, protected PR checks, and
live proof of the exact release family, sole lease, board coverage, freshness,
and tracking coherence.
