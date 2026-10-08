# NFL player props active-roster opportunity tournament predeclaration

## Hypothesis

The first team-budget candidate failed because it normalized opportunity across the full prior-role
roster while its player score model was still trained on nonparticipants as zero outcomes. The
settlement-aligned tournament showed that active-only fitting materially improves several market
centers, but it does not enforce roster/team opportunity coherence.

The new falsifiable hypothesis is that a team budget allocated with active-only player opportunity
scores and as-of-safe participation probabilities will improve settled active-player forecasts over
the active-only conditional candidate. This combines the two repairs without using the test game's
realized participation state as an input.

## Frozen candidate

For each 2023, 2024, and 2025 evaluation season:

1. fit team pass-attempt, rush-attempt, and target budgets only on prior seasons;
2. fit player passing-attempt, rushing-attempt, and target scores on prior-season rows with
   `participated = 1`;
3. estimate every test-roster player's participation probability from shifted
   `prior_participated_avg5`, clipped to `[0.05, 0.99]`;
4. for a settled active player, condition that player's participation weight to one while leaving
   teammate weights at their pregame estimates, then allocate the shared team budget;
5. derive completions, passing yards, receptions, rushing yards, and receiving yards from the new
   opportunities and separately trained conditional efficiency rates;
6. test fixed 25%, 50%, 75%, and 100% blends of the active-only conditional incumbent and the new
   active-roster budget candidate.

Prop lines, prices, outcomes from the evaluation game, current-week participation, and unstamped
injury strings are forbidden features. `participated` may define the settlement-aligned training
and evaluation population only.

## Chronology and gates

- Train through 2022; select one fixed blend per market on 2023.
- Require both lower MAE and lower RMSE for selection.
- Freeze the blend and require both metrics to improve in 2024 confirmation.
- Open 2025 once, report game-clustered MAE uncertainty and four chronological segments.
- A production candidate must improve 2025 MAE and RMSE, have a game-clustered MAE interval below
  zero, avoid a material bias/underprediction regression, improve every chronological segment, and
  pass CRPS/NLL/coverage gates.
- Passing completions may never exceed attempts; projections may never be negative.
- Passing-family product behavior remains coupled. A statistically passing point head is not
  shippable if a same-board replay worsens the joint QB decision surface.

This tournament is research-only. It does not authorize a runtime artifact, release bump, grade,
stake, threshold, or member-facing change.
