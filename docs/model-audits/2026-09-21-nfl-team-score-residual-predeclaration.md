# NFL team-score residual forecast predeclaration

Date: 2026-09-21

Status: predeclared before this candidate's confirmation results are inspected

## Hypothesis

The production later-week fallback constructs a game total around the market
and then allocates points through a margin estimate.  The first 2026-09-21
market-residual candidate also modeled game margin and total as separate
targets; its total confirmation failed and its spread gain was unusably small.

This orthogonal candidate predicts each team's scoring residual around its
market-implied team total.  One orientation-symmetric model is shared by home
and away team-rows.  The two predicted team scores are then combined into a
coherent projected margin and projected total.  This directly tests whether
independent team scoring construction adds stable information without fitting
the 2026 Week 2 outcomes.

## Immutable inputs and chronology

- Feature release:
  `nfl_real_pregame_features_2016_2025_2026_08_19_r1`
- Training seasons: 2018-2021.
- Selection seasons: 2022-2023.
- Confirmation seasons: 2024-2025, opened once after this declaration and
  audit implementation are committed.
- Regular season only; source checksums and within-week leakage controls remain
  those of the feature release.
- 2026 Week 2 is diagnosis only and may not be used for fitting or selection.

## Team-row construction

Each game produces one home-team row and one away-team row.  Home/away feature
names are mapped to team/opponent roles, with oriented rest, Elo, margin, and
price probabilities.  The target is final team points minus the implied team
total `(market total + oriented market margin) / 2`.

Allowed inputs are the existing leakage-safe rolling offense, defense, matchup,
quarterback, injury, rest, continuity, venue, roof, weather, week, and market
fields.  Team identity and final-score information are excluded.

The fixed estimators are standardized ridge regression with alpha 100, 300, or
1000 and conservative histogram gradient boosting with minimum leaf size 40
or 80, maximum 15 leaves, learning rate 0.03, 240 iterations, and L2 penalty
20 or 30.

Applied team-score corrections use weights 0.10, 0.20, 0.33, or 0.50 and
symmetric per-team caps of 1.5, 2.5, or 3.5 points.  A recipe is chosen on the
pooled 2022-2023 selection seasons by lowest sum of normalized spread-MAE and
total-MAE ratios relative to market, then lowest worst-market ratio, smaller
weight, smaller cap, and simpler estimator.  It qualifies only if neither
market's pooled MAE is worse than market by more than 0.02 points and at least
one improves by 0.02 points or more.

Spread and total probability scales are selected independently on 2022-2023
from 0.04, 0.08, 0.12, or 0.16 logit units per reconstructed point correction,
using Brier score, then log loss, then smaller scale.  The probability baseline
is the recorded two-sided no-vig price.  Pushes are excluded.

The selected recipe is fit once on 2018-2023 and evaluated on pooled 2024-2025.
The 2024 outcomes are not used to refit the forecast applied to 2025.

## Confirmation gates

Spread and total must each independently satisfy all gates from the preceding
market-context audit:

1. pooled MAE and pooled Brier both improve over market;
2. neither confirmation season is worse on both metrics;
3. correction-direction accuracy is at least 50%, with both directions shown;
4. the fixed two percentage-point action lane has at least 30 resolved plays,
   positive pooled ROI, neither season below -5% ROI, and both bet directions.

In addition, both spread and total must pass together because a shared
team-score recipe cannot be selectively deployed without breaking the declared
score coherence.  A current-board promotion/demotion replay, release bump,
focused tests, `npm run verify:model-change`, integration safety, PR checks,
and post-deploy verification remain mandatory before any launch.  A failed
gate leaves production unchanged.

