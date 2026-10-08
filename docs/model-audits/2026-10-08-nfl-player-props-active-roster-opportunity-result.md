# NFL player props active-roster opportunity tournament result

## Decision

Reject both simple team-budget candidates. Do not export an artifact or change any production
release, projection, probability, grade, stake, or member surface.

The result narrows the root cause. Team-budget coherence is a valid product invariant, but neither
normalizing the existing all-roster scores nor normalizing active-only scores with a shifted
participation prior improved forecast accuracy reliably. The next independent-model repair must
improve the latent role state and market-specific efficiency inputs before enforcing the final
joint allocation.

## Frozen chronology

The checksum-pinned dataset contains 138,860 roster/game rows, 2,639 games, and 3,104 players from
2016-2025. Both tournaments trained through 2022, selected in 2023, required confirmation in 2024,
and opened 2025 once as holdout. No line or price entered either candidate.

## Candidate 1: existing player scores normalized to team budgets

The first candidate forecast team passing attempts, rushing attempts, and targets and allocated
them across the relevant roster using existing direct-model scores and prior role-share pooling.

- No market selected and confirmed a candidate.
- Rushing Yards selected a 25% pool / 25% architecture blend in 2023, but failed 2024 confirmation.
- All other markets failed the 2023 requirement to improve both MAE and RMSE.
- The candidate had zero negative projections and zero completions-above-attempts violations.

This rejects the idea that normalization alone fixes the model. The allocation still inherited the
all-roster zero-outcome target problem.

## Candidate 2: active-only scores with probabilistic teammate availability

The second candidate fit opportunity scores only on prior-season `participated = 1` rows. At test
time it weighted every teammate with shifted `prior_participated_avg5`; for the evaluated settled
player, it conditioned that player's state to active. It then allocated the same independent team
budgets and derived completions/yards from conditional efficiency models.

| Market | 2023 selected | 2024 confirmed | Production eligible |
|---|---|---|---|
| Passing Attempts | none | no | no |
| Passing Completions | none | no | no |
| Passing Yards | none | no | no |
| Rushing Attempts | none | no | no |
| Rushing Yards | 25% budget blend | no | no |
| Receptions | none | no | no |
| Receiving Yards | none | no | no |

Because no candidate confirmed, the reported 2025 rows intentionally fall back to the reference
and have zero deltas. The architecture again had zero negative projections and zero
completions-above-attempts violations.

## What the failure means

The tested allocation score is too weak, not the concept of joint allocation. In particular:

1. `prior_participated_avg5` cannot distinguish active-normal, active-limited, and active-expanded
   roles and has no timestamped practice/injury context.
2. Targets and carries were allocated from generic opportunity regressors rather than explicit
   route participation, snap packages, personnel group, vacated-work, and coaching decisions.
3. The team budget used aggregate prior volume and matchup fields; it did not repair the 47 stale
   2026 snap/advanced-matchup inputs identified in the runtime audit.
4. Conditional efficiency heads still lack assignment-level or reliable unit matchup data.
5. A joint constraint can reduce impossible combinations while worsening marginal player means;
   both coherence and accuracy must pass.

## Next falsifiable hypothesis

Build the hierarchy in the opposite direction:

1. estimate active/full/limited/expanded role state using timestamped availability and recent
   snap/route/workload evidence;
2. estimate player opportunity shares conditional on that state and material teammate states;
3. forecast an as-of-safe team play/dropback/rush/target budget with current-season EPA, pace,
   explosives, pressure/sack, air-yard, YAC, CPOE, coaching, venue, and weather inputs;
4. combine shares and budgets only after both components beat their direct baselines separately;
5. fit compound market-specific distributions and test on complete frozen 2026 boards.

This next candidate is blocked for true route/alignment and individual OL/DL/coverage assignments
by the current data contract. It is **not** blocked for current-season aggregate matchup refresh,
schedule adjustment, role mixtures, coaching, weather, or injury-driven workload redistribution.
Those repairs can proceed with existing/publicly refreshable inputs and should be tested before a
licensed tracking feed is considered.

## Reproduction

```bash
python3 scripts/operator/tournament_nfl_player_props_opportunity_budget.py
python3 scripts/operator/tournament_nfl_player_props_active_roster_opportunity.py
```

Both scripts write only ignored local research reports.
