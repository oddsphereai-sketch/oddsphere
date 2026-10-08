# NFL player props full opponent-identity predeclaration

## Diagnosis after the first candidate

The advanced-matchup identity correction was selected and confirmed for several markets, but none
cleared all 2025 point and distribution gates. The correction was being layered on top of a second,
older instance of the same defect: all 21 foundational `prior_opponent_allowed_*` columns in the r1
historical dataset are also attached on the player's own-team key.

On the same untouched Arizona at Miami 2024 Week 8 example, the stored
`prior_opponent_allowed_passing_yards_ewm` is `276.2957722`, exactly Arizona's defensive history.
Miami's actual pregame value is `163.1142889`. This explains why fixing only the advanced block left
passing-attempt volume untouched and forced every recipe to learn from internally contradictory
opponent identities.

## Frozen candidate

The full candidate corrects both layers together:

1. rebuild the 21 foundational shifted allowed-volume columns against the actual opponent defense;
2. attach the 42 advanced rate/efficiency columns against that same opponent;
3. retain every own-team, player-role, snap, weather, model-family, recipe, eligibility,
   settlement-population, and calibration rule;
4. refit from scratch using only seasons before each evaluation season; and
5. compare fixed 25%, 50%, 75%, and 100% blends against a fully legacy refit.

The r1 dataset and released runtime artifact remain unchanged and reproducible. This tournament
patches a research frame in memory; it does not overwrite the checksum-pinned historical file.
Lines, prices, market probabilities, evaluation-game outcomes, realized participation, and
unstamped injury text remain forbidden features.

## Chronology and acceptance gates

- Select on 2023 only when both MAE and RMSE improve.
- Confirm the frozen selection on 2024 only when both improve.
- Open 2025 once and require improved MAE/RMSE, a game-clustered MAE interval below zero, no
  material bias/underprediction regression, and improvement in all four chronological segments.
- Require lower CRPS, NLL no worse than 0.5%, and acceptable 80%/90% interval coverage.
- Preserve nonnegative projections and passing-completion/attempt coherence.
- Report every supported market separately. No aggregate can hide a failed prop family.

Passing history does not itself authorize production. A passing candidate must next be exported
under new dataset/model/calibration identifiers, replayed on every available 2026 locked scope by
lock timestamp, and evaluated for sides, probabilities, grades, promotions/demotions, and board
size. Market evidence remains a separate observer.
