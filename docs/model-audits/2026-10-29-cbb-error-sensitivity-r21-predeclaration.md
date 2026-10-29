# Private CBB r21 error-sensitivity audit: predeclaration

This is a diagnosis of the unpublished men's CBB r2 score model, not a model
release proposal. No production model, member score, grade, stake, writer,
reader, cron, or locked record may change. The r2 artifact and coefficients stay
frozen. The 2024 selection season and 2025 diagnostic season have already been
opened; neither can be called a fresh holdout.

## Questions fixed before looking at the results

1. Which groups in the r2 correction head help on the exact 2024 cohort when
   each group is removed and the remaining coefficients are refit using only
   2023 labels? The fixed groups are rest (features 5–6), raw Four Factors
   (7–14), recent form (15–17), nonlinear margin (4), and pace-related
   correction (3 and 17). Compare the full head with each ablation, an
   intercept-only head, and no correction. All matchup-head fits use the same
   ridge penalty of 100. The ablation is descriptive: correlated feature
   groups can substitute for one another, so a delta is not a causal value.
2. How do 2024 residuals change across pregame-predicted margin bands
   (<5, 5–15, >=15), pregame-predicted Total bands (<130, 130–150, >=150),
   and calendar month? Report group sizes, signed bias, MAE, and wrong-winner
   counts. No group is removed from the full-cohort result.
3. Are the 9-point margin and 13-point Total MAEs mostly removable by a
   uniform correction? Report actual-versus-predicted slope, prediction and
   outcome SD, residual SD, and bias. These are diagnostics computed on 2024,
   not deployable corrections.
4. How much of Total error might be attributable to tempo measurement?
   Substitute the *postgame* actual tempo into the forecast scoring-rate
   equation while preserving its correction term. This is an illegal oracle,
   explicitly not a candidate or accuracy claim.
5. Which score inputs are most sensitive? Perturb only the *forecast equation*
   (not the trained state) by plausible diagnostic increments: +1 possession,
   +1 point per 100 possessions to home offense, away defense, away offense,
   or home defense, and +1 point to the residual margin/Total corrections.
   Report average score-coordinate movement and how many 2024 winner sides
   would cross zero. These perturbations do not demonstrate predictive value.

The source cohort is the existing `score-feature-development.json` (2023) and
`score-feature-selection.json` (2024) under `/private/tmp/oddsphere-cbb-data/`.
Repeat the fixed family-ablation list by refitting through 2024 and replaying
2025 only as an already-opened stability diagnostic, if its score-feature rows
can be regenerated from the same source-game receipts. Report paired deltas
and correction/harm counts, not just separately rounded MAEs; do not choose a
variant from 2025. The release artifact's r2 2025 metrics must reproduce before
interpreting any ablation. Correlated groups may transfer signal to surviving
features, so a favorable ablation is at most a hypothesis about the current
feature/penalty combination.
The audit will require matching game IDs, season/order checks, SHA-256 input
receipts, a clean committed source SHA, and will output only a local report.
No parameter may be selected for activation from this audit. A proposed change
would need a new release, an untouched chronological evaluation, exact-quote
Moneyline/Spread/Total and score coherence, grade-board impact, and the normal
model-change safety gates. A smaller MAE on a filtered easy subset or an oracle
is not a full-model improvement.
