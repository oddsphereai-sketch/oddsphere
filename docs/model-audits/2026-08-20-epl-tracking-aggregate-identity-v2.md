# EPL tracking aggregate identity v2

## Scope

- EPL prediction release remains `epl_goals_coherent_2026_08_20_r16`.
- EPL calibration/grade release remains `epl_grade_policy_2026_08_20_v21`.
- Tracking aggregate contract is `tracking_aggregate_v2_epl_projected_competition_2026_08_20`.
- Picks, probabilities, projections, grades, market selections, prices, locks, and stakes are unchanged.

## Finding

The bounded tracking-record query filtered `snapshot_json.competition=english_premier_league` in Postgres but did not project that field into returned records. The aggregate classifier therefore could not recognize those rows as EPL after the query. It treated unlocked launch rehearsals as ordinary soccer rows and used the generic cross-release dedupe path, which could surface an older release in a pre-result calibration preview.

No EPL game had locked at audit time, so no official outcome, win/loss record, Brier score, log loss, or ROI was contaminated.

## Correction

The bounded query now projects only `snapshot_json->>competition` as `competition`; it still avoids transferring the full historical snapshot payload. EPL classification accepts that projected field and retains the full-snapshot fallback for existing callers. Consequently:

- unlocked EPL rows remain excluded from official tracking;
- the immutable T-60 locked row becomes the canonical record;
- EPL remains separate from World Cup history;
- results are grouped by the exact locked model release;
- provider calls, database writes, snapshot size, and prediction-writer load are unchanged.

## Board and model impact

Actionable promotions: 0. Actionable demotions: 0. Net board impact: 0. The live 10-game r16/v21 snapshot remains unchanged.

Rollback is removal of the projected competition field and restoration of aggregate contract v1. A rollback is not recommended because it would restore incorrect EPL classification.
