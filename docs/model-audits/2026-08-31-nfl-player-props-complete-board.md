# NFL Player Props complete-board audit

Date: 2026-08-31  
Starting production base: `eaaad39470f7da8c7abd78c8c596aaa33aa64612`  
Predeclaration: `docs/model-audits/2026-08-31-nfl-player-props-complete-board-predeclaration.md`

## Result

The candidate repairs the observed underpopulation without weakening the actionable boundary. The no-write capture at `2026-08-31T20:33:28.762Z` covered all 16 scheduled Week 1 games and all 32 quarterbacks with a current passing-yards offer.

| Measure | Stored production snapshot | Candidate no-write board |
| --- | ---: | ---: |
| Completed/internal rows | 344 | 1,024 |
| Best Angle | 1 | 0 |
| Lean | 16 | 19 |
| Watchlist | 50 | 52 |
| No Play | 277 | 898 |
| Held | 20 | 55 |
| Actionable | 17 | 19 |

The candidate contained 613 newly visible No Play rows awaiting an independent exact-line confirmation. Those rows cannot reach Watchlist, Lean, Best Angle, tracking, or stakes. The passing-yards board expanded to 116 side/price reads for 32 quarterbacks across all 16 games; all remain No Play under the existing non-actionable passing-yards lane.

The expanded Sharp pagination changed four matching stored grades under the unchanged policy: Hunter Henry receptions Under No Play→Watchlist, Rashid Shaheed receiving yards Under Watchlist→Lean, Christian McCaffrey receptions Under No Play→Watchlist, and Puka Nacua receptions Under Best Angle→Lean. One newly visible independently confirmed outcome qualified under the existing lane: Jaxon Smith-Njigba receiving yards Under 84.5 at Bovada -115, Lean, 57.83% final probability, +2.87pp edge, and +8.11% exact-price EV. This is three matching-row promotions, one matching-row demotion, one newly visible Lean, and net +2 actionable rows. No grade threshold, projection, probability model, calibration, stake, lock, or tracking rule changed.

## Coverage and load

- BALLDONTLIE: 36 bounded calls; SharpAPI: 8 bounded calls; total 44, below the existing 48-call collection ceiling.
- 16,405 normalized observations, 7,558 exact offers, 256 feature rows, 1,024 runtime decisions.
- Market/player coverage: anytime TD 256/256; passing yards 116/32; receiving yards 284/85; receptions 172/80; rushing yards 196/53.
- SharpAPI still reported `has_more=true` after the established eight-page ceiling, so `SHARPAPI_PROPS_TRUNCATED_BY_PAGE_BUDGET` remains a truthful health diagnostic. The repair does not claim the full upstream catalog is exhausted. BALLDONTLIE already supplies the complete 32-quarterback passing-yards scope that motivated this incident, and the visible No Play fallback prevents unmatched exact lines from disappearing.
- The change adds no table, cron, writer, lease, provider class, schedule, or mutation. The existing `nfl-forward-evidence` owner remains authoritative.

## Release disposition

Model and calibration artifacts remain unchanged. Provider observation r5 adds bounded offset fallback; decision/runtime r4 publishes complete one-book exact reads only as No Play; board r7, member r10, and writer r11 carry the new provenance. The existing action thresholds, partial-response continuity, T-60 freeze, tracking, and settlement contracts remain intact.
