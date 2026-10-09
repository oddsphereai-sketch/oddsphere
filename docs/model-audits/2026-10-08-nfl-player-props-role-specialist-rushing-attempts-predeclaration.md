# NFL Player Props role-specialist Rushing Attempts predeclaration

Date: 2026-10-08  
Status: predeclared before candidate scoring  
Scope: Rushing Attempts only

## Hypothesis

The active settlement-aligned model materially improved the general participating-player target,
but the exact 2025 sportsbook-offered cohort still has a negative point bias. A single pooled
Poisson HGB may be averaging distinct carry-generation processes: designed/scramble QB attempts and
RB/FB backfield allocation. Position-specialist heads and active-role weighting may improve the
independent point center without observing a prop line or price.

## Frozen chronology and target

- Historical source: checksum-pinned official 2016-2025 player-game feature parquet.
- Target population: prior-role-eligible QB/RB/FB rows with official participation. Participation is
  an outcome filter only and is never a pregame feature.
- Fit through 2022, select on 2023, refit through 2023 and confirm on 2024, refit through 2024 and
  open 2025 once as holdout.
- The active 25% released / 75% settlement-aligned head is the incumbent.
- Prop lines, sportsbook prices, consensus probabilities, and price movement are forbidden from
  training and point-model selection.

## Candidate architecture

Using the same leakage-safe prior player role, share, snap, team opportunity, opponent allowance,
matchup efficiency, venue, roof, weather, home, and week features as the active head, test:

1. Separate Poisson HGB heads for QB and RB/FB.
2. A pooled Poisson HGB with training weights increasing smoothly with prior five-game carries.
3. Separate QB and RB/FB heads with the same active-role weights.

Each architecture is tested at fixed 25%, 50%, 75%, and 100% blends with the active point head.
No post-holdout weight change is allowed.

## Gates

- Select on 2023 only among candidates improving both MAE and RMSE for the complete target and the
  active-role cohort (`prior_rushing_attempts_avg5 >= 4`).
- The identical candidate must improve both MAE and RMSE for both cohorts on 2024 confirmation.
- On 2025 holdout, require lower overall and active-role MAE/RMSE, game-clustered overall MAE upper
  interval below zero, no worse absolute bias beyond 0.25% of the outcome mean, no worse
  underprediction rate beyond 0.25 percentage point, and no worse MAE in any chronological quartile.
- Refit the matching empirical residual distribution only from 2023-2024 out-of-sample residuals;
  require lower 2025 CRPS, NLL within 0.5%, and valid 80%/90% coverage.
- If point/distribution gates pass, rerun the already-predeclared price-blind probability calibration
  and independent-first posterior test without changing its fit/selection/confirmation dates or
  acceptance thresholds.
- Production remains unchanged unless the exact Week 4 board replay also passes promotion/demotion,
  nonpositive-EV, settled-unit, immutable-lock, and release-safety gates.
