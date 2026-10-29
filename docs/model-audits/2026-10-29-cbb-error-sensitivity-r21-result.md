# Private CBB r21 error-sensitivity result

Decision: **do not change the r2 score model or activate CBB**. This was a
diagnostic requested to locate the source of roughly nine-point margin and
thirteen-point Total errors, not a qualified release. The score-feature groups
were declared before this run in
`2026-10-29-cbb-error-sensitivity-r21-predeclaration.md`. A clean-commit local
report with input hashes and its source SHA is at
`/private/tmp/oddsphere-cbb-data/error-sensitivity-r21-report.json`.
Neither 2024 nor 2025 is a pristine holdout; both were previously opened.

## What the controlled ablations show

Each variant refits the same ridge correction on 2023 and evaluates the same
5,710 games in 2024. The 2025 column repeats the fixed variants after a
2023–24 refit, only as an already-opened stability diagnostic. Positive MAE
delta is worse than the full r2 head. Every game remains in each comparison;
66 forecasts in each season have incomplete inputs and are included.

| Removed from the r2 correction | 2024 winner change | 2024 margin / Total MAE change | Opened 2025 winner change | Opened 2025 margin / Total MAE change |
| --- | ---: | ---: | ---: | ---: |
| Rest features | −9 | −0.002 / −0.002 | +3 | +0.007 / +0.002 |
| Raw Four Factors | −27 | +0.041 / +0.061 | −39 | +0.064 / +0.029 |
| Recent form | 0 | −0.001 / +0.025 | −10 | −0.001 / +0.005 |
| Nonlinear margin | −1 | +0.001 / +0.001 | −4 | +0.004 / −0.007 |
| Pace-correction features | −1 | −0.003 / +0.020 | −1 | +0.004 / +0.033 |
| Entire correction head | −28 | +0.084 / +0.337 | −31 | +0.152 / +0.326 |

The baseline is 4,113 correct winners, 9.242 margin MAE and 12.906 Total MAE
in 2024; on the opened 2025 diagnostic it is 4,112, 9.279 and 13.638.
Removing Four Factors harms both seasons, so deleting them is not a remedy.
Removing rest barely changes score error and has opposing winner effects by
season; that is a weak, unstable lead, not a promotion. The correction head
does add value but its entire 2024 Total gain is only about 0.34 point. No
ablation makes a material, consistent step toward the owner's targets.
Correlated feature groups can substitute for one another after refitting, so
this is incremental-dependence evidence, not causal attribution to a faulty
input.

## Where the residual error lives

On 2024, the actual-on-predicted slope is 1.008 for margin and 0.962 for
Total; signed forecast biases are −0.817 and −0.088 points respectively.
Predicted SDs are 8.60/8.59, actual SDs 14.64/18.47, and residual SDs
11.79/16.52 for margin/Total. The large outcome spread does not imply the
model should inflate its predictions to match outcome SD. These measurements
show no large global scale or offset error that a simple rescaling could fix.

Regulation games have 12.331 Total MAE (5,387 games). Overtime games have
22.501 (323 games), and account for about 0.575 points of the full-cohort
12.906 Total MAE above the regulation-only rate. Overtime is a real component
but not the whole gap. An **illegal postgame-tempo substitution** that changes
only the base scoring-rate component, leaving the learned correction fixed,
produces 11.971 all-game Total MAE and 11.204 on regulation games. Because
the dataset normalizes overtime pace to 40 minutes while the target includes
OT points, the all-game arithmetic mixes two effects. Neither number is an
eligible candidate, a lower bound, or an attainable projection. It indicates
that even perfect knowledge of this particular tempo estimate would not by
itself reach sub-10 on the observed games.

The raw score equation moves Total by about 2.112 points per extra possession
and moves both margin and Total by about 0.687 points for a one-point-per-100-
possessions change to one offense/defense rating. The margin change from an
extra possession averages only +0.076 point because its sign and size depend
on matchup. Perturbing a single rating by +1 crosses 178 or 188 corrected
winner sides, depending on which team is perturbed. These are **leverage**
measurements, not evidence that any observed rating error has the needed sign
or that those flips would win.

## Independent review and next falsifiable hypothesis

Three independent AI reviewers inspected the equations, cohorts, and
interpretation; this was not a human external audit. They identified two
errors in the first r21 diagnostic (scaling the fitted correction in the pace
oracle and counting perturbation flips from the raw rather than final margin).
Both were fixed; the revised raw-base-rate algebra, per-game perturbations,
and corrected-margin crossings were rechecked. The audit also now regenerates
the 2023 and 2024 feature files from the exact game/box/venue inputs and
requires byte-hash parity; it checks game identity/order/as-of and reproduces
the frozen 2025 r2 aggregate before interpreting ablations. No reviewer found
a verified arithmetic bug in the r2 model that explains the plateau.

The most specific new hypothesis is *pregame scoring efficiency*, rather than
tempo alone: current Four Factors have incremental signal, but the model uses
unweighted per-game rate means, while the rate-only opponent adjustment r19
failed. A distinct next test would use the available attempt/opportunity
denominators and venue context with a fixed pregame cutoff, fit on earlier
games, and evaluate ML/Spread/Total plus coherent scores on exact same-game
quotes. That hypothesis is not yet a fix or a promised gain. Any proposed
model or grade change requires a new release and future chronological proof;
the opened cohorts cannot be reused as a fresh success claim.
