# NFL dual-independent cross-market arbitration predeclaration

Date: 2026-10-26

Status: rejected before implementation; no production authority.

## Rejection

The owner rejected this candidate on 2026-10-26 because it reduced whole-game interpretation to a
new conjunction of qualifying conditions. Although the proposed route would have reproduced the
reported Dallas-at-Philadelphia conflict, it would not have closed the general gap in which captured
price, movement, split, roster, and cross-market evidence disappears from the decision whenever one
preferred authority path is unavailable. No production code, release identifier, prediction, grade,
stake, or stored record was changed by this candidate.

## Defect

The released r34 model can leave the exact-stat score as the final side when named-book Moneyline
history is incomplete, even if all of the following disagree with it:

- the separately collected player-aware team-score projection;
- a fresh target-book-excluded Moneyline consensus across at least three book families; and
- a fresh target-book-excluded Spread consensus across at least three book families.

Dallas at Philadelphia exposed this unavailable-state gap. The exact-stat score favors Philadelphia
by 2.38, the player-aware score favors Dallas by 5.70, and the target-excluded market makes Dallas
the outright winner and the -4.5 cover side. The released three-state reader returns
`no_stable_named_moneyline_direction`, applies zero side correction, and publishes both Philadelphia
sides as Best Angles.

## Candidate

Only when the released reader would otherwise be unavailable for missing stable named Moneyline
history, the candidate may use the player-aware score tuple as categorical side authority when:

1. its winner opposes the exact-stat winner;
2. its Spread side at the fresh target-excluded median line opposes the exact-stat Spread side;
3. fresh target-excluded Moneyline consensus agrees with the player-aware winner;
4. fresh target-excluded Spread consensus agrees with the player-aware Spread side; and
5. all existing target-family exclusion, freshness, identity, and minimum-book requirements pass.

The player-aware margin becomes the coherent margin center; no scalar market weight is introduced.
Total remains owned by the released Total reader. The route cannot activate from favorite status,
public percentages, or one sportsbook alone.

## Frozen gates

- Compare against the released r34/r33/r42 reader on the same release-pure settled replay.
- Moneyline and Spread direction must not regress; actionable units must not regress.
- Report every side change, correction, harm, promotion, demotion, and board-count change.
- Reject a candidate that only demotes actionables without a tested promotion path.
- Preserve every locked payload byte-for-byte; apply only to future unlocked writes.
- Run the focused NFL production suite and `npm run verify:model-change`.
- Publish only from a clean latest-main descendant after integration-safety verification.

## Rollback

Restore the r34/r33/r42/r39 release family and remove this missing-state route for future unlocked
games. Existing locked records remain immutable under either version.
