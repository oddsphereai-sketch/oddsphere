# C5: team-specific scoring and prevention residual state

Declared November26,2026 before any C5 fit or evaluation. Fresh production base
48362cd845ae7ed405c3d9d3f21b265f2805198b; the unchanged inactive C1–C4 research
was merged into this dedicated branch. Production R39/marriageR41/readerR5/
gradeR31 and R11 original-card locks stay unchanged. No shared release-registry
edit, production import, writer, cron, live shadow, provider/model request,
historical correction or member change is authorized by this experiment.

C1/C2 player corrections and C3/C4 league-state/penalty changes were too small
and failed. C5 tests a different hypothesis: **persistent team-specific score
errors** may be hidden by a league-wide residual average. This is not a claim
that player availability causes those residuals, or that a losing side should
be reversed. The archived 75-feature baseline remains the exact comparator.

For each native team, define independent zero-mean scoring and points-allowed
residual processes. Their common exponential decay has learned length in days;
scoring and prevention have separate stationary variances. Each game's home
score residual observes home scoring + away prevention, and away residual
observes away scoring + home prevention. Independent score observation noise
has one learned variance. Exactly four positive parameters are fitted jointly:
scoring variance, prevention variance, noise variance, lengthDays. No other
head, feature, window, price, promotion threshold, weight or side quota changes.
The state covariance includes all induced cross-team dependencies; replacing it
with independent team averages is not equivalent and is not allowed.

Fit one joint exact Gaussian marginal likelihood on2022 original-source score
residuals against frozen A1 (trained2021). Only finals originally available
before first2023 cutoff enter training. Start from old-training residual sample
variance for noise; each signal starts at half the nonnegative noise-corrected
variance of team residual means, with machine-epsilon floor only; start length
at the median positive same-team start spacing. Use one L-BFGS-B solve in log
parameters, analytic gradients, max200 iterations, ftol1e-10/gtol1e-6. No grid,
restart or evaluation-selected hyperparameter. Nonconvergence, numerical/source
failure or mismatch holds the entire model. Freeze the complete head and source
hashes before reading C5 development results.

The exact vector Markov factorization uses rho=exp(-elapsedDays/lengthDays),
mean*=rho, covariance=rho²*covariance+(1-rho²)*stationaryCovariance, followed by
the two-dimensional Gaussian score observation update. Prove likelihood,
analytic gradients and posterior against a dense GP on independent examples.
No eligible observations returns the original scores and prior uncertainty.
Native unknown teams fail explicitly; no invented zero-impact team or fuzzy ID.

Replay2023/2024 as reopened development and2025 as already-opened replication,
not untouched holdouts. Frozen A2 trained2021/2022 supplies their baseline.
Only same-season non-target games started before the target and whose original
final publication is at/before the target cutoff may enter a posterior. The
covariance coordinate is original game start, not retrieval time. Late-published
old games require an exact rebuild in start order; never move their date to the
current time. Reset state by season. Identical receipts deduplicate; conflicts,
foreign releases, bad identities/clocks or source hashes fail. Target/future/
post-cutoff outcomes must not influence forecasts, training or source selection.

Keep the unchanged >=0.10 team-MAE development gain, positive95% week-block
lower bound, and neither Total nor Margin MAE worse. Bootstrap1000 Eastern
Monday-week draws with seed20261123. Replication must improve team MAE without
worsening either marginal error. Report all seasons, biases, winner direction,
source refusals, corrections and training diagnostics. The joint head cannot
be split after observing results. A failure stays held with originals preserved.

Passing only opens the next stage: exact current-incumbent/source transport,
genuinely new frozen forward forecasts, calibrated probabilities, full exact-
price market/grade replay with transparent promotions/demotions/board counts,
all safety/fresh-main/protected/live gates. Point MAE is not a priced hit rate.
No forced Best Angles, blanket reversal, loosened grade gate or flat-board fix.

Reuse the existing original native box archive and source-verified C3 export;
verify each added native team identity against its original source body/hash.
Keep raw evidence private, bounded <=10000 games/32 teams/season. Fit only in
the existing isolated NumPy/SciPy research environment; no site dependency,
memory, source-budget, subscription or database change.
