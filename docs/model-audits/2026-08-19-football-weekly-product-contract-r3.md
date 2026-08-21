# NFL + NCAAF weekly product contract r3

Status: local shadow product design only  
Date: 2026-08-19  
Production impact: none

## Exact checkpoint

The football program now has a research/evaluation foundation, provider ownership policy, a first fitted NFL benchmark, a weekly slate contract, and a local reader contract. It does not yet have a launch-quality NFL or NCAAF prediction model. The first simple NFL score-only benchmark lost to the market-only baseline on the protected 2025 holdout, so it remains an input candidate rather than a promoted model.

There is still no football production writer, member route, cron, database lane, published snapshot, official tracking market, grade, or stake. The projection releases remain `nfl_pregame_shadow_unfit_2026_08_19_r1` and `ncaaf_pregame_shadow_unfit_2026_08_19_r1`. Every slate and reader output is local-only and statically non-actionable.

## Weekly product decision

Football should use a weekly experience, not a daily experience:

- NFL and NCAAF are separate boards with separate releases, health, calibration, and week controls.
- The stable identity is league + season + season phase + week. Preseason, regular season, postseason, and NCAAF bowls cannot be silently mixed.
- Thursday, Friday, Saturday, Sunday, and Monday games remain part of one season-week, then display in kickoff-day groups.
- Finals remain visible through the end of the week. The default reader advances only after every game that still belongs to the current week is terminal.
- A canceled game or a game formally moved to another week cannot pin the old slate forever.
- The founder reader may explicitly revisit prior or future weeks without changing the active default.

This deliberately reuses the strongest Premier League behavior—one stable weekly object, completed-game retention, and explicit previous/next navigation—while using football-native week and phase semantics.

## Reader hierarchy

The weekly overview should show slate state, game count, projection coverage, price coverage, split coverage, and last refresh before any cards. Each kickoff day then contains compact game rows. Selecting a game opens one reader with this hierarchy:

1. Teams, kickoff, broadcast, game state, and final score when complete.
2. Independent projected score, margin, total, win probability, and uncertainty.
3. Moneyline, spread, and total tabs with exact current book/price.
4. Model versus market, without allowing the market to overwrite the independent projection.
5. Opening, prior, current, and eventual lock snapshots from one chronological source path.
6. Broad public consensus and named-book splits in visibly separate sections with provider, books-used, and freshness attribution.
7. A short list of model reasons: quarterback/personnel, opponent-adjusted efficiency, explosiveness, pressure/havoc, pace, rest/travel, and weather.
8. Visible data-health holds for missing/stale projection inputs, prices, splits, injuries, or identity matches.

Until a model is fit, probability and edge fields remain blank or explicitly marked research-only. The prototype must not manufacture grades from illustrative values.

## Implemented contracts

- `football_weekly_slate_contract_2026_08_19_r1` defines league-week identity, phase isolation, game state, teams, score, market panels, attributed reads, reasons, data health, provider-request counts, and the permanent local/non-actionable boundary.
- `football_weekly_reader_contract_2026_08_19_r1` produces kickoff-day groups, a default next-game selection, weekly coverage summaries, and NFL/NCAAF labels without fetching or writing data.
- `scripts/test-football-weekly-slate.ts` proves weekly rollover, completed-game retention, kickoff ordering, explicit historical selection, NCAAF Week 0 support, phase safety, identity safety, health state, and non-actionability.

## Cost and runtime boundary

The eventual member reader should make zero provider calls. One bounded scheduled pipeline will assemble a coherent stored snapshot per league-week. Historical inputs are bulk-cached locally by season. Current schedule, stats, prices, injuries, and splits are fetched at slate level, never by game card or member request. T-24h, T-6h, and T-60m evidence should update only the games entering each window; lock sweeps must not repeatedly rebuild an entire multi-day slate.

No such writer exists in this phase. The shared sport-scoped `prediction_pipeline` lease remains untouched.

## What still has to be built

1. Create checksum-backed NFL play-by-play/team-week features and an approved NCAAF historical feature cache with reproducible as-of timestamps.
2. Implement audited football adapters for BALLDONTLIE, Playbook, and SharpAPI that map into the existing schedule, named-price, consensus, and source-book split contracts.
3. Start local observe-only weekly snapshots now so opening/prior/current/lock history exists before rule fitting.
4. Fit separate NFL and NCAAF Elo/SRS, regularized opponent-adjusted efficiency, boosted, and partial-pooling candidates; evaluate complete weeks chronologically against market-only baselines.
5. Add score distributions and probability calibration, then test market movement/split features only as incremental overlays on untouched weeks.
6. Feed stored shadow snapshots into the founder reader and run it locally through live weekly rollover, provider gaps, and final-score retention.
7. Design play grades only after calibrated probabilities and price-aware expected value are trustworthy. Promotion requires a new immutable model/calibration/decision release plus the full model-change safety gate.

## Board impact

Zero promotions, zero demotions, and zero net actionable-board change. This contract cannot generate a play, grade, or stake.
