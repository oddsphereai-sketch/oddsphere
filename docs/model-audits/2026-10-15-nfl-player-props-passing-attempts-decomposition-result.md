# NFL Player Props Passing Attempts decomposition result

Date: 2026-10-15
Status: rejected research candidate; production unchanged

## Decision

Reject the factorized Passing Attempts head. It improves the prior-season selection and
confirmation windows but does not improve the completed 2026 season. It will not enter the
probability, grade, board, writer, or member paths.

The incumbent remains a market-free team pass-budget × expected lead-passer-share forecast. The
target line, price, sportsbook, consensus, movement, spread, and total were absent from every
candidate point feature.

## Frozen candidate

The challenger separately forecasts:

1. offensive plays;
2. dropback rate from shifted xPass/pass-over-expected, pace, team style, opponent, pressure,
   weather, and down-state history;
3. credited pass attempts per dropback from shifted sack/scramble/pressure context; and
4. the expected lead passer's share from prior role, depth, and availability evidence.

The frozen 75% challenger / 25% incumbent mixture improved 2024 MAE/RMSE from
`6.72470 / 8.95568` to `6.68958 / 8.89800` and improved untouched 2025 MAE/RMSE from
`6.85638 / 8.68379` to `6.78402 / 8.60877`.

## Completed 2026 result

The broad 186-row QB diagnostic includes role-changing backups and is retained only as a warning,
not treated as the prop-offer population. Twenty-five rows had fewer than ten actual attempts,
often after a backup appearance or in-game quarterback change; both the incumbent and challenger
necessarily miss those full-game-role violations by roughly a full starter workload.

On the 158 postgame lead-passer evaluation rows across 79 games, the incumbent records
`6.26843 / 8.23206` MAE/RMSE. The frozen candidate records `6.30202 / 8.24121`, so it fails both
point gates. Its game-clustered candidate-minus-incumbent MAE interval is
`[-0.10838, 0.17180]`: the aggregate is harmful and uncertainty does not establish a gain. The use
of postgame lead passer is an evaluation denominator only and never an inference feature.

On the 16 immutable offered Passing Attempts thresholds, the incumbent records
`8.94463 / 11.26457` MAE/RMSE and 56.25% direction. The candidate records
`8.93881 / 11.25663` and 62.50% direction. One corrected side in sixteen offers is insufficient to
override the larger current-season point failure. The descriptive offered-line MAE/RMSE is
`9.06250 / 11.44552`, so the incumbent already beats that small market-line sample on point error.

## Failure diagnosis

The factorized team components are approximately unbiased but weakly identify one game's realized
script. On 2026 lead-passer games, predicted offensive plays have about `6.89` MAE and only `0.15`
correlation with realized plays; predicted dropback rate has about `0.17` correlation. The final
team-attempt budget has about `6.25` MAE and `0.32` correlation. Separating the equations does not
create information about the realized lead/deficit sequence, overtime, or an in-game quarterback
exit.

This also explains why a generic opponent pass-attempt allowance or another raw matchup multiplier
is unlikely to be the missing answer. Passing Attempts needs an explicit pregame game-state
distribution and an availability/role-survival process, not more weight on the same rolling means.

## Next Passing Attempts candidate

Continue with a materially different hierarchical simulation:

- a market-free pregame scoring/possession state distribution;
- team-specific pass-over-expected effects by simulated score/time state;
- drive/play opportunity rather than one direct game count;
- explicit sack/scramble conversion; and
- a separate pregame starter/full-game-role survival probability so in-game role failure enters
  the count distribution rather than contaminating the full-game mean model.

That candidate must be trained and evaluated with timestamp-equivalent inputs. If a historical/live
source cannot reproduce a feature, the feature remains unavailable rather than being inferred from
the prop market.

## Safety

This tournament is local and research-only. It wrote no prediction, probability, grade, stake,
member row, lock, tracking row, or market observation. No release identifier changes. Existing
locked records remain byte-for-byte authoritative.
