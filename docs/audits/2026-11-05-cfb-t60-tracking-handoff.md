# CFB original T-60 tracking handoff

Tracking record R53 and sole forward writer R151 preserve complete original
R59/R58 priced T-60 locks through the R60 release handoff. Supported predecessor
R47/R64/R41 payloads retain their exact original decisions, lines, prices,
probabilities, grades, timestamps and release IDs; they are not recast as
accuracy-only No Play calls. Already-materialized games are removed before
team/game upserts and legacy builder execution, so old entries cannot block new
locks. The shared `prediction_pipeline:cfb` lease remains authoritative. No
forecasting model, calibration, decision policy, provider cadence or numerical
market reader changes. The cron now records the actual tracking failure reason.

The November 4 recovery materializes nine original calls across BALL–MASS,
TOL–SAC and CMU–EMU from three hash-verified pregame T-60 snapshots. Outcomes use
the canonical grader and stored final scores. Existing snapshots and records
remain immutable. Required proof includes exact original priced-field/grade
precedence, invalid/late release rejection, actual writer retry idempotence,
already-tracked legacy isolation, three-market denominator coverage, full model
gate, latest-main integration safety and affected live tracking verification.

This is a tracking materialization and operational failure-reporting repair.
Prediction model, calibration and decision releases stay exact, so it is not a
new forecasting model release. Record eligibility uses the original stored
release tuple rather than relabeling history with the current release.
