# NFL market-error memory forecast predeclaration

Date: 2026-09-21

Status: frozen after development/selection inspection and before confirmation
results are opened

## Objective

Improve the side accuracy of every NFL full-game Spread and Total prediction
without suppressing games, changing Moneyline, imposing a side quota, or using
grades to hide incorrect forecasts. Every eligible game continues to receive a
Spread and Total prediction. Actionability remains a separate exact-price
decision.

The candidate addresses a missing input in the existing market-anchored
forecast: whether the market has recently and repeatedly over- or under-rated a
team's offense, defense, cover margin, or scoring environment. These states are
computed only from games completed before the predicted week.

## Immutable input and chronology

- Feature release:
  `nfl_real_pregame_features_2016_2025_2026_08_19_r1`.
- Source artifact and checksum are verified from its manifest at runtime.
- State/training seasons: 2016-2021.
- Development/selection seasons: 2022-2023.
- Reuse-aware confirmation seasons: 2024-2025.
- Regular season only.
- All games in one NFL week are snapshotted before that week's results update
  team state, so same-week results cannot leak.
- Historical nflverse prices are terminal market observations, not represented
  as equivalent to OddSphere's live T-60 quote.

The 2024-2025 period has been used by earlier, different candidate families.
It is therefore called reuse-aware confirmation rather than untouched data.
This candidate's architecture and constants are nevertheless frozen before its
2024-2025 results are read, and the launch gates require both seasons to pass
independently. Locked 2026 predictions remain the genuine forward evidence.

## Frozen team state

For each team, maintain exponentially weighted pre-week states with half-lives
of 2, 4, 8, and 16 games for:

- points scored minus market-implied team points;
- points allowed minus market-implied opponent points;
- team-oriented margin residual against the spread;
- final game total minus the posted total.

For each matchup, reconstruct home-score, away-score, margin, total, cover, and
game-total residual signals from those states. Include only the frozen core
pregame fields: market margin and total, week, neutral site, rest difference,
temperature, wind, indoor roof, Elo difference, home/away QB EPA and CPOE,
home/away QB injury weight, and home/away roster continuity.

## Frozen probability and score recipe

Spread and Total are trained independently after excluding pushes:

- median imputation with missingness indicators;
- standard scaling;
- L2 logistic regression with `C=0.01`, maximum 500 iterations;
- probability = 75% market no-vig logit + 25% model logit.

These constants were selected on 2022-2023. The frozen selection results were:

- Spread: 52.60% pooled accuracy; 50.96% in 2022 and 54.26% in 2023.
- Total: 52.04% pooled accuracy; 51.49% in 2022 and 52.59% in 2023.

Both prediction directions were present in both markets. Exact-price action
thresholds selected on the same development window are one percentage point of
edge for Spread and two percentage points for Total.

For coherent projected scores, convert each candidate probability into an
expected market residual with a normal residual law whose scale is estimated
only from the training seasons. Cap margin and total corrections at four
points, then solve:

- projected home = (corrected total + corrected home margin) / 2;
- projected away = (corrected total - corrected home margin) / 2.

The displayed Spread side, Total side, and projected score identity must agree.

## Frozen confirmation gates

Spread and Total qualify independently only if all conditions hold on the
fixed 2024-2025 confirmation predictions made by a model fit through 2023:

1. Full-board resolved accuracy is above 50% pooled and at least 50% in each
   confirmation season.
2. Candidate Brier score improves on the two-sided no-vig market baseline
   pooled, and neither season is worse by more than 0.0025.
3. Both opposing forecast directions occur in each season; a one-sided board
   is ineligible.
4. The candidate's mean absolute point error is no worse than the market by
   more than 0.10 points pooled.
5. The frozen exact-price lane has at least 30 resolved actions, positive pooled
   units, neither season below -5% ROI, and both opposing directions.
6. A live-board replay proves every game remains predicted, score identity is
   coherent, and at least one promotion and one demotion/neutral hold are
   tested. No quota or flat-board rule may satisfy this gate.
7. Production can use the existing authoritative NFL writer and shared
   sport-scoped `prediction_pipeline` lease.

Passing historical gates is not deployment authorization. A release bump,
registry update, focused tests, `npm run verify:model-change`, clean fresh-base
integration verification, pull request, required green checks, and post-deploy
verification remain mandatory. A failed market remains unchanged in
production while orthogonal research continues.
