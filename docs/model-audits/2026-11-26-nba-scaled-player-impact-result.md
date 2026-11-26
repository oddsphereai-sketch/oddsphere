# C6 player-impact fit and current-code comparison: reject activation

November26,2026. Fresh production base9db25a7f81ec2767100ba8fbd0d3758059cbaa93
retains R64 props and NBA Daily Edge R39/marriageR41/readerR5/gradeR31/lockR11.
This is a completed offline experiment, not an accuracy repair or live shadow.
All stored forecasts, outcomes, grades, stakes, sources and readers stay exact.

The owner asked to implement the scaled player-impact fit, test it against the
live model and deploy only if it holds up. **It does not hold up.** Both older
qualification gates fail. The source-bound current-season comparison also
fails to support promotion. No player-impact or grade-policy change is deployed.

## Fixed fit and source admission

Declaration5636639fa preceded implementationca4d8feb8 and fitting. Both heads
were frozen in18c814f96 before development/current-season C6 results were read.
Frozen at18:52:39.378UTC, head
15f1f90cf303994d133009ec51aa463d01574fd8bb03248d63fbe47b5719ff5a;
input SHA f554ea31d77848c38d2bcd7b5e1c48afc5a7e3b6581c1862f74ccc1d5695f23d.

Training uses976 complete original2022 player snapshots against A1 trained2021.
The unchanged C2 ledger has1880 complete2023/2024 selection games,1858 verified
changes and1379 unknown ledger rows. All2742 old2023–2025 C2 comparison rows,
original snapshot hashes, point baselines, outcomes and source clocks match.
Its54 opened2026 rows are kept separate for the current-code diagnostic.

The six original features are scaled by old-training RMS without centering;
zero shock retains zero correction. One Gaussian marginal-likelihood solve per
target learns weight/noise variance, without an intercept, feature search,
manual point boost or grade change. Each converges in11 iterations/13 evaluations.
Learned Margin alpha188.936050 and Total alpha1296.713642 replace C2's fixed
raw-unit alpha1000 only inside this new offline head. Neither C2 nor C5 is
modified/combined. No refit or component selection follows the failures.

## Older reopened results

| Cohort | Games | Team MAE A → C6 | Margin MAE A → C6 | Total MAE A → C6 |
| --- | ---: | ---: | ---: | ---: |
| Reopened development2023/2024 |1880|9.359346 →9.334450|10.900124 →10.826853|15.097664 →15.095361|
| Already-opened replication2025 |862|9.507885 →9.500649|11.184103 →11.083668|15.238473 →15.248668|

Development team gain0.024896 falls below the unchanged0.10 requirement;
week-block95%CI[-0.008132,0.058577] crosses0. Replication Total error worsens.
Margin bias also increases: development0.345603→1.047216, replication
0.670157→1.515604. More winner directions are correct in the combined old
cohorts, but that cannot qualify Total/Spread accuracy, probability, value or
actionability. These compare earlier-fit native A2, not the current live head.

## Test against the live numerical score path

Current R39 code and its shipped artifact reproduce **112/112 actual saved raw
forecasts**, from saved paid inputs reconstructed only through each original
as_of. Old roster corrections plus those raw scores reproduce the original
independent projections. This verifies a numerical comparator; it does not
relabel the original R36/R38 releases or invent R39 historical locks.

Of54 source-complete2026 impact snapshots,43 match the retained112-game replay
bundle by exact start/team identity and pass the original as_of cutoff. Eleven
have no exact matching fixture in that particular archive; that is not a
finding that the live slate or tracking omitted those games. Native postgame
boxes corroborate stable fixture identity and finals only; no target count,
participant, availability or rotation can enter the forecast.

For each admitted game, replace the old roster correction with C6 on the
**same saved raw live-model score**. Do not add both adjustments. Preserve the
original market tuples and original source/lock clocks. Results stay separated
by the original release:

| Stored cohort | Games | Independent Margin MAE B → C6 | Independent Total MAE B → C6 |
| --- | ---: | ---: | ---: |
| R36, Nov6–19 slate dates |35|10.528220 →10.918311|14.245320 →14.782013|
| R38, Nov20 slate date |8|8.041653 →8.568873|21.609452 →21.076421|

The larger group worsens both errors. In unpriced independent-stage directions
at identical original execution lines, R36 Spread stays17–18 and Total declines
18–17→17–18; R38 Spread stays4–4 and Total stays2–6. These are **not candidate
wagers, public records, ROI or full market-reader results**. The original
published final forecast remains separate, including its original market
effects. Current R39 market-reading/execution and calibrated C6 probability
were not qualified by this point-stage comparison. No candidate Best Angle,
Lean, demotion, stake or board-count improvement is claimed.

The same head and all point predictions remain exact across report revisions;
later revisions add source hashes, typed metadata and line-direction diagnostics,
not another model fit. Each of112 snapshot gzip files and54 native identity
source/receipt pairs is hash-bound in the final private report. Original saved
input hashes remain equal before/after; no original source is overwritten.

## Validation and disposition

Five independent Python tests prove zero-intercept dense Gaussian likelihood,
analytic gradients, primal/dual ridge coefficient parity, unit-invariant RMS,
zero-shock/zero-column behavior, rank-deficient covariance and chronological
training selection. TypeScript controls prove raw/scaled parity, exact source/
head/clock/season/scale guards, old-roster replacement, premature-source refusal,
both Spread orientations, pushes, missing opposing-price honesty and original
input immutability. Poisoning every later outcome and feature preserves the
actual976-row training design and scales exactly without refitting. Equivalent
timezone encodings are compared as UTC instants, without changing actual fit
membership. Existing runtime feature/no-leakage tests pass.

Full repository TypeScript, scoped ESLint and complete `npm run
verify:model-change` pass. The optional local PostgreSQL proof is explicitly
skipped because MARKET_BRAIN_POSTGRES_URL is unset. No production build,
protected merge or live accuracy verification is claimed for this rejected
candidate. Its reader/writer/grade paths have no new C6 import.

Initial adapter failure correctly exposed that the old C2 report also held54
opened2026 cases; the historical export explicitly separates them instead of
silently losing them or blending them into old-season replication. An initial
synthetic test had two identical linear predictions; its test vector was fixed.
TypeScript caught reporting-only duplicate fields/array types; those were fixed
without changing the frozen model. Original failure logs remain retained.

Keep C6 as a reproducible offline artifact only, together with C1–C5. Historical
failure is not rescued by one small current-season arm. Do not persist a shadow
in any production writer, snapshot, tracking table or database. There is no
qualified replacement to release, no forced play and no blanket flip. A future
model still needs materially better forecasts, current-incumbent/full-market
and probability evidence, genuinely new frozen forward confirmation, transparent
grade/count impact and every protected/live deployment gate. Additional provider
or paid model requests, production writes and live grade changes in this work:0.
