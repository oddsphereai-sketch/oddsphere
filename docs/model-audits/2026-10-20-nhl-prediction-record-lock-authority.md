# NHL prediction-record lock authority

Date: 2026-10-20
Scope: NHL pregame lock classification and write authority only

## Production finding

All 12 NHL public prediction rows for the four-game October 19 slate were
locked before puck drop. The generic pregame sweep nevertheless emitted four
`game_started_without_lock` criticals after those games started because it
classified NHL through `game_predictions`. The current NHL writer publishes
only the authoritative three-market `prediction_records` tuple, so no
`game_predictions` rows existed for those games.

## Repair

NHL now follows its actual publication contract in both directions:

- classification requires exactly one current-release Moneyline, Spread, and
  Total row, all with non-null locks;
- the T-60 transition stamps only unlocked rows in that exact current release;
- all three rows must transition together or the sweep fails closed; and
- the audit records the current model and explicit lock-authority releases.

Partial, duplicate, mixed-release, and mixed lock-state tuples remain
unresolved. Existing locked records are neither updated nor reinterpreted.

## Same-input board impact

- Forecast sides changed: 0
- Probabilities changed: 0
- Projected scores changed: 0
- Grades or stakes changed: 0
- Market-reader behavior changed: 0
- Existing locked records changed: 0
- Tracking eligibility changed: 0
- False post-start criticals removed: 4 on the October 19 replay

## Releases and rollback

Lock authority:
`nhl_prediction_record_lock_authority_2026_10_20_r1_current_three_market_tuple`.

Lock coherence:
`nhl_lock_coherence_2026_10_20_r2_prediction_record_authority`.

Roll back the helper, route branches, and coherence identifier together if an
exact current three-market tuple cannot classify or lock atomically. Never
roll back by changing, deleting, or reconstructing a stored locked row.
