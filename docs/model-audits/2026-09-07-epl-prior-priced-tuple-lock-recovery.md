# EPL prior-priced-tuple lock recovery — 2026-09-07

## Scope

This release corrects EPL tracking completeness when an exact market that was
already published with a verified price disappears from the provider at T-60.
It does not change a prediction, probability, projection, side, price
selection, Play Grade, stake, provider budget, or member-reader hierarchy.

## Production evidence

On the September 6 Manchester United at Everton fixture (`game_id=58439`), all
four current-authority r18/v23 prediction rows existed before kickoff. Match
Result, Double Chance, and Total locked and graded. BTTS remained unlocked and
therefore did not enter Tracking.

- Published BTTS tuple: Yes, Watchlist, -178.
- Published capture: 2026-09-06 09:37:56Z.
- Scheduled T-60 lock: 2026-09-06 12:00:00Z.
- Provider BTTS history: 12 two-sided rows across six sportsbooks, all captured
  at 09:37:52Z; no later BTTS quote was returned.
- The targeted EPL lock ran successfully every five minutes. At 12:00Z it
  wrote the other due markets, then continued retrying through the pregame
  window. The general EPL refreshes were explicitly partial because current
  selected-price and outcome-board coverage was incomplete.

The writer's previous fail-closed branch preserved the last priced BTTS tuple
instead of overwriting it with a held row, but also left that tuple unlocked.
That combination protected the price while silently omitting the prediction
from official tracking.

## Correction

EPL now opts into the shared, already-deployed soccer lock capability used by
UCL: when a due proposed row is held only because its current coherent price is
missing, and the same current-authority row previously had a coherent price,
the writer advances `locked_at` on that prior row. It does not rewrite any
economic or model field. Rows that never had a verified selected-side price do
not qualify and remain held.

The policy is identified as
`epl_tracking_lock_2026_09_07_r1_prior_priced_tuple_fallback`. The lock cron
counts `priorTuplesLocked` in `records_updated` and exposes both the count and
policy identifier in its details, preventing a successful fallback from being
misreported as a zero-write run.

## Safety and board impact

- Prediction flips: 0.
- Actionable promotions: 0.
- Actionable demotions: 0.
- Grade changes: 0.
- Stake changes: 0.
- Current locked-row mutations: 0; the historical September 6 omission is not
  retroactively fabricated or graded.
- Writer ownership and lease: unchanged; both EPL writers retain the shared
  sport-scoped `prediction_pipeline` lease.

Focused EPL and UCL contract tests protect the independent opt-ins and verify
that fallback locking updates only `locked_at` on the previously priced tuple.
