# Durable NBA read-failure diagnostics

Starting base732ae8d9c7f6190a3b96d5dfc82941c7021b9aab; isolated branch
codex/nba-reader-durable-failure-receipts-20261106.

Post-deployment inspection of1052 found the safe source phase in cron HTTP
details, while runCron persists only error_message and lifecycle/counters.
Diagnostic release nba_reader_failure_log_2026_11_06_r1_allowlisted_phase
appends the allowlisted phase to the snapshot writer's existing error string.
The ordinary NBA and split-refresh callers already copy that string into their
existing data_refresh_log error_message. Unknown text is redacted; no SQL,
token, raw provider response or unbounded evidence is added.

No new writer/log table, provider request, publication, refresh, cadence,
source-admission/grade/stake/model/calibration rule or legacy read changes.
NBA publication R1 and grade R31, CBB decisionR13/gradeR12, CFB decisionR62
remain unchanged. This is logging-only; it does not force a source failure in
production or certify a historical missing log. Fault/recovery tests verify the
actual persisted-message substrate, zero snapshot/cache writes and redaction.
Fresh-main protected integration and focused/hosted checks remain required.

## Confirmed rolling-publication blocker

After integrating production16f84c5, the actual read-only current-day pipeline
succeeded for9games, while Nov7/8 and the full rolling builder reproducibly
failed split_observation_high_water_failed. The existing ORDER BY globalid
DESC LIMIT1 can time out proving there are no matching future observations.
Publication R2 uses the exact same NBA/event MAX through a scoped MATERIALIZED
read-only invoker function, analogous to the previously approved v57 price
frontier. No date cutoff, discarded evidence, successful-empty requirement or
source/confirmation gate is added. Missing migration alone may use the exact
old query; timeout/permission errors remain failures and preserve the old board.
GradeR31/modelR36/marriageR38 and every prior lock stay exact. Complete-input
board impact is zero promotions/demotions; genuine absence resumes ordinary
unpriced future evaluation, while improved real prices retain the tested
promotion rules. No numerical tuning or forced play count is involved.

The additive v61 migration must pass real PostgreSQL parity, invoker/RLS/role
checks and locked-row immutability before protected publication and application.
Live proof requires the current and future scoped frontiers, successful full
rolling builder, normal publication R2/cron health and original locked hashes.
