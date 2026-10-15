# NFL player props Rushing Yards position-hybrid predeclaration

Date: 2026-10-15
Status: frozen before executing the hybrid replay; research only

## Why this follow-up is allowed

The preceding team-factorization candidate was selected and confirmed before the exact 2026 replay.
It improved aggregate MAE/RMSE in 2024, 2025, and Weeks 1–5 of 2026, but failed offered-line
direction because two low-line quarterbacks changed from correct Unders to incorrect Overs. That
opened result may motivate a new development candidate, but it is not a fresh holdout and will not
be represented as one.

The failure is position-specific. Quarterback rushing contains scrambles, designed runs, sacks and
kneel-down accounting that do not behave like backfield/receiver allocation. The non-QB
team-carry × complete-roster share × conditional-YPC component improved point accuracy without a
single offered-line direction change. This follow-up tests one finite position boundary rather than
retuning the selected factorized model.

## Frozen candidate

- QB: retain the exact released independent Rushing Yards projection.
- RB/FB/WR: use the already frozen `75%` attempt-weighted team-factorized blend from the preceding
  audit. The football-only component predicts one team carry budget, normalizes expected player
  share across the supported pregame rushing roster, and predicts conditional YPC. No line, price,
  book, consensus, movement, outcome, or market-implied team value enters the candidate.
- No weight, threshold, low-line cutoff, or player exception is selectable. Unsupported positions
  remain on the released projection. TE is currently unsupported by the frozen rushing-roster
  artifact and therefore stays on the release rather than being silently generalized.

The QB rule is a separate workload/yardage treatment by design: the factorized non-QB allocation
does not gain authority over QB rushing until a dedicated QB scramble/designed-run/kneel model is
predeclared and passes on later evidence. This release does not infer which individual QB play type
will occur.

## Chronology and gates

The source projections retain their original chronology: train strictly before the evaluated
season, select on 2024, confirm on 2025, then inspect the exact immutable 2026 Weeks 1–5 offers.
The hybrid has no fitted parameter, so there is no new outcome-trained state.

The candidate must:

1. improve aggregate and non-QB MAE/RMSE in 2024 and 2025 while leaving every QB projection exact;
2. keep aggregate bias within one yard of the released head;
3. have a below-zero 2025 game-clustered MAE interval and no adverse fixed 2025 segment;
4. on the exact 2026 offered replay, improve aggregate and non-QB MAE/RMSE, leave QB MAE/RMSE and
   direction exact, and not worsen aggregate or non-QB direction; and
5. produce zero mutation of every stored locked payload.

Passing opens production-parity and probability/grade/board-impact work. It does not authorize a
live cutover. Before release, the same-input board review must report changed projections,
probabilities, sides, promotions, demotions, actionables, market mix, and exact-price return; every
actionable demotion requires a tested promotion path. The runtime must use the existing sole NFL
player-props writer and `prediction_pipeline:nfl` lease, bump all affected immutable release IDs,
and preserve legacy reader precedence.
