# NHL complete-slate odds r2 — 2026-09-29

## Scope and release boundary

- Sport: NHL regular season only; game type `02`.
- Markets: moneyline, total, and spread (puck line).
- Model: `nhl_regular_2026_r2_complete_slate_odds`.
- Calibration: `nhl_regular_calibration_2026_r2_complete_slate_odds`.
- Decision: `nhl_regular_decision_2026_r2_complete_slate_odds`.
- Refresh: `nhl_daily_refresh_schedule_2026_09_29_r3_complete_slate_odds`.

The selected r1 model coefficients and grade policy are unchanged. This is a
versioned model-input recovery because the prior league-wide SharpAPI scan could
stop after 1,000 rows of futures, player props, and the first game, leaving later
games without prices while the cron still reported success.

## Repair and load budget

The authoritative `refreshNhlLines` path now loads the bounded `/events` catalog
for the slate's UTC dates, resolves the best exact team/time event for each local
game, and requests one 200-row `/odds` page for each resolved event. If that page
does not contain a full-game moneyline, total, or puck line, only the missing
market is requested directly. Both sides of every official market are checked;
missing coverage makes the refresh partial instead of silently healthy. Existing
rows remain in place until a replacement group is written successfully.

On the five-game September 29 ET production slate, the release dry-run resolved
all five games and produced 40 two-sided main-line rows with zero coverage errors.
The ordinary path required three event-catalog calls across the two UTC dates plus
five event-odds calls, eight total, compared with 20 league-page requests that
still omitted four games.

## Board and model-safety impact

FLA at CAR already had complete price-backed recommendations and receives the same
main-game feed. The other four games had no price-backed actionable rows, so the
repair demotes zero existing actionables and makes up to 12 previously unavailable
market decisions eligible for normal calibration. No quota, forced promotion, new
copy, label, writer, or member-facing surface is introduced.

Locked rows remain immutable. The existing daily and hourly tracking callers use
the same `writeNhlPredictionRecords` implementation and the sport-scoped
`prediction_pipeline:nhl` lease. Public tracking admits only the exact r2 model and
calibration identifiers after lock. Rollback is the last coherent stored NHL
response snapshot plus the r1 code; a failed provider refresh never clears the
last successfully stored line group.
