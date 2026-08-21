# NFL + NCAAF data and research foundation r2

Status: local shadow research only  
Date: 2026-08-19  
Production impact: none

## Safety and scope

- Primary projection releases remain explicitly unfit: `nfl_pregame_shadow_unfit_2026_08_19_r1` and `ncaaf_pregame_shadow_unfit_2026_08_19_r1`.
- The source-attributed split contract is `football_pregame_research_schema_2026_08_19_r2`; it supersedes r1 for new research rows without changing a projection.
- This phase adds only research contracts and benchmarks: `football_asof_dataset_2026_08_19_r1`, `football_dynamic_margin_diagonal_state_space_2026_08_19_r1`, `football_market_only_benchmark_2026_08_19_r1`, and `football_shadow_evaluation_2026_08_19_r1`.
- There is still no production writer, reader, route, cron, database table, official tracking lane, calibration, grade, decision, or stake release.
- Board impact is zero promotions, zero demotions, and zero net actionable change. Every football forecast remains shadow/hold and `actionable=false`.
- The dynamic margin implementation is an intentionally lightweight diagonal-uncertainty benchmark. It is not represented as the finished Bayesian/state-space model and has no fitted production defaults.

## What the deeper literature supports

### Pregame game forecasts

Glickman and Stern's dynamic state-space model treats each team's strength as changing week by week, shrinks strength across offseasons, estimates home-field advantage, and carries posterior uncertainty into margin forecasts. Its small 1993 NFL holdout slightly outperformed the quoted Las Vegas line on MAE and MSE, but the authors explicitly identify injuries as missing information and the result is far too small and old to establish a modern betting edge. The architecture is useful; the historical win claim is not a launch gate.

- Glickman and Stern, *A State-Space Model for National Football League Scores*: <https://www.glicko.net/research/nfl.pdf>
- Lopez, Matthews, and Baumer, state-space comparison across sports: <https://arxiv.org/abs/1701.05976>

NFL score margins are not ordinary continuous outcomes. Field goals and touchdowns create mass near key numbers, while score counts can be overdispersed. A normal margin distribution is a useful first benchmark, but exact spread-cover probabilities must eventually be checked against empirical/discrete or simulation-based distributions, especially around 3 and 7.

- Bayesian comparison of NFL score distributions and home advantage: <https://pmc.ncbi.nlm.nih.gov/articles/PMC8282683/>
- Recent stochastic analysis of the NFL point-spread distribution: <https://pubmed.ncbi.nlm.nih.gov/38476452/>

Open nflfastR work demonstrates three transferable practices: build football features from play state rather than box-score folklore, use out-of-season validation, and inspect calibration rather than accuracy alone. Expected points, win probability, completion probability, expected yards after catch, and pass-probability components give us a principled route from play-by-play into team and player features.

- nflfastR EP/WP/CP/xYAC/xPass model documentation: <https://github.com/nflverse/open-source-football/blob/master/_posts/2020-09-28-nflfastr-ep-wp-and-cp-models/nflfastr-ep-wp-and-cp-models.Rmd>
- Yurko, Ventura, and Horowitz, reproducible expected points, win probability, and player value: <https://doi.org/10.1515/jqas-2018-0010>

For college football, South and Egros used a chronological train/test design and found lasso, random forest, Bayesian, and boosted candidates statistically similar on their 2015 test set. The regularized linear model had the lowest variability and roughly 75% outcome accuracy. Team strength, home location, opponent offense/defense, and talent were important. The practical lesson is to require complex models to beat stable regularized baselines rather than assuming complexity is predictive.

- South and Egros, college-football model comparison: <https://journals.sagepub.com/doi/10.3233/JSA-190314>

### Player props

Direct peer-reviewed sportsbook player-prop research is much thinner than game forecasting or daily-fantasy research. Existing fantasy-prediction work is useful for feature discovery but does not establish a profitable prop model. One recent neural-network/optimization study reported considerable uncertainty and typical optimized lineups near the middle of the realized distribution. That is evidence against using one opaque projected-fantasy-points target as our prop engine.

- Becker and Sun, fantasy-football player prediction and optimization: <https://doi.org/10.1515/jqas-2013-0009>
- Neural-network NFL fantasy prediction with uncertainty and lineup optimization: <https://arxiv.org/abs/2309.15253>
- Random-forest play-call prediction: <https://doi.org/10.3233/JSA-190348>
- Hidden-Markov NFL play-call prediction: <https://arxiv.org/abs/2003.10791>
- NFL Big Data Bowl public research resources: <https://github.com/nfl-football-ops/Big-Data-Bowl>

The defensible prop architecture is therefore structural and market-specific:

1. **Availability and role.** Active/DNP probability, starter and depth-chart status, expected snaps, routes, dropbacks, carries, target share, red-zone share, and uncertainty around role changes.
2. **Team opportunity.** A joint distribution for drives, plays, situation-neutral pace, pass rate, rush attempts, sacks, scrambles, game script, and scoring environment.
3. **Conditional player efficiency.** Completion probability, air yards, yards after catch, yards per carry, target quality, pressure/coverage matchup, offensive-line health, and opponent tendencies. Recent efficiency is shrunk aggressively because volume and role are generally more stable than small-sample efficiency.
4. **Market-specific distributions.** Count/hurdle or beta-binomial style models for attempts, targets, receptions, carries, touchdowns, and interceptions; compound volume-times-efficiency distributions for passing, rushing, and receiving yards. Distribution choice is fitted by prop family rather than imposed globally.
5. **Joint simulation.** Simulate team play volume and game state first, then allocate opportunities to correlated players. Quarterback attempts, receiver targets/receptions/yards, running-back work, team totals, and touchdown chances must remain coherent rather than being modeled as independent cards.
6. **Price-aware evaluation.** Convert each simulated distribution to over/under/push probability at the exact locked line, compare with synchronized de-vigged prices, and calibrate separately by prop family, line range, role certainty, and decision lock.

Book-specific void/push rules and player participation definitions must be part of settlement before any prop record can be trusted. Props remain a later workstream; current collection should begin now so opening/current/closing history exists when the prop model is ready.

## Live BALLDONTLIE coverage audit

The read-only audit was run with a hard eight-request ceiling, no retry, no database/cache writes, and no raw payload or API-key logging. The exact requested range was 2026-08-19 through 2026-08-29 inclusive.

### NFL preseason

- 32 scheduled games returned across preseason weeks 3 and 4; zero rows fell outside the requested dates.
- 32 of 32 games had at least one odds row (100% event coverage).
- 144 odds rows across BetMGM, BetRivers, Caesars, DraftKings, Fanatics, FanDuel, Kalshi, and Polymarket.
- All 144 moneyline pairs were complete; 121 rows had complete spreads and 121 had complete totals.
- All 144 rows had valid provider update timestamps. Two odds pages were read and the final result was not truncated.
- Total requests: three.

This establishes that the current NFL feed can support bounded preseason market capture. It does not establish historical training coverage, split coverage, or reliable preseason player participation.

### NCAAF Week 1

- 69 scheduled games returned for 2026 Week 1.
- Only 6 of 69 games had any odds row (8.7% event coverage).
- 22 odds rows across BetMGM, BetRivers, Caesars, and Fanatics; those 22 rows were complete for moneyline, spread, and total and had valid timestamps.
- One odds page was read and was not truncated.
- Total requests: two.

The missing 63 games must be classified as `market unavailable at this observation time`, never as a neutral price, zero movement, or absence of bettor interest. This audit occurred roughly ten days before the Playbook NCAAF slate began and cannot distinguish an ordinary early market-opening curve from a permanent provider gap. It does establish that BALLDONTLIE could not support a complete board at this early lock or a multi-season price-aware backtest by itself. Coverage must be remeasured at T-24h, T-6h, and T-60m before provider reliability is judged.

The NFL games endpoint accepts `dates[]`; unsupported start/end date parameters can be silently ignored. The audit therefore asserts that every returned game date lies inside the requested date set. This provider-integrity check remains mandatory.

## Current provider comparison

A second read-only audit spent eight calls total: lines and splits for NFL/NCAAF from Playbook, plus current main-market odds and splits for NFL/NCAAF from SharpAPI. A two-call SharpAPI schema follow-up avoided repeating Playbook requests.

### NFL now

- BALLDONTLIE had named-vendor odds for all 32 requested preseason games and is the strongest verified preseason schedule/odds lane in this snapshot.
- Playbook returned 272 complete consensus line and split rows, but their kickoff range was 2026-09-10 through 2027-01-10. That is the regular-season schedule: it returned zero games within the next 14 days and did not cover the active preseason window.
- SharpAPI's first capped 200 main-market rows covered three NFL events, multiple named/exchange books, all three main market types, and valid feed timestamps; pagination indicated more rows. This proves current named-book depth, not full event coverage, because the one-page sample was market-row dense and truncated.
- SharpAPI returned zero NFL `/splits` rows at the audit time.

### NCAAF now

- Playbook returned 111 consensus rows from 2026-08-29 through 2026-11-28. All 111 had complete spreads/totals; 105 had moneylines. The corresponding public bet/money pairs were coherent and reported one to eleven books used. Only eight games were inside 14 days, which supports the user's early-market explanation.
- SharpAPI's capped first odds page had 200 current main-market price rows across late-August games and was truncated, so it proves price availability but not full-game coverage. The observed books leaned toward exchange/international sources rather than the desired US retail set.
- SharpAPI returned 18 NCAAF BetMGM split rows with valid freshness timestamps. They were ticket-only: 9 rows had coherent moneyline ticket pairs, 14 had spread ticket pairs, 2 had total ticket pairs, and zero had complete handle/money pairs. Missing handle remains null. These are source-book observations, not a broad public consensus or verified professional-bettor signal.
- BALLDONTLIE's 6-of-69 early event coverage is therefore one provider/time snapshot, not a conclusion about what will be available near kickoff.

### Provider ownership decision

There is no responsible single "most reliable provider" across every surface:

- **Schedule, team/player identity, current statistics, roster/injury truth:** BALLDONTLIE is the primary sports-specific anchor, supplemented by versioned nflverse/CollegeFootballData bulk history for research.
- **Current named-book prices:** BALLDONTLIE and SharpAPI compete field-by-field. Select the freshest complete synchronized pair for the exact event/book/market/line; do not impose one global winner.
- **Consensus line and broad public context:** Playbook is useful and currently broad for the upcoming regular seasons, but its line is an aggregate, not a bettable sportsbook price or proof of movement.
- **Source-book price history, closing, microstructure, and future props breadth:** SharpAPI is the natural candidate, subject to football-specific pagination, book-quality, identity, and coverage audits. The existing generic Sharp provider code is MLB-oriented and cannot simply be reused as the football adapter.
- **Public consensus splits:** Playbook can supply consensus bets/money with `booksUsed`, but only when a source observation timestamp/freshness contract is available.
- **Book-specific splits:** SharpAPI rows stay separated by DraftKings/Circa/BetMGM source. Even SharpAPI's current documentation cautions that splits should be used alongside movement and value, not alone; no split row proves the identity of a "sharp bettor."

This policy is stamped in `football_provider_policy_2026_08_19_r1`.

## First fitted NFL benchmark result

One 2.1 MB nflverse schedule/results file was downloaded into the ignored local research cache and checksum-pinned (`e4da26b553a34ee2699f366b70f85f4b80b147d3e5e2b7ee1c3e5ee54295a14f`). The tournament used 4,175 completed regular-season games from 2010-2025, kept complete weeks together, compared 36 predeclared dynamic-margin configurations on the 2024 selection season, and then opened 2025 once as the holdout.

The selected score-only benchmark used 0.55 prior-season carryover, 1.5 home-field points, low weekly evolution, and a wide observation variance. It did **not** beat the market:

- 2024 selection: model margin MAE 10.15 versus historical terminal-line MAE 9.61; model cover Brier 0.2553 versus de-vigged market 0.2511.
- 2025 one-time holdout: model margin MAE 10.32 versus market 9.72; model cover Brier 0.2645 versus market 0.2496; home-win Brier 0.2244.

That is a successful safety result, not a failed project: it proves the market-only baseline is strong and prevents the simple state-space rating from being mistaken for a betting model. The benchmark remains useful as an independent team-strength feature. The 2025 result must not be used to retune this release; the richer efficiency/QB/personnel candidates need nested expanding-window development and a newly protected forward evaluation block.

## How market reads enter the model

Market evidence is separated into four layers to prevent leakage and double counting:

1. **Market-only benchmark.** At each decision lock, de-vig a synchronized opposing pair from one source. The posted spread and total are point-forecast baselines. No asynchronous best-price synthetic consensus is allowed.
2. **Independent residual.** Compute model-minus-market margin, total, and probability differences. The independent projection never receives current odds as an unnoticed team-strength feature.
3. **Incremental market-read candidates.** Opening-to-current movement, price movement at a fixed line, key-number crossings, cross-book agreement, ticket share, money share, and split disagreement receive explicit timestamps, sources, missingness indicators, and freshness. Injury/news variables are present simultaneously so a line reaction to quarterback news is not counted twice.
4. **Execution.** Only after a side is selected are the exact available line and price used for expected value, best-price choice, and later CLV. A good football forecast at a bad price is not a play.

Market-read candidates will be admitted only if they improve later untouched weeks over both the market-only benchmark and the same model without the candidate. Thresholds must be learned within past-only folds, separately for NFL/NCAAF and market family. Vendor-specific split quality and missingness will be reported; `RLM` and `sharp money` remain descriptive candidate labels until this test passes.

Split inputs now require provider, source key, source type (`multi_book_consensus`, `named_book`, or `unknown`), sportsbook, books used, event, market, side, line, tickets, money, source update, observation, and fetch timestamps. One public read cannot blend providers or events. Opposing ticket percentages must sum to approximately 100; money percentages must either be a coherent pair or both remain null. A ticket-only source stays ticket-only.

## Implemented local foundations

- `lib/services/football/footballAsOfDataset.ts` audits feature first-known timestamps, fails on future features/finals, builds latest-known pregame snapshots, and creates complete-week expanding-window folds.
- `lib/services/football/footballDynamicMarginBenchmark.ts` supplies a market-independent, recency-evolving team-strength benchmark with offseason shrinkage, home field, and predictive uncertainty.
- `lib/services/football/footballMarketBaseline.ts` builds synchronized, source-preserving de-vigged market-only baselines and rejects observations from after the decision lock.
- `lib/services/football/footballEvaluation.ts` reports Brier score, log loss, calibration error, locked-price units/ROI, MAE, RMSE, and bias in separate release/league/market groups. Pushes are excluded from probability accuracy and retained as risked stakes for ROI.
- `lib/services/football/footballProviderPolicy.ts` assigns providers by data surface instead of naming one universal winner.
- `scripts/operator/audit-football-bdl-coverage.ts` is the bounded read-only current-slate audit.
- `scripts/operator/audit-football-market-providers.ts` compares football lines/splits with provider and league filters and a visible request budget.
- `scripts/test-football-model-research.ts` proves future results cannot change a prior forecast, weekly folds remain past-only, future odds are rejected, pushes are handled correctly, and candidate releases cannot be silently blended.

## Next research gates

1. Create versioned, checksum-backed local season caches from bulk nflverse NFL files and the approved NCAAF historical source. Store raw snapshots once; derive compact team-week and player-week features locally.
2. Run a coverage/null-rate/identity audit for every intended feature before fitting. Features without reproducible as-of availability are excluded or explicitly missing.
3. Fit NFL and NCAAF dynamic-margin, SRS/Elo, regularized efficiency, and boosted candidates independently using expanding season-week folds.
4. Add discrete/empirical score-distribution candidates for exact spread and total probabilities, then calibrate only on later untouched data.
5. Begin observe-only collection for current games, odds, openings, injuries, depth/role, splits, and closing snapshots. Do not fit a market-read rule until enough locked history exists.
6. Start props with availability/opportunity heads and the passing-volume tree; add receiving, rushing, and touchdown simulations only after internal coherence tests pass.
7. A model remains unfit until it beats appropriate naive and market-only baselines on untouched weeks with acceptable calibration, interval coverage, stability, data cost, board breadth, and cluster-bootstrap uncertainty.

## Verification

- `./node_modules/.bin/tsc --noEmit --pretty false`: pass.
- `npm run test:football-shadow-foundation`: pass before this phase.
- `npm run test:football-model-research`: pass.
- Full mandatory `npm run verify:model-change`: pass, including both football suites plus all existing model-safety suites.
