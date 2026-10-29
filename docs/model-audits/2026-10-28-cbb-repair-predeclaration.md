# Private CBB neutral-symmetry and uncertainty repair

Owner authorized repairing the loss-audit weak points. No activation, production writer,
locked-record changes, grades/stakes, or member surface changes are authorized.

## Frozen experiment, before evaluating these candidates

- R2 remains an immutable comparator. R8/R9 remain rejected, not the starting model.
- R10 compares two fixed neutral-symmetry repairs: (a) project the frozen R2 forecasts
  from both equivalent neutral-site listings onto one symmetric forecast; (b) refit the
  same 19-feature, ridge-100 residual head with odd margin/even Total neutral-site
  features. No search over penalties, feature subsets, winner-flip thresholds or outcomes.
- Actual home games retain actual home-court context. Projection variant (a) must leave
  every non-neutral R2 forecast numerically unchanged, except its new release metadata.
- Select the refit over projection on 2024 only if both score MAEs and Brier/log loss
  are no worse and winner accuracy does not decline. Otherwise use projection as the
  narrowly scoped correctness repair; quantify rather than conceal its predictive cost.
- Fit 2023, select 2024, then describe 2025 strictly as already-opened diagnostic data.
  All label availability uses the conservative game-start-plus-six-hours lag.
- R11 compares constant variance with one six-feature positive conditional-variance
  model fitted by Gaussian negative log likelihood (fixed regularization 1).
  Features: pace, Total, absolute margin, inverse-square-root minimum team games,
  neutral site, intercept. They are swap-even. Residual training uses monthly rolling
  mean-head refits, never residuals from a mean head trained on the same games.
- Choose conditional variance only if 2024 joint marginal Gaussian log score improves
  and winner Brier/log loss do not worsen. It cannot change score means or pick sides.
  This is uncertainty calibration, not an invented increase in winner accuracy.
- Exact quote-time comparisons: existing 353 three-market and 635 Total cohorts;
  W/L/push, paired corrections/harms, score coherence, proper probability scores.
  No new quote selection, postgame filtering, minimum-edge veto or market rule tuning.
- Repair invariants must also hold on actual replayed states, not merely synthetic inputs.
  Every neutral fixture must give opposite margins, equal Totals, complementary winner
  probabilities, and exchanged team scores when only listing order changes.
- A failed quoted-market comparison is reported. It cannot be used to retune the chosen
  coefficients on 2025. No claim of unseen validation or guaranteed future win rates.

Uncertainty fitting reference: Gaussian NLL learns positive variance from residuals; see
[PyTorch GaussianNLLLoss](https://docs.pytorch.org/docs/stable/generated/torch.nn.GaussianNLLLoss.html).
This repair does not claim missing historical injury receipts, movement/split coverage,
or a full overtime mixture has thereby been solved.

## R12 residual-stat follow-up, declared after R10/R11 results

R10's symmetry repair costs 10 net winners in opened 2025 and four Total winners in
the 635 quoted rows. It is a correctness repair, not an accuracy upgrade. Do not
overwrite the default preview with a claim of improvement.

The prior loss audit found new-stat candidates also re-estimated all shared R2
coefficients. Test a fixed R10 offset instead: learn only additional shot-profile and
mechanism information left unexplained by the existing 19 inputs. Orthogonalization
is fitted on training inputs only, ridge 100; offset penalties remain 100. Two loss
choices only: squared and the existing eight-iteration Huber loss (10 margin/15 Total).
Neutral odd/even structure is mandatory throughout. Fit offset residuals from monthly
out-of-sample 2023 means; select on 2024 mean MAEs, Brier/log loss, winner preservation.
If neither qualifies, record that result without changing the default preview. If one
qualifies, fit on rolling 2023+2024 residuals and open the same 2025/quote diagnostics
once. No 2025-tuned deadband, coefficient grid, outcome labels in features, market blend,
manual winner override, or alterations to quote cohorts.
