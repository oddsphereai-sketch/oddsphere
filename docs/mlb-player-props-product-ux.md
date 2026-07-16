# MLB Player Props Product UX

## Product Shape

Player Props is a model-assisted Prop Researcher. It recognizes that one player can have many markets, one market can have many books, and the model is one input in the user's investigation rather than a substitute for it.

The workflow has three connected layers: Today's Radar for discovery, a unified search-and-market-board workspace, and a Prop Reader that translates the selected model-versus-market case into plain language. The compact player directory follows the board as a secondary way to browse rather than separating search from its results.

## Grade Language

The canonical backend grades are:

- `BEST_ANGLE`: strongest actionable prop after EV, model-edge, confidence, price, and data checks
- `LEAN`: positive value with a thinner margin or more price sensitivity
- `WATCHLIST`: interesting, but waiting on context or price confirmation
- `NO_PLAY`: valid market whose current risk-reward does not justify action
- `PENDING_DATA`: stale, missing, contradictory, malformed, or unmapped required data
- `RESEARCH`: visible market with an immature model or insufficient verified features

The backend values remain stable, but member labels are Strong Signal, Positive Signal, Watch, No Edge, Pending, and Research. These labels describe the model's current read without presenting the page as a pick sheet. `Best Edge` is not used because it is easily confused with the numeric model-edge field.

Grade and math are separate. A row carries `playGrade`, `modelEdge`, `expectedValue`, `confidence`, `marketProbability`, `modelProbability`, `finalProbability`, and `reasonCodes`. The grade summarizes the decision; model edge remains a numeric probability difference.

## Operating Model

### Prop Researcher

Prop Researcher is the single member workflow. It opens with universal search and quick market filters. An untouched slate shows Today's Radar and a player directory. Selecting an exact player opens that player's focused workspace without introducing another top-level navigation mode.

Today's Radar intentionally mixes research questions: the largest projection-versus-line gap, the widest loaded sportsbook price spread, and a context-dependent market to monitor. It is not a ranked picks list and does not hide the rest of the board.

The market board is continuous rather than grouped by recommendation grade. Player, market, selected side and line, model projection, book price, model edge, expected value, confidence, and model signal remain visible together. Stronger signals can be filtered or sorted, but they do not replace the full market universe. Identical player/market/side/line rows are deduped only when Best Price is selected.

### Prop Reader

Selecting any Radar card, player market, desktop row, or mobile card opens the centered Prop Reader. Its leading summary states where the projection sits relative to the line, whether the selected side aligns, how OddSphere probability compares with the market, and which loaded sportsbook currently has the strongest price. Supporting modules retain the model comparison, projection visual, price ladder, confidence, change risks, and matchup context.

Recent Form is the first evidence module in the Reader. For a verified MLB identity it shows the actual market stat by game, recalculates selected-side hit rates against the current line for the last 5, last 10, and full available season, and isolates history against the current opponent. The chart uses positive color only for selected-side hits; misses remain neutral because historical hit rate is research context, not a model recommendation.

Matchup Context follows Recent Form. Opponent offense comes from the official MLB Stats all-team season hitting endpoint. OddSphere computes K rate, walk rate, batting average, OPS, league averages, and per-metric rankings itself; the provider's generic rank field is not reused. The Reader states that No. 1 is the highest value so a user can interpret the direction for the selected market.

Pitch arsenal and handedness come from verified Ball Don't Lie player and pitcher pitch-type payloads. For hitter markets, the Reader intersects the probable starter's pitch usage with the hitter's results by pitch type and reports usage-weighted xwOBA, average, slugging, whiff rate, and mix coverage. This is pitch-mix research, not direct career batter-versus-pitcher history. Aggregate rows are rejected when their last-game date is not strictly before the Reader's as-of timestamp. They remain labeled research context and do not alter the promoted model score.

Game Environment separates three different confidence states. Venue and roof context comes from the official MLB schedule, three-year rolling park factors come from Baseball Savant, and game-hour conditions come from the National Weather Service hourly forecast for the verified venue coordinates. Domed parks suppress weather, unavailable feeds remain pending, and wind direction is not translated into an in/out effect until ballpark orientation is verified. The live weather adapter intentionally rejects historical replay because archived pregame forecasts require stored snapshots.

## Search And Controls

Search matches player, team, opponent, market, market group, and sportsbook. Filters cover model signal, market group, book, team/game, confidence, EV, model edge, odds range, and start time. Sorts cover signal priority, player, market, start time, EV, model edge, final model probability, confidence, book, and update time. Signal first is the default sort so actionable reads and Watchlist context do not get buried inside large market views.

The centered Reader shows the prop summary, plain-English interpretation, model-versus-market comparison, projection versus line, EV, numeric model edge, fair odds, comparable book prices, research confidence, missing context, and verified matchup context. Independent probability, shrinkage, raw features, reason codes, odds sanity, settlement, and CLV stay in admin diagnostics.

## Splits And Context

Market Context is shown only when the source field and timestamp behavior are verified. Missing splits remain absent with an explicit empty state. Official game logs can be displayed as descriptive evidence as soon as player identity and pregame as-of filtering are verified. Recent form, matchup, park, and weather features receive model weight only after leakage checks and out-of-sample validation show that they improve calibration or predictive loss.

## Route And Launch Safety

- Daily Edge remains at `/lab/daily-edge` in the authenticated Oddsphere product shell.
- Player Props is a gated product-nav tab whose canonical future member route is `/mlb/props`.
- `/lab/player-props` redirects to `/mlb/props` so there is only one member product destination.
- `/dev/mlb-props-preview` is a no-auth fixture-backed practice slate, renders in the same product shell, and returns 404 in production.
- `/dev/mlb-props-preview?reader=<fixture-id>` can open one validated practice Reader directly for responsive QA; unknown ids are ignored.
- The preview may use `/api/mlb/player-headshot/<numeric-id>` to validate photo-ready UI against MLB's image CDN. That route returns 404 in production; member headshots remain disabled until an approved commercial image license is configured.
- `/admin/mlb/props-review` is protected and uses the same review surface.
- `/mlb/props` requires member authentication, remains disabled behind display/API flags, and never imports fixture picks.

Future member enablement requires both `ODDSPHERE_PROPS_DISPLAY_ENABLED=true` and `ODDSPHERE_PROPS_PUBLIC_API_ENABLED=true`, plus member access enforcement. Preview and dry-run paths perform no Supabase writes. Hidden paper persistence remains separately gated and requires explicit operator approval.
