# NFL player props current-week availability-role result

Date: 2026-10-08  
Starting production base: `8756604e952879faa21ae886811bdc169ba725c8`  
Decision: reject every candidate for current-week production

## Bottom line

The owner rejected a shadow-only wait and asked for an evidence-based current-week decision. This
audit therefore tested point-in-time injury/practice status and teammate vacated-role features now,
using 2016-2023 for training, 2024 for selection, 2025 for confirmation, and the exact immutable 2026
Weeks 1-4 locked scopes for the final decision.

The availability layer improved several independent heads, especially Rushing Attempts, but no
market passed the frozen immediate-use gates against the current published prediction. No stored
projection, probability, grade, stake, lock, writer, reader, release identifier, or member surface
changed. The answer for the current week is to retain the current published model rather than ship a
candidate that the exact current-season replay shows is less accurate.

## Data and method

The checksum-pinned nflverse injury archive contains 56,830 unique player-week reports from
2016-2026. It provides final Out/Doubtful/Questionable designations and DNP/Limited/Full practice
participation. The candidate keeps missing evidence distinct from healthy and derives same-team,
same-role teammate opportunity that is plausibly vacated according to strictly prior carry, target,
pass-attempt, and snap shares.

The selected candidates were market-free:

- Passing Attempts: combined availability, Poisson direct model;
- Passing Completions: practice availability, Poisson direct model;
- Passing Yards: combined availability, absolute-error direct model;
- Rushing Attempts and Rushing Yards: 75% practice-aware hierarchy;
- Receptions: 75% combined-availability hierarchy; and
- Receiving Yards: no candidate survived 2025 confirmation.

All six surviving candidates improved both MAE and RMSE over their historical reference in 2025.
Examples include Passing Yards MAE 66.63 to 60.31, Rushing Attempts 3.054 to 3.012, Rushing Yards
18.56 to 18.34, and Receptions 1.460 to 1.452. These historical improvements were not sufficient for
release; the exact current-season comparison was authoritative.

## Exact 2026 Weeks 1-4 decision set

The replay matched all 135 locked scopes from the six surviving markets across 46 games.

| Metric | Availability candidate | Locked independent | Published |
| --- | ---: | ---: | ---: |
| MAE | 14.960 | 15.178 | **12.229** |
| RMSE | 38.411 | 34.867 | **30.899** |
| Direction accuracy | 48.9% | 51.9% | **51.9%** |
| Brier score | 0.2915 | 0.3215 on exact raw subset | **0.2512** |

The game-clustered 95% interval for candidate-minus-published MAE was `[0.608, 5.291]`. The entire
interval is worse than zero, so this is not merely an inconclusive small-sample miss. Candidate
probability averaged 63.2% on outcomes that won 51.9%, while the market probability's calibration
gap was 1.3 percentage points.

### Market detail

- Rushing Attempts made the strongest independent progress: MAE 3.742 to 2.875 and RMSE 4.397 to
  3.249 versus the old independent point. It still missed the published MAE gate, 2.875 versus
  2.820, on only 13 scopes. Direction was unchanged at 53.8%.
- Rushing Yards improved old-independent MAE 17.566 to 16.802 but trailed published 16.304.
- Receptions improved old-independent MAE 2.099 to 1.950 but trailed published 1.836.
- Passing Completions improved the old independent point but remained materially worse than the
  published point. Passing Attempts and Passing Yards regressed versus both relevant current-season
  benchmarks.
- Receiving Yards failed before the 2026 replay because its 2025 MAE regressed.

No market improved both MAE and RMSE over the published point with non-regressing direction and the
required clustered interval. No production proposal is authorized.

## Current-week decision

Do not replace this week's published projections with the availability candidate. That would knowingly
trade away exact current-season point accuracy. Availability and role transfer are real missing inputs,
but they do not by themselves solve the independent model.

The next immediate independent-model target is current-season rolling role adaptation: use only prior
weeks to update player/team opportunity shares, evaluate each later week in rolling origin, and freeze
the Week 5 update before outcomes. That is a separate candidate and must not be selected by tuning on
the failed aggregate result above. Market prices remain excluded from its point forecast.

