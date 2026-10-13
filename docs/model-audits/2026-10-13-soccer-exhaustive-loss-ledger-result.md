# Soccer exhaustive loss-ledger result

Date: 2026-10-13

Status: completed read-only diagnosis. The active EPL r20 release remains the
production champion. No prediction, grade, stake, member copy, label, lock or
stored record was changed by this audit.

## What was actually reviewed

The audit reads every settled immutable soccer prediction record, keeps release
identities separate, reconstructs the pre-lock independent/final/market states
when the stored schema permits it, measures team/Total/margin error once per
game, and attaches matched winning controls from the same release, market,
grade, data-health and market-depth cohort.

- 698 settled rows entered the ledger;
- 244 were losses;
- 25 non-binary, void, unsupported or otherwise ineligible rows were excluded;
- zero providers were called; and
- zero database rows were written.

The runnable artifact is
`scripts/operator/audit-soccer-exhaustive-loss-ledger.ts`. Its default output
contains every loss and the immutable IDs of its matched winning controls.

## Premier League

### Release-pure tracked results

| Release | All predictions | Actionable predictions |
|---|---:|---:|
| r16 legacy | 53-27 / 66.25% | 21-11 / 65.63% |
| r18 structural target exclusion | 65-54 / 54.62% | 15-9 / 62.50% |
| r19 draw arbitration | 23-17 / 57.50% | 5-2 / 71.43% |

R16 lacks the modern forward-evidence schema and therefore cannot be treated as
equivalent diagnostic evidence. R18 plus r19 supply 40 games with complete
stored pre-lock independent and target-excluded market captures.

### Root cause, not just aggregate accuracy

Across those 40 games the final score head measured:

- team-score MAE 1.021;
- Total MAE 1.516;
- margin MAE 1.222;
- team-score correlation 0.172;
- Total correlation 0.105; and
- margin correlation 0.215.

The stored pre-lock matchup inputs were much more informative for margin than
for Total. Correlation with actual home margin was 0.358 for big-chance
difference, 0.340 for possession difference, 0.340 for shots-on-target
difference, 0.327 for xG-for difference and 0.307 for shot difference. Prior
season rank strength was only 0.027. This independently supports the active r20
decision to replace most of the old margin with a current attack/defence and
process matchup margin.

The same simple aggregates did not explain realized goal totals in this small
forward cohort. No tested total-environment aggregate was stable; the largest
absolute correlation was only 0.191 and several directions reversed. The
full-season untouched 2025 evaluation was therefore kept authoritative rather
than fitting a rule to ten current games.

The injury count is not a safe numeric model input in its current stored form.
One captured club can contain the same player from more than one source/status
observation, so raw count differences are duplicated and not severity
equivalent. The active r20 score engine correctly does not use that count.

### Market-reading findings

Blanket market replacement failed. Across the 40-game forward cohort:

- independent Total direction was 21-19;
- the active, qualified target-excluded Total tilt was 23-17 and improved Total
  Brier from 0.24990 to 0.24724;
- requiring same-book movement confirmation fell back to 21-19 and worsened
  Total Brier to 0.25206; and
- a movement-resistance veto finished 22-18, still behind the active reader.

Thus the current EPL Total market reader is doing useful work; raw movement is
not a valid replacement. It preserves Match Result marginals, excludes all
evaluated books, and only acts on fresh complete exact-2.5 alternatives from
independent source families.

For Match Result, a selected target-excluded crossing rule corrected one of 30
selection games without harm but changed zero of ten chronological holdout
games. It does not clear a production gate. The r19 current-release locks also
show only one loss where target-excluded consensus was correct and the model was
wrong; movement pointed to the eventual result in six losses, but movement-only
arbitration produced more harms than corrections overall.

### New score candidates

Two additional professional candidate families were tested and rejected:

1. The previously researched 33-feature Poisson regression worsened untouched
   team-score MAE (0.900 to 0.907), Match Result Brier/log loss and margin
   correlation despite improving Total and BTTS direction.
2. A newly predeclared sequential dynamic attack/defence model improved
   untouched team-score MAE to 0.881 and margin MAE to 1.211, but materially
   worsened Total MAE to 1.277, Total Brier to 0.25684, Total direction to
   45.79%, BTTS Brier and Match Result accuracy. It is rejected.

The dynamic candidate's xG weight is not interpretable as a selected finding:
the 2024 selection season has no xG coverage in the historical snapshot, so all
xG weights tied during selection and the deterministic tie-break chose 0.20.
The 2025 holdout does contain xG observations, but that coverage mismatch is an
additional reason not to promote this candidate—not evidence for a particular
xG weight.

Those failures establish the useful decomposition: dynamic or process-rich
strength estimates can improve which club receives the scoring expectation,
but replacing the r19 Total intensity damages the markets. The active r20
hybrid already takes the safe portion of that evidence—75% professional matchup
margin plus 25% r19 margin while retaining the stronger r19 Total—and remains
the best validated coherent score model. Its untouched 2025 gains remain:
Match Result 48.95% to 50.00%, team-score MAE 0.89999 to 0.89790, margin MAE
1.22053 to 1.20760, with Total accuracy unchanged at 56.05% and slight BTTS
improvement. R20 has no settled forward games yet, so no claim is made about a
live settled record.

## Champions League

UCL is not the source of the reported soccer-board collapse:

- all settled rows: 62-21 / 74.70%;
- actionable rows: 18-4 / 81.82%;
- current r7 rows: 20-7 / 74.07%; and
- current r7 actionables: 5-1 / 83.33%.

The 26-game score cohort has materially stronger structure than EPL: team-score
correlation 0.617, Total correlation 0.417 and margin correlation 0.607. No
tested replacement is justified.

One observability limitation remains: UCL locks store the final coherent
projection and the final arbitration source, but not the complete EPL-style
forward capture with an independently replayable pre-arbitration score state.
Eight of nine r7 games remained independent and one used the target-excluded
opening-market log pool. Historical UCL performance is valid, but the one
market-applied game cannot be decomposed into an exact independent-versus-final
counterfactual from the lock alone. The ledger marks this as degraded evidence
rather than inventing the missing state.

## World Cup

The inactive legacy World Cup release remains historically strong on aggregate:

- 235-124 / 65.46% across all binary predictions; and
- 28-9 / 75.68% on actionables.

Its 93-game score cohort measured team-score MAE 0.880, margin MAE 1.173 and
margin correlation 0.647. It predates the modern target-excluded forward schema,
so its market-reader attribution is diagnostic only and is not a basis for
changing EPL or UCL.

## Research interpretation

The production direction is consistent with primary forecasting research:
dynamic/hierarchical attack and defence states and a coherent low-score count
distribution are appropriate independent foundations, while bookmaker
probabilities are a strong forecast benchmark but not proof that every move
should overwrite an independent model. See Dixon and Coles' score model
([Journal of the Royal Statistical Society C](https://doi.org/10.1111/1467-9876.00065)),
Baio and Blangiardo's hierarchical goal model
([Journal of Applied Statistics](https://doi.org/10.1080/02664760802684177)),
Koopman and Lit's score-driven dynamic bivariate Poisson work
([International Journal of Forecasting](https://doi.org/10.1016/j.ijforecast.2018.10.011)),
and Štrumbelj and Robnik-Šikonja's bookmaker forecast comparison
([International Journal of Forecasting](https://doi.org/10.1016/j.ijforecast.2009.10.005)).

## Decision

- Keep EPL r20 and its qualified target-excluded Total tilt live.
- Do not restore r19, deploy the dynamic model, follow movement blindly, change
  grades, flatten the board, or modify any settled lock.
- Keep UCL r7 unchanged; its current prediction and actionable accuracy do not
  justify a replacement.
- Treat World Cup as an inactive legacy audit, not a cross-league tuning set.
- Judge the next EPL change only after r20 has release-pure settled forward
  evidence; never blend r18/r19 outcomes and label them r20 performance.

Rollback is not applicable because this audit changes no runtime behavior.
