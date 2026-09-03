# MLB pregame-sweep deadline containment

Date: 2026-09-03

## Incident and boundary

The 15:35 ET `pregame_sweep` entered MLB's T-60 window, completed the separate
MLB-props lock, and then stopped before the full-game current-line replacement.
Its shared lease expired without the route reaching `runCron`'s `finally`
cleanup. The next scheduled run acquired the expired lease, refreshed the game,
and locked it 52 minutes before first pitch. Read-only production evidence found
no full-game line, history, prediction, or lock mutation from the interrupted
run.

This change is behavior-neutral for forecasts and successful refreshes. It adds
a route-owned soft deadline to the existing T-60 line refresh and propagates its
abort signal through the existing SharpAPI discovery and odds calls, including
rate-limit waits. Before the atomic current-line replacement begins, the service
must still have a fixed commit reserve. If it does not, the route returns a
truthful partial result, applies no authoritative lock, and lets the existing
cron wrapper close the lifecycle row and release the existing sport-scoped
lease. The next minute's normal sweep retries from the complete prior line set.

## Preserved contracts

- T-60 remains the first and highest-priority full-game action.
- The sole line refresh, prediction writer, lock writer, cron schedule, and
  `prediction_pipeline:mlb` lease are unchanged.
- Provider endpoints, query shapes, successful-run write topology, forecast
  inputs, probabilities, decimal projections, sides, grades, stakes, tracking,
  and locked-record precedence are unchanged.
- No partial current-line replacement starts on a deadline path.
- Ordinary callers that do not supply a deadline retain the existing behavior.
- Stale-lifecycle reconciliation is unchanged; graceful deadline containment
  makes the route's existing `finally` cleanup authoritative for this failure.

## Deadline contract

- Route maximum: 90 seconds.
- Pregame soft deadline: 55 seconds from request entry, including lease wait.
- The SharpAPI request signal ends 12 seconds before the soft deadline.
- At least 12 seconds must remain before entering the atomic current-line
  replacement.
- Deadline telemetry identifies the failed stage, elapsed/remaining time,
  confirms current-line replacement and authoritative lock did not begin, and
  names the next scheduled sweep as the retry.

## Verification

Focused tests cover a pre-aborted request, abort during a SharpAPI 429 wait,
signal propagation, the exact commit-reserve boundary, ordering before the
atomic replacement, fail-closed route telemetry, next-run retry, and shared
lease release through `runCron`'s `finally` block. Existing pregame-sweep safety
and SharpAPI speculative-bucket suites remain required alongside TypeScript,
lint, the complete model-change gate, production build, diff check, and fresh
main integration safety.

