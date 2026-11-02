# Bounded Data API pool experiment on the existing Small plan

Base: `641ed5b0fba1794fa4be00427be9e6b68cb132ef`.
Operational configuration: `supabase_data_api_pool_2026_11_02_r1_five_connections`.
Project: `jounoyrkcirgmyjccxll`. Compute remains Small; no billing, plan,
permissions, schema exposure, row limits, model, provider or cron change.

## Observed baseline

- At 18:10:06Z, official project Metrics API: Committed_AS 2,952,159,232 bytes,
  CommitLimit 2,035,793,920 bytes, MemAvailable 699,781,120 bytes,
  MemTotal 1,924,112,384 bytes, swap used 637,378,560 bytes.
- Kernel OOM-kill counter is zero in this metric snapshot. Exporter/Auth startup
  times and Postgres last startup align with the 17:02 restart. The counter
  cannot establish what happened before that restart or prove its cause.
- A read-only pg_stat_activity snapshot found nine idle PostgREST/authenticator
  connections, zero active API queries, one dashboard query and normal platform
  background connections. No in-database pool override exists. Dashboard Pool
  size is unset (automatic), not an explicit known configured value.
- Twelve small metadata reads at concurrency six completed with zero errors;
  mean 478ms, p95 738ms at 18:20:38Z. These read only the CBB publication
  timestamp, with no provider calls or data writes.

## One reversible configuration change

After this predeclaration passes the clean/fresh-base protected PR process,
set only Integrations / Data API / Settings / Pool size to 5 and save. Do not
change compute, shared-pooler settings, credentials, exposure or max rows.
The goal is to cap retained API backends and simultaneous query-memory work,
while retaining enough concurrency for the measured low active-query load.
This is a measured experiment, not a claim that pool size caused the restart.

PostgREST's internal pool is distinct from Supavisor/PgBouncer pools. SQL
`pgrst.db_pool` role settings cannot configure it; use the supported dashboard.
No manual termination, database reboot or credential change is authorized by
this runbook. If the dashboard requires a disruptive action beyond the normal
API configuration save, stop and reassess before proceeding.

## Verification and rollback

Wait for the supported configuration save to complete. Repeat the same twelve
small reads and resource snapshot at least one minute afterward. Require zero
read errors and p95 <= max(2 x baseline p95, 2000ms). Verify the API pool has
at most five backends, the database startup time has not changed, the website
still loads its stored board, all active scheduled collectors/writers proceed
under their original leases, and locked records remain exact. Compare memory
commitment and available physical RAM; do not infer causality from one point.

Rollback by clearing only the Pool size field (automatic) and saving if the
read envelope fails, normal pipeline collection/publishing fails or queue/pool
acquisition timeouts appear. Record before/after metrics and the decision.
Do not keep this change merely to remove a warning when request behavior is
worse. Do not call the earlier restart cause confirmed from a pool improvement.

Sources: [Supabase Metrics API](https://supabase.com/docs/guides/observability/metrics),
[Supabase pool guidance](https://supabase.com/kb/troubleshooting/supavisor-faq-YyP5tI),
[PostgREST pool configuration](https://docs.postgrest.org/en/stable/references/configuration.html#db-pool).
