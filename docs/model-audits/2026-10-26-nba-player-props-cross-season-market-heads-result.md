# NBA player props selective cross-season market heads — result

## Scope

This release changes only future unlocked NBA player-prop decisions. Stored
locked projections, sides, probabilities, grades, prices, and evidence remain
immutable. It does not change member copy, navigation, the reader layout, the
writer cadence, the canonical market-line selection, or provider ingestion.

The candidate was evaluated market by market. The qualified cross-season model
bundle is used for Points, Assists, Points + Rebounds + Assists, and Rebounds +
Assists. The active r10 heads remain authoritative for Rebounds, Threes, Points
+ Rebounds, and Points + Assists because the alternatives either failed to
improve direction or harmed the actionable confirmation subset.

## Exact production-path replay

The replay uses all 2,646 settled, release-pure decisions locked October 22-25,
2026 and the exact pre-lock observations available to the runtime.

| Measure | Active r10 | Candidate r11 |
| --- | ---: | ---: |
| Direction | 1,485-1,161 (56.12%) | 1,496-1,150 (56.54%) |
| Mean absolute error | 4.499 | 4.264 |
| Best Angles | 8 | 8 |
| Leans | 41 | 43 |
| Watchlists | 44 | 46 |
| No Plays | 2,553 | 2,549 |

The candidate makes 273 side changes: 142 corrections and 131 harms. It pairs
13 actionable promotions with 11 demotions, so the board gains two actionables
instead of flattening.

| Market | Active | Candidate | Active MAE | Candidate MAE |
| --- | ---: | ---: | ---: | ---: |
| Points | 218-172 (55.90%) | 219-171 (56.15%) | 5.760 | 5.290 |
| Assists | 196-138 (58.68%) | 197-137 (58.98%) | 1.594 | 1.484 |
| PRA | 172-132 (56.58%) | 174-130 (57.24%) | 8.180 | 7.194 |
| Rebounds + Assists | 147-129 (53.26%) | 154-122 (55.80%) | 3.426 | 3.060 |

Points actionables improve from 18-13 to 22-8. PRA actionables improve from
2-3 to 5-2. The existing Assists calibration remains small (candidate 4-2), so
the release does not claim a settled 60% guarantee.

## Coherence and rollback

The serialized projection is forced to remain on the selected side after
three-decimal rounding. The exact replay has zero projection/side
disagreements. Runtime scoring remains deterministic and target-book excluded.

Rollback is one artifact/decision release: restore r10/r11 and rerun the sole
NBA private writer under the existing `prediction_pipeline:nba` lease. Never
rewrite locked rows during rollback.
