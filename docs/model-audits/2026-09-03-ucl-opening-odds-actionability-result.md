# UCL historical opening-odds actionability result

## Decision

Retain the forecast-only all-No-Play grade policy. The official Ball Don't Lie
UCL historical opening endpoint has adequate untouched-holdout Match Result
coverage but zero calibration coverage under the fixed chronological split.
No threshold can be selected without using the holdout for training.

## Frozen protocol result

- Cohort remained exactly 185 training / 126 calibration / 63 untouched
  holdout; cutoff `2026-01-28T20:00:00.000Z`.
- Holdout request: 292 raw opening rows, 54/63 matches with at least one
  complete named-vendor three-way board, 85.71% coverage.
- Holdout vendors: Caesars, DraftKings, Fanatics, FanDuel, and Polymarket.
- Calibration request: 0 raw opening rows, 0/126 quoted matches, 0% coverage.
- Required coverage was at least 80% in both blocks and at least 40 holdout
  matches. The calibration gate failed before threshold selection.

No calibration candidate was selected and the holdout odds were not used to
tune a floor. The corrected evaluator stops before fetching team-stat features
or materializing any holdout win/loss/profit when this coverage gate fails.
Exact-price EV/ROI threshold evaluation therefore has no valid play set. The
result is 0 promotions, 0 demotions, and 0 side changes.

| Board | Best Angle | Lean | Watchlist | No Play |
|---|---:|---:|---:|---:|
| Untouched holdout before | 0 | 0 | 0 | 252 |
| Untouched holdout after | 0 | 0 | 0 | 252 |

The 252 rows are 63 matches times Match Result, Double Chance, Total, and BTTS.
Only Match Result had a potentially relevant historical endpoint; the other
three markets remain No Play by source coverage. The evaluated opening vendor
and exact quote remain downstream of the UCL-owned forecast and cannot change
its side or probability.
