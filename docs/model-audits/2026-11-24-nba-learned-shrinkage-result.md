# NBA C4 result: no meaningful accuracy gain; held

November24,2026. Predeclared in commitcfb365c53 after failed C3, before any C4
fit. Production base29d6bbf1e and Daily Edge R39/marriageR41/readerR5/gradeR31
are unchanged. No live model, provider, reader, writer, grade, stake, lease,
schedule or locked history changes. No live shadow or database write.

The proposed score model learns separate Gaussian weight/noise variances for
Margin and Total while retaining frozen A2's exact75 features, original-source
clocks and training-only imputation/missing-indicator/scaling. It fits2,457
source-confirmed2021/2022 games. The complete6142-game2021–2025 source subset
is streamed and every retained native final body/receipt is reverified. Its
trainingHash equals the existing A2 source corpus exactly:
ff032a04760c09cc0a8fbcb15ec393b2c0d2b644399160e1228fabfb49a8c5c4.
Eight prior whole-corpus source refusals remain unavailable, including five
in the evaluation seasons; no missing source is manufactured.

Before fitting, dense orthogonal-contrast covariance and spectral restricted
likelihood agree; analytic gradients match finite differences. Synthetic tests
also verify posterior ridge solve and intercept translation. The actual fixed
alpha1000 reconstruction matches original A2 coefficients with maximum differences
3.05e-14 Margin/2.77e-12 Total. This verifies the design, output orientation and
baseline algebra before testing a changed penalty. Actual later-season outcome/
feature poisons leave the2,457 training rows and transformed matrix exactly equal;
no second real fit is performed. TypeScript retains exact ordinary portable
scoring/missing-indicator parity for identical coefficients and rejects invalid
head/source/time/dimension/variance/score states. Target-only extra feature keys
cannot enter the selected design; original inputs remain unchanged.

Both declared single L-BFGS runs terminate by relative objective convergence,
11 Margin/10 Total iterations, without a restart. Their gradients are retained,
not misrepresented as all meeting1e-6. Learned penalties are982.701018 Margin
and996.314034 Total, both close to the old research setting1000. This result
shows this particular change contributes little in these historical cohorts;
it does not prove the current production artifact or recent accuracy is sound.

The two output vectors were jointly frozen at06:41:39.265UTC, before replay:
head3065ae703048bb5d7251ca99c7e7977bebaafbe578c5f4d6046c574c117ff6af;
input70abac93ea558541c0bb0963682ee1464697c90925a51740a67cf15b86247f5f.
All3,685 admitted evaluation rows replay successfully. Already-opened labels
remain explicit:2023/2024 development,2025 replication, no untouched holdout.
This compares native earlier-fit A2 with C4, not current-incumbent performance.

| Cohort | Games | Team MAE A → C | Margin MAE A → C | Total MAE A → C |
| --- | ---: | ---: | ---: | ---: |
| Development2023/2024 | 2,456 | 9.321408 → 9.321239 | 11.013432 → 11.013341 | 14.872707 → 14.872506 |
| Opened replication2025 | 1,229 | 9.565206 → 9.565168 | 11.460659 → 11.460565 | 15.178929 → 15.178954 |

Development gain0.000168 is far below0.10. The fixed1,000-draw week bootstrap
has95%CI[−0.0000108,+0.0003252]; replication Total MAE worsens. Both joint gates
fail. **C4 stays held**, with no component selection, probability/price/grade
claim, full-market activation or forced play. The complete small frozen head
and season/week summary remain in adjacent evidence JSON; full originals,
training receipts, fit diagnostics, per-game replay and failures stay private.

C1/C2/C3/C4 do not qualify as the NBA accuracy fix. Any further replacement
must clear the original forecast-improvement, source-bound current-incumbent,
new forward, calibrated probability, exact execution-price/full-grader and
balanced board-count gates before protected production publication. The separate
exact-lock-card draft is a reliability repair and cannot qualify a score model.

Validation: four independent Python math/admission tests, TypeScript portable
parity/integrity tests, the real later-season poison/design control, scoped
ESLint, full repository TypeScript and complete `npm run verify:model-change`
pass. Optional local PostgreSQL proof remains explicitly skipped because its
URL is unset. The C3 numerical/source tests also still pass. The streaming
adapter's default eligible season range stays2022–2025; C4 explicitly requests
2021–2025 and canonical key order. Original C3 files/hashes remain unchanged.
These are offline/draft checks, not live accuracy or deployment qualification.
