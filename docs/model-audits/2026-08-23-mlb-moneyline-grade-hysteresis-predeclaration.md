# MLB moneyline grade-hysteresis predeclaration

Date: 2026-08-23

Status: predeclared shadow audit; no production grade, probability, side, stake, writer, or reader change.

## Question

The active r67 moneyline decision can stand an unchanged side down when verified SharpAPI money is at least ten percentage points below tickets, and it can stand a candidate down for adverse same-book movement. The audit will determine whether those binary boundaries remove useful plays and whether a bounded Lean-only continuity rule is chronologically defensible. It will also test the 60% floor on the existing strong-winner exception.

## Frozen inputs and unit of analysis

- One unique locked MLB moneyline tuple per game, using the exact selected side, evaluated sportsbook price, model probability, line-movement state, SharpAPI money/ticket pair, projection agreement, release identifiers, and lock timestamp stored with that tuple.
- Outcomes and one-unit returns use only the locked evaluated price. Later quotes are context only.
- Rows are reported separately by probability-head and decision-release identifier. No blended release result will be called current-model performance.
- Duplicate game-lock tuples, unlocked rows, missing outcomes, and rows without the inputs required by a candidate are excluded explicitly and counted.

## Frozen chronology

- Development: locked dates 2026-08-10 through 2026-08-14.
- Validation: locked dates 2026-08-15 through 2026-08-19.
- Holdout: locked dates 2026-08-20 through 2026-08-22. August 23 is current-board impact only because its outcomes are not known at predeclaration time.
- Threshold selection may use development only. Validation and holdout remain confirmation slices and will be printed separately.

## Frozen candidates

The active r67 decision is the baseline. Every alternative is capped at Lean and can never create or restore a Best Angle.

1. Signed-resistance cliff sensitivity: replace the active `money - tickets <= -10` action cliff with `-15`, `-20`, `-25`, or `-30`, leaving every other guard unchanged.
2. Strong-winner floor sensitivity: test the active 60% model-probability floor at 58%, 57%, and 55%, leaving the active price band, projection agreement, market direction, and other data guards unchanged.
3. Adverse-movement tolerance: where adverse movement is the only stand-down reason, test maximum adverse magnitudes of 0.5, 1.0, 1.5, and 2.0 probability points. The exact-price EV must be non-negative, the projected-score side must agree, and no public/signed/data hold may remain.
4. Combined graded resistance Lean: require model probability at least 58%, signed money-minus-tickets greater than -15, non-negative exact-price EV, projected-score agreement, no public conflict or data hold, price from -300 through +200, and movement that is neutral/supportive or adverse by at most 1.0 probability point.
5. Continuity/hysteresis version of candidate 4: add the requirement that the immediately preceding same-day immutable grade-history state was actionable on the same side. A retained play is downgraded to Lean; it is never retained as Best Angle.

The audit will report each component separately and the combined rule so a result cannot be attributed to a hidden conjunction.

## Gates

A production rule must:

- be positive in one-unit return in validation and holdout separately;
- remain positive after removing its largest win in both confirmation slices;
- avoid a material calibration regression versus the published probability (absolute observed-minus-expected gap may not worsen by more than five percentage points);
- have at least five settled actions in each confirmation slice and at least fifteen pooled confirmation actions;
- disclose paired baseline-to-candidate promotions and demotions plus current-board impact;
- preserve the selected side, probability head, evaluated exact-price tuple, T-60 lock immutability, and single authoritative writer.

If no candidate passes, all grade-policy alternatives remain shadow. A serialization or market-scope data defect may be fixed independently only with focused regression tests and zero unexplained decision change.
