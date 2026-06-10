# Phase 0 — Full Inventory / System Map

**Audit:** Daily Edge platform site/model-wide reliability audit
**Date:** 2026-06-10
**Phase:** 0 — coverage map (read-only)
**Scope:** every route, service, cron, table, script, page, provider, env gate that touches Daily Edge.
**Charter:** no quality judgments here. Phases 1–6 do the assessment. Phase 0 only confirms that every surface is on the map so nothing is omitted in the deeper audit.

---

## Methodology notes

- All file paths cite real repo locations.
- All DB row counts cite live Supabase queries run during compilation.
- "Has tests" notes a `scripts/test-<service>.ts` file if present — does NOT assert the test is comprehensive (that's a Phase 1+ check).
- "Manual" means the only known trigger is a developer running the script; an item can be both manual and called by a cron (rare).
- Surfaces marked **disabled** are present in code but explicitly gated off in production.
- Three items remain partially mapped at compaction time — flagged inline as `⚠ partial in this phase`.

---

## 1. API ROUTES (36 total)

### 1.1 Cron routes (`app/api/cron/**`) — 16 routes

| File | Method | Sport | Reads | Writes | Env gates |
|---|---|---|---|---|---|
| `app/api/cron/afternoon-refresh/route.ts:19` | GET/POST | mlb/nba/nhl in-season | linesService, weather, sharp_signals | lines, line_history, sharp_signals, weather_forecasts | provider keys |
| `app/api/cron/daily-refresh/route.ts:73` | GET/POST | **disabled** (Phase 4.3 tripwire — BDL ID-namespace mismatch) | none | none | DAILY_REFRESH_DANGEROUS_ENABLE |
| `app/api/cron/evening-refresh/route.ts:28` | GET/POST | mlb/nba/nhl in-season | SharpAPI, ESPN/BDL lineups, OpenWeather | lines, line_history, player_props, sharp_signals, lineups, weather_forecasts, prop_predictions | provider keys |
| `app/api/cron/feature-coverage-refresh/route.ts:90` | GET/POST | mlb | BDL players, OpenWeather, ESPN BDL lineups | players, lineups, weather_forecasts | FEATURE_COVERAGE_AUTO_REFRESH_ENABLED, WEATHER_PROVIDER, PLAYER_STATS_PROVIDER, BDL_PLAYER_BACKFILL_DB_WRITES_ENABLED |
| `app/api/cron/lineup-watch/route.ts:20` | GET/POST | mlb/nba/nhl in-season | ESPN/BDL lineups | lineups, prop_predictions | provider keys |
| `app/api/cron/midday-refresh/route.ts:19` | GET/POST | mlb/nba/nhl in-season | SharpAPI /odds | lines, line_history, sharp_signals | none |
| `app/api/cron/morning-slate/route.ts:52` | GET/POST | mlb/nba/nhl in-season | ESPN/BDL games, SharpAPI, OpenWeather, auto-model inputs | games, lines, line_history, player_props, sharp_signals, weather_forecasts, game_predictions, prop_predictions, market_signals, grades, slate_status | MORNING_SLATE_AUTO_PUBLISH |
| `app/api/cron/nba-daily-refresh/route.ts:72` | GET/POST | nba | ESPN scoreboard, BBR HTML, SharpAPI /odds | teams, games, nba_team_ratings, lines, line_history | **NBA_CRON_ENABLED**, SHARPAPI_KEY |
| `app/api/cron/nhl-daily-refresh/route.ts:46` | GET/POST | nhl | NHL /v1/schedule, SharpAPI /odds | teams, games, lines, line_history | **NHL_CRON_ENABLED**, SHARPAPI_KEY |
| `app/api/cron/post-game-results/route.ts:45` | GET/POST | all in-season | BDL finished games, prediction_records | prediction_results, prediction_records.status, tracking aggregates | none |
| `app/api/cron/pregame-sweep/route.ts:304` | GET/POST | mlb/nba/nhl in-season | games.locked_at, game_predictions.locked_at, SharpAPI, sharp_signals | game_predictions.locked_at, prediction_records.locked_at, admin_audit_log, lines, line_history, sharp_signals, market_signals, grades | **PREGAME_SWEEP_CRON_ACTIVE**, PREGAME_SWEEP_DRY_RUN |
| `app/api/cron/slate-cycle/route.ts:45` | GET/POST | **mlb only** | all provider APIs | per-step writes (S1: games, S2-3: lines, S4: props, S7: predictions, S9-10: signals+grades, S11: publish) | ORCHESTRATOR_SKIP_CONFIRMATION, per-step `*_DB_WRITES_ENABLED`, MORNING_SLATE_AUTO_PUBLISH |
| `app/api/cron/tracking-refresh/route.ts:62` | GET/POST | mlb/nba/nhl | games, BDL/ESPN scores, prediction_results | prediction_records, prediction_grades, tracking aggregates | none |
| `app/api/cron/weekly-calibration/route.ts:15` | GET/POST | cross-sport | prediction_results | calibration_buckets | none |
| `app/api/cron/weekly-park-factors/route.ts:18` | GET/POST | mlb | FanGraphs (or mock) | ballparks.park_factor_* | none |

All cron routes use `cronHandler`/`cronHandlerPerSport` from `lib/cron/runCron.ts` for `CRON_SECRET` bearer-token auth + per-source locking + `data_refresh_log` writes.

### 1.2 Member-facing routes (`app/api/lab/**`) — 6 routes

| File | Method | Sport | Reads | Writes |
|---|---|---|---|---|
| `app/api/lab/calibration/route.ts:85` | GET | all (game-level filter) | calibration_buckets | none |
| `app/api/lab/daily-edge/route.ts` | GET | mlb/nba/nhl (dispatcher) | games, game_predictions, prediction_records, lines, sharp_signals, lineups, weather | none |
| `app/api/lab/player-props/route.ts:183` | GET | mlb/nba/nfl/cbb/cfb/nhl/ucl (live: mlb only) | games, prop_predictions, players, teams, prediction_results | none |
| `app/api/lab/refresh-status/route.ts:249` | GET | any (default mlb) | data_refresh_log | none |
| `app/api/lab/tracking-foundation/route.ts:25` | GET | all | prediction_records, prediction_results, tracking_aggregate, tracking_baselines | none |
| `app/api/lab/tracking/route.ts:1` | GET | all | prediction_results | none |

All read-only. No auth gate (public read). Auth check happens at the page layer via middleware/`requireAuth`.

### 1.3 Admin routes (`app/api/admin/**`) — 9 routes

| File | Method | Sport | Auth | Writes |
|---|---|---|---|---|
| `app/api/admin/auto-predictions/route.ts:320` | GET | mlb | `validateAdminAuth` | none |
| `app/api/admin/cron-status/route.ts:125` | GET | mlb + cross-sport | `validateAdminAuth` | none |
| `app/api/admin/games/route.ts:15` | GET | all configured sports | `validateAdminAuth` | none |
| `app/api/admin/nba-as-daily-edge/route.ts:24` | GET | nba | `validateAdminAuth` | none |
| `app/api/admin/nba-preview/route.ts:69` | GET | nba | `validateAdminAuth` (with temp branch bypass) | none |
| `app/api/admin/teams/route.ts:27` | GET | all configured sports | `validateAdminAuth` | none |
| `app/api/admin/tracking/route.ts:16` | GET | all | `validateAdminAuth` | none |
| `app/api/admin/upload-scores-model/route.ts:33` | POST | mlb | `validateAdminAuth` | game_predictions, scores_model_runs, grades |
| `app/api/admin/upload-slate/route.ts:69` | POST | all configured sports | `validateAdminAuth` | manual_slate_staging, games, teams (blocked by Flag B1) |

### 1.4 Auth routes (`app/api/auth/**`) — 5 routes

| File | Method | Env gates |
|---|---|---|
| `app/api/auth/login/route.ts:61` | POST | LAB_BETA_PASSWORD (fail-closed if missing) |
| `app/api/auth/logout/route.ts:19` | POST | none |
| `app/api/auth/whop/callback/route.ts:118` | GET | WHOP_CLIENT_ID, WHOP_CLIENT_SECRET, WHOP_API_KEY, WHOP_RESOURCE_ID, WHOP_SESSION_SECRET |
| `app/api/auth/whop/start/route.ts:42` | GET | WHOP_CLIENT_ID |
| `app/api/auth/whop/status/route.ts:39` | GET | none (read-only diagnostic) |

---

## 2. VERCEL CRON SCHEDULE (`vercel.json`)

| Path | Schedule (UTC) | Notes |
|---|---|---|
| `/api/cron/slate-cycle` | `0 8 * * *` | morning |
| `/api/cron/slate-cycle` | `0 10 * * *` | morning |
| `/api/cron/slate-cycle` | `0 12 * * *` | morning |
| `/api/cron/slate-cycle?intraday=true` | `0 13–2 * * *` (14 hourly entries) | intraday |
| `/api/cron/tracking-refresh` | `0 * * * *` | hourly — mlb+nba+nhl |
| `/api/cron/pregame-sweep` | `*/15 * * * *` | every 15 min |
| `/api/cron/feature-coverage-refresh` | `30 11 * * *` | morning |
| `/api/cron/feature-coverage-refresh` | `30 21 * * *` | evening |
| `/api/cron/nba-daily-refresh` | `30 13 * * *` | NBA — requires `NBA_CRON_ENABLED=true` |
| `/api/cron/nhl-daily-refresh` | `45 13 * * *` | NHL — requires `NHL_CRON_ENABLED=true` (per Daniel: confirmed live as of 2026-06-10) |

**Crons defined in code but NOT in `vercel.json`:** `afternoon-refresh`, `evening-refresh`, `daily-refresh`, `midday-refresh`, `morning-slate`, `lineup-watch`, `post-game-results`, `weekly-calibration`, `weekly-park-factors`. These exist as route handlers but are not scheduled by Vercel — either deferred or invoked manually. To be classified in Phase 1.

---

## 3. LIB SERVICES + INFRASTRUCTURE

### 3.1 Cron infrastructure (`lib/cron/**`)

- `lib/cron/runCron.ts:71` — `cronHandler`, `cronHandlerPerSport` (wrapper composing auth + lock + refreshLogger). Used by every cron route.
- `lib/cron/auth.ts:23` — `validateCronAuth` (CRON_SECRET bearer check).
- `lib/cron/fetchWithRetry.ts:55` — `fetchWithRetry`, `NonRetryableHttpError`. Used by all external provider calls.
- `lib/cron/dates.ts:28` — `todaySlateDate`, `yesterdaySlateDate`, `parseDateFromUrl`.
- `lib/cron/seasons.ts:47` — `sportsInSeasonToday` (static calendar + override).

### 3.2 Shared services (`lib/services/*.ts`, top-level)

Selected key files (full list: `find lib/services -maxdepth 1 -name "*.ts"` shows 49 entries):

| File | Purpose | Writes | Has tests |
|---|---|---|---|
| `lib/services/automationOrchestrator.ts` | R-19 cron orchestrator (mlb slate-cycle) | per-step | yes |
| `lib/services/automationOrchestratorGates.ts` | G1/G2/G3 safety gates | none (pure) | yes |
| `lib/services/automationSlateLockSnapshot.ts` | Lock snapshot writer | game_predictions/prediction_records.locked_at | yes |
| `lib/services/automationSlateSafetyGates.ts` | Lock-aware exclusion rules | none (pure) | yes |
| `lib/services/automodelOrchestratorService.ts` | Phase 4B orchestrator | game_predictions | yes |
| `lib/services/automodelService.ts` | Auto-model entrypoint + writer | game_predictions | yes |
| `lib/services/gradeDerivationService.ts` | MLB grade derivation | none (pure derivation) | yes |
| `lib/services/lastKnownGoodReader.ts` | sharp_signals_history fallback reader | none (read) | yes |
| `lib/services/linesService.ts` | MLB lines + sharp_signals refresh | lines, line_history, sharp_signals, sharp_signals_history | yes |
| `lib/services/marketCoverageAudit.ts` | Lines/odds/signals coverage audit | none (read) | yes |
| `lib/services/marketCoverageGate.ts` | Lock-gate market coverage | none (read) | no |
| `lib/services/marketSignalDerivationService.ts` | derive sharp-status / line-move tone | none (pure) | yes |
| `lib/services/marketVerdictDerivation.ts` | per-market verdict | none (pure) | yes |
| `lib/services/mlbLinescoreIngestService.ts` | MLB Stats API → first_inning_runs | games (FI runs, scores) | yes |
| `lib/services/perMarketCopyGenerator.ts` | per-market card copy | none (pure) | yes |
| `lib/services/pickBreakdownGenerator.ts` | breakdown text | none (pure) | yes |
| `lib/services/predictionGrader.ts` | shared grader (MLB + NBA + NHL) | none (pure) | yes (updated 2026-06-10 incl. NHL regression) |
| `lib/services/predictionGradingService.ts` | grade writer | prediction_grades | yes |
| `lib/services/predictionRecordService.ts` | prediction_records writer | prediction_records | yes |
| `lib/services/predictionService.ts` | shared prediction entrypoint | game_predictions | partial |
| `lib/services/recommendationConfidence.ts` | confidence calc | none (pure) | yes |
| `lib/services/refreshLogger.ts` | data_refresh_log writer + lock | data_refresh_log | partial |
| `lib/services/scoreIngestService.ts` | MLB BDL score ingest | games | partial |
| `lib/services/sharpReadSelector.ts` | sharp-read derivation | none (pure) | yes |
| `lib/services/signalDerivationService.ts` | signal derivation | none (pure) | yes |
| `lib/services/signalEvidenceClassifier.ts` | signal evidence classification | none (pure) | yes |
| `lib/services/signalSummaryGenerator.ts` | signal-summary text | none (pure) | yes |
| `lib/services/slatePublishService.ts` | slate publish | slate_status | yes |
| `lib/services/slateReconciliation.ts` | slate reconciliation | none (read) | partial |
| `lib/services/slateService.ts` | slate listing/fetch | none (read) | partial |
| `lib/services/slateValidationDecision.ts` | publish decision rules | none (pure) | yes |
| `lib/services/trackingAggregateService.ts` | tracking aggregator | tracking_aggregate | yes |
| `lib/services/trackingBaselineImport.ts` | CSV import | tracking_baselines | partial |
| `lib/services/trackingRefreshService.ts` | hourly tracking refresh (MLB+NBA+NHL) | prediction_records, prediction_grades, tracking aggregates | partial |
| `lib/services/verdictDerivation.ts` | verdict (MLB) | none (pure) | yes |
| `lib/services/weatherService.ts` | weather fetch | weather_forecasts | partial |
| `lib/services/morningSlatePublishPolicy.ts` | publish policy decision | none (pure) | yes |
| `lib/services/lineupService.ts` | lineup ingest | lineups | partial |
| `lib/services/dailyEdgeSlateResolution.ts` | slate resolution for DTO | none (read) | partial |
| `lib/services/dailyEdgeCompletenessAudit.ts` | completeness audit | none (read) | yes |
| `lib/services/firstInningResolver.ts` | FI resolver | none (pure) | yes |
| `lib/services/firstInningSeasonResolver.ts` | FI season resolver | none (pure) | yes |
| `lib/services/firstInningStatsWriter.ts` | FI pitcher stats writer | first_inning_pitcher_stats | partial |
| `lib/services/seasonPitchingStatsWriter.ts` | season-pitching writer | player_season_stats | partial |
| `lib/services/bullpenIngestService.ts` | bullpen ingest | bullpen_pitchers | partial |
| `lib/services/bullpenIngestPlanner.ts` | bullpen plan | none (pure) | partial |
| `lib/services/bdlPlayerBackfillService.ts` | BDL player backfill | players | partial |
| `lib/services/espnProbablePitcherService.ts` | ESPN probable pitcher | none (read) | partial |
| `lib/services/keyStatsFormatter.ts` | key-stats text | none (pure) | partial |
| `lib/services/aiReviewerV1.ts` / `lib/services/aiReviewerWiring.ts` | AI sanity boundary | none (pure stub) | partial |
| `lib/services/providerDateAlignment.ts` | provider date alignment | none (pure) | partial |
| `lib/services/providerMappingService.ts` | provider player ID mapping | provider_player_mappings | partial |
| `lib/services/providerModeAudit.ts` | provider mode audit | none (read) | yes |
| `lib/services/gameLifecycle.ts` | game-lifecycle helpers | none (pure) | partial |
| `lib/services/missingPlayerIngestPlanner.ts` | missing-player planner | none (pure) | partial |
| `lib/services/modelReadinessService.ts` | model readiness audit | none (read) | yes |
| `lib/services/resultsService.ts` | results service | prediction_results | partial |
| `lib/services/scoreIngestService.ts` | score ingest (MLB) | games | partial |
| `lib/services/starterResolver.ts` | starter resolver | none (pure) | partial |
| `lib/services/statsService.ts` | stats fetch | none (read) | partial |
| `lib/services/marketVerdictDerivation.constants.ts` | derivation thresholds | none (constants) | n/a |
| `lib/services/automationGate.ts` | automation gate | none (pure) | yes |
| `lib/services/bannedTermsLinter.ts` | banned-terms linter | none (pure) | yes |
| `lib/services/_idMaps.ts` | ID maps | none (constants) | n/a |
| `lib/services/fiV2Writer.ts` | FI V2 writer | prediction_records (FI fields) | partial |

### 3.3 NBA services (`lib/services/nba/**`)

| File | Purpose | Writes |
|---|---|---|
| `lib/services/nba/adaptNbaToDailyEdgeResponse.ts` | NBA DTO → MLB-shaped DailyEdgeResponse | none (read) |
| `lib/services/nba/buildMarketReviewRows.ts` | market-review rows for NBA card | none (pure) |
| `lib/services/nba/buildNbaDailyEdgeAdapted.ts` | NBA pipeline (read-only, no DB writes) | none |
| `lib/services/nba/buildNbaDailyEdgeDto.ts` | NBA DTO builder | none (pure) |
| `lib/services/nba/buildNbaPredictionRecords.ts:180` | NBA prediction_records writer (Phase 7H + 2026-06-10 stale-skip fix) | prediction_records (insert + update) |
| `lib/services/nba/espnNbaInjuries.ts` | ESPN injury scraper | none (read) |
| `lib/services/nba/etSlateDate.ts` | NBA ET slate-date helper | none (pure) |
| `lib/services/nba/featureSnapshot.ts` | NBA model feature snapshot | none (read) |
| `lib/services/nba/nbaMarketIntelligence.ts:407` | NBA spread/ML/total intel + grade (sign convention boundary at line 407 — fixed 2026-06-10) | none (pure) |
| `lib/services/nba/nbaMarketReview.ts` | NBA grade primitives (`classifySpreadConflict`, `gradeNbaMarket`) | none (pure) |
| `lib/services/nba/nbaOpportunitiesClient.ts` | SharpAPI /opportunities/ev (NBA) | none (read) |
| `lib/services/nba/nbaScoreIngestService.ts` | NBA score ingest (BDL/ESPN) | games | 
| `lib/services/nba/nbaSplitsClient.ts` | SharpAPI /splits (NBA) | none (read) |
| `lib/services/nba/refreshNbaLinesService.ts:308` | NBA lines refresh (2026-06-10 parser fix removed `is_main_line=false` drop) | lines, line_history |
| `lib/services/nba/refreshNbaTeamRatingsService.ts:181` | BBR scrape → nba_team_ratings | nba_team_ratings |
| `lib/services/nba/seedNbaGamesService.ts` | ESPN scoreboard → games + teams (per-day) | games, teams |

### 3.4 NHL services (`lib/services/nhl/**`)

| File | Purpose | Writes |
|---|---|---|
| `lib/services/nhl/adaptNhlToDailyEdgeResponse.ts` | NHL DTO adapter | none (pure) |
| `lib/services/nhl/buildNhlDailyEdgeAdapted.ts` | NHL pipeline | none |
| `lib/services/nhl/buildNhlPredictionRecords.ts` | NHL prediction_records writer | prediction_records |
| `lib/services/nhl/featureSnapshot.ts` | NHL feature snapshot | none (read) |
| `lib/services/nhl/gradeNhlPredictions.ts:86` | NHL grading (2026-06-10 fixes: pending re-grade + UPDATE not INSERT) | prediction_grades |
| `lib/services/nhl/nhlScoreIngestService.ts:52` | NHL /v1/score → games (2026-06-10 fix: ET slate_date in fetch set) | games |
| `lib/services/nhl/refreshNhlGoalieStatsService.ts` | NHL goalie stats refresh | players (goalie fields) |
| `lib/services/nhl/refreshNhlLinesService.ts:198` | NHL lines refresh from SharpAPI | lines, line_history |
| `lib/services/nhl/refreshNhlTeamStatsService.ts` | NHL team stats refresh | teams |
| `lib/services/nhl/seedNhlGamesService.ts` | NHL public API /v1/schedule → games + teams | games, teams |

### 3.5 Automodel (`lib/automodel/**`)

**MLB (multiple versions in tree — Phase 1 must confirm which is active):**
- `lib/automodel/mlbAutoModelV1.ts`
- `lib/automodel/mlbAutoModelV2.ts`
- `lib/automodel/mlbAutoModelV2_1.ts`
- `lib/automodel/mlbAutoModelV2_2.ts`
- `lib/automodel/mlbFirstInningModelV2.ts`
- `lib/automodel/mlbFirstInningFeatureBuilder.ts`
- `lib/automodel/mlbFirstInningMarketBaseline.ts`
- `lib/automodel/mlbIndependentProjection.ts`
- `lib/automodel/mlbV22PosteriorBlend.ts`

**NBA (`lib/automodel/nba/**`):**
- `lib/automodel/nba/blendPosterior.ts:17` — `posterior_spread = home_score - away_score` (positive when home favored — this is the convention boundary that bit us 2026-06-10)
- `lib/automodel/nba/nbaAutoModelV1.ts` — V1 entrypoint
- `lib/automodel/nba/nbaAutoModelV2.ts` — V2 (shadow / not active per Phase 1 to verify)
- `lib/automodel/nba/projectIndependent.ts` — independent projection
- `lib/automodel/nba/nbaDistribution.ts` — distribution helpers
- `lib/automodel/nba/marketPrior.ts` — market prior blending
- `lib/automodel/nba/nbaFeatureWeights.ts` — feature weights
- `lib/automodel/nba/seriesContext.ts` — playoff series context
- `lib/automodel/nba/types.ts` — shared types

**NHL:**
- `lib/automodel/nhlAutoModelV0.ts` — only NHL model file

**Shared/cross-sport:**
- `lib/automodel/aiSanityBoundary.ts` — AI sanity boundary stub
- `lib/automodel/featureSnapshot.ts` — shared feature snapshot
- `lib/automodel/firstInningModelVersion.ts` — FI model version
- `lib/automodel/lockState.ts` — lock-state helpers
- `lib/automodel/marketPrior.ts` — shared market prior
- `lib/automodel/modelVersion.ts` — model version helper
- `lib/automodel/movementThresholds.ts` — movement thresholds
- `lib/automodel/playGrade.ts` — play-grade taxonomy
- `lib/automodel/runDistribution.ts` — MLB run distribution
- `lib/automodel/sharpGradeDirection.ts` — sharp grade direction
- `lib/automodel/snapshotStash.ts` — snapshot stash helper
- `lib/automodel/staleDetection.ts` — stale detection
- `lib/automodel/t60Selection.ts` — T-60 selection
- `lib/automodel/types.ts` — shared types

### 3.6 Providers (`lib/providers/**`)

**Real API:**
- `lib/providers/real_api/BallDontLieProvider.ts` — BDL games + players + lineups + stats
- `lib/providers/real_api/BallDontLieSlateProvider.ts` — BDL slate
- `lib/providers/real_api/OpenWeatherProvider.ts` — weather
- `lib/providers/real_api/SharpAPIOddsProvider.ts` — SharpAPI /odds (MLB)
- `lib/providers/real_api/SharpAPISignalProvider.ts` — SharpAPI /splits + /opportunities (MLB)
- `lib/providers/real_api/_basketballReferenceClient.ts` — BBR HTML scraper (NBA ratings)
- `lib/providers/real_api/_bdlClient.ts` — BDL HTTP client
- `lib/providers/real_api/_espnNbaScoreboardClient.ts` — ESPN NBA scoreboard
- `lib/providers/real_api/_mlbStatsApiClient.ts` — MLB Stats API
- `lib/providers/real_api/_opportunitiesDiscovery.ts` — opportunity discovery
- `lib/providers/real_api/_sharpApiClient.ts` — base SharpAPI client (`https://api.sharpapi.io/api/v1`)
- `lib/providers/real_api/_splitsDiscovery.ts` — splits discovery
- `lib/providers/real_api/_teamNameNormalizer.ts` — MLB team-name normalizer
- `lib/providers/real_api/sharpApiEventIdCandidates.ts` — event_id candidate matching
- `lib/providers/real_api/sharpApiMarketCoverage.ts` — market coverage map

**NHL providers (`lib/providers/nhl/**`):**
- `lib/providers/nhl/_nhlApiClient.ts` — NHL public API `api-web.nhle.com`
- `lib/providers/nhl/_moneyPuckClient.ts` — MoneyPuck (stats)
- `lib/providers/nhl/_sharpApiNhlClient.ts` — SharpAPI NHL adapter
- `lib/providers/nhl/_teamNameNormalizer.ts` — NHL team-name normalizer

**Mock + manual + factory:**
- `lib/providers/factory.ts` — provider factory
- `lib/providers/manual/ManualSlateProvider.ts`
- `lib/providers/mock/*` (6 mock providers)
- `lib/providers/interfaces/*` (6 interface files: IOddsProvider, IParkFactorProvider, IPlayerStatsProvider, ISharpSignalProvider, ISlateProvider, IWeatherProvider)

### 3.7 Calibration + props + tracking (`lib/calibration/**`, `lib/models/**`)

- `lib/calibration/calibrationMath.ts`
- `lib/calibration/calibrationReport.ts`
- `lib/calibration/contextFlags.ts`
- `lib/calibration/sampleSize.ts`
- `lib/calibration/shadowCalibration.ts`
- `lib/models/props/{confidenceScore,contextAdjustments,edgeCalculator,log5Matchup,marcelRegression,propModelOrchestrator,tierClassifier}.ts`
- `lib/models/props/distributions/{binomial,negativeBinomial,poisson}.ts`
- `lib/models/tracking/{aggregator,calibrationComputer,clvCalculator,outcomeResolver}.ts`

### 3.8 Scores model (`lib/scoresModel/**`)

- `lib/scoresModel/factory.ts`
- `lib/scoresModel/ingester.ts`
- `lib/scoresModel/sportSchemas.ts`
- `lib/scoresModel/interfaces/IScoresModelSource.ts`
- `lib/scoresModel/auto/AutoMlbScoresModelSource.ts`
- `lib/scoresModel/manual/ManualScoresModelSource.ts`

### 3.9 Auth (`lib/auth/**`)

- `lib/auth/admin.ts` — `validateAdminAuth`
- `lib/auth/betaSession.ts` — beta cookie session
- `lib/auth/whopAccess.ts` — Whop access check
- `lib/auth/whopConfig.ts` — Whop config
- `lib/auth/whopOAuth.ts` — Whop OAuth handshake
- `lib/auth/whopSession.ts` — Whop session cookie

---

## 4. OPERATOR SCRIPTS (`scripts/operator/**`)

**Total observed: ~104 scripts.** Breakdown:

### 4.1 Probe / debug helpers (prefix `_`, all read-only or one-shot diagnostic) — ~45

Notable entries (full list: `find scripts/operator -name "_*"`):
- `_audit_*` (8 files) — read-only audit probes for tracking, market coverage, play-grade, label-choice, lock state
- `_probe_*` (~12 files) — BDL/SharpAPI/NHL/NBA probes
- `_backfill_*` (4 files) — one-shot DB backfills with two-key gates
- `_restore_lines_now.ts` — pregame-sweep V1 recovery (one-shot)
- `_seabal_*` (3 files) — one-off probes for SEA@BAL diagnostic
- `_trigger_*` (2 files) — one-shot triggers (linescore ingest, tracking refresh)

### 4.2 Production operator workflows — ~50

Selected (full list: `find scripts/operator -name "*.ts" | grep -v "^_"`):
- `automation/run-slate-cycle.ts` — R-19 orchestrator (called by `/api/cron/slate-cycle`)
- `audit-daily-edge-integrity.ts` — Daily Edge Integrity Auditor v1 (MLB only currently)
- `audit-daily-edge-blank-fields.ts`, `audit-daily-edge-completeness.ts`
- `audit-fi-market-coverage.ts`, `audit-market-coverage.ts`
- `audit-mlb-feature-coverage.ts`, `audit-mlb-model-readiness.ts`
- `audit-model-calibration-performance.ts`, `audit-model-edge-calibration.ts`
- `audit-tracking-readiness.ts`, `verify-grading-correctness.ts`
- `automodel-*.ts` (9 files: apply, calibration-backtest, morning-card, rerun-game, rerun-held, show-deltas, status, t60-refresh, v2-shadow, v2-1-shadow, v2-2-shadow)
- `backfill-*.ts` (5 files: bdl-players, bullpen-pitchers, first-inning-stats, provider-mappings, season-pitching-stats)
- `calibration-report.ts`
- `cleanup-wrong-slate-games.ts`
- `create-prediction-records.ts`
- `cutover-fi-v2-unstarted-2026-06-06.ts`, `cutover-v22-unstarted-2026-06-06.ts`
- `discover-whop-resources.ts`
- `dry-run-fi-whip.ts`, `fi-v2-threshold-calibration.ts`, `first-inning-v2-shadow.ts`
- `grade-predictions.ts`, `manual-grade-slate.ts`
- `hide-slate.ts`, `publish-slate.ts`
- `import-tracking-baseline.ts`
- `ingest-final-scores.ts`, `ingest-missing-pitchers.ts`, `ingest-mlb-linescores.ts`
- `manual-map-provider-ids.ts`
- `null-stale-cole-stats.ts`
- `pregame-sweep-status.ts`
- `refresh-lines.ts`, `refresh-lineup-coverage.ts`, `refresh-mlb-stats-from-splits.ts`, `refresh-sharp-signals.ts`, `refresh-slate.ts`, `refresh-starters.ts`, `refresh-teams.ts`, `refresh-weather-coverage.ts`
- `regenerate-breakdowns-4_1_8.ts`
- `repair-mlb-model-readiness.ts`
- `unlock-game.ts`
- `oneoff/refresh-missing-lines-2026-06-06.ts`

### 4.3 NBA-specific (`scripts/operator/nba/**`)
- `backfill-nba-prediction-records.ts`, `refresh-nba-lines.ts`, `refresh-nba-team-ratings.ts`, `run-nba-prediction.ts`, `seed-nba-all-teams.ts` (NEW 2026-06-10), `seed-nba-finals.ts`

### 4.4 NHL-specific (`scripts/operator/nhl/**`)
- `grade-nhl-games.ts`, `refresh-nhl-goalie-stats.ts`, `refresh-nhl-lines.ts`, `refresh-nhl-team-stats.ts`, `run-nhl-prediction.ts`, `seed-nhl-games.ts`, `write-nhl-prediction-records.ts`

### 4.5 Write gate pattern
All write-capable operator scripts use a two-key safety pattern: `--apply` flag PLUS `*_DB_WRITES_ENABLED=true` env var. Common gates observed: `AUTOMODEL_DB_WRITES_ENABLED`, `LINES_DB_WRITES_ENABLED`, `SHARP_SIGNAL_DB_WRITES_ENABLED`, `SLATE_DB_WRITES_ENABLED`, `PREDICTION_RECORDS_DB_WRITES_ENABLED`, `PREDICTION_GRADES_DB_WRITES_ENABLED`, `TEAMS_DB_WRITES_ENABLED`, `BDL_PLAYER_BACKFILL_DB_WRITES_ENABLED`, `WEATHER_COVERAGE_DB_WRITES_ENABLED`, `LINEUP_COVERAGE_DB_WRITES_ENABLED`, `STARTER_DB_WRITES_ENABLED`, `BULLPEN_DB_WRITES_ENABLED`, `FIRST_INNING_DB_WRITES_ENABLED`, `SEASON_PITCHING_DB_WRITES_ENABLED`, `PROVIDER_MAPPING_DB_WRITES_ENABLED`, `SLATE_PUBLISH_DB_WRITES_ENABLED`, `SLATE_HIDE_DB_WRITES_ENABLED`, `SLATE_UNLOCK_DB_WRITES_ENABLED`, `MLB_LINESCORE_DB_WRITES_ENABLED`, `STATS_CLEANUP_DB_WRITES_ENABLED`, `BDL_DB_WRITES_ENABLED`, `MLB_MODEL_READINESS_REPAIR_DB_WRITES_ENABLED`, `SCORE_INGEST_DB_WRITES_ENABLED`, `TRACKING_BASELINE_DB_WRITES_ENABLED`, `SHARP_LINES_RECOVERY_DB_WRITES_ENABLED`, `PLAYER_INGEST_DB_WRITES_ENABLED`, `_CUTOVER_DB_WRITES_ENABLED`.

---

## 5. AUDIT + TEST SCRIPTS

### 5.1 Audit (`scripts/audit/**`)
- `scripts/audit/nba/backtest-nba-predictions.ts` — NBA v1 calibration backtest (target: 30+ settled games)
- `scripts/audit/nba/calibration-report.ts` — NBA calibration report
- `scripts/audit/nba/compare-nba-v0-v1.ts` — v0 vs v1 NBA shadow comparison

### 5.2 Tests (`scripts/test-*.ts`)
**~140+ files.** Categories:
- Unit (pure-logic): grade-derivation, calibration math, distributions, signal-derivation, market-signal-derivation, derive-market-signal-regression, pick-breakdown-generator, perMarketCopyGenerator, signal-summary-generator, signal-evidence-classifier, sharp-grade-direction, play-grade, prediction-grader, **test-nba-spread-sign-convention.ts (NEW 2026-06-10)**
- Integration / smoke: lab-daily-edge, lab-player-props, lab-tracking, lab-calibration, lab-api, prediction-results, market-coverage-audit, slate-dates, slate-publish, manual-slate, admin-upload, automodel-orchestrator (live), automation-orchestrator-cron, scores-model, foundational-crons, refresh-cycle-crons, weekly-crons
- Live probes (skipped in CI): mlb-stats-api-live, openweather-live, sharpapi-multibucket, sharpapi-provider, sharpapi-event-id-mapping
- Regression: banned-terms-linter, daily-edge-completeness-audit, line-move-tone, theme-aliases, props-math, distributions, tracking
- Other: tests for adapter-factory, production-source-filter, threshold-constants, auth-gate, signal-summary-generator

### 5.3 Daily Edge Integrity Auditor (existing — MLB only)
`scripts/operator/audit-daily-edge-integrity.ts`
- CLI: `--sport mlb`, `--date YYYY-MM-DD`, `--game-id N`, `--market moneyline|total|first_inning`, `--strict`, `--json`, `--base-url`
- Exit codes: 0 clean (non-strict), 1 HIGH or strict mode, 2 fatal
- Categories: A_lock_contract, B_public_splits, C_lines_odds, D_tracking_grading, E_thinning
- NPM script: `npm run audit:daily-edge`

---

## 6. PAGES (UI)

### 6.1 Lab (member-facing) — `app/lab/**/page.tsx`
- `/lab` → redirects to `/lab/daily-edge`
- `/lab/daily-edge` — Daily Edge product surface (consumes `/api/lab/daily-edge`, sport-aware)
- `/lab/player-props` — Coming Soon stub
- `/lab/tracking` — tracking page (consumes `/api/lab/tracking-foundation`)
- `/lab/track-record` — lifetime totals
- `/lab/my-bets` — Coming Soon stub
- `/lab/account` — account management
- `/lab/design-preview` — design sandbox

### 6.2 Admin — `app/admin/**/page.tsx`
- `/admin/auto-predictions` — pre-publish predictions preview (mlb)
- `/admin/slate` — manual slate upload
- `/admin/scores-model` — manual scores upload (mlb)
- `/admin/cron-status` — cron health dashboard
- `/admin/tracking` — admin tracking
- `/admin/nba-preview` — NBA Finals v0a preview
- `/admin/nba-daily-edge-preview` — NBA Daily Edge debug

### 6.3 Other public
`/`, `/picks` (redirects), `/track-record`, `/pricing`, `/tools`, `/login`, `/join`, `/legal/{terms,privacy,responsible-gambling}`

---

## 7. DATABASE TABLES (live row counts as of 2026-06-10)

| Table | Rows | Notes |
|---|---|---|
| `games` | 583 | sport mix: mlb=578, nba=4, nhl=1 |
| `teams` | 62 | includes mlb + nba + nhl + others |
| `players` | 685 | |
| `prediction_records` | 223 | locked-snapshot store |
| `game_predictions` | 478 | pre-lock model output (current/working) |
| `lines` | 3,188 | current market state |
| `line_history` | 161,826 | append-only |
| `sharp_signals` | 371 | current |
| `sharp_signals_history` | 8,728 | append-only |
| `prediction_grades` | 223 | v17+ grades (1:1 with prediction_records) |
| `prediction_results` | 453 | legacy results (some pre-v17) |
| `prediction_breakdowns` | 0 | empty (breakdown text now inline in snapshot_json?) — ⚠ Phase 1 to confirm |
| `nba_team_ratings` | 4 | only 2 NBA teams have rows (Finals only) |
| `mlb_team_ratings` | error — table does not exist | ⚠ MLB ratings stored elsewhere — Phase 1 to confirm |
| `nhl_team_ratings` | error — table does not exist | ⚠ NHL ratings stored elsewhere |
| `lineups` | 1,134 | |
| `weather_forecasts` | 88 | |
| `prop_predictions` | 129 | |
| `data_refresh_log` | 574 | cron run audit |
| `tracking_baselines` | 17 | |
| `tracking_aggregate` | error — table does not exist | ⚠ Phase 1 to confirm aggregator destination |
| `calibration_buckets` | 11 | |
| `admin_audit_log` | 180 | |
| `scores_model_runs` | 18 | |
| `ballparks` | 30 | |
| `player_season_stats` | 566 | |
| `manual_slate_staging` | 0 | empty (no manual slates in V1) |
| Tables that DO NOT exist (returned error): `mlb_team_ratings`, `nhl_team_ratings`, `player_stats`, `season_pitching`, `pitcher_stats`, `weather`, `slate_state`, `slates`, `slate_publishes`, `first_inning_data`, `tracking_aggregate`, `player_props`, `bullpen_pitchers`, `first_inning_pitcher_stats`, `provider_player_mappings`, `grades`, `market_signals`, `slate_status` | ⚠ Either deprecated, renamed, or never created. Phase 1 must classify each. |

---

## 8. ENV GATES (consolidated)

**Cron / auth:**
- `CRON_SECRET` (validated by cronHandler)
- `SHARPAPI_KEY`
- `BDL_API_KEY` (BallDontLie)
- `OPENWEATHER_API_KEY`
- `WHOP_CLIENT_ID`, `WHOP_CLIENT_SECRET`, `WHOP_API_KEY`, `WHOP_RESOURCE_ID`, `WHOP_SESSION_SECRET`
- `LAB_BETA_PASSWORD`

**Sport activation:**
- `NBA_CRON_ENABLED` (gates `/api/cron/nba-daily-refresh` writes)
- `NHL_CRON_ENABLED` (gates `/api/cron/nhl-daily-refresh` writes) — confirmed live in prod as of 2026-06-10

**Behavior gates:**
- `MORNING_SLATE_AUTO_PUBLISH`
- `PREGAME_SWEEP_CRON_ACTIVE`
- `PREGAME_SWEEP_DRY_RUN`
- `ORCHESTRATOR_SKIP_CONFIRMATION`
- `FEATURE_COVERAGE_AUTO_REFRESH_ENABLED`
- `WEATHER_PROVIDER` (real_api | mock)
- `PLAYER_STATS_PROVIDER` (real_api | mock)
- `DAILY_REFRESH_DANGEROUS_ENABLE` (tripwire — keeps old daily-refresh route blocked)

**Operator write-gates** — see §4.5 above (28 distinct `*_DB_WRITES_ENABLED` env vars). ⚠ Phase 1 to confirm none of these are required for any cron-driven writes (they should be operator-script only).

**Local dev bypass:**
- `middleware.ts:99-127` — `process.env.NODE_ENV === "development"` + localhost hostname → bypass auth on `/lab/*` and `/api/lab/*`. Not in scope of c87b20d push.

---

## 9. EXTERNAL PROVIDERS

| Provider | Used for | Sport(s) | Tier/Key | Where in code |
|---|---|---|---|---|
| SharpAPI (`api.sharpapi.io/api/v1`) | /odds, /splits, /opportunities/ev | mlb, nba, nhl | tier=`sharp` (features: odds, schedule, ev, arbitrage, middles, low_hold, closing_line, splits); max_books=25, 1000 rpm | `lib/providers/real_api/_sharpApiClient.ts` |
| BallDontLie (BDL) | games, players, lineups, stats, season-pitching | mlb (primary), nba | API key | `lib/providers/real_api/_bdlClient.ts` |
| ESPN public APIs | scoreboard (NBA), injuries (NBA), probable pitcher (MLB) | nba, mlb | no key | `lib/providers/real_api/_espnNbaScoreboardClient.ts`, `lib/services/espnProbablePitcherService.ts`, `lib/services/nba/espnNbaInjuries.ts` |
| Basketball Reference (BBR) | NBA per-possession + Four-Factor + playoff ratings (HTML scrape) | nba | no key (robots-aware) | `lib/providers/real_api/_basketballReferenceClient.ts` |
| MLB Stats API (`statsapi.mlb.com`) | linescore (FI runs), schedule, players | mlb | no key | `lib/providers/real_api/_mlbStatsApiClient.ts` |
| NHL public API (`api-web.nhle.com`) | /v1/schedule, /v1/score, /v1/gamecenter | nhl | no key | `lib/providers/nhl/_nhlApiClient.ts` |
| MoneyPuck | NHL advanced stats | nhl | no key | `lib/providers/nhl/_moneyPuckClient.ts` |
| OpenWeather | weather forecasts | mlb | API key | `lib/providers/real_api/OpenWeatherProvider.ts` |
| FanGraphs | park factors (planned Phase 7; currently mock) | mlb | no key | `lib/providers/mock/MockParkFactorProvider.ts` (production), interface `IParkFactorProvider` |
| Whop | auth/OAuth + access check | platform-wide | OAuth | `lib/auth/whop*.ts` |

---

## 10. ACTIVE SPORTS / MODELS (inventory only)

**Sports with at least one prediction_record:**
- mlb — 578 games in DB, 478 game_predictions, 223 prediction_records, 223 prediction_grades, 11 calibration_buckets
- nba — 4 games in DB (Finals only), 2 active prediction_records for tonight (pr.id 899, 900)
- nhl — 1 game in DB (Stanley Cup G2), 2 prediction_records for 6/9 game (pr.id 946, 947)

**Sports in `VALID_SPORTS` enum (`app/api/lab/daily-edge/route.ts:88`):** mlb, nba, nfl, cbb, cfb, nhl, ucl. Only mlb + nba + nhl have any current data.

**Sports referenced in vercel.json crons:** mlb (via slate-cycle), nba (via nba-daily-refresh), nhl (via nhl-daily-refresh, NHL_CRON_ENABLED=true). All three additionally covered by tracking-refresh hourly.

**Models present in code:**
- MLB: mlbAutoModelV1, V2, V2_1, V2_2 + FI model V2 + several supporting pieces. Active version: ⚠ Phase 1 to confirm.
- NBA: nbaAutoModelV1 (active), nbaAutoModelV2 (shadow / not active per file comment).
- NHL: nhlAutoModelV0 only.
- Player Props: distributions + Marcel regression + log5 + tier classifier; live for MLB only per route exposure.
- Soccer / NFL: no model files found.

---

## 11. KNOWN COVERAGE GAPS (for Phase 1+ to investigate, not conclusions)

Items flagged during compilation that require deeper Phase 1+ investigation:

1. **Several DB table names returned errors** when probed by name (mlb_team_ratings, nhl_team_ratings, market_signals, slate_status, grades, prediction_breakdowns shown 0, etc.). Need schema introspection in Phase 1 to confirm actual table names.
2. **`prediction_breakdowns` table has 0 rows** but is referenced in code paths. Phase 1 to confirm whether breakdowns now live in `snapshot_json` only.
3. **Cron routes defined in code but not scheduled in vercel.json** (afternoon-refresh, evening-refresh, midday-refresh, morning-slate, lineup-watch, post-game-results, weekly-calibration, weekly-park-factors). Status unclear.
4. **MLB active automodel version** — multiple versions in tree (V1, V2, V2_1, V2_2). Which is active in prod is not visible from file presence alone; Phase 1 to confirm via `automodelService` and `resolveAutomodelVersion`.
5. **NBA v2 vs v1** — v2 exists; comments suggest v0/v1 are active. Phase 1 to verify.
6. **NHL only has V0** — `nhlAutoModelV0.ts` is the sole NHL model. Phase 1 to verify what V0 actually does.
7. **Operator write-gate sprawl** — 28+ `*_DB_WRITES_ENABLED` env vars. Phase 1 to check whether any cron route depends on any of these (it shouldn't).
8. **Auditor MLB-only** — `audit-daily-edge-integrity.ts` only covers MLB. Phases 1–6 produce the cross-sport generalization plan.
9. **`scores_model_runs` table** (18 rows) — referenced by `app/api/admin/upload-scores-model/route.ts`. Phase 1 to verify table schema + retention.
10. **No regression tests yet exist** for: NBA stale-skip fix (c87b20d), NBA lines parser dedupe (c87b20d), NHL score-ingest ET fix (c87b20d), NHL pending-grade UPDATE (c87b20d). Sign-convention test exists (e53bba2).

---

## 12. WHAT THIS PHASE DOES NOT DO

- Does NOT classify any sport as TRUSTED, PARTIAL, BLOCKED, or NOT LAUNCH READY — that's Phase 1.
- Does NOT assess code quality, model correctness, or UI honesty — Phases 1–5.
- Does NOT propose fixes — Phase 6 + post-audit.
- Does NOT run calibration math — Phases 1–3 conditional on adequate sample size.
- Does NOT cite line numbers for every internal helper — only for entrypoints and notable surface boundaries.

Phase 1 begins with: per-layer comparison of MLB vs NBA vs NHL across the 17-layer production chain Daniel laid out (schedule → catalogue → source data → lines → line_history → sharp/public signals → sharp_signals_history → prediction generation → prediction_records → pre-lock refresh → locked snapshot → DTO/card → UI labels/rationale → final score ingest → grading → tracking → auditor/fixer coverage → cron coverage → manual intervention dependencies).
