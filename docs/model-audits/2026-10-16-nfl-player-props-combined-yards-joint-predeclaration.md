# NFL player props Rushing + Receiving Yards component/joint tournament predeclaration

Date: 2026-10-16

Production changes authorized: none

## Failure being addressed

The prior direct log-target HGB reduced 2026 Weeks 2-5 MAE and threshold Brier but projected 27.00 yards against a 40.14-yard realized mean and worsened RMSE from 32.50 to 33.94. It compressed the upper tail and failed its gate.

## Frozen candidate set

Use the same market-free, pregame eligible-player frame and feature family as the prior tournament. Compare:

1. `component_hgb_raw`: separate raw-yard HGB models for rushing and receiving;
2. `component_hgb_log_smear`: separate log-yard HGB models with training-only Duan smearing by component; and
3. `opportunity_efficiency_hgb`: separate HGB opportunity models for carries and targets, plus conditional HGB efficiency models for yards per carry and yards per target, with component projections formed by multiplication.

The independent foundation remains the sum of pregame rushing- and receiving-yard rolling means. No line, price, market consensus, or post-lock information may enter a point model.

For probability evaluation, retain paired rushing and receiving residuals from the selection period rather than treating the components as independent. Use position-specific empirical paired-residual pools, falling back to the all-position pool when necessary. This preserves observed cross-component covariance and asymmetric tails.

## Evaluation

- Fit candidates on 2017-2024.
- Select one candidate on 2025 by lowest MAE, then RMSE, then average fixed-threshold Brier.
- Refit the selected architecture through 2025.
- Report the already-inspected 2026 Weeks 2-5 replay as a repeated current-season diagnostic, not an untouched holdout.
- Report paired game bootstrap intervals for MAE, RMSE, and average Brier deltas.
- Fixed thresholds: 39.5, 49.5, 59.5, 69.5, and 79.5 yards.

## Frozen advancement gate

The selected candidate must, on the 2026 Weeks 2-5 diagnostic:

1. improve MAE;
2. improve RMSE;
3. improve average threshold Brier;
4. win at least four of five threshold Brier scores;
5. keep absolute mean projection bias below 5 yards; and
6. have the paired game-bootstrap 95% interval for RMSE delta exclude zero in the improving direction.

Even a passing candidate remains research-only until exact release-pure offers/prices and prospective outcomes support calibration, economic, promotion/demotion, and board-count gates.
