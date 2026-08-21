# NFL + NCAAF Daily Edge model foundation r1

Historical note: the r1 schema described here is superseded for new research rows by `football_pregame_research_schema_2026_08_19_r2`; see `2026-08-19-football-data-and-research-r2.md`. The unfit projection releases remain unchanged.

Status: local shadow research only  
Date: 2026-08-19  
Sports: NFL and NCAAF/CFB  
Initial markets: moneyline, spread, total

## Safety declaration

- Projection releases: `nfl_pregame_shadow_unfit_2026_08_19_r1` and `ncaaf_pregame_shadow_unfit_2026_08_19_r1`.
- Shared research schema: `football_pregame_research_schema_2026_08_19_r1`.
- Calibration, decision, grade, and stake releases: intentionally unfit/unassigned.
- Writer, reader, cron, database, official tracking, grades, and stakes: none.
- Production board impact: zero promotions, zero demotions, zero net actionable change.
- The existing sport-scoped `prediction_pipeline` lease is untouched.
- This release cannot publish or return an actionable forecast. Missing evidence is a hold/data-health finding, never an ordinary `NO_PLAY`.

## Research conclusion

The best defensible build is not one pooled football model. NFL and NCAAF should share contracts, evaluation, market math, and reader semantics while retaining separate features, fitted coefficients, uncertainty, calibration, and release identifiers.

The forecast must have four distinct layers:

1. **Independent score distribution.** Opponent-adjusted efficiency, passing/rushing decomposition, explosiveness, finishing drives, QB/personnel, rest/travel, venue/weather, and league-specific priors produce a home score, away score, margin distribution, total distribution, and win probability without betting odds.
2. **Market baseline.** A synchronized same-book or documented consensus pair is de-vigged. Spread, total, and moneyline are first-class baselines, not features casually mixed across books.
3. **Chronologically selected ensemble.** A blend of independent and market forecasts is allowed only if its weight wins on past-only calibration and untouched forward holdouts. The market-only forecast remains a mandatory benchmark.
4. **Market-read overlay.** Public splits, money/ticket divergence, same-source movement, sharp/retail disagreement, key-number crossings, and price availability can affect confidence or actionability only after their incremental value is proven. They never rewrite the independent projection.

## Primary evidence used

- BALLDONTLIE NFL documentation: <https://nfl.balldontlie.io/>
- BALLDONTLIE NCAAF documentation: <https://ncaaf.balldontlie.io/>
- BALLDONTLIE OpenAPI specifications: <https://www.balldontlie.io/openapi/nfl.yml> and <https://www.balldontlie.io/openapi/ncaaf.yml>
- Yurko, Ventura, and Horowitz, reproducible expected-points/win-probability modeling: <https://doi.org/10.1515/jqas-2018-0010>
- nflfastR EP/WP/CP model documentation and calibration: <https://github.com/nflverse/open-source-football/blob/master/_posts/2020-09-28-nflfastr-ep-wp-and-cp-models/nflfastr-ep-wp-and-cp-models.Rmd>
- South and Egros, chronological college-football model comparison: <https://journals.sagepub.com/doi/10.3233/JSA-190314>
- Fair, college-football rankings and market efficiency: <https://cowles.yale.edu/sites/default/files/2022-08/d1381.pdf>
- PLOS One, NFL decision theory and discrete spread outcomes: <https://journals.plos.org/plosone/doi?id=10.1371/journal.pone.0287601>
- CollegeFootballData current API, advanced-metric, and cost documentation: <https://api.collegefootballdata.com/> and <https://collegefootballdata.com/api-tiers>
- nflverse public play-by-play releases: <https://github.com/nflverse/nflverse-pbp>

The important combined lesson is that EPA-style efficiency and opponent adjustment are valuable independent inputs, while the final market line is an extremely strong forecast. Model selection must therefore report both raw predictive quality and incremental performance versus market-only baselines.

## Provider reality and cost plan

### NFL

BALLDONTLIE provides teams, games, player injuries, rosters/depth, game/player/team stats, advanced passing/rushing/receiving, play-by-play with down/distance/field position, and current/opening odds. Current NFL odds start in 2025 Week 8; preseason odds are queryable by game ID and regular week queries accept `season_type=1`.

Recommended use:

- BALLDONTLIE for current fixtures, roster/injury truth, provider IDs, live/current odds, and audit fallback.
- nflverse season parquet files for bulk historical play-by-play/EPA research. Download once per season and cache locally instead of spending one API request per game.
- A small local feature snapshot per team/week, not raw play-by-play in the production reader.

Preseason must be a separate regime. Team-season stats explicitly exclude preseason, starters play uneven snaps, and depth/coach intent dominates normal team-strength signals. Preseason can collect evidence and produce research forecasts, but it must not train the regular-season calibration as if the regimes were interchangeable.

### NCAAF

BALLDONTLIE describes game history from 2004 onward, primarily FBS, with games, standings, AP rankings, play-by-play, team/player game and season stats, and current/opening odds. Full team stats and odds require the NCAAF GOAT tier. Odds begin only in Week 9 of 2025, so BALLDONTLIE alone cannot support a multi-season price-aware backtest.

Recommended use:

- BALLDONTLIE for current schedule, provider identity, current team/player status, box scores, and current/opening prices.
- CollegeFootballData as the preferred low-cost historical research supplement for opponent-adjusted EPA/PPA, explosiveness, success rate, havoc, field position, recruiting, weather, and older betting lines. Its current free tier includes 1,000 monthly calls; bulk season queries are explicitly preferred over per-team calls.
- FBS-only initial scope. FCS matchups should be held or modeled through a separately validated proxy because BALLDONTLIE does not guarantee non-FBS coverage.

### Hard load boundaries

- Historical data is fetched once by season, stored under a versioned local cache, and never requested from member reads.
- Current slate collection is bulk by date/week, then odds/stats are bulk by game IDs in chunks of at most 100.
- No per-card, per-user, or browser-triggered provider requests.
- Concurrency starts at one for research and never exceeds three without a measured need.
- Pagination, retries, and total requests are hard-capped; 429 retries occur once and honor provider headers.
- Production eventually reads one coherent stored weekly snapshot. Thursday/Saturday/Sunday/Monday games share `season` + `week`, while display remains grouped by kickoff date.

## Feature program

### Shared core

- Opponent-adjusted offensive and defensive EPA/play or PPA/play.
- Early-down pass efficiency and dropback success; rushing is retained but should not receive equal weight by assumption.
- Explosive-play creation/allowance and finishing-drives efficiency.
- Pressure/havoc, sack rate, turnover-worthy indicators, and field position.
- Pace/seconds per play, neutral-situation pass rate, and play volume for totals.
- QB identity and availability, receiver/line continuity, defensive injuries, kicker status.
- Rest, short week, bye, travel distance, time-zone change, surface, roof, wind, precipitation, temperature, and altitude.
- Recency decay, opponent adjustment, prior-season shrinkage, and an explicit uncertainty estimate.

### NFL-specific

- QB dropback EPA separated from team offense; injury/depth confirmation has a hard freshness gate.
- Offensive-line and receiver continuity; defensive pressure and coverage indicators.
- Preseason/regular/postseason regime and starter participation.
- Division familiarity, rest asymmetry, international/neutral venue, and coaching changes.

### NCAAF-specific

- Recruiting/talent prior, transfer/returning-production continuity, coach/coordinator change.
- Conference and schedule strength, FBS/FCS status, neutral/bowl game, altitude and travel.
- Garbage-time filtering and opponent adjustment are mandatory because schedule imbalance is much larger than in the NFL.
- Team volatility and a wider predictive distribution, especially early in the season and for roster turnover.

AP rank is useful reader context and a possible weak prior, but it must not be treated as an independent efficiency statistic without validation.

## Market handling

- Pair only synchronized opposing outcomes from the same provider, source key, event, book, market, line, and observation time before removing vig.
- Never compare a consensus opener with a named-book current line.
- `first observed` and provider-native `opening` remain distinct.
- Spread movement uses signed side lines and records every crossing of fitted key numbers. Initial research keys are 3, 7, 10, and 14, but their values and league/era dependence must be estimated from the training data rather than hard-coded into a grade.
- Money/ticket divergence is descriptive until forward validation proves a rule.
- RLM requires a heavy public side plus chronological same-source movement against that side.
- Steam requires multiple named books moving the same market/line direction inside a defined window. A consensus snapshot cannot prove steam.
- Splits cannot change the independent projected score.

## Candidate model tournament

Every league/market should compare at least:

1. Market-only baseline.
2. Recency-weighted Elo/SRS margin baseline.
3. Regularized linear opponent-adjusted efficiency model.
4. Gradient-boosted model with monotonic/sanity constraints where appropriate.
5. Hierarchical/Bayesian partial-pooling model, especially for NCAAF team and conference effects.
6. Calibrated ensemble of the best genuinely different models.

Do not choose one algorithm in advance. Select by repeated expanding-window evaluation, stability, calibration, and data/runtime cost.

## Chronological evaluation contract

- Unit of split: complete season-week. No game may use a stat, injury, line, split, ranking, or roster observation first known after its decision timestamp.
- Development: expanding-window folds across past seasons.
- Calibration: later, untouched weeks used for probability/variance/ensemble calibration and any action threshold.
- Final holdout: the newest untouched season segment. Never tune after reading it.
- Lock views: T-24h, T-6h, T-60m, and closing where data exists. Each result is evaluated against only evidence known at that timestamp.

Required metrics:

- Score MAE/RMSE and interval coverage.
- Margin and total MAE/RMSE.
- Moneyline Brier score, log loss, calibration gap, and reliability tables.
- Spread/total cover Brier and log loss at the exact locked number and price.
- Record, pushes, locked-price units/ROI, CLV where comparable, maximum drawdown, and cluster-bootstrap uncertainty by week/game.
- Board count and market/price/week/team concentration.
- Market-only delta for every predictive metric.

Any demotion rule must be paired with a tested promotion rule and report promoted, demoted, and net actionable counts. Until held-out evidence is sufficient, every output remains shadow/hold and `actionable=false`.

## Reader design

The football card should answer, in order:

1. Projected score, margin, total, and win probability with an uncertainty band.
2. Best current price and exact book; the graded number is visually distinct from consensus context.
3. Model versus market: projected spread/total, current line, and price-aware edge.
4. Market path: opening, prior, current, and lock/close, with key-number crossings called out.
5. Tickets versus money, source freshness, and a restrained interpretation (`public heavy`, `money disagreement`, `mixed`, or `unavailable`).
6. Football reasons that matter: QB/personnel, efficiency mismatch, explosiveness, pressure/havoc, rest/travel, and weather.
7. Data health: starter uncertainty, missing advanced data, FCS coverage, stale prices, or identity mismatch must be visible holds.

Useful bettor-facing stats are opponent-adjusted efficiency ranks, pass/rush split, explosiveness, success rate, pressure/havoc, finishing drives, pace, turnover luck/regression context, QB status, weather, rest/travel, current/opening number, key-number movement, best price, and model-versus-market probability. Raw stat dumps and unvalidated trend trivia should not dominate the card.

## Build sequence

1. Run bounded BALLDONTLIE coverage audits for current NFL preseason and the first NCAAF slate; record endpoint tier, row count, null rate, event match rate, vendor coverage, timestamp quality, and request count.
2. Build versioned local historical caches and an as-of feature table. Add CFBD only after confirming terms/key and measuring what BALLDONTLIE cannot supply.
3. Implement market-only and Elo/SRS benchmarks before richer models.
4. Add opponent-adjusted efficiency and score-distribution candidates, then the chronological tournament.
5. Collect current odds/splits in observe-only mode through preseason and early NCAAF weeks. Fit no market-read thresholds yet.
6. Build a local founder reader from stored shadow snapshots.
7. Only after held-out validation, choose immutable model/calibration/decision releases and design the single leased production writer.

## r1 implementation

- `lib/services/football/footballModelContract.ts` defines separate league releases, as-of feature provenance, independent projections, price/split observations, shadow output, and the permanent `actionable: false` boundary.
- `lib/services/football/footballMarketMath.ts` implements synchronized two-way de-vigging, same-source movement, key-number crossing detection, conservative public reads, and fail-closed RLM candidate classification.
- `scripts/test-football-shadow-foundation.ts` proves source mixing is rejected and market labels cannot be created from incomplete evidence.

No production file, API route, database schema, cron, reader, tracking registry, grade, or stake was changed.
