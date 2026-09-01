# Supabase outage and capacity containment — 2026-09-01

## Incident evidence

- Production Supabase became unhealthy at approximately 2026-09-01 15:48 UTC. Member routes returned empty or stale fallback boards while the Supabase REST host returned Cloudflare 522 responses.
- The Postgres log records an abrupt interruption, an improper shutdown, and automatic WAL recovery. It does not record `out of memory`, `too many clients`, `No space left`, `PANIC`, or a server-process termination signature in the reviewed 24-hour window.
- A dashboard-initiated project restart restored a healthy primary at approximately 16:25 UTC. Read-only production audits and authenticated MLB Daily Edge, CFB Daily Edge, and NFL Player Props reads succeeded afterward.
- The recovery does not establish a single application query as the cause. The repeated REST 522s occurred while the database was unavailable and are treated as outage fallout, not causal proof.

## Capacity evidence

Observed after recovery:

- Compute: Supabase Micro, 1 GB RAM, 60 direct-connection limit.
- Provisioned disk: 8 GB; approximately 6.1 GB was in use in the infrastructure view.
- Database relations: approximately 5.66 GB.
- `market_split_observations_v2`: approximately 1.87 GB and 2.47 million planned rows.
- `prop_scoring_runs`: approximately 1.67 GB and 1,183 scalar rows. Each row can hold a large canonical board payload.
- `market_price_observations_v2`: approximately 612 MB and 1.59 million planned rows.
- `lab_response_snapshots`: approximately 579 MB. A read-only audit at 2026-09-01T16:40:27Z found 14,118 planned keys, of which 14,108 were already beyond `stale_until`; only 10 were still eligible for any application read.

## Accepted containment

This change extends the existing authenticated `cleanup-stream-tables` sole maintenance route:

- Delete only `lab_response_snapshots` rows whose `stale_until` is more than 24 hours in the past.
- Select only `snapshot_key`; never fetch the large JSON payload during cleanup.
- Delete at most 250 rows per statement and at most 2,000 response-cache rows per run.
- Run the existing maintenance route every six hours while preserving its 60-minute lease.
- Keep all prediction, grade, tracking, lock, price, split, and model-evidence tables outside this new rule.

The application already rejects every targeted row with `stale_until <= now`. The additional 24-hour grace means this cleanup cannot change a fresh or stale fallback response.

## Deliberate exclusions

- No `prediction_records`, grade, settlement, tracking, or locked tuple is deleted.
- No market split or price observation is deleted or compacted.
- No `prop_scoring_runs` row is deleted by this change.
- No model, probability, projection, grade, stake, provider, or cron writer behavior changes.
- Historical market/evidence tables require a separately reviewed non-lossy hot/archive policy; their raw chronology must not be discarded to solve a capacity issue.

## Post-deploy checks

1. Confirm exact deployment commit and successful Vercel status.
2. Execute or observe the authenticated cleanup route and record per-table counts.
3. Prove the expired cache count decreases by no more than 2,000 per run and the live cache count remains unchanged.
4. Re-run authenticated MLB Daily Edge, CFB Daily Edge, and NFL Player Props reads.
5. Confirm Supabase reports healthy, no blocked queries, and normal connection utilization.
6. Monitor disk/database growth; implement non-lossy archive storage before basketball materially increases hot-history volume.
