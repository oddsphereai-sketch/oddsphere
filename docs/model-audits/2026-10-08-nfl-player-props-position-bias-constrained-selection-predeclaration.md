# NFL player props position-model bias-constrained selection predeclaration

## Trigger and evidence status

The initial position-model selector minimized MAE/RMSE on 2023, but that objective could select an
absolute-loss head whose point center already violated the production bias rule. Training-mean
calibration did not change the selected family. The failure is in candidate selection: the acceptance
constraint must be enforced before a candidate is frozen, not discovered only after holdout.

The 2025 results are now opened retrospective evidence and are not an untouched holdout for this
iteration. They will be reported honestly as such. No 2025 outcome may select a candidate name or
weight. The final release decision requires the separate 2026 current-season replay.

## Frozen selector

On 2023, a candidate is eligible only when it:

- lowers MAE and RMSE;
- has absolute bias no worse than the reference plus 0.25% of the market mean; and
- has underprediction rate no worse than the reference plus 0.25 percentage points.

Choose the eligible candidate with the best normalized MAE+RMSE. Freeze it. On 2024, require the
same four constraints. Do not choose another candidate if confirmation fails. Report 2025 without
using it to alter the result.

All model families, features, blend weights, chronology, distributions, and downstream gates remain
unchanged. Passing candidates still need joint quarterback coherence; all candidates remain shadow
until complete 2026 projection/side/probability/grade replay.
