# College basketball pick regression repair test plan

Scope is private CBB Moneyline, Spread and Total research only, from main
`9b66451f241485591009484a8e005d205146a19d`. R2 remains the unchanged comparison
preview. R12 is the previous unpromoted trial, not a production model. No writer,
lease, cron, provider factory, member reader, grade, stake, tracking or locked row changes.

## Diagnosed pattern and hypotheses

On the same 635 exact opening quotes, R12 moves 158 picks to over and eight to under,
correcting 79 losses and harming 87 wins. Its average Total rises 1.804 points. The
regression is six net losses in 600 regulation games and two in 35 overtime games;
it cannot be explained solely by overtime. Correlated linear feature accounting is
descriptive, not causal attribution.

The 353-game comparison and its overlap within the 635-game comparison are not the same
quote cohort: only 100/353 have identical sportsbook and forecast cutoff; 230 have the
same Total line. Up to 21.09 hours separates the cutoffs, with mean absolute line
difference 0.514 points. Never attribute the record difference solely to the extra games.
Every within-cohort model comparison must still use exactly the same quote and cutoff.

R12 trains corrections on residuals from monthly expanding mean fits, but evaluates
them over a mature, prior-season-fitted mean. A residual pattern specific to an immature
mean may then be misapplied. Test that hypothesis rather than manually subtracting points
or choosing under after seeing an over lose. Separately, a squared-error fit rewards
fixing large score misses; it does not directly reward correct line-side probabilities.
The distinction between mean, median and the required scoring rule is established in
[Gneiting, Making and Evaluating Point Forecasts](https://arxiv.org/abs/0912.0902).

## Fixed candidates before fitting or opening their results

Generate season-frozen out-of-sample mean residuals: fit the neutral-symmetric projection
mean on 2022 raw feature rows and forecast 2023; fit on 2023 and forecast 2024. Retain
the six-hour label lag and exactly the R12 correction-training game IDs. Development
raw forecasts used zero global residual correction, while 2024 inputs use a +1.023-point
Total correction and 2025 inputs use +0.822 points. For the replicated 2023 forecasts,
fit that global correction on 2022 only and reconstruct the raw feature vector in those
same units. Never reuse the evaluated season's correction. This tests both maturity and
the concrete zero-versus-fitted residual-calibration mismatch; do not call either alone
the established causal source of all losses. Fit final additional-stat heads on these 2023 and 2024 residuals,
never on 2025. Use the same 69 inputs and ridge-100 residualization as R12.

1. R13: matched-mean Total correction with squared loss; preserve the separately frozen
   R12 margin head exactly. This isolates training architecture from the objective.
2. R14: the same matched-mean Total correction with smoothed absolute loss (smoothing
   0.25 points; fixed tail scale 15, ridge 100); preserve the R12 margin head exactly.
3. R15: matched-mean margin and Total corrections trained using a fixed grid of binary
   outcome log scores. Total thresholds 100.5 through 200.5 in five-point increments;
   margin thresholds symmetric at ±0.5, ±5.5, ±10.5, ±15.5, ±20.5, ±25.5, ±30.5.
   These are training thresholds, not fabricated historical sportsbook lines. Use the
   existing Gaussian CDF and unchanged standard deviations, ridge 100 and numerical
   Newton/line-search convergence, with no threshold or penalty search.

All heads output one margin and Total, hence one score and coherent probabilities for
all markets. Neutral-site odd/even constraints remain mandatory. R13/R14 must prove that
moneyline and spread projections, probabilities and picks remain equal to frozen R12.

## Selection and later diagnostics

Choose between R13/R14 on 2024 Total threshold-grid log score, not MAE. Require no
worsening versus R12 on that probability score. R15 must improve both margin and Total
grid log scores and preserve 2024 winner count/Brier/log loss versus R12 before it can
be considered selected. Keep results for all three fixed candidates, including failures.
Do not pick the best 2025 result retrospectively and call it validation.

Evaluate all three once on the already-opened 2025 full season and the unchanged 353
three-market and 635 Total quote cohorts. Report W/L/push/pass, paired corrections/harms,
conditional probability scores and date-block intervals. Smaller score MAE cannot qualify
a candidate that loses picks in the other markets. Do not suppress weak-edge games,
remove losing dates, use actual overtime as a prediction input, manually blend forecasts,
or retune on these 2025 outcomes.

A bounded BallDontLie probe for 2024-02-17 and 2025-02-15 returned zero opening rows
in one request. The alternative historical Odds API credential is not configured.
This does not prevent the stated offline tests, but grid scores are not substitutes
for historical market-pick validation. No new subscription or live collection is created.
