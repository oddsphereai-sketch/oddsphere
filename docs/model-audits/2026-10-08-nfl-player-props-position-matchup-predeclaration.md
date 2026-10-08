# NFL player props position-matchup predeclaration

## Hypothesis

Team-level opponent allowance is too broad for player props. A defense can be strong against wide
receivers while conceding to tight ends or running backs, and quarterback rushing is distinct from
running-back rushing. The available official outcomes support a leakage-safe position bucket even
without proprietary coverage assignments.

The hypothesis is that actual-opponent, position-bucket allowance histories improve active-player
forecasts when added to a regularized market-specific model.

## Frozen candidate

- Aggregate completed-game opportunities and outcomes allowed by each defense to `QB`, `RB/FB`,
  `WR`, and `TE` buckets.
- For passing attempts, completions, passing yards, rushing attempts, rushing yards, targets,
  receptions, and receiving yards, create three-game, five-game, and EWM defensive histories shifted
  by one completed game.
- Join the shifted state to the current offense/player using the actual opponent and the player's
  position bucket.
- Correct both existing base and advanced opponent identities in the candidate frame.
- Fit active/settled rows only with three frozen model families: regularized shallow squared-error
  HGB, regularized shallow absolute-error HGB, and a stable Extra Trees model.
- Test fixed 25%, 50%, 75%, and 100% blends against the current released point head.

The reference reproduces the released full-family point recipe for six markets and the released 25%
legacy / 75% settlement-aligned Rushing Attempts head. This avoids claiming improvement against a
stale or weaker comparator.

No prop line, price, market probability, current-game outcome, realized current-game participation,
or unstamped injury string is a feature. Position bucket is roster-known; evaluation participation
defines only the wager-settlement population.

## Chronology and gates

- Select on 2023 when both MAE and RMSE improve; confirm unchanged on 2024 under the same rule.
- Open 2025 once and require improved MAE/RMSE, game-clustered 95% MAE delta below zero, no material
  bias/underprediction regression, and improvement in all four chronological segments.
- Require lower CRPS, NLL no worse than 0.5%, and acceptable 80%/90% interval coverage.
- Preserve nonnegative projections and evaluate all seven supported markets separately.

This public-data position bucket is not presented as cornerback/receiver assignment, route, coverage,
box-count, linebacker, or offensive-line tracking. If it fails, the result will narrow the missing
dependency rather than relabel coarse team data as an individual matchup model.
