# NFL player props role × volume × efficiency predeclaration

## Hypothesis

Correcting opponent identity improved several point heads but did not produce stable, material gains.
The released recipe still asks direct regressions to infer a team-game structure that can be stated
explicitly: player opportunities are the team's available volume multiplied by the player's recent
active role share, while yards and completions are conditional efficiencies on those opportunities.

The falsifiable hypothesis is that an explicit, settlement-aligned role × volume × efficiency
architecture will be more stable than the legacy direct heads after the full opponent-identity
correction.

## Frozen candidate families

All inputs are shifted by at least one completed game. For each evaluation season, fit or calculate
using prior seasons only.

1. **Active recency:** direct prior active-game EWM, three-game mean, five-game mean, and season mean
   for the target market.
2. **Role volume:** expected team pass attempts, rush attempts, or targets is the equal-weight mean
   of the offense's shifted EWM and the actual opponent defense's shifted allowed EWM. Player volume
   is that budget multiplied by the equal-weight mean of the player's shifted three-game and EWM
   role share.
3. **Conditional efficiency:** completions and yards are derived from the corresponding opportunity
   forecast multiplied by shifted active-game completion rate, yards per attempt, catch rate, yards
   per carry, or yards per target, with broad football-valid caps declared in code.
4. **Corrected direct model:** the released market recipe is refit on active rows with both base and
   advanced opponent identity corrected.
5. Test fixed 25%, 50%, 75%, and 100% blends of each family against the settlement-aligned legacy
   direct reference. Candidate names and weights are frozen before 2025 is opened.

Lines, odds, market probabilities, current-game results, realized current-game participation, and
unstamped injury strings are forbidden. No current-roster normalization may use knowledge of which
teammates actually played.

## Chronology and gates

- Select one candidate per market on 2023 only when both MAE and RMSE improve.
- Confirm that exact candidate on 2024 only when both improve.
- Open 2025 once; require lower MAE and RMSE, clustered 95% MAE delta below zero, no material bias
  or underprediction regression, and improvement in all four chronological segments.
- Require lower CRPS, NLL no worse than 0.5%, and acceptable 80%/90% coverage.
- Forecasts must be nonnegative. Derived completions cannot exceed derived attempts; receptions
  cannot exceed targets.
- Report all seven supported markets separately. A passing-family candidate cannot ship unless the
  joint quarterback equations remain coherent on the 2026 replay.

Any historical pass remains shadow-only until export under new release identifiers and a complete
2026 lock-timestamp replay of projection, side, probability, grade, promotions/demotions, and board
size. Market reading stays outside the independent projection.
