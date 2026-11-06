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
