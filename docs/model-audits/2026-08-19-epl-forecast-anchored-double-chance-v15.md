# EPL forecast-anchored Double Chance — r10 / v15

## Decision

Double Chance now covers the primary Match Result prediction. A home forecast selects Home or Draw; an away forecast selects Away or Draw. If Draw becomes the most likely Match Result in a future slate, the headline pairs Draw with the more likely club.

The previous selector ranked Double Chance outcomes by model-versus-market edge. That could make a strong Arsenal forecast display Coventry or Draw as the Double Chance headline. The price discrepancy was valid secondary market context, but it was not a coherent prediction.

## Unchanged behavior

- Dixon–Coles probabilities, expected goals, and score distribution remain on the r8 probability core.
- Match Result, Total, and BTTS selections are unchanged.
- Draw remains a first-class probability and Match Result outcome, but no unvalidated draw override was added.
- Double Chance grades and thresholds are unchanged. All three outcome prices remain visible.
- Provider calls, caches, writer ownership, publication gates, locks, and costs are unchanged.

## Board impact and safety

The contemporaneous 10-match dry run changed four contradictory headlines: Coventry or Draw to Arsenal or Draw, Hull or Draw to Manchester United or Draw, Crystal Palace or Draw to Everton or Draw, and Fulham or Draw to Chelsea or Draw. Each changed row remains No Play. The complete 40-market distribution remains 3 Best Angles, 2 Leans, 6 Watchlists, and 29 No Plays.

Double Chance cannot receive an actionable Lean or Best Angle under the current EPL policy. Therefore this selection correction causes zero actionable promotions, zero actionable demotions, and no actionable board-count change. It changes only contradictory Double Chance headlines and their associated tracking identity.

The authoritative writer remains `app/api/cron/epl-daily-refresh/route.ts` under the shared `prediction_pipeline:soccer` lease. Rollback is r9/v14.

## Official tracking readiness

The active EPL writer emits Match Result, Double Chance, Total, and BTTS prediction records under `snapshot_json.competition=english_premier_league`. Official accuracy begins at the immutable T-60 lock: unlocked EPL rows are excluded both from grading and member aggregation. The scheduled shared tracking refresh now includes soccer, ingests finals only for the EPL external-id namespace, and delegates all four markets to the existing 90-minute soccer grader.

Member tracking maps EPL rows to a dedicated `Premier League` competition key while historical tournament rows remain under `World Cup`. Release deduplication prefers the locked EPL row and otherwise the latest pregame release, preventing an older superseded EPL selection from becoming the official result.
