# Phase 1 — Cross-Sport Critical-Path Audit

**Audit:** Daily Edge platform site/model-wide reliability audit
**Date:** 2026-06-10
**Phase:** 1 — read-only critical-path comparison MLB vs NBA vs NHL
**Predecessor:** [Phase 0 inventory](./00-inventory.md) (`8473910`)
**Standards:** evidence-backed only; no "should work"; no "probably fine"; HIGH issues escalate immediately.

---

## Executive summary

| Sport | Overall classification | Reason |
|---|---|---|
| **MLB** | **PARTIAL** | All 19 layers have implementations; 17 verified, 2 partial (auditor MLB-only is fine; manual deps for FI grading bridge + season-stat backfill remain). No HIGH issues found tonight. Closest to TRUSTED. |
| **NBA** | **PARTIAL — BLOCKED for full-trust** | 3 layers VERIFIED, 7 PARTIAL, 5 FAILING, 4 UNVERIFIABLE. Multiple HIGH-equivalent gaps: no sharp_signals writer for NBA (ever), `data_quality_tier="high"` despite `has_splits=false` is misleading, spread rendered but not tracked. Sign-flip bug fixed today (`e53bba2`) but underlying calibration unverified. |
| **NHL** | **PARTIAL — narrow Stanley Cup scope only** | Stanley Cup pipeline works end-to-end after today's fixes (`c87b20d`, `c831489`); 6/9 game graded WIN/WIN. But NHL has only 2 teams + 1 game ever ingested; cron is freshly active; broader NHL season not validated. Auditor is MLB-only. |

**Production status as of this audit:**
- 0 active HIGH issues affecting tonight's slate that were not already fixed today.
- 1 NBA UI honesty issue ranked as HIGH: `data_quality_tier="high"` while `has_splits=false` is shipped to the card (does not block the slate, but misleads users about data confidence). Recommend fix before next NBA slate.
- 0 NHL HIGH issues for the Stanley Cup scope. The next game tonight will be the first end-to-end live test of the full automated chain.

**No emergency fixes required during this audit.** Continuing per the audit protocol.

---

## Phase 0 follow-up findings (the 9 numbered investigations)

### FU-1. Nine cron routes defined in code but not in `vercel.json`

Status reconciliation: `slate-cycle` IS scheduled in `vercel.json` (8 morning entries + 14 intraday entries). The 9 routes below are either independent intraday helpers or weekly/post-game services. Verified by reading each route's top comment.

| Route | File:line | Status | Sport(s) | Writes | Risk if absent |
|---|---|---|---|---|---|
| `afternoon-refresh` | `app/api/cron/afternoon-refresh/route.ts:1-7` | **Orphaned (functionality covered by `slate-cycle?intraday=true`)** | mlb/nba/nhl in-season | lines, line_history, sharp_signals, weather_forecasts | Low — covered by hourly intraday slate-cycle |
| `evening-refresh` | `app/api/cron/evening-refresh/route.ts:2-14` | **Orphaned (covered by `slate-cycle?intraday=true` 19-23 UTC entries)** | mlb/nba/nhl | lines, props, sharp_signals, lineups, weather, prop_predictions | Low — covered |
| `daily-refresh` | `app/api/cron/daily-refresh/route.ts:2-71` | **Intentionally disabled (Phase 4.3 tripwire — BDL ID-namespace mismatch)** | mlb | none (returns 503) | None — intentional |
| `midday-refresh` | `app/api/cron/midday-refresh/route.ts:2-8` | **Orphaned (covered by `slate-cycle?intraday=true` 12-18 UTC entries)** | mlb/nba/nhl | lines, line_history, sharp_signals | Low — covered |
| `morning-slate` | `app/api/cron/morning-slate/route.ts:2-32` | **Orphaned (replaced by `slate-cycle` morning entries at 8/10/12 UTC)** | mlb | games, lines, props, sharp_signals, weather, predictions, signals, grades, slate_status | Low — `slate-cycle` calls the same underlying services |
| `lineup-watch` | `app/api/cron/lineup-watch/route.ts:2-9` | **Production gap** | mlb/nba/nhl | lineups, prop_predictions | **MEDIUM** — late lineup scratches may not be caught by slate-cycle (slate-cycle doesn't include per-15-min lineup refresh). Pregame-sweep at `*/15` does NOT call lineupService. |
| `post-game-results` | `app/api/cron/post-game-results/route.ts:2-16` | **Orphaned-but-needed (functionality covered by `tracking-refresh` hourly)** | mlb/nba/nhl | prediction_records.status, prediction_results, tracking_aggregates | Low — `tracking-refresh` covers MLB+NBA+NHL hourly |
| `weekly-calibration` | `app/api/cron/weekly-calibration/route.ts:2-8` | **Production gap** | cross-sport | calibration_buckets | **MEDIUM** — calibration buckets stale → tracking UI shows stale confidence calibration. Last refresh date should be checked. |
| `weekly-park-factors` | `app/api/cron/weekly-park-factors/route.ts:2-10` | **Production gap (MLB only)** | mlb | ballparks.park_factor_* | **MEDIUM** — MLB park factors stale → model input degraded. Last refresh date should be checked. |

**Classification rules used:**
- **Orphaned** — the underlying services are called by other scheduled crons, so the route itself being unscheduled doesn't break production.
- **Production gap** — the route's functionality is NOT covered by any other scheduled cron, and its absence has real reliability impact.
- **Intentionally disabled** — gated by an explicit tripwire env var.

**Recommendation (deferred to Phase 6 roadmap):** schedule `lineup-watch`, `weekly-calibration`, and `weekly-park-factors`. Confirm `data_refresh_log` whether the orphaned routes have been triggered manually recently — if yes, they're being used as escape hatches; if no, they're safe to delete in a cleanup pass.

### FU-2. DB tables that returned errors in Phase 0 — **all reconciled**

Phase 0 probed certain tables and got null/error responses. **Re-probe shows ALL listed tables actually exist in the schema.** The errors were Supabase returning `rows=null` for empty/restricted tables, not "table not found." Reconciliation table:

| Table | Phase 0 status | Actual status | Code references | Classification |
|---|---|---|---|---|
| `mlb_team_ratings` | "error" | EXISTS, empty | None found in `lib/`, `app/`, `scripts/` | **DEAD** — never used |
| `nhl_team_ratings` | "error" | EXISTS, empty | None found | **DEAD** — never used |
| `player_stats` | "error" | EXISTS, empty | None found | **DEAD** |
| `season_pitching` | "error" | EXISTS, empty | None found by table name | **DEAD** — actual table is `player_season_stats` (566 rows) — see `lib/services/seasonPitchingStatsWriter.ts:189-220` |
| `pitcher_stats` | "error" | EXISTS, empty | None found | **DEAD** |
| `weather` | "error" | EXISTS, empty | None found by table name | **DEAD** — actual table is `weather_forecasts` (88 rows) — see `lib/services/predictionService.ts:145`, `lib/services/automodelService.ts:568` |
| `slate_state` | "error" | EXISTS, empty | None found | **DEAD** — state lives on `games.slate_status` column |
| `slates` | "error" | EXISTS, empty | None found | **DEAD** — replaced by `games.slate_date` + `manual_slate_staging` |
| `slate_publishes` | "error" | EXISTS, empty | None found | **DEAD** |
| `first_inning_data` | "error" | EXISTS, empty | None found | **DEAD** — FI data lives on `games.first_inning_runs` + `prediction_records.snapshot_json` |
| `tracking_aggregate` | "error" | EXISTS, empty | Code references `tracking_aggregates` (plural) at `lib/services/resultsService.ts:312` and `lib/services/trackingAggregateService.ts` | **RENAMED** — `tracking_aggregate` table is dead; live table is `tracking_aggregates` |
| `player_props` | "error" | EXISTS, empty | Live table is `prop_predictions` (129 rows) — `lib/services/predictionService.ts`, `app/api/lab/player-props/route.ts` | **RENAMED / DEAD** |
| `bullpen_pitchers` | "error" | EXISTS, empty | `lib/services/bullpenIngestService.ts` exists; no current `.from("bullpen_pitchers")` writes found in lib | **STUB** — service is partial/incomplete |
| `first_inning_pitcher_stats` | "error" | EXISTS, empty | `lib/services/firstInningStatsWriter.ts:139` writes to `player_season_stats` (not this table) | **DEAD** |
| `provider_player_mappings` | "error" | EXISTS, empty | `lib/services/providerMappingService.ts` exists but writes appear inert | **STUB** |
| `grades` | "error" | EXISTS, empty | All grading writes go to `prediction_grades` (223 rows) — `lib/services/predictionGradingService.ts:1` | **DEAD** |
| `market_signals` | "error" | EXISTS, empty | `lib/services/marketSignalDerivationService.ts` writes signal data into `game_predictions.sport_specific` JSON, not this table | **DEAD** |
| `slate_status` | "error" | EXISTS, empty | All status writes go to `games.slate_status` column | **DEAD** (column lives elsewhere) |

**Net production risk:** Zero. No active code path is broken because of these dead/empty tables.

**Cleanup recommendation (Phase 6 roadmap):** drop the 18 dead tables in a single schema migration after a confirmation pass that nothing reads them. The empty schema entries add noise to introspection but do not affect runtime.

### FU-3. `prediction_breakdowns` (0 rows) — DEAD/MIGRATED

Status: **DEAD/DEPRECATED.** Breakdown content has migrated into JSON columns on the active tables.

| Where breakdowns live now |
|---|
| `prediction_records.snapshot_json` — contains `ml_play_grade`, `ou_play_grade`, `model_integrity_notes`, `ml_best_angle_reason`, `ou_best_angle_reason`, `nrfi_reason_codes`, etc. Verified by direct DB sample (Phase 0 §7). |
| `game_predictions.sport_specific` — `breakdown_v2` field per `lib/services/pickBreakdownGenerator.ts:30-37` comment ("Phase 4.1.8.A: model-prose breakdown lives in `sport_specific.breakdown_v2`"). |

**Remaining references to `prediction_breakdowns`:**
- `scripts/predict-tonight.ts` — script-only writer (operator-only)
- `scripts/test-prediction-results.ts` — test-only
- `lib/types/domain/PropPrediction.ts:1` — type definition

**No active member-facing code reads from `prediction_breakdowns`.** Card rationale is sourced from `snapshot_json` / `sport_specific.breakdown_v2`.

**Risk:** None for member experience. Table is safe to drop post-confirmation pass.

### FU-4. Active MLB automodel version — **V2.2 confirmed in production**

| Evidence |
|---|
| Live DB query: most recent 46 of 50 MLB prediction_records have `model_version="auto_v2.2_mlb_full_game_projection"` |
| Constant source: `lib/automodel/types.ts:1247` defines `MODEL_VERSION_V2_2 = "auto_v2.2_mlb_full_game_projection"` |
| Writer: `lib/services/automodelService.ts:1083-1147` — when effectiveVersion=`v2_2`, invokes `runMlbAutoModelV2_2(snap, v1Output, stage)`; v1 fallback exists at lines 1088-1099 (`model_used: "v2_2_fallback_v1"`) |
| Version resolver: `lib/automodel/modelVersion.ts:27-53` — `resolveAutomodelVersion()` reads `AUTOMODEL_VERSION` env, defaults to `"v1"` |
| Env activation: production must be running with `AUTOMODEL_VERSION=v2_2` for V2.2 to be the active version. The default code path returns v1. |

**Implication for the audit:**
- The codebase ships V1, V2, V2_1, V2_2 — production is on V2.2 per live data.
- V2.2 fallback to V1 path exists for error recovery.
- Tracking/grading uses `prediction_grades.prediction_record_id` and is version-agnostic; no version compatibility issue confirmed.
- **NBA equivalent:** `nba_v0_2026` is the only NBA model in production (per `prediction_records.model_version`).
- **NHL equivalent:** `nhl_v0_2026_finals` is the only NHL model in production.

### FU-5. Missing regression tests — Phase 1 findings

Per Daniel's instructions, NOT writing tests during the read-only audit. Listing here with severity and recommended test file paths:

| Bug fixed today | Severity | Test exists? | Recommended test file |
|---|---|---|---|
| NBA stale-skip — pre-lock predictions now refresh (commit `c87b20d`) | **HIGH** | ❌ no | `scripts/test-nba-prediction-records-stale-skip.ts` — assert that `createNbaPredictionRecords` UPDATEs pre-lock rows with new intel + attribution; verify locked rows still skipped |
| NBA lines parser dedupe — `is_main_line=false` no longer drops; odds-closest-to-110 dedupe (commit `c87b20d`) | **HIGH** | ❌ no | `scripts/test-nba-lines-parser-dedupe.ts` — fixture: 5 onexbet spread rows at different points, all `is_main_line=false`; assert dedupe keeps one row per (game,market,side,sportsbook) with odds closest to -110 |
| NHL score-ingest ET slate_date — UTC-derived date no longer breaks late-evening tips (commit `c87b20d`) | **HIGH** | ❌ no | `scripts/test-nhl-score-ingest-et-date.ts` — fixture: game_date `2026-06-10T00:00:00Z` (8pm ET on 06-09); assert fetch URL includes `2026-06-09` (the ET slate_date) |
| NHL pending-grade UPDATE — pending placeholder grades now update post-final (commit `c87b20d`) | **HIGH** | ❌ no | `scripts/test-nhl-grading-pending-update.ts` — fixture: existing `prediction_grades` row with result="pending"; final score arrives; assert UPDATE-in-place not INSERT (no dup, id preserved) |
| NBA spread sign-convention — `predicted_spread_home` consumer negation (commit `e53bba2`) | **HIGH** | ✅ yes | `scripts/test-nba-spread-sign-convention.ts` (5 tests, all pass) |

**4 missing test files. Recommendation: add as Phase 6 immediate roadmap items.**

### FU-6. Operator env gates in cron code paths — **CLEAN**

Verified by direct grep across all cron route files and the services they call:

| Env gate | Cron usage? | Notes |
|---|---|---|
| `BDL_PLAYER_BACKFILL_DB_WRITES_ENABLED` | Yes — `feature-coverage-refresh/route.ts:114` | This is a *scheduled* cron (vercel.json), so the gate is the cron itself opting-in. Acceptable. |
| All 27 other `*_DB_WRITES_ENABLED` operator gates | **No matches in any cron route or cron-called service** | Clean — production crons do not depend on operator-only env vars. |

`automationOrchestratorGates.ts:18-38` defines per-step env vars but these gate the *scheduled* slate-cycle, not operator paths.

**Conclusion: No reliability risk from operator env gates in production cron behavior.**

### FU-7. NBA sharp/public/splits and market movement — **MULTIPLE GAPS**

Status across the NBA pipeline:

| Question | Answer | Evidence |
|---|---|---|
| Does NBA have a sharp_signals writer? | **NO** | `sharp_signals` rows for any NBA game ever: **0**. No `from("sharp_signals")` write found in `lib/services/nba/**`. The `nbaSplitsClient.ts` and `nbaOpportunitiesClient.ts` are read-only DTO inputs, not DB writers. |
| Will late-arriving NBA splits be captured? | **NO automatically** | No cron writes NBA `sharp_signals`. SharpAPI vendor data is genuinely thin for NBA tonight ([memory: `project-sharpapi-nba-coverage-gap`](../../.claude/projects/-Users-danielmengel-Projects-oddsphere/memory/project_sharpapi_nba_coverage_gap.md)) but even if richer data appears at 6 PM, our pipeline has no consumer for it. |
| Does NBA model use sharp/public/market movement? | **NO** | `lib/services/nba/nbaMarketReview.ts:gradeNbaMarket` inputs: `pick, confidence, band, edge, dataQualityTier, injuriesKnown`. No splits parameter. No line_movement parameter. The DTO renders a `line_movement` block but the grader ignores it. |
| Does the card imply splits are used? | **YES** | `prediction_records.data_quality_tier="high"` is computed from book_count + lines + opportunities; `has_splits` is NOT a factor. So a card shows "high data quality" while `snapshot.has_splits=false`. **Verified live for tonight's pr.id=899 (NBA ML home).** This is HIGH severity UI honesty issue. |
| Is spread modeled or only displayed? | **DTO-only — NOT tracked** | `lib/services/nba/buildNbaPredictionRecords.ts:7-14` explicit comment: "Markets: moneyline and total ONLY. Spread… intentionally NOT written." Card renders `intel.spread` with a grade label, but no prediction_record exists for it. Auditor cannot detect a wrong spread grade. |

**Severity classification for Phase 6 roadmap:**
- HIGH: `data_quality_tier="high"` when `has_splits=false` — downgrade tier or surface splits unavailability explicitly
- HIGH: NBA spread persistence — either write to `prediction_records` so it's tracked + auditor-visible, or mark card as "derived, not tracked"
- MEDIUM: build NBA sharp_signals writer (ingest whatever SharpAPI returns, however thin, with provenance) so the no-skip guarantee holds when data later improves

### FU-8. NHL automation — **WIRED + ENABLED, narrow scope validated**

| Check | Status | Evidence |
|---|---|---|
| `nhl-daily-refresh` route exists in code | ✅ | `app/api/cron/nhl-daily-refresh/route.ts:46` (commit `c831489`) |
| Scheduled in `vercel.json` | ✅ | `vercel.json` line: `45 13 * * *` |
| Env gate `NHL_CRON_ENABLED=true` set in prod | ✅ | Confirmed by Daniel directly |
| Score ingest uses ET slate_date | ✅ | Fixed today commit `c87b20d`; verified backfill of game 15204 finalized status FUT→OFF |
| Grading correctly updates pending placeholders | ✅ | Fixed today commit `c87b20d`; pr.id 946 (CAR ML) + pr.id 947 (OVER 5.5) corrected to WIN/WIN |
| Future NHL games can be seeded/finalized/graded without manual scripts | ⚠ Partially | The full chain works for ONE-game Stanley Cup slate. Multi-game slate not yet exercised. Per `prediction_records.model_version="nhl_v0_2026_finals"` — model is Finals-scoped only. |

**Production reality check:** Only 1 NHL game has ever been in DB (`game_id=15204`). Tonight's Stanley Cup Game 3 will be the first live end-to-end automated run. The Phase 1 audit cannot certify this works for general NHL season yet — only for the narrow Stanley Cup case. Classified as PARTIAL.

### FU-9. MLB benchmark — what does "trusted" look like?

MLB has implementations across all 17+2 layers per the [agent investigation §3](#mlb-benchmark-17-layers). Used as the reference for NBA + NHL gap analysis below.

---

## The 19-layer × 3-sport critical-path matrix

For each layer × sport, classification:
- **VERIFIED** — implementation exists, runs automatically on schedule, tested or has live evidence
- **PARTIAL** — exists but missing test coverage, has known gaps, or requires manual intervention in normal operation
- **FAILING** — actively broken, contract not met, or no implementation
- **UNVERIFIABLE** — no historical data to validate (e.g., sport hasn't completed a game yet)

### Layer 1 — Schedule/game seeding

| Sport | Status | Evidence |
|---|---|---|
| MLB | **VERIFIED** | `lib/providers/real_api/BallDontLieSlateProvider.ts` called from `slate-cycle` hourly + `morning-slate`. 578 MLB games in DB. |
| NBA | **PARTIAL** | `lib/services/nba/seedNbaGamesService.ts` called by `nba-daily-refresh` cron at `30 13 * * *`. Per-day seed only; depends on ESPN scoreboard returning Finals events. Verified 1 game seeded for 2026-06-10. |
| NHL | **PARTIAL** | `lib/services/nhl/seedNhlGamesService.ts` called by `nhl-daily-refresh` cron at `45 13 * * *` (with `NHL_CRON_ENABLED=true`). Only 1 NHL game ever in DB (the Stanley Cup test). Multi-game slates not yet tested. |

### Layer 2 — Team/player catalogue

| Sport | Status | Evidence |
|---|---|---|
| MLB | **VERIFIED** | 30 MLB teams in DB. Players resolved via BDL when needed. |
| NBA | **PARTIAL** | 30 NBA teams now seeded (commit ran today via `scripts/operator/nba/seed-nba-all-teams.ts`). NBA players: NOT in scope (NBA model doesn't currently require player-level inputs). |
| NHL | **PARTIAL** | Only 2 NHL teams in DB (CAR, VGK — Stanley Cup teams). No catalogue-wide seed exists. `lib/services/nhl/seedNhlGamesService.ts` upserts teams as games are seeded; for non-Finals games, all 32 NHL teams would need seeding. |

### Layer 3 — Source/provider data

| Sport | Status | Evidence |
|---|---|---|
| MLB | **VERIFIED** | BDL + SharpAPI + MLB Stats API + OpenWeather all functional. Provider clients in `lib/providers/real_api/` and `lib/providers/nhl/`. |
| NBA | **VERIFIED** | SharpAPI + ESPN + BBR all functional. Coverage genuinely thin for NBA splits (see [`project-sharpapi-nba-coverage-gap`](../../.claude/projects/-Users-danielmengel-Projects-oddsphere/memory/project_sharpapi_nba_coverage_gap.md)) — this is a vendor issue, not a code issue. |
| NHL | **VERIFIED** | NHL public API (`api-web.nhle.com`) + SharpAPI both functional. |

### Layer 4 — Lines

| Sport | Status | Evidence |
|---|---|---|
| MLB | **VERIFIED** | `lib/services/linesService.ts:121-250` (V1+V2), per-(game,market,sportsbook) DELETE scope. 3,143 rows live. |
| NBA | **PARTIAL** | `lib/services/nba/refreshNbaLinesService.ts:308` patched today (`c87b20d`) to stop dropping `is_main_line=false` rows and dedupe by odds-closest-to-110. 14 lines now in DB for tonight's Finals game. **Missing regression test.** |
| NHL | **VERIFIED** | `lib/services/nhl/refreshNhlLinesService.ts:198` wired into `nhl-daily-refresh`. Live for Stanley Cup. Multi-game slate not yet exercised. |

### Layer 5 — `line_history`

| Sport | Status | Evidence |
|---|---|---|
| MLB | **VERIFIED** | 161,826 rows. Append-only on every line observation. |
| NBA | **VERIFIED** | 28 new rows written for game 15188 today. Append behavior matches MLB pattern. |
| NHL | **VERIFIED** | Append-only writes confirmed via Stanley Cup game lines refresh. |

### Layer 6 — Sharp/public signals

| Sport | Status | Evidence |
|---|---|---|
| MLB | **VERIFIED** | 371 rows. `lib/services/linesService.ts:270-320` writes to `sharp_signals` via `refreshSharpSignals` per-(game, market, side) DELETE scope (preservation fix `a5ff80c`). |
| NBA | **FAILING** | **Zero NBA rows in `sharp_signals` table ever.** No NBA-specific writer exists. `lib/services/nba/nbaSplitsClient.ts` is a read-only fetcher used by the DTO builder, not a writer. SharpAPI returns 1 sportingbet_br row for tonight's Knicks/Spurs game — currently dropped into the DTO at render time, never persisted. ([memory: `project-nba-model-audit-2026-06-10`](../../.claude/projects/-Users-danielmengel-Projects-oddsphere/memory/project_nba_model_audit_2026_06_10.md)) |
| NHL | **FAILING / not applicable** | No NHL sharp_signals writer. SharpAPI NHL splits coverage status not yet probed in this audit. Phase 4 deep dive. |

### Layer 7 — `sharp_signals_history`

| Sport | Status | Evidence |
|---|---|---|
| MLB | **VERIFIED** | 8,818 rows. Append-only on every observation. |
| NBA | **FAILING** | No NBA writer → no NBA rows ever. |
| NHL | **FAILING** | No NHL writer → no NHL rows ever. |

### Layer 8 — Prediction generation

| Sport | Status | Evidence |
|---|---|---|
| MLB | **VERIFIED** | `lib/services/automodelService.ts:1083-1147` runs V2.2 model; writes to `game_predictions`. Production version `auto_v2.2_mlb_full_game_projection` confirmed in live DB. |
| NBA | **PARTIAL** | `lib/services/nba/buildNbaPredictionRecords.ts` writes ML + Total. Spread is generated by the model but **NOT persisted** — DTO-only. Auditor cannot detect a wrong spread call. Production version `nba_v0_2026`. |
| NHL | **PARTIAL** | `lib/services/nhl/buildNhlPredictionRecords.ts` writes ML + Total for NHL. Production version `nhl_v0_2026_finals` — Finals-scoped. |

### Layer 9 — `prediction_records`

| Sport | Status | Evidence |
|---|---|---|
| MLB | **VERIFIED** | 217 MLB prediction_records (of 223 total). `lib/services/predictionRecordService.ts` writes per-slate. |
| NBA | **PARTIAL** | 2 NBA records exist (pr.id 899 NBA ML + pr.id 900 NBA Total for game 15188 tonight). **Spread is not a record** — DTO-only. |
| NHL | **PARTIAL** | 2 NHL records exist (pr.id 946 CAR ML + pr.id 947 OVER 5.5 for 6/9 game). Multi-game NHL slate untested. |

### Layer 10 — Pre-lock refresh

| Sport | Status | Evidence |
|---|---|---|
| MLB | **VERIFIED** | Phase 6B.18 + 6B.28 in-place mutation + `signal_rows_at_lock` substrate rehydration. Auditor verifies. |
| NBA | **VERIFIED** | Fixed today (commit `c87b20d`) — `buildNbaPredictionRecords` now UPDATEs pre-lock rows instead of skipping. Confirmed pr.id 899/900 refreshed with `refreshed_from_pipeline_at` attribution. **Missing regression test.** |
| NHL | **UNVERIFIABLE** | Same code path as NBA in spirit, but only 1 NHL game in DB and it locked at 23:01 last night. Tonight's Game 3 will be the first live test of pre-lock refresh for NHL. |

### Layer 11 — Locked snapshot

| Sport | Status | Evidence |
|---|---|---|
| MLB | **VERIFIED** | `lib/services/automationSlateLockSnapshot.ts:113-180` writes locked_at + admin_audit_log entry. Lock contract enforced (Lock 2). |
| NBA | **UNVERIFIABLE** | No NBA games have completed a lock cycle yet this season — Finals game 15188 will lock tonight at ~T-60. First live observation will be tonight. |
| NHL | **VERIFIED** (for the one game) | pr.id 946/947 locked at `2026-06-09T23:01:40Z`. Lock contract held; pre-lock data was preserved into snapshot. |

### Layer 12 — DTO/card builder

| Sport | Status | Evidence |
|---|---|---|
| MLB | **VERIFIED** | `app/api/lab/daily-edge/route.ts` MLB branch. Lock contract: locked records' `play_grade`/`no_bet`/etc override live grades. |
| NBA | **PARTIAL** | `app/api/lab/daily-edge/route.ts:2668-2691` dispatches to `buildNbaDailyEdgeAdapted`. Renders 3 markets (ML/spread/total). Spread is in DTO but NOT tracked. **`data_quality_tier="high"` despite `has_splits=false`** — HIGH UI honesty bug. |
| NHL | **PARTIAL** | `app/api/lab/daily-edge/route.ts:2698-2724` dispatches to `buildNhlDailyEdgeAdapted`. Stanley Cup-scoped; broader season untested. |

### Layer 13 — UI labels/rationale

| Sport | Status | Evidence |
|---|---|---|
| MLB | **VERIFIED** | `lib/services/verdictDerivation.ts`, `marketVerdictDerivation.ts`, `perMarketCopyGenerator.ts`, `pickBreakdownGenerator.ts`. All labels traceable to specific fields. Banned-terms linter at `lib/services/bannedTermsLinter.ts`. |
| NBA | **PARTIAL** | Labels (lean/caution/watch/best_angle/market_aligned) come from `lib/services/nba/nbaMarketReview.ts:gradeNbaMarket`. **Line movement displayed but NOT used by grader.** **Splits displayed (or shown as null) but never tracked as a model input.** Spread sign-flip bug fixed today (`e53bba2`). |
| NHL | **PARTIAL** | NHL DTO renders labels via shared adapter. No NHL-specific copy generator audit done in this phase. |

### Layer 14 — Final score ingest

| Sport | Status | Evidence |
|---|---|---|
| MLB | **VERIFIED** | `lib/services/scoreIngestService.ts` (BDL) + `lib/services/mlbLinescoreIngestService.ts` (MLB Stats API for FI). Idempotent. |
| NBA | **UNVERIFIABLE** | `lib/services/nba/nbaScoreIngestService.ts` exists. No NBA games have been ingested yet (Finals tonight is the first). Will be tested live. |
| NHL | **VERIFIED** | `lib/services/nhl/nhlScoreIngestService.ts:52` — fix today (`c87b20d`) for ET slate_date. Game 15204 successfully ingested (FUT→OFF, scores 3/5). **Missing regression test.** |

### Layer 15 — Grading

| Sport | Status | Evidence |
|---|---|---|
| MLB | **VERIFIED** | `lib/services/gradeDerivationService.ts` + `lib/services/predictionGrader.ts` (shared) + `lib/services/predictionGradingService.ts` (writer). 223 prediction_grades in DB. |
| NBA | **UNVERIFIABLE** | Same shared grader. No NBA games graded yet. `lib/services/predictionGrader.ts:resolveSideToken` (fixed today `c87b20d`) handles canonical pick tokens — NBA picks are `"home"`/`"away"`/`"over"`/`"under"`, so the resolver returns them directly. |
| NHL | **VERIFIED** | `lib/services/nhl/gradeNhlPredictions.ts:86` — fixes today (`c87b20d`): re-grades pending placeholders + UPDATEs in place. pr.id 946 + 947 graded correctly (both WIN). **Missing regression tests.** |

### Layer 16 — Tracking

| Sport | Status | Evidence |
|---|---|---|
| MLB | **VERIFIED** | `lib/services/trackingRefreshService.ts` (hourly) + `lib/services/trackingAggregateService.ts`. `tracking_aggregates` table writes confirmed. |
| NBA | **UNVERIFIABLE** | Same code path. No NBA graded picks yet. |
| NHL | **VERIFIED** (1 game) | Stanley Cup game 6/9 tracked correctly post-grade-fix. CAR ML + OVER 5.5 both WIN reflected. |

### Layer 17 — Auditor/fixer coverage

| Sport | Status | Evidence |
|---|---|---|
| MLB | **VERIFIED** | `scripts/operator/audit-daily-edge-integrity.ts` — 5 categories (A: lock contract, B: public splits, C: lines/odds, D: tracking/grading, E: thinning). Exit codes 0/1/2. Strict mode. |
| NBA | **FAILING** | Auditor is MLB-only. NBA cannot be validated as TRUSTED until Phase 6 produces a cross-sport auditor v2 with NBA adapter. |
| NHL | **FAILING** | Same — MLB-only. NHL cannot be auditor-validated. |

### Layer 18 — Cron/scheduler coverage

| Sport | Status | Evidence |
|---|---|---|
| MLB | **VERIFIED** | `slate-cycle` (hourly), `tracking-refresh` (hourly), `pregame-sweep` (15-min), `feature-coverage-refresh` (twice/day). All scheduled in `vercel.json`. |
| NBA | **PARTIAL** | `nba-daily-refresh` (1×/day) + `tracking-refresh` (hourly, includes NBA). **No intraday NBA-specific refresh.** Pre-lock pre-game NBA refresh only happens at the daily cron + hourly tracking-refresh. Adequate for tonight; gap-prone for general season. |
| NHL | **PARTIAL** | `nhl-daily-refresh` (1×/day, just enabled today) + `tracking-refresh` (hourly). Same gap as NBA — no intraday-specific refresh. |

### Layer 19 — Manual intervention dependencies

| Sport | Status | Evidence |
|---|---|---|
| MLB | **PARTIAL** | Operator scripts still required for: FI grading bridge (`manual-grade-slate.ts`), pitcher backfill (`ingest-missing-pitchers.ts`), starter refresh (`refresh-starters.ts`), season pitching backfill (`backfill-season-pitching-stats.ts`). |
| NBA | **PARTIAL** | Required: full team catalogue seed (`seed-nba-all-teams.ts` — applied today as forward-looking prep). No sharp_signals writer means no manual fallback exists for NBA splits either. |
| NHL | **PARTIAL** | Required (today): manual operator-corrected grades for game 15204 (one-time bug recovery, now fixed). No multi-game NHL slate has run automated yet. |

---

## Per-sport summary table

| Layer | MLB | NBA | NHL |
|---|---|---|---|
| 1. Schedule | ✅ VERIFIED | ⚠ PARTIAL | ⚠ PARTIAL |
| 2. Team/player catalogue | ✅ VERIFIED | ⚠ PARTIAL | ⚠ PARTIAL |
| 3. Source/provider | ✅ VERIFIED | ✅ VERIFIED | ✅ VERIFIED |
| 4. Lines | ✅ VERIFIED | ⚠ PARTIAL | ✅ VERIFIED |
| 5. line_history | ✅ VERIFIED | ✅ VERIFIED | ✅ VERIFIED |
| 6. Sharp/public signals | ✅ VERIFIED | 🚫 FAILING | 🚫 FAILING |
| 7. sharp_signals_history | ✅ VERIFIED | 🚫 FAILING | 🚫 FAILING |
| 8. Prediction generation | ✅ VERIFIED | ⚠ PARTIAL | ⚠ PARTIAL |
| 9. prediction_records | ✅ VERIFIED | ⚠ PARTIAL | ⚠ PARTIAL |
| 10. Pre-lock refresh | ✅ VERIFIED | ✅ VERIFIED (fixed today) | ❓ UNVERIFIABLE |
| 11. Locked snapshot | ✅ VERIFIED | ❓ UNVERIFIABLE | ✅ VERIFIED (1 game) |
| 12. DTO/card | ✅ VERIFIED | ⚠ PARTIAL (UI honesty bug) | ⚠ PARTIAL |
| 13. UI labels/rationale | ✅ VERIFIED | ⚠ PARTIAL | ⚠ PARTIAL |
| 14. Final score ingest | ✅ VERIFIED | ❓ UNVERIFIABLE | ✅ VERIFIED (fixed today) |
| 15. Grading | ✅ VERIFIED | ❓ UNVERIFIABLE | ✅ VERIFIED (fixed today) |
| 16. Tracking | ✅ VERIFIED | ❓ UNVERIFIABLE | ✅ VERIFIED (1 game) |
| 17. Auditor/fixer | ✅ VERIFIED | 🚫 FAILING (MLB-only) | 🚫 FAILING (MLB-only) |
| 18. Cron coverage | ✅ VERIFIED | ⚠ PARTIAL | ⚠ PARTIAL |
| 19. Manual deps | ⚠ PARTIAL | ⚠ PARTIAL | ⚠ PARTIAL |

**Tally:**
- MLB: 17 VERIFIED, 2 PARTIAL → overall **PARTIAL** (closest to TRUSTED; only operator-dependency layers + auditor sport-specificity remain)
- NBA: 3 VERIFIED, 7 PARTIAL, 5 FAILING, 4 UNVERIFIABLE → overall **PARTIAL — BLOCKED for full-trust** until sharp_signals + UI honesty + spread tracking fixed
- NHL: 7 VERIFIED, 8 PARTIAL, 2 FAILING, 2 UNVERIFIABLE → overall **PARTIAL — narrow Stanley Cup scope** (works for Cup, multi-game season untested)

---

## Critical findings (severity-ranked)

### HIGH severity

| # | Issue | Sport | Affected files / tables | Recommendation |
|---|---|---|---|---|
| H-1 | `data_quality_tier="high"` is reported on NBA prediction_records despite `has_splits=false` — the tier calculation ignores splits availability, so cards imply more data confidence than the model has. | NBA | `lib/services/nba/featureSnapshot.ts` (tier calc) + `lib/services/nba/buildNbaPredictionRecords.ts` (snapshot writer) | Downgrade tier when splits absent; OR add a "thin coverage" tier; OR demote `data_quality_tier` to MEDIUM when `has_splits=false`. |
| H-2 | NBA spread is rendered on card with grade labels (`lean`, `caution`, `support`, etc.) but is NOT persisted as a `prediction_record`. Auditor cannot detect a wrong spread call. | NBA | `lib/services/nba/buildNbaPredictionRecords.ts:7-14` (explicit comment), `lib/services/nba/nbaMarketIntelligence.ts:buildSpread` | Either write NBA spread to `prediction_records` (and add to grader + tracking) OR label card with "derived, not tracked" until persistence is added. |
| H-3 | Auditor is MLB-only. NBA + NHL cannot be classified as TRUSTED in any future audit. | NBA, NHL | `scripts/operator/audit-daily-edge-integrity.ts` | Phase 6 deliverable: auditor v2 with cross-sport adapter pattern (shared lock-contract + tracking/grading checks + sport-specific adapters for splits, market thinning, score-ingest TZ, label-style picks). |
| H-4 | No NBA sharp_signals writer — provider data (even when thin) is not captured, so no no-skip guarantee for late-arriving splits. | NBA | `lib/services/nba/` (no writer exists) | Build minimal NBA writer that ingests whatever SharpAPI returns (consensus / sportsbook-specific / partial) with `_source` provenance, mirroring `lib/services/linesService.ts:refreshSharpSignals` pattern. |
| H-5 | 4 missing regression tests for today's HIGH bug fixes (NBA stale-skip, NBA lines parser dedupe, NHL ET score-ingest, NHL pending-grade UPDATE). | NBA, NHL | Listed in FU-5 above | Add tests in Phase 6 immediate roadmap. |

### MEDIUM severity

| # | Issue | Sport | Files / tables |
|---|---|---|---|
| M-1 | `lineup-watch` cron exists in code but is NOT scheduled in `vercel.json`. No other cron runs lineup refresh at 15-min cadence. Late lineup scratches could be missed. | mlb/nba/nhl | `app/api/cron/lineup-watch/route.ts` |
| M-2 | `weekly-calibration` cron not scheduled. Calibration buckets may be stale → tracking UI shows stale confidence calibration. | cross-sport | `app/api/cron/weekly-calibration/route.ts`, `calibration_buckets` (11 rows) |
| M-3 | `weekly-park-factors` cron not scheduled. MLB park factors stale → model input degraded over time. | MLB | `app/api/cron/weekly-park-factors/route.ts`, `ballparks` |
| M-4 | NBA `line_movement` is displayed on card but NOT used by the grader. UI implies it affects decision when it does not. | NBA | `lib/services/nba/nbaMarketIntelligence.ts`, `lib/services/nba/nbaMarketReview.ts:gradeNbaMarket` |
| M-5 | NBA + NHL have no intraday market refresh cron — only daily + hourly tracking-refresh. SharpAPI updates between mornings won't reach predictions until next morning. | NBA, NHL | `vercel.json` cron schedule |
| M-6 | NBA model uses only `home_team` + `away_team` ratings — no rest, no playoff series momentum, no injury weighting beyond a binary flag. Phase 2 deep dive will verify. | NBA | `lib/automodel/nba/nbaAutoModelV1.ts`, `lib/services/nba/featureSnapshot.ts` |
| M-7 | NHL has only 1 game ever in DB. Cron is freshly active. Multi-game slates not validated. Tonight's Stanley Cup G3 is the first live multi-day test. | NHL | `games`, `prediction_records` |

### LOW / INFO

| # | Issue | Detail |
|---|---|---|
| L-1 | ~18 dead/empty DB tables (mlb_team_ratings, nhl_team_ratings, etc.). | No production risk. Cleanup pass recommended. |
| L-2 | `prediction_breakdowns` table is empty and unused. | Breakdown content lives in `snapshot_json` / `sport_specific.breakdown_v2`. Safe to drop. |
| L-3 | Multiple unscheduled cron routes are orphaned. | Functionality covered by `slate-cycle`. Safe to delete in cleanup pass after confirmation. |

---

## Per-sport overall classification

### MLB — **PARTIAL** (closest to TRUSTED)
- 17 of 19 layers VERIFIED
- 2 layers PARTIAL (manual deps for FI/season-stats; auditor sport-specific scope is by design)
- Only HIGH issue is shared (H-3 auditor coverage)
- **Path to TRUSTED:** complete auditor v2 (Phase 6) + reduce manual operator deps (FI bridge + season-stat backfill could be automated)

### NBA — **PARTIAL / BLOCKED for full-trust**
- 3 of 19 layers VERIFIED
- 7 PARTIAL, 5 FAILING, 4 UNVERIFIABLE
- 4 HIGH issues block trust: H-1, H-2, H-3, H-4
- **Path to TRUSTED:** ship NBA splits writer (H-4), fix data_quality_tier honesty (H-1), persist NBA spread (H-2), generalize auditor (H-3), backfill regression tests (H-5)

### NHL — **PARTIAL / narrow Stanley Cup scope only**
- 7 of 19 layers VERIFIED, 8 PARTIAL, 2 FAILING, 2 UNVERIFIABLE
- 1 HIGH issue blocks trust: H-3 (auditor)
- Sharp signals (H-4 equivalent) not yet investigated for NHL — Phase 4 deep dive
- **Path to TRUSTED:** validate cron after multi-game slate, generalize auditor, add NHL regression tests, decide on NHL sharp signals strategy

---

## Active production HIGH issues affecting tonight's slate

**None requiring emergency intervention.** All today's fixes (`c87b20d`, `c831489`, `e53bba2`) are deployed live. The HIGH issues above are systemic gaps to address in Phase 6 roadmap, not active bugs affecting visible slate content tonight beyond what's already documented.

H-1 (`data_quality_tier="high"` with no splits) is technically live-visible on tonight's NBA card, but it does not produce incorrect picks — it overstates data confidence. Recommend fixing before next NBA slate but does not warrant pausing the audit.

---

## What this phase does NOT do

- Does NOT design the auditor v2 (Phase 6 deliverable).
- Does NOT measure model calibration / accuracy (Phase 2 NBA deep dive + Phase 3 MLB benchmark).
- Does NOT classify World Cup / Soccer / NFL / Player Props (Phase 5).
- Does NOT propose fixes per layer beyond severity tagging — fix order belongs in Phase 6 roadmap.
- Does NOT write any tests — recommended test files are listed in FU-5 for Phase 6.

---

## Next: Phase 2

`docs/audit/02-nba-model-logic-calibration.md` — deep dive on NBA model inputs (what is actually used), market movement incorporation (used vs displayed), sharp/public signal incorporation, predicted score sanity (game-to-game variation), calibration (if historical sample permits), and UI label explainability per [Daniel's Phase 2 spec](../../../README.md#phase-2).
