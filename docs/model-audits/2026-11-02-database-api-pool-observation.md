# Same-plan Data API pool experiment: initial observations

Follow-up to `2026-11-02-database-api-pool-predeclaration.md`, merged before the
dashboard change. Plan remains Small. No paid upgrade, credential, grant,
schema, exposure, max-row, writer, model, provider cadence or billing change.

The Data API pool size was saved as 5 at approximately 18:27:20–30 UTC and
verified after reload. This is the internal Data API PostgreSQL connection
pool, not the application client or Supavisor connection setting.

Each latency sample uses 12 small metadata-only reads at concurrency 6 and
performs no provider requests or database writes:

| Sample | Mean | p95 | Failures |
| --- | ---: | ---: | ---: |
| Before, 18:20 UTC | 478 ms | 738 ms | 0 |
| After, 18:28 UTC | 481 ms | 691 ms | 0 |
| Warm, 18:48 UTC | 468 ms | 721 ms | 0 |

The response-time gate passes. It does not establish the cause of prior
database interruptions or prove long-term stability. The first lower memory
sample is confounded: the metrics exporter restarted at 18:26:34.850 UTC,
before this pool change, after an earlier restart around 17:02 UTC.

At 18:43 UTC, committed memory was 2,544,201,728 bytes against a 2,035,793,920
byte commit limit; available memory was 653,082,624 bytes and swap used about
554 MB. The warning therefore remains unresolved. A zero OOM counter since
the latest boot cannot exclude an earlier OOM. Accessible PostgreSQL logs
show automatic recovery but do not identify the managed host's restart cause.
No claim that the pool caused or cured these restarts is supported.

Retain the predeclared rollback: clear the Pool size field back to automatic
if the latency/error or normal-job health gates fail. Do not lower it again
or buy more capacity merely to remove the warning. Managed host diagnosis
remains outside the accessible logs; no external support message has been
sent or authorized by this experiment.
