# NFL two-source flow boundary result

Date: 2026-10-25

Status: qualified future-unlocked production release

## Outcome

The candidate is additive to r34. It does not replace the existing material-flow authority. The
new path is considered only when that authority is unavailable and requires a persistent,
unreversed target-excluded named-book move plus two fresh independent agreeing flows: Playbook
consensus and a non-owning SharpAPI sportsbook. Each flow must show at least a two percentage-point
money-minus-ticket gap. Any opposing flow vetoes the read.

An outright winner may change only when the median no-vig Moneyline across at least three fresh,
distinct, target-excluded sportsbook families crosses 50% in the same direction. Otherwise the
independent winner is preserved and the categorical margin may move inside the interval between
zero and the target-excluded Spread boundary. Total remains frozen.

## Evidence

The checksum-matched 74-game completed replay is exactly unchanged versus the deployed r34 reader:

- winner: 50-23-1 (68.49%);
- Spread: 41-31-2 (56.94%);
- Spread +3: 51-23 (68.92%);
- Spread +6: 56-17-1 (76.71%);
- exact-price actionables: 34-17, +14.07 units;
- team-score MAE: 6.902; margin MAE: 8.899; Total MAE: 10.309;
- promotions: zero; demotions: zero; side changes: zero; Total changes: zero.

That neutral replay is intentional: no completed row in the frozen cohort entered the newly added
rare state. The immutable October 25 loss examples do:

- Cincinnati at Baltimore enters `outcome_correction` because the named-book move, Playbook flow,
  non-owning DraftKings flow, and target-excluded Moneyline majority all select Cincinnati;
- San Francisco at Atlanta enters `value_resistance`: San Francisco remains the projected winner,
  while the categorical margin moves to Atlanta's side of +2.5. It is not an automatic winner flip.

These two games were diagnosed only after their immutable locks and therefore are supporting defect
reproductions, not a pristine holdout or a claimed accuracy percentage. The release is justified as
a narrowly gated missing-state repair that is behavior-neutral on the completed replay and cannot
flatten the historical board.

The read-only Week 7 production-input rehearsal contains 14 games and 42 markets. It preserves all
17 actionables (15 Best Angles and two Leans), produces zero promotions, zero demotions, zero side
changes, zero probability changes, and zero health holds. This also proves that the immutable
Baltimore and San Francisco locks remain unchanged even though the regression harness reproduces
the corrected future behavior from their stored evidence.

## Safety and rollback

Only unlocked and future rows may use r35/r30/r29/r38. Stored r34 and earlier locks retain their
exact payload, reader precedence, prices, projections, grades, and tracking identity. The shared
`prediction_pipeline:nfl` lease, sole writer, exact-price economics, thresholds, stakes, and Total
reader are unchanged.

Rollback restores r34/r29/r28/r37/r66/r49/r41 for future unlocked rows only; it must not rewrite any
r35 lock.
