# CFB tracking settlement hotfix — 2026-08-30

## Predeclaration

- Sport/markets: CFB Moneyline, Spread, and Total postgame settlement only.
- Frozen decision authority: score runtime `cfb_v1_joint_score_runtime_2026_08_29_r6_transition_coherent`; model/distribution/probability/representative-score r4; calibration r3; grade policy r3; decision r17; tuple schema r11; official tracking record r4. None of those prediction-time releases or immutable T-60 tuples may change.
- Authoritative write path: the existing hourly `tracking_refresh` CFB branch under the shared `prediction_pipeline:cfb` lease. No second cron, provider, writer, table, reader override, or manual database repair is authorized.
- Owned files: `lib/services/football/balldontlieNcaafSlate.ts`, `lib/services/football/cfbScoreIngestService.ts`, `scripts/test-cfb-v1-production.ts`, `docs/current-model-releases.md`, and this audit note.
- Explicit exclusions: CFB forecast/PMF/calibration/decision/grade/fixture/member files; NFL files; tracking aggregation/presentation; database schema; locked prediction records.

## Production failure proof

The 2026-08-29 ET slate has 20 immutable locked CFB `prediction_records` across seven games. At the start of this repair all 20 grades remained pending, and every linked `games` row remained `scheduled` with null scores. Hourly `tracking_refresh:cfb` runs were partial after kickoff.

The settlement reader requested the NCAAF games collection with `game_ids[]`. BALLDONTLIE's NCAAF games collection does not support that filter; it supports `dates[]`, date ranges, team IDs, seasons, and weeks, while exact game identity is available at `/games/:id`. The unsupported parameter was ignored, so the reader received historical rows beginning in 2004 and exhausted its pagination budget without any requested 2026 IDs.

A read-only provider probe using the supported UTC dates `2026-08-29` and `2026-08-30` returned all seven requested IDs as final with valid scores. The repair therefore changes only the score-ingest lookup: derive the bounded UTC date set from the already-persisted game start times, request the supported date-filtered collection, then retain the existing exact provider-ID post-filter before any game update.

## Frozen safety contract

- Provider-date count is capped at three and game IDs remain capped at 200.
- The existing four-page maximum and 100-row page size remain bounded.
- A non-requested game returned for the same date is discarded.
- An invalid/missing persisted game timestamp fails closed before a provider call.
- Locked predictions, prices, sides, probabilities, grades, releases, and publication times remain byte-for-byte unchanged; only terminal scores and deterministic `prediction_grades` settlement may advance.
- Before/after model board impact is zero promotions, zero demotions, zero actionability change, and zero stake change.
- Rollback is the preceding `cfb_score_ingest_2026_08_25_r1_exact_id` reader; if exact-ID/date coherence or grading differs from the immutable tuple, halt the CFB settlement branch rather than rewriting a prediction.

## Validation record

- Production SELECT/provider dry run from the candidate path: release `cfb_score_ingest_2026_08_30_r2_supported_date_filter`; seven terminal game updates proposed; zero already-final, in-progress, or scheduled rows; one provider request; zero errors; `apply=false`, so zero database writes.
- Focused `test:cfb-v1-production`: pass, including supported `dates[]` request identity and non-requested same-date row exclusion.
- `npm run verify:model-change`: pass.
- TypeScript: pass.
- Focused lint: zero errors and zero warnings.
- Webpack production build: pass.
- Prediction-time board impact: zero promotions, zero demotions, zero side/price/probability/actionability/stake changes. The existing 20 immutable rows remain the exact settlement cohort.
- Protected PR, deployment, natural-cycle grading, aggregate, and live member-page proof: pending.
