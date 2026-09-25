# NFL runtime-parity outcome heads r4 predeclaration

Date: 2026-09-25

Tournament: `nfl_runtime_parity_outcome_heads_2026_09_25_r4`

Status: research/shadow only

## Question

The earlier score regressions minimized point error but did not reliably choose
the correct side of the spread or total. This tournament tests whether the same
runtime-reproducible matchup state can estimate the probability of beating the
market boundary directly, while retaining one coherent projected score.

This is an engine experiment, not a grade threshold or board-balancing rule.
No production prediction, member display, tracking row, writer, cron, copy,
label, layout, or stake may change from this replay.

## Frozen inputs and chronology

- Use only the r2 runtime-parity pregame fields: points, plays, sacks,
  turnovers, red-zone rate, Elo, games of state, rest, injuries, roster and
  coaching continuity, venue, and weather.
- Market margin and total may enter only as explicit calibration anchors and as
  the boundary whose residual is being predicted. Team identity, prices,
  outcomes, EPA, success, explosive rate, pass tendency, and CPOE are excluded.
- Train on 2018-2022, select estimator and shrinkage on 2023, and replay the
  already-open 2024-2025 development period chronologically.
- The 2024-2025 replay is not an untouched promotion holdout. A passing result
  may enter frozen 2026 forward shadow only.

## Frozen candidate family

Separate regularized logistic and histogram-gradient classifiers estimate
home-cover and over probabilities. Candidate probabilities are shrunk toward
0.5 by weights selected on 2023. Probabilities are translated into margin and
total means with chronological residual scales; one home/away score pair is
then reconstructed as `(total +/- margin) / 2`.

The selected recipe minimizes the sum of spread and total Brier score, followed
by direction accuracy, calibration error, and complexity. No result-informed
manual side inversion or minimum-edge filter is allowed.

## Shadow gates

- spread and total direction accuracy are each at least 50%, with both
  directions represented;
- moneyline direction does not regress versus market;
- spread and total Brier do not regress versus no-vig market probability;
- team-score, margin, and total MAE each improve versus market-implied scores;
- exact-price action lanes report count, mix, ROI, and season stability;
- runtime feature semantics can be reproduced inside the sole existing NFL
  writer without per-card provider calls.

Failure of any gate leaves the candidate in research. It cannot be rescued by
changing grades, flattening the board, adding member copy, or rewriting locked
predictions.
