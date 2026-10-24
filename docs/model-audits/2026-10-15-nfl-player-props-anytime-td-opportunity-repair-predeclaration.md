# NFL player props Anytime TD opportunity repair predeclaration

Date: 2026-10-15
Status: frozen before running the candidate

## Objective

Test whether TD-specific opportunity and matchup history improves the fixed market-independent
team-budget/allocation ensemble. The candidate must not use sportsbook price, implied probability,
spread, total, line movement, or the opened Week 5 outcomes as a feature or fitting target.

## Frozen candidate

Keep the existing 50/50 direct-share/scorer-hurdle ensemble, algorithms, hyperparameters,
training windows, Platt procedure, and independent team-touchdown budget. Add exactly these eight
pregame lagged features already derived from checksum-pinned play-by-play:

- player `prior_anytime_td_avg5` and `prior_anytime_td_ewm`;
- player `prior_redzone_opportunity_avg5` and `prior_redzone_opportunity_ewm`;
- player `prior_goal_line_opportunity_avg5` and `prior_goal_line_opportunity_ewm`;
- team `prior_team_td_avg5`;
- matchup `prior_opponent_td_allowed_avg5`.

The player opportunity counts combine rushing attempts and pass targets inside the opponent 20
and inside the opponent 10/goal-to-go. All values are shifted before the predicted game. No
candidate set, feature set, or weight may be changed after results are opened.

## Chronology and gates

1. Fit through 2023 and select on 2024 against the fixed independent ensemble.
2. Freeze the candidate and confirm by fitting through 2024 and evaluating 2025.
3. Require lower Brier and log loss and no lower AUC in both seasons.
4. Require the 2025 game-clustered 95% Brier-delta interval to be below zero and every frozen
   chronological segment to be non-worse.
5. Only after those gates, report the immutable 45-row Week 5 board as an external check. Require
   lower Brier and log loss, no lower AUC, and no worse decile calibration error to call it a
   release candidate.
6. Report exact locked-price positive-EV and top-rank economics separately. They cannot select or
   refit the independent predictor. A probability winner that still fails economics remains
   research-only and cannot enable actionability.

Any failure retains the existing production release unchanged. No locked payload may be rewritten
or reinterpreted.
