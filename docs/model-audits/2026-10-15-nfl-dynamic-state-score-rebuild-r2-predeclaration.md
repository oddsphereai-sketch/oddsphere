# NFL dynamic state score rebuild r2 — frozen predeclaration

Date: 2026-10-15

Status: research-only challenger; no production or locked-record writes.

## Prior result that motivates this release

The frozen r1 direct-regression challenger failed confirmation. On 544 games in
2024–2025 it recorded margin MAE 10.105 and total MAE 10.580. A scalar market
blend selected zero independent margin weight and its 30% independent total
weight regressed market MAE. The result suggests that presenting a wide table
of rolling football statistics directly to generic regressors is not a strong
enough score architecture.

## Frozen architecture

r2 starts with an explicit weekly state-space score model:

- one latent offensive scoring state and one latent defensive points-allowed
  state per team;
- a league scoring level that moves only after a complete week is locked;
- offseason shrinkage toward the league prior;
- a symmetric home-field adjustment; and
- weekly residual updates applied only after every game in that week has been
  predicted.

The frozen parameter grid is:

- residual gain: 0.05, 0.10, 0.15, 0.20;
- offseason carry: 0.50, 0.65, 0.80;
- home-field margin: 1.5, 2.0, 2.5 points; and
- league-level weekly gain: 0.01, 0.03, 0.06.

The single joint state recipe is selected on 2023 team-score MAE, then frozen.

After that selection, the r1 `core` and `availability` football feature
families may predict capped residual corrections to the state margin and total.
The frozen correction grid uses the r1 base/ensemble estimators, weights 0.25,
0.50, 0.75, and 1.00, and caps of 2, 4, and 6 points. Margin and total select
their own correction recipes on 2023 MAE. Confirmation refits the selected
residual model on the expanding prior-season window but never changes the
recipe, weight, cap, or state parameters.

## Split, exclusions, and reporting

Training is 2016–2022, selection is 2023, and confirmation is untouched 2024
and 2025. Inputs retain all r1 leakage exclusions: no market fields in the
independent stage, no actual/archived-unknown weather, no team identity, and no
completed-game current quarterback identity.

The report must show the same coherent score, moneyline, direct line, and
3-/6-point improved-line metrics as r1. A simple consensus-anchor blend remains
diagnostic only; the qualified 2026 market reader is evaluated later on exact
stored timestamps.

r2 advances only if the frozen 2024–2025 confirmation improves both independent
margin and total MAE over r1 and at least one frozen market-anchor head improves
on the market without a material regression in the other. Otherwise it is
rejected without confirmation tuning.
