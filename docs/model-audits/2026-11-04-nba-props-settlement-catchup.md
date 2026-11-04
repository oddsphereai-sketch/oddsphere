# NBA props bounded settlement catch-up

Starting base:02611d27a457af825138394aadd363e27b39eafd.
Scope: settlement date selection and completion metadata within the existing
NBA full-refresh writer and prediction_pipeline:nba lease. Writer R11→R12,
settlement R1→R2. All model, calibration, decision, grade, lifecycle, price and
tracking capture releases remain exact. Board impact:0 promotions,0 demotions,
0 side changes,0 actionable change. No provider-call or schedule increase.

A read-only join of all11 retained private tracking slates found6962 tracked
rows and157 without outcome revisions across games21717860 and21717861.
The current official-stat state includes both completed games. The normal
settlement call only scanned the most recent seven dates; the older missed
rows could no longer be reached automatically.

R2 keeps those seven dates for normal official-stat revision handling. A single
metadata-only catalog query reads at most401 rows and rejects a season exceeding
400 tracking slates. At most three older dates with absent or changed completion
receipts are read per full refresh. A receipt records the original tracking
checksum (or its generated timestamp for legacy uncompressed payloads) and row
count only once all rows belong to official completed games in current state.
Changed source checksums reopen the date, so late materialization is retried.
Incomplete dates remain pending rather than being stamped complete.

The original tracking payloads never change. The R1 settlement history is read
without reinterpretation; all old outcome revisions are preserved as an exact
prefix and new revisions append through the unchanged official-stat grading
function. No independent refresh path or numerical-model change is introduced.

Tests exercise the actual database-backed settlement function: legacy history,
an older date outside the seven-day window, unchanged prior revisions and
tracking bytes, checksum reopening, three-date and400-slate bounds, and an
idempotent second run. Focused writer/readiness tests, types, lint, full model
verification and protected fresh-base publication are required. Operational
recovery follows production deployment, with before/after protected hashes and
an exact missing-outcome audit. Natural new full refresh must show R12 and
release-coherent source/member data; existing locks remain authoritative.
