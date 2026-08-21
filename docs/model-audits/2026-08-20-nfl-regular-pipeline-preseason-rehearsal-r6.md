# NFL regular-pipeline preseason rehearsal r6

Date: 2026-08-20  
Scope: move the one current preseason product board onto the regular-season NFL model program  
Environment: local only; no provider refresh, production writer, official grade, stake, settlement, or tracking mutation

## Releases

- Regular current refit: `nfl_pregame_real_local_current_refit_2026_08_19_r3`
- Historical tournament candidate: `nfl_pregame_real_local_candidate_2026_08_19_r2`
- Feature release: `nfl_real_pregame_features_2016_2025_2026_08_19_r1`
- Probability calibration: `nfl_empirical_residual_probability_2026_08_19_r1`
- Preseason provider input: `nfl_preseason_current_provider_inputs_2026_08_19_r2`
- Regular roster/depth input: `nfl_regular_current_provider_inputs_2026_08_19_r1`
- Rehearsal snapshot: `nfl_regular_pipeline_preseason_rehearsal_snapshot_2026_08_20_r1`
- Rehearsal grade policy: `nfl_regular_pipeline_preseason_grade_policy_2026_08_20_r1`
- Tracking policy: `football_tracking_policy_2026_08_19_r1`

## Architecture correction

The product reader no longer uses the separate 309-game preseason model. That release and its
failed 2025 side holdout remain immutable benchmark evidence only. The current board now runs
the same scorer, 143-feature regular-season model, probability calibrators, and conservative
market blend intended for Week 1. One scorer accepts a phase argument; there is no copied model
implementation or second writer.

The rehearsal composes two already-stored inputs without a provider call: the real Preseason
Week 2 schedule/current odds/injuries package and the complete 32-team Week 1 roster/depth
package captured 42 minutes earlier. Both checksums are stamped into the scored snapshot. All
16 games scored and all 32 depth-chart quarterback names matched historical quarterback state.

The model is deliberately evaluating a regular-strength team forecast against a preseason
market in which backups and coach-managed playing time matter. That disagreement is diagnostic,
not a betting edge. The phase layer therefore caps every row below Lean, and preseason remains
permanently ineligible for official or lifetime tracking.

## Market intelligence boundary

Market information is not absent from the model: r3 blends the independent margin 30% with the
current market margin 70%, and blends the independent total 40% with the current market total
60%. That anchor materially reduces unbounded model disagreement while retaining an independent
forecast.

Line movement and split evidence remain separate from the probability head. Opening/current
prices, fixed-line price movement, key-number crossings, cross-book agreement, consensus
tickets/money and book-specific splits will be admitted only through past-only incremental
tests. No public percentage or so-called sharp split may rewrite a projection merely because it
looks directional. The current provider audit found no BALLDONTLIE split feed, regular-season
but not preseason Playbook coverage, and no SharpAPI NFL split rows in the bounded sample.

## Board impact

- Predictions changed from the retired preseason reader model to the existing r3 regular model.
- Across 48 market rows: 12 Watchlist, 19 Caution, 17 No Play.
- Across 16 game headlines: 10 Watchlist, 5 Caution, 1 No Play.
- Actionable promotions: 0.
- Actionable demotions: 0.
- Net actionable change: 0.
- Lean: 0. Best Angle: 0. Tracked preseason rows: 0.

## Cost, failure, and rollback

- Member reads make zero provider calls.
- The rehearsal reuses checksum-pinned inputs and does not add a cron or independent refresh.
- Missing roster, injury, price, checksum, release, or game identity evidence fails the board
  closed instead of falling back to the retired preseason projection.
- Rollback is the prior local reader pointer and r5 rehearsal snapshot. No production or
  historical tracking row is changed.

## Verification

- `football-research/cache/nfl-model-env/bin/python -m py_compile scripts/operator/score_current_nfl_regular.py`
- `npx tsc --noEmit --pretty false`
- `npm run test:football-product-preview`
- focused ESLint for the changed reader/model files
- `npm run verify:model-change`

This release does not approve the model for Week 1. Regular-season launch still requires a new
immutable decision release, coherent opening/current/lock evidence, tested promotion and
demotion rules, the shared `prediction_pipeline` lease, and live post-deployment verification.
