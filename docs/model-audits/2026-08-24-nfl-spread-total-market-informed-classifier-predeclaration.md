# NFL Spread/Total Market-Informed Residual Classifier — Predeclaration

## Why this family is materially different

The qualified r10 joint PMF produces coherent football-shaped forecasts, but its raw
high-conviction Spread and Total probabilities were overconfident in 2024–25. This
candidate does not loosen those losing rules. It fits a separate pregame outcome head
whose job is to learn when an r10/market disagreement is trustworthy.

The target sportsbook's probability and price are excluded from the prediction head.
They enter only after the forecast to evaluate the exact offered quote. The head may use
the target-excluded same-line consensus, r10 conditional probability and scoring cushion,
line magnitude, side, week, and frozen key-number/total-zone flags. It may not use the
result, closing line, final availability, target fair probability, or target price.

## Frozen chronology

- 2021 fits candidate heads.
- 2022 selects the head on grouped, game-balanced Brier score then log loss; it also
  reports calibration, target-excluded market correlation, and winner disagreements.
- The selected family is refit on 2021–22.
- 2023 selects the exact-price grade policy.
- 2024 and 2025 confirm it without refitting or threshold changes.

Offer rows receive inverse per-game/market frequency weights so books do not turn one
game outcome into many independent training examples. Evaluation and grade selection
retain only the best eligible exact quote per game and market.

## Candidate heads

All heads use standardized continuous inputs and deterministic random state:

- regularized logistic models with C = 0.03, 0.1, 0.3, or 1;
- histogram gradient boosting with depth 2 or 3, learning rate 0.03 or 0.05, and L2
  regularization 1 or 5.

The head-selection gate requires finite probabilities, both classes in training/evaluation,
and no worse than 0.005 Brier or 0.01 log loss versus target-excluded same-line consensus
on 2022. This allows a risk-aware market-informed candidate without claiming independence.

## Grade policy and confirmation

The 2023 grid tests model probability 52.5%–65%, exact-price EV 0%–3%, model edge over
target-excluded fair probability 0–4 percentage points, and scoring cushion 0–2 points.
Every row still requires r10 direction agreement, at least two comparison books, a quote
before kickoff, price -200 through +200, and the frozen key/zone cushion penalty.

Selection requires at least 12 bets/six weeks, positive units, at least -0.5 units after
removing the largest win, calibration gap at most 12 points, and two books.

Provisional Lean confirmation requires at least 24 bets/eight each season, positive pooled
and largest-win-independent units, neither season below -10% ROI with one positive season,
pooled calibration gap at most 10 points and each season at most 15, weekly-cluster
bootstrap probability-positive at least 60%, and two books. The interval may cross zero
and stakes cannot increase. Best Angle adds positive units and largest-win-independent
units in both seasons, at least 4% pooled ROI, probability-positive at least 75%, and no
more than 10-point calibration gap in either season.

Watchlist is non-actionable and captures coherent rows within two percentage points of the
selected EV/edge boundary. No Play remains the evaluated fallback. Held remains reserved
for genuine quote, identity, health, or availability failure. No tier has a quota.
