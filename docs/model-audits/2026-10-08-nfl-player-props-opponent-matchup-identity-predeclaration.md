# NFL player props opponent-matchup identity predeclaration

## Confirmed defect

The historical feature builder does not attach the defense named by its feature contract. It first
converts each offense-team game into allowed metrics keyed by the defense, correctly shifts those
metrics, and then merges them back on the player's **own team**. The columns named
`matchup_opponent_allowed_*` therefore describe the player's own defense rather than the defense the
player will face.

This was reproduced on an untouched real-history row. For Arizona at Miami in 2024 Week 8, the
attached pregame `matchup_opponent_allowed_pass_yards_per_attempt_ewm` was `8.2287009367`, exactly
Arizona's own-defense history. Miami's actual pregame allowed value was `6.0347060760`.

The defect is present in the common builder consumed by the full-family trainer and research
tournaments. It does not authorize rewriting any existing artifact, stored projection, lock, grade,
price, stake, or member record.

## Frozen candidate

The candidate changes one semantic only: after computing strictly shifted defensive histories keyed
by the defense, it joins the current offense row to the defense named by that row's `opponent` field.
Own-team histories, weather, base player-role inputs, model families, recipes, eligibility,
settlement population, calibration method, and cross-market quarterback equations remain unchanged.

The legacy join remains callable so the released artifact and prior tournament results stay exactly
reproducible. New research must request the corrected opponent identity explicitly. Lines, prices,
market probabilities, evaluation-game outcomes, realized participation, and unstamped injury text
are forbidden model inputs.

## Chronology and gates

- Fit only on seasons before the evaluation season.
- Compare legacy and corrected identities on settlement-aligned rows with official participation.
- Select a fixed legacy/corrected blend per market on 2023 only when both MAE and RMSE improve.
- Confirm that frozen blend on 2024 only when both metrics improve.
- Open 2025 once and report MAE, RMSE, bias, underprediction, four chronological segments,
  game-clustered uncertainty, CRPS, NLL, and 80%/90% coverage.
- A production candidate must improve 2025 MAE and RMSE; have a game-clustered MAE interval below
  zero; avoid material bias or underprediction regression; improve all four chronological segments;
  and pass the existing distribution gates.
- Passing completions may not exceed attempts; no projection may be negative.
- Passing attempts can remain unchanged because its frozen full-family recipe uses only base
  features. That outcome is evidence that workload/role modeling still needs a separate candidate,
  not permission to force a matchup effect into volume.

Even a passing historical candidate remains shadow-only until the corrected artifact is replayed on
the complete 2026 locked board by release and lock timestamp. Market reading remains a separate
observer and may not be blended into this independent projection tournament.
