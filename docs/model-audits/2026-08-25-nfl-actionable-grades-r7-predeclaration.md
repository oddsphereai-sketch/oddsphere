# NFL actionable grading completion r7 predeclaration

Date: 2026-08-25

## Why r7 is materially different

The frozen r6 pass qualified the moneyline Best Angle tier, reproduced the passing Spread
probability head, and rejected its first Spread exact-price selector. Its Total score-component
head selected on 2023 but the beta calibrator learned a league-wide 2023 Under intercept; that
intercept failed in both later seasons. Those negative results are preserved.

This r7 pass changes architecture and grade semantics rather than searching another residual
threshold grid:

1. Spread uses the already-qualified beta-calibrated probability head and one architecture-led,
   outcome-independent exact-price boundary: selected-side probability at least 51%, nonnegative
   exact-price EV, nonnegative edge versus the target-excluded same-line consensus, and nonnegative
   scoring cushion after key-number adjustment.
2. Total uses an expanding seasonal direct score-component refit. Before each target season, fit
   on all prior 2021-forward seasons. Estimate the residual law only from the immediately prior
   season using a model fit before that season. Do not carry a learned directional calibration
   intercept across seasons. This adapts football parameters while remaining strictly pregame and
   walk-forward.
3. The Total exact-price boundary is frozen at selected-side probability at least 53.5%, EV at
   least 2%, edge at least 1pp, and scoring cushion at least one point plus the extreme-total-zone
   adjustment. It was identified on the 2023 selection season; 2024–25 are repeated confirmation.

Both lanes remain uncapped and retain at least two other same-line books, a target-book-excluded
fair probability, bounded `-200..+200` prices, exact evaluated line/price/time, and all existing
health/T-60 holds. No quota or weekly minimum exists.

## Grade evidence contract

`Lean` is an evidence-backed actionable tier, not a claim that a 95% return interval excludes
zero. A Spread or Total lane qualifies with:

- at least eight actions in each 2024 and 2025 season;
- positive pooled units, positive units in each season, and positive pooled units after removing
  the largest win;
- pooled and per-season calibration gaps no larger than 10pp and 15pp respectively;
- nonnegative pooled mean CLV and at least two sportsbooks; and
- weekly-cluster bootstrap probability and interval reported as uncertainty diagnostics.

`Best Angle` retains the stronger r6 moneyline contract: positive confirmation seasons and
largest-win independence in each, pooled ROI above 2%, nonnegative mean CLV and at least 40% CLV+
frequency, season calibration gaps at most 10pp, and week-cluster probability of positive units at
least 80%. Spread and Total may remain Lean without a Best Angle subgroup. This is intentional tier
separation, not a forced top play in every market or week.

## Confirmation status and forward boundary

The r6 diagnostics necessarily exposed 2024–25 again. r7 therefore labels them repeated
confirmation and makes no pristine-holdout claim. Immutable 2026 opening/unlocked/T-60/settlement
evidence is the true forward check. Any public candidate must preserve the exact decision tuple,
the single leased writer, no tracking before the approved regular-season boundary, and rollback to
the current r5 member release.
