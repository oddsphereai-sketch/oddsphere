# NBA/NHL scheduled refresh recovery predeclaration

Date: 2026-09-21

## Defect

The member registry keeps NBA and NHL available during their offseason, and both existing refresh routes are complete and fail closed behind exact production environment gates. The emergency cron pause removed their two daily schedules, but later cron restoration never restored those entries. The current stability audit therefore reports both sports as blocked even though their route implementations remain present.

## Candidate

- Restore exactly one daily schedule for `/api/cron/nba-daily-refresh` at `30 13 * * *`.
- Restore exactly one daily schedule for `/api/cron/nhl-daily-refresh` at `45 13 * * *`.
- Stamp the route health details with `nba_daily_refresh_schedule_2026_09_21_r1` and `nhl_daily_refresh_schedule_2026_09_21_r1`, respectively, so production proof cannot be confused with an older deployment.
- Preserve `NBA_CRON_ENABLED=true` and `NHL_CRON_ENABLED=true` as the only write-enabling states. Disabled routes return successfully with zero writes.
- Preserve the existing routes, providers, prediction implementations, tracking writers, database tables, locks, and hourly shared tracking refresh.
- Add no page copy, label, badge, model coefficient, probability, side, grade, stake, or board quota.

The current September 21 production slate contains zero NBA and zero NHL games, so the same-slate board impact must be zero promotions, zero demotions, and zero prediction changes. The schedules are deliberately daily rather than intraday to bound provider and database load. Existing sport-owned and shared cron leases remain authoritative.

## Acceptance

1. The focused schedule contract proves one entry per route, the exact bounded cadence, and the exact fail-closed environment gates.
2. The production-backed site-stability audit no longer reports either cron as missing.
3. The all-model readiness audit still reports zero NBA/NHL games rather than fabricated rows.
4. Integration safety, typechecking, build, and protected PR checks pass from a clean branch based on current `origin/main`.

Rollback removes the two `vercel.json` entries. It never rewrites a prediction or tracking record.
