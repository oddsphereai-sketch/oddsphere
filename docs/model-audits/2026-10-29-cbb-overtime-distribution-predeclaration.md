# College basketball total-decision distribution test

Private, offline continuation of the R12–R15 audit. R2 preview and all live
models remain unchanged. The 2025 season and opening-quote cohorts have already
been examined; they are diagnostics, not untouched validation.

R13 corrected a training/forecast mismatch and preserved R12's winner, moneyline
and spread projections exactly, but its 635 opening-total record fell to 325–310
from R12's 333–302 and R2's 341–294. R14 and R15 also failed the fixed 2024
selection rule. Smaller score error and a fixed-threshold grid score did not
predict better bookmaker-line choices.

The 635-game quote ledger provides a concrete distribution hypothesis: 336
games finished below their total line, while 35 overtime games averaged 18.79
points above it. Among the 600 regulation games, 328 finished below the line
and the median result was 1.5 points below it. This is descriptive postgame
evidence, not an input to any forecast. A symmetric normal distribution around
the final-score mean may put the 50% decision boundary too high when overtime
adds a long right tail.

## Fixed test before fitting

Fit one overtime-mixture distribution, R16. Keep the R12 projected final
margin, total, team scores, moneyline probability and spread probabilities
unchanged. Its total distribution has a regulation and an overtime component.
Fit the pregame overtime probability from 2023 games by logistic regression on
absolute projected margin in units of ten points, with L2 penalty 10 on both
coefficients; no current-game result or market price enters that fit. Fit the
mean points added by overtime from 2023 overtime games. For the 2024 selection,
use only 2023 training. For the later opened 2025 diagnostic, refit with 2023
and 2024 games. Use R10 pregame margin in training because R12 training-season
forecasts are unavailable without using the same games to fit R12. This proxy
mismatch is a limitation to report.

Set regulation location to `R12 final total - p(overtime) × mean overtime
points`, and overtime location to that regulation location plus mean overtime
points. Choose within-component variance so the mixture preserves R12's total
variance. This creates one coherent distribution with the exact same expected
final score and variance; only its shape changes. Predict an over when its
probability exceeds 50%; never use the observed overtime indicator at prediction
time. No arbitrary odds, manual score adjustments, pick suppression, or grading
rules are introduced.

Select R16 only if the 2024 fixed total-threshold binary log score improves
over R12 and the 2024 total-threshold W/L across all grid decisions does not
worsen. Report both, including a rejection. Then open the same exact 353
three-market and 635 total quotes once. Report all-game W/L/push/pass and
paired corrections/harms relative to R12 and R2. Moneyline and spread picks
must equal R12 exactly; neutral listing symmetry and forecast chronology must
hold. Any 2025 quote improvement remains exploratory because that cohort was
already opened. No live release follows this test.
