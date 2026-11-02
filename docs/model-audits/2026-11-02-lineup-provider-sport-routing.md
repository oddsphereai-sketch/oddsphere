# Legacy lineup provider ownership repair

Starting production base: `0211a1688a87a99c79b4a503b1b457346709ced8`.

The November 2 CBB `lineup_watch` failure came from the legacy MLB adapter:
`getPlayerStatsProvider()` constructs `BallDontLieProvider`, whose client uses
`/mlb/v1` and whose persistence requires baseball batting positions. The cron
previously passed every in-season sport's numeric game IDs to this adapter, then
attempted a legacy generic props generator. CBB's authoritative member pipeline
uses neither this lineup service nor its batting-order table.

The cron now dispatches only the adapter's supported sport, MLB. The service
also rejects unsupported sports before provider construction, ID mapping, or
database access, protecting every other caller. An unsupported direct call is
an explicit error, never a fabricated successful lineup capture. Existing failed
logs remain untouched. The November offseason invocation has no supported runs
and makes no provider requests or prediction writes.

The existing MLB refresh body, in-season calendar, authoritative sport writers,
shared prediction-pipeline lease, schedules, models, inputs, prices, grades,
stakes, stored snapshots, and locks are unchanged. No model release changes:
the change removes an invalid provider route rather than modifying inference.
Same-input promotion, demotion, and actionable-board impact are zero.

Validation exercises the actual transpiled route with stubbed dependencies:
unsupported sports perform no lineup, props, or prediction calls; the MLB
branch retains its lineup/line/first-inning/model/member/snapshot sequence and
lock-safe options. The actual lineup service rejects every unsupported sport
before constructing the provider. Existing MLB lineup and pipeline tests also
remain required. Rollback is this commit alone; never rewrite recorded locks.
