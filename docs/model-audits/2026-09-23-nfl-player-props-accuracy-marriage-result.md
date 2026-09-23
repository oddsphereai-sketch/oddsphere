# NFL Player Props accuracy-marriage result

Date: 2026-09-23
Base: `a1e1b0f6abc69de7f38b84c6832f32533c220d41`
Predeclaration: `docs/model-audits/2026-09-23-nfl-player-props-accuracy-marriage-predeclaration.md`

## Decision

Keep the active production model, calibration, decision, runtime, board, member, and writer
releases unchanged. The active board already uses the intended independent-model/target-excluded
market marriage. None of the bounded challengers cleared the release gates without flattening the
board, and changing the member model would therefore be less accurate or violate the paired-change
requirement.

This is not a side-quota decision. The current Week 3 ranked member forecast contains 239 Overs and
316 Unders across ordinary two-way markets (43.1% Over), rather than the previously reported modal
threshold skew. Grades continue to require an exact evaluated price, a target-book-excluded
same-line comparator, participation and role evidence, freshness, and genuine same-book movement.

## Rebuilt historical evidence

The 2025 exact-opening source was re-collected read-only from the provider: 272 regular-season
games, 125,278 raw rows, 183,182 normalized side rows, 616 resolved players, and 46,771 joined exact
offers. The immutable outcome source contains the original 2016-2025 player history. No production
database row was written or rewritten.

The original chronological residual calibration reproduced the incumbent 0.20 model-residual
weight in all seven volume/yardage markets under its frozen candidate set, and only receptions
qualified against both the raw model and target-excluded market on confirmation. Receptions
confirmation action candidates remained positive: Best Angle returned 80-67 and +8.55% ROI;
Lean returned 91-77 and +4.12% ROI.

A predeclared lower-weight grid found two probability-calibration challengers worth testing:

- passing yards selected market-only on the pre-November selection period and improved confirmation
  Brier from 0.25309 to 0.24984, but the current QB projection already applies a separately tested
  target-excluded market-dominant point head, so changing the generic residual coefficient would not
  be the authoritative production fix;
- receiving yards selected 0.10 and improved confirmation Brier from 0.25156 to 0.25068.

The receiving-yards challenger failed the paired board gate on immutable Week 2. It raised settled
actionable accuracy from 26-25 (51.0%) to 21-18 (53.8%) only by reducing the same board from 90 to
62 actionables, with 28 demotions and zero promotions. It remains shadow-only.

## Rejected challengers

The already-versioned ranked expected-prevalence side was tested as the actionable-side authority.
It reduced immutable Week 2 settled actionable accuracy from 26-25 (51.0%) to 22-23 (48.9%), with
12 demotions and only four promotions. It is rejected for actionability and remains correctly
limited to the member forecast display.

A confidence-floor policy with paired lower-threshold Watchlist promotions improved Week 2 settled
accuracy from 51.0% to 55.0%, but it reduced the same board from 90 to 56 actionables (39 demotions,
five promotions). On the 2025 confirmation cohort it did not improve exact-price ROI. It is rejected.

## Current board and operational proof

The 2026 Week 3 snapshot generated at `2026-09-23T15:36:09.376Z` is coherent with the active member
and board releases. It contains 16 games, 9,940 input offers, 2,420 complete exact offers, 1,545
member decisions, and 22 actionables. It reports zero stale-quote rows and zero unavailable-feature
rows. Opening evidence is present on 1,245 rows. The authoritative writer remains
`nfl-forward-evidence` under `prediction_pipeline:nfl`; provider calls, schedules, locks, stakes,
tracking history, UI copy, labels, and layout are unchanged.

## Forward boundary

Week 3 remains untouched prospective evidence. Future promotion requires a release-separated
settled sample and a paired promotion/demotion replay that preserves exact-price value and board
breadth. No prior locked record is reinterpreted.
