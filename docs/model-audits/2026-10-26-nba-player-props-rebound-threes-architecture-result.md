# NBA player props rebound/threes architecture r10 result

## Decision

Qualified for future unlocked NBA player-prop decisions. The broad eight-market rebuild was rejected: it fell from 55.86% to 55.63%, worsened MAE from 4.562 to 4.667, produced 16 actionable demotions against five promotions and created one side/projection disagreement. Only the independently supported Rebounds and Threes changes advance.

## Exact production-path replay

The replay uses all 2,646 settled, non-push decisions locked October 22-25 with their stored pre-lock market history and official outcomes.

| Measure | Active r9/r10 | Candidate r10/r11 |
| --- | ---: | ---: |
| All markets | 1,478-1,168 (55.86%) | 1,485-1,161 (56.12%) |
| All-market MAE | 4.562 | 4.499 |
| Rebounds | 188-179 (51.23%) | 192-175 (52.32%) |
| Rebounds MAE | 2.850 | 2.385 |
| Threes | 185-146 (55.89%) | 188-143 (56.80%) |
| Threes MAE | 1.126 | 1.137 |
| Existing actionable rows | 29-20 (59.18%) | 29-20 (59.18%) |

There are 107 side changes: 57 corrections and 50 harms. The two changed markets gain seven net correct directions. Rebound MAE improves materially; Threes accepts a 0.011 MAE increase for three net correct directions. Across the four slate dates, overall direction improves on October 22 and October 24 and is unchanged on October 23 and October 25. No individual-date all-market record worsens.

## Grade and board impact

Settled replay grade counts remain exactly eight Best Angles, 41 Leans, 44 Watchlists and 2,553 No Plays. There are two actionable promotions paired with two actionable demotions, for zero board flattening. None of the 49 previously actionable settled rows changes side, and their record remains 29-20.

The October 26 zero-write board comparison preserves 762/762 decisions and all eight markets. Grade counts remain eight Best Angles, 19 Leans, 26 Watchlists and 709 No Plays. There is one actionable promotion paired with one demotion, 14 side changes, zero non-finite/nonpositive forecasts and zero side/projection disagreements.

## Integrity

- database writes during audit: zero;
- member writes during audit: zero;
- locked rows mutated: zero;
- target book excluded from market confirmation: yes;
- provider requests, cadence, writer and `prediction_pipeline:nba` lease: unchanged;
- copy, labels and layout: unchanged.

This is historical evidence, not a promise of future results. The release improves the strongest reproducible weak-market candidate without claiming that a 56.12% replay guarantees the same forward hit rate.
