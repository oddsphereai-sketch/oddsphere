# C6: training-only scaled player-impact fit

Declared before fitting C6 on November26,2026. Exact fresh production base
9db25a7f81ec2767100ba8fbd0d3758059cbaa93; prior inactive research276ffafb0
was merged without conflict. R64 props changes remain exact. Daily Edge stays
R39/marriageR41/readerR5/gradeR31 and original-card locksR11. No live shadow,
writer, database/provider/AI request, schedule, dependency, historical correction
or member change. C1–C5 remain held; their heads/thresholds do not change.

The old C2 residual head uses six differently scaled raw player/rotation
features with penalty1000. Its training Gram eigen-directions retain only
1.71%–38.06% of their unpenalized strengths. This is a documented fitting
limitation, not evidence that a weaker penalty produces better picks. C6 tests
that hypothesis using the identical original C2 source ledger, source gates,
six features, expected/reference minutes, eligibility, windows and coherent
Margin/Total score architecture. No feature or game subset is selected.

Scale each feature by its training-only RMS, without centering, so zero player
shock continues to produce exactly zero correction. A training column identically
zero uses scale1 and its fitted coefficient must remain0. No evaluation value
supplies a scale. Fit independent zero-mean Gaussian linear heads for Margin and
Total residuals against frozen A1 trained2021, using complete2022 player rows
whose original finals were published before the first2023 cutoff. Each head
has just learned isotropic weight variance and independent noise variance;
alpha=noiseVariance/weightVariance. No fitted intercept or current-market input.

Use the exact Gaussian marginal likelihood in the original n-dimensional
zero-mean space (no flat-intercept projection). Compute its SVD reduction and
analytic log-parameter gradient; independently prove dense covariance/gradient
and ordinary ridge-coefficient/prediction parity. One L-BFGS-B solve per target,
max200 iterations, ftol1e-10/gtol1e-6. Initial noise=mean(training residual²),
initial weight=noise/1000. No grid, restart, evaluated-outcome tuning, manual
point boost or grade/price threshold change. Failure to converge or any source,
coefficient, numerical or input-integrity failure holds the entire joint head.
Freeze both vectors, scales and source hashes before evaluating C6 outcomes.

Use frozen A2 trained2021/2022 for reopened2023/2024 development and already-
opened2025 replication, on the same complete C2 cohort. Neither is an untouched
holdout. Keep the unchanged >=0.10 team-MAE development gain, positive95%
Eastern-Monday-week lower bound (1000 draws/seed20261123), and neither Margin
nor Total MAE worse. Replication must improve team MAE without either marginal
error worsening. Report season/block errors, biases, winner direction, unknown
sources, exact cohort and input immutability. Never select a winning component
after results or combine with C5. Failed models remain offline artifacts only.

The owner also requests an actual-live-model comparison. Implement an explicit
offline same-input bridge to the current R39 numerical path using original
saved pregame inputs, exact game/source/as-of and original market tuples.
Reproduce its incumbent scores/grades before making a replacement comparison;
replace the old roster correction rather than count both. Preserve the existing
market reader, target-book exclusion, coherent score, probability calibration
and exact-price grading in the test. An earlier R38 saved forecast remains
labeled R38 even if current R39 mathematics reproduces it. A comparison of a
newly reconstructed native baseline with an old paid-input forecast is a source-
transport diagnostic, not an isolated live-model improvement. Unsupported
availability/identity/cutoff inputs stay unknown and are not marked healthy.

Report priced records, units/ROI, Brier/log loss, calibration, both market
directions and every promotion/demotion/actionable count only where the actual
saved contract and source support them. A point-error gain cannot qualify live
wagers. Any source gap, failed historical gate or insufficient current/forward
evidence forbids activation. Need genuinely new frozen forward evidence and
current-incumbent superiority without hidden board flattening or forced plays,
then versioned runtime/registry, single leased writer, immutability/reader tests,
full/focused/type/lint/build, protected fresh-main/exact-tree/Ready and ordinary
scheduled live proof before release. No manual refresh or paid proof request.

Raw originals remain private outside the site; source preparation streams the
large ledger and emits bounded <=10000-row/six-feature compact inputs. Reuse
the isolated NumPy2.0.2/SciPy1.13.1 environment; no site package or RAM change.
