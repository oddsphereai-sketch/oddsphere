# NHL daily stats lease recovery — November 1, 2026

The daily full refresh and the public-splits publisher were both scheduled at
11:45 UTC. On October 30, October 31 and November 1 the publisher acquired the
shared NHL prediction lease first, so the only full stats refresh skipped.
Intraday refreshes correctly omit the expensive team/goalie scrape. Both stats
tables consequently retained October 29 inputs even though prices, splits and
member snapshots continued refreshing. Direct November 1 reads confirmed that
both current-season MoneyPuck CSV sources were available with HTTP 200.

Operational release `nhl_daily_refresh_schedule_2026_11_01_r15_stats_lease_recovery`
moves the existing once-daily full run to 11:47 UTC and gives only full runs a
bounded 60-second retry of the same `prediction_pipeline:nhl` lease, at two-second
intervals. After 11:47 UTC, the existing intraday writer also checks a durable
completion receipt for the ET slate date and refreshes both packs if today's full
run was skipped or failed. It records success only when both scrapes complete
without row errors; a partial scrape leaves recovery due. Subsequent intraday
runs remain lightweight after success, including across cold starts. The route
has a 300-second runtime budget for bounded lease waiting plus its existing work.
Intraday timing, sole writer, source selection, model, calibration,
grade policy, stakes and immutable locked payloads are unchanged. No second
writer or independent stats-refresh path is introduced. For identical input the
prediction and actionable board changes are zero; restored ordinary source
ingestion can naturally refresh unlocked forecasts through the existing writer.

Validation includes the NHL model/lock suite, availability suite, current cron
configuration suite, deterministic short-contention recovery and bounded long
contention, and skipped/partial-day catch-up with durable success, next-day
expiry, future-receipt rejection and member/locked namespace protection, plus
`verify:model-change`. A production recovery uses the same
authenticated full cron and must prove fresh team/goalie rows, a coherent member
snapshot, and the shared lease before completion. Raw operational receipts remain
local and are not published with this note. The November 1 recovery completed
with both current-season packs and all five games, without source errors.

Rollback restores the r14 operational release, 11:45 UTC schedule, and no full-run
lease retries; remove the intraday completion check. It changes no model artifacts
or stored member/locked records.
