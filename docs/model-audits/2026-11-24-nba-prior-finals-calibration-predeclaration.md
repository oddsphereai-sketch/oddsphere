# C3: prior-final residual calibration — fixed offline experiment

Declared before any C3 fit on November24,2026. Base production29d6bbf1e;
research branch includes that exact base. This is unactivated research, not a
new writer, source, live model, grade, stake or shadow persisted on the site.
Current Daily Edge remains R39/marriageR41/readerR5/gradeR31. The separate R11
lock-card prevention draft remains independent and must retain its own gates.

## What changed in the evidence

The previously frozen C2 head and all six input hashes replay unchanged. Its
seven supported early November23 projections can now be scored against stored
provider finals. At those exact early saved lines, its Total direction went
2–5; the early incumbent went4–3. C2 Total MAE11.399611 and Margin MAE8.509340
also fail to improve the raw portable comparator (11.377681/8.381925). These are
unpriced independent-score diagnostics, not original C2 wagers or a T60 record.
Three original medical-source exceptions remain unavailable; no forecast is
manufactured for them. Seven games are one correlated slate, not enough to
identify a persistent bias, select a numerical policy or prove a future winner.
The historical C2 promotion gate remains failed.

The frozen 75-feature portable recipe already consumes league offense and pace
information. C3 therefore tests adaptation of **prediction residuals**, rather
than claiming those factual features were missing. The hypothesis is that an
independent score model can have a time-varying common scoring or home-margin
error even when its underlying league stats are present. Prior completed games
can estimate that state with uncertainty; a single losing wager cannot justify
flipping future picks. November23 outcomes may motivate the hypothesis but do
not fit its hyperparameters or serve as its final evaluation.

## Fixed C3 recipe

Use two independent zero-mean stationary exponential Gaussian processes: one
for actual-minus-portable Total, one for actual-minus-portable home margin.
The coordinate is the Eastern slate-day ordinal. For either head:

    k(day_i,day_j) = signalVariance * exp(-abs(day_i-day_j)/lengthDays)

Each original game has independent observation-noise variance. Group admitted
same-day residuals by their count, mean and within-day sum of squares. Their
mean has noiseVariance/count. Fit the exact grouped Gaussian marginal
likelihood, including within-day contrasts, so individual-game noise cannot
be misrepresented as a perfectly known daily mean. There are exactly three
positive parameters per head: signal variance, noise variance and length in
days. No fixed calendar window, manual point boost, book-derived mean, price
blend, side quota, promotion threshold or market-read override is introduced.

Fit each head once, on2022 residuals from the previously frozen A1 portable
baseline trained only on2021. The training source finals must have been
available before the first2023 prediction cutoff. Use one L-BFGS solve in log
parameters and analytic gradients: at most200 iterations; numerical ftol1e-10
and gtol1e-6. Initialize noise from within-day sample contrasts, signal from
between-day residual means after subtracting noise/count (positive numerical
floor only), and length from median positive observed day spacing. No grid,
restart, fitted feature topology or selection on2023/2024/2025/2026 outcomes.
Non-convergence, nonfinite parameters or failed source/proof gates hold the head.

The exponential process has an exact scalar Gaussian filtering representation.
Between ordered observation days, rho=exp(-gap/lengthDays), mean*=rho and
variance=rho^2*variance+(1-rho^2)*signalVariance. Assimilate each grouped mean
with its learned noiseVariance/count. Propagate to the target day. Prove this
matches the dense Gaussian posterior; no independent approximation or calendar
smoothing weight may change the result. With no eligible source, the correction
is zero, prior uncertainty remains and the original forecast is unchanged.

Apply margin and Total corrections to one coherent pair:
home=(Total+margin)/2; away=(Total-margin)/2. This first experiment owns point
forecasts only. Predictive probabilities, market-exclusion/execution, grades,
stakes, original quote selection and live market marriage are **not** supplied
or promoted by this experiment.

## Chronology, originals and data budget

Use the existing original-team-feature corpus, original final-source publication
receipts and frozen A1/A2 artifacts. Do not fetch another provider/model or buy
proof. Every observation is identified by original game ID, season, start,
source-available clock, baseline-artifact hash, baseline projection and final
scores. Reject invalid clocks/conflicts; deduplicate identical receipts without
increasing their weight. Admit only a same-season, non-target game started
before the target and whose final source was available by the actual evaluation
cutoff. Future/target/post-cutoff poisons cannot affect a posterior. No date is
inferred from a URL, filename, current cache or later result.

Training2022 uses A1. Development2023/2024 and opened replication2025 use the
frozen A2 trained2021/2022. Those already-opened outcomes are explicitly not an
untouched final holdout. Report their labels, all source refusals, point-error
changes and week-block uncertainty honestly. No current production artifact
trained through2025 can call2023–2025 an unseen backtest.

Bound a cohort to10,000 games/256 observed slate days; a head/baseline mismatch,
foreign season, incomplete original source or numerical failure is not new
basketball evidence. Stream source hashing, keep original raw data outside Git
and the site, and emit immutable small head/report artifacts. Use installed
NumPy2.0.2/SciPy1.13.1 in the isolated research environment only; no site package
or dependency changes. The scalar posterior needs no SciPy or large matrix.

## Gates before any next stage

Before reading development results: dense/grouped likelihood and gradient
parity, scalar/dense posterior parity, source/time/target/duplicate/season
controls, same-season reset, no-source identity, symmetric score construction
and unchanged original input hashes. Freeze fitted parameters/hash before
replaying development; never tune again under the same C3 identifier.

Report both marginal errors, team MAE and bias by season and chronological
block. Keep the existing primary improvement requirement: at least0.10 team
MAE gain with positive week-block lower confidence bound and neither margin nor
Total MAE worse. A failed joint head remains held; no post-result choice of only
its winning component under this declaration. Passing this development gate
still requires a source-bound current-incumbent comparison, genuinely fresh
forward evidence, calibrated distributions, exact-price full-market grading,
transparent board-count/promotion/demotion impacts, versioning, single writer/
lease, focused/full/type/lint and all protected/live release gates. No Best Angle
or additional play is forced, and no stored locked record changes.

Mathematical references: the Gaussian conditional and marginal-likelihood
identities in Rasmussen and Williams, *Gaussian Processes for Machine Learning*,
[chapter2](https://gaussianprocess.org/gpml/chapters/RW2.pdf) and
[chapter5](https://gaussianprocess.org/gpml/chapters/RW5.pdf). The NBA hypothesis,
source admission and model transport are this experiment's assumptions; those
references do not establish basketball accuracy or justify a production release.
