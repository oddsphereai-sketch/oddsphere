# MLB Player Props Market-Specific Recalibration — 2026-07-30

## Decision

The market-specific calibration tournament was completed using only existing locked
predictions, prices, and outcomes. No additional provider or paid data was used.

The probability layer successfully reduced overconfidence, but it did not produce a
held-out actionable portfolio. Therefore no runtime coefficients, grades, stakes, or release
identifiers were changed.

## Method

The audit used 21,002 settled, display-enabled T60 tracking rows from 2026-07-16 through
2026-07-29.

For each market, the candidate probability had the form:

```text
logit(calibrated) =
  logit(no-vig market)
  + intercept
  + model_delta_weight * (logit(raw model) - logit(no-vig market))
  + side_bias
```

The tournament compared fixed market/model weights and L2-regularized coefficient fits.

- Discovery: through 2026-07-21
- Validation/model selection: 2026-07-22 through 2026-07-25
- Final holdout: 2026-07-26 through 2026-07-29
- Selection objective: Brier score, then log loss
- Qualification: beat the no-vig market on both Brier score and log loss in holdout
- Release handling: results remain attributable by stored overall release and per-market
  model version

## Probability result

Across the 6,597-row final holdout:

| Probability source | Brier | Log loss | Calibration gap |
| --- | ---: | ---: | ---: |
| Current final probability | 0.230849 | 0.653429 | +1.949 pp |
| No-vig market | 0.227378 | 0.645902 | -0.608 pp |
| Qualified challenger | 0.227352 | 0.645817 | -0.430 pp |

The challenger is better calibrated than the current model, but only microscopically better
than the market.

Only two markets beat the market baseline on both held-out probability scores:

1. Batter hits: retain 10% of the model's log-odds movement away from the market.
2. Batter doubles: a fitted side adjustment qualified numerically, but its negative
   model-delta coefficient and short model eras make it unsuitable for direct runtime use.

Every other sufficiently covered market either preferred the market outright or failed to
beat it in holdout. Pitcher outs and stolen bases lacked enough chronological coverage.

## Actionable result

At the existing generic action gate of:

- probability >= 56%;
- calibrated edge >= 2%;
- expected value >= 1%;

the honest market-anchored challenger produced zero held-out bets.

A lower gate was selected using only the validation period:

- probability >= 50%;
- calibrated edge >= 0.5%;
- expected value >= 0.25%;
- at most one candidate per player/game.

It returned +6.69% ROI in validation, then failed decisively in the untouched final holdout:

- 619 bets;
- 328-291;
- -85.20 units;
- -13.76% ROI;
- predicted 63.89% versus 52.99% observed.

The failed gate would have increased the historical holdout board by 80 bets, so it was not
a hidden board-flattening rejection.

## Interpretation

The recalibration question is now answered:

- The current player-prop probabilities are overconfident.
- For most markets, the no-vig sportsbook probability is a better forecast.
- A market-specific calibration layer can improve probability accuracy using existing data.
- Calibration cannot manufacture actionable value when the raw model contributes little or
  unstable lift beyond the market.

Deploying the fitted coefficients would either collapse the actionable board or require a
lower action threshold that lost heavily in holdout. Both outcomes fail
`docs/model-change-safety.md`.

## Reproduction

Run:

```bash
npx tsx --env-file=.env.local ops-local/player-props-market-specific-calibration-tournament.ts
```

The script is read-only and writes its detailed JSON report to:

```text
/private/tmp/market-specific-calibration-tournament.json
```
