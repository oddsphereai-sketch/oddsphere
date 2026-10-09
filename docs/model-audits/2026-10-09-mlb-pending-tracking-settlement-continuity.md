# MLB pending-tracking settlement continuity — 2026-10-09

## Scope

This is an operational settlement repair. It does not change an MLB forecast,
projection, probability, side, line, price, play grade, stake, model release,
copy, label, or layout. Existing locked `prediction_records` remain the source
of truth. Only authoritative game outcomes and their downstream
`prediction_grades` are allowed to move from pending to a settled result.

Settlement contract:
`tracking_settlement_v5_mlb_provider_catchup_2026_10_09`.

## Production finding

The production ledger contained 28 stale MLB pending grades across ten slate
dates from June 6 through July 17:

- 11 Moneyline records;
- 11 full-game Total records;
- 6 first-inning records.

Nine linked games were officially postponed but their stored game lifecycle
had remained scheduled. Those games accounted for 25 records, including two
duplicate historical release rows for ATL–CWS that remain preserved and are
handled by the existing aggregate precedence contract. The remaining three
records belonged to the first game of the July 7 MIL–STL doubleheader; its
stored row said final but lacked both full-game scores and first-inning runs.

The normal tracking cycle revisits yesterday, today, and tomorrow. A bounded
historical-pending repair had previously existed, but its invocation and result
surface were absent from the current orchestrator. Its old discovery query also
bounded the first 1,000 pending grades across every sport before filtering by
sport, which could starve one sport in a busy ledger. Finally, database-only
discovery could not select old MLB rows whose terminal state itself was the
missing datum.

## Repair

The one-time cleanup used the existing MLB Stats linescore ingester and shared
deterministic grader. Strict date, home-team, away-team, and doubleheader start
matching succeeded before any write. It produced:

- 25 `void` results for nine officially postponed games;
- one Moneyline result, one full-game Total result, and one first-inning result
  for the official July 7 MIL–STL final;
- zero remaining MLB pending grades in the production tracking snapshot.

The durable repair:

1. restores bounded stale-pending discovery and grading to the active hourly
   tracking orchestrator;
2. filters the pending query by sport before applying its 1,000-row cap;
3. processes no more than three historical slate dates per sport per run;
4. performs one MLB Stats slate read for each selected historical MLB date
   before grading, so a missing final or postponed lifecycle can recover;
5. leaves all non-MLB sports on the existing database-only eligibility rule;
6. exposes the contract version and catch-up counters in cron diagnostics.

## Safety and rollback

The repair does not write `game_predictions`, `slate_status`, or `locked_at`.
The MLB ingester only writes authoritative game status, final-score, and
inning-score fields after strict identity matching. The grader writes only the
derived settlement row and retains the existing settled-to-pending regression
guard. Existing locked decision tuples are never reconstructed or replaced.

Rollback removes the stale-pending invocation from
`trackingRefreshService.ts`, restores the v4 settlement identifier, and leaves
all already-settled historical results intact because authoritative settlement
must not be regressed to pending.
