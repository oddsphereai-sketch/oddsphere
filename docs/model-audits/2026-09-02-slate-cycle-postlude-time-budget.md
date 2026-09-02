# MLB slate-cycle postlude time budget

## Scope and production symptom

The five-minute `/api/cron/slate-cycle` route performs the authoritative MLB
slate, line, model, prediction-record, and publication work in
`runSlateCycleAutomated`. After that core finishes, the route also repeats a
Market Intelligence v2 collection and a Daily Edge response-snapshot publish.
Those two postlude operations have dedicated recovery owners:

- `/api/cron/public-splits-observations-refresh` runs every 15 minutes and
  performs the source-aware MLB Market Intelligence v2 refresh before
  republishing Daily Edge.
- `/api/cron/lineup-watch` runs twice per hour and republishes Daily Edge after
  its authoritative model/member-record sync.

A slow core slate cycle could therefore spend its final platform seconds on
recoverable duplicate work, overrun `maxDuration = 300`, and lose the core
cycle's structured completion telemetry.

## Behavior-neutral repair

The route now measures elapsed wall time from request entry. After the core
orchestrator returns, it starts the duplicate postlude only when at least
90 seconds remain:

- 45 seconds for Market Intelligence v2;
- 15 seconds for the response snapshot;
- 30 seconds reserved for completion logging, lease release, response
  serialization, and platform shutdown variance.

After Market Intelligence v2, the route recomputes the budget and requires the
15-second snapshot allowance plus the same 30-second reserve before publishing
the response snapshot. If either boundary is missed, the recoverable stage is
deferred to its dedicated scheduled owner. Deferral is not reported as a model
or writer failure; it is explicit in `details.postlude_timing`, including core
elapsed time, remaining time, required remaining time, per-stage status,
per-stage elapsed time, and a stable deferral reason.

This materially reduces overrun risk, but it is not a hard execution deadline.
Once Market Intelligence v2 has started, its underlying request is allowed to
finish; it may exceed the 45-second work estimate. The route deliberately does
not use a `Promise.race` timeout that would return while database/provider work
continued unobserved. The post-MI budget recheck prevents the next duplicate
stage from starting when that first stage consumed the snapshot allowance.

## Preserved contracts

This change does not modify the core orchestrator, model inputs or outputs,
predictions, probabilities, projections, grades, stakes, provider calls inside
the core, database query shape, writers, schedules, sport-scoped
`prediction_pipeline` lease, lock behavior, or tracking. When sufficient time
remains, both postlude operations run in the same order and with the same
arguments as before.

## Verification

The focused refresh-cycle test executes the pure budget helper at the exact
90-second full-postlude boundary, one millisecond below it, the exact 45-second
post-MI snapshot boundary, and under backward clock skew. It also executes the
telemetry builder and pins the post-MI route recheck.
Deployment verification must confirm a natural slate-cycle keeps its normal
model/release output and either completes both postlude stages or records a
truthful time-budget deferral without an orphaned `in_progress` run.
