# NFL weekly representative-score dispersion predeclaration

Date: 2026-09-25

Status: frozen before execution.

## Problem boundary

The weekly NFL pipeline preserves coherent discrete margin and total
distributions, but its displayed representative score is currently the
winner-consistent integer pair nearest the two distribution means. That point
functional can display many one- or two-point margins even when the underlying
distribution assigns more mass to other football score shapes.

This tournament changes only the displayed representative-score point
functional. It does not change the margin or total distributions, win/cover/
total probabilities, prediction sides, grades, prices, stakes, promotions,
demotions, tracking tuples, or board count.

## Frozen data and chronology

- Distribution shapes: the production Week 1 discrete-drive artifact pooled
  margin and total distributions.
- Historical anchors and results: the frozen
  `nfl_pregame_features_2016_2025_r3` artifact.
- Selection: 2023 only.
- Untouched confirmation: 2024 and 2025, opened only after selection freezes.
- Regular-season rows with finite market margin, market total, and final scores
  are eligible. No 2026 outcome enters selection.

For this point-functional isolation, each historical forecast shifts the pooled
production margin and total distributions to the pregame market anchors. This
does not claim to replay every current split, price, or independent-model
adjustment; it holds the distribution center fixed so only score selection is
compared.

## Frozen candidates

The incumbent is the winner-consistent integer score pair nearest the expected
away and home scores, with the production loop's deterministic tie break.

Candidates enumerate every non-tied, nonnegative, parity-valid integer pair
whose margin and total both have positive probability in the shifted marginal
distributions and whose winner agrees with the distribution's non-tie win
probability. They minimize:

`-log(P(margin) * P(total)) + w * (margin-center distance + total-center distance)`

for frozen center weights `0.00, 0.05, 0.10, 0.20, 0.40, 0.80, 1.20`.

## Frozen metrics and selection

Report combined team-score MAE, margin MAE, total MAE, exact-score rate, winner
accuracy, mean weekly duplicate-pair rate, mean margin/total center distance,
and predicted versus actual rates for absolute margins at most one, two, and
three points.

A candidate is eligible on 2023 only if:

1. winner accuracy is no worse than the incumbent;
2. team-score MAE is no more than `0.05` points worse;
3. margin MAE and total MAE are each no more than `0.10` points worse;
4. its absolute-margin-at-most-two rate is closer to the observed rate than
   the incumbent's rate; and
5. every selected score is marginally supported, parity-valid, nonnegative,
   non-tied, and winner-consistent.

Eligible candidates rank by team-score MAE, then combined margin/total MAE,
then closeness of the two-point-margin rate to observed, then lower center
distance, then smaller weight.

After selection freezes, each confirmation season must retain structural
validity and winner accuracy no worse than incumbent. Team-score MAE may not
worsen by more than `0.15`, and neither margin nor total MAE may worsen by more
than `0.20`. The pooled 2024-2025 two-point-margin rate must be closer to the
observed rate than incumbent.

Failure leaves production unchanged. Passing qualifies only the displayed
point functional for a versioned live-board replay and the repository's full
model-change safety checks.
