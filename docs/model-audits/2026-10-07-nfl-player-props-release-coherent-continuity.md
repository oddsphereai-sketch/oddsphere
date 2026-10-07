# NFL player props release-coherent continuity hotfix

Date: 2026-10-07  
Starting production base: `8506cdc8539ee4edd3280bd8d4d8ec34550748d5`

## Production finding

The first natural October 7 receptions-release publication succeeded with 827
member rows, zero projection/side contradictions, and the intended five
actionables. A final SELECT-only release-mix audit then found one unlocked
Darnell Washington Anytime TD row retained from the preceding snapshot after
the provider omitted that still-fresh outcome. Its model and values were valid
and unchanged, but its decision release remained September 29 while the other
826 member rows used the October 7 decision release. The complete internal
board also retained one alternate Ted Hurst Receiving Yards row from the
preceding decision release; it was not selected into the member board.

This was a live-acceptance failure under the mixed-release rollback gate. The
release was not declared complete.

## Repair

The existing last-known-good continuity behavior remains in place. During only
the bounded September 29 to October 7 transition, a still-fresh unlocked row
from a market whose behavior did not change may retain its exact values while
being stamped into the current decision family. The model and calibration
identity remain truthful; ordinary unchanged markets receive the current
ordinary calibration stamp, while Anytime TD retains its own unchanged model
and calibration releases.

Receptions cannot use this bridge because its arbitration changed. It must be
freshly recomputed under the October 7 rule or remain absent until a current
offer returns. Any older or unknown decision release is also ineligible. Valid
locked rows remain byte-for-byte immutable and release-separated.

## Impact

For the captured production snapshot, the repair retains the two still-fresh
unchanged-market internal rows, including the one member-selected Anytime TD
row, changes zero predictions, probabilities, projections, prices, grades,
sides, stakes, actionables, or the 827-row member count, and reduces mixed
unlocked decision-release rows from two to zero. It adds no provider call,
database loop, schedule, writer, copy, label, or layout.

Focused lifecycle tests must prove both sides of the gate: the unchanged
Anytime TD row bridges with the current decision release, while a preceding-
release receptions row cannot bridge. Publication requires the full model-
change suite, current-main integration safety, protected PR checks, a new
member/lifecycle/writer/tracking release family, and live proof of zero mixed
unlocked releases after the next writer cycle.
