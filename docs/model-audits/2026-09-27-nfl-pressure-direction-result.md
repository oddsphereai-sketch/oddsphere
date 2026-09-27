# NFL pressure-direction margin result

Date: 2026-09-27

Release: `nfl_pressure_direction_margin_2026_09_27_r1`

## Chronological validation

The fixed pressure/turnover direction head was selected on 543 games from
2022-2023 and then evaluated without retuning on 544 games from 2024-2025.

| Cohort | Games | Market margin MAE | Candidate margin MAE | Spread direction |
| --- | ---: | ---: | ---: | ---: |
| Selection (2022-2023) | 543 | 9.3223 | 9.3098 | 54.72% |
| Confirmation (2024-2025) | 544 | 9.6664 | 9.6378 | 54.92% |

Candidate margin MAE also did not regress in any individual evaluated season.
Winner accuracy remained identical to the market center in both pooled periods,
the correction moved in both directions, and the coherent-score audit found
zero contradictions. These are small but repeatable point-error gains; they do
not establish a guaranteed win rate and prospective results remain separated by
this exact release and lock timestamp.

The companion quarterback Total residual passed the historical tournament, but
it is not activated by this release because its exact current-slate runtime
input parity has not yet been proven. NFL Total model behavior therefore remains
unchanged rather than promoting a historically promising but operationally
unverified head.

## Exact current-board replay

The final exact production-pipeline replay retained 16 games and all 48
Moneyline, Spread, and Total forecasts. Ten already-locked games were preserved
unchanged. Across the live release board, actionables moved from 16 to 17 with
one promotion, one within-actionable demotion, and zero Moneyline, Spread, or
Total side changes. Grade counts moved from 5 Best Angles / 11 Leans / 6
Watchlists / 26 No Plays to 5 / 12 / 5 / 26, so the candidate did not flatten
the board.

The pressure correction averaged 0.431 absolute points on the current slate,
reached 1.168 points at most, and was positive for eight games and negative for
eight games. The complete score-to-winner-to-spread coherence assertion passed.
No grade quota, threshold change, copy, label, layout, stake, or lock rewrite is
part of the release.

## Runtime, tracking, and rollback

The immutable runtime artifact is evaluated in the existing writer after one
already-required current-season-state read. Its probability and applied margin
correction are stamped into the weekly raw signal; the complete r21/r23/r43
publication and r15/r11/r12/r13 tracking family advances together. The preceding
r20 snapshot remains a bounded availability predecessor only and cannot be
counted as current-release performance.

Roll back future unlocked publication to the preceding r20 release family on
any mixed release, artifact/state mismatch, missing game or market, locked-row
mutation, coherence failure, unexpected actionable collapse, writer/lease
overlap, timeout growth, snapshot failure, or member/tracking disagreement.
Preserve every immutable locked row and all release-stamped evidence.
