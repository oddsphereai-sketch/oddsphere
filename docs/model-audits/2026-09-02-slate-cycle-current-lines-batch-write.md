# Slate-cycle current-lines batch write containment

Date: 2026-09-02
Classification: behavior-neutral operational repair
Starting production base: `a4da4ea106c37d3b7b9a14c1c2cc057fadf77692`

## Incident evidence

The first natural slate-cycle after the postlude time-budget release started at
`2026-09-02T14:05:21.612Z` and was terminated before its lifecycle row could
close. Its six-minute lease expired normally, but refresh-log row `98514`
remained `in_progress`; the existing stale-run reconciler will mark it failed
before the next same-source slate-cycle.

Read-only production evidence isolates the overrun to the current-lines write
inside S7, before sharp signals or model generation:

- SharpAPI returned the line generation at `14:06:10.433Z`.
- The generation contained 2,148 MLB rows across 15 games and 573 distinct
  `(game, market, sportsbook)` groups: 1,092 Moneyline rows, 940 Total rows,
  56 Spread rows, and 60 First Inning rows.
- The old writer performed a prior-ID SELECT, new INSERT, and usually prior-ID
  DELETE serially for every group: as many as 1,719 database requests.
- Current inserts continued through approximately `14:10:13Z`, about 243
  seconds after the provider generation was ready.
- The append-only history write then finished in about 1.1 seconds. No newer
  `sharp_signals`, `game_predictions`, `prediction_records`, or Daily Edge
  response snapshot came from that slate-cycle.
- The following opener-baseline safety read matched 13,480 game-level history
  rows without pagination. PostgREST could therefore return only its first
  1,000 rows and make later `(game, market)` baselines look absent.
- The next natural `lineup_watch` acquired the expired shared lease, completed
  successfully at `14:17:34Z`, refreshed predictions/records, wrote the member
  snapshot, and released the lease. No manual cron/provider/writer/DB action
  was used.

The already-deployed postlude guard was not reached. It remains useful for the
redundant postlude, but it cannot contain a core S7 stage that consumes almost
the full route duration.

## Frozen behavior contract

This repair changes database request topology only. It does not change the
provider request, accepted provider rows, current-line identity, opener or
history logic, coverage calculations, sharp signals, model inputs/outputs,
predictions, grades, stakes, locks, writer ownership, shared lease, or cron
schedule.

The current-line contract remains:

1. Treat a complete `(game, market, sportsbook)` generation as indivisible.
2. Preserve every absent book as last-known-good.
3. Read prior IDs before any mutation and filter the broad read back to exact
   incoming group keys with `player_id IS NULL`.
4. Insert complete new groups before deleting any captured prior ID.
5. Delete prior IDs only for groups whose entire new generation inserted.
6. If a multi-group insert chunk fails, retry its complete groups sequentially
   so one rejected group cannot strand healthy groups.
7. If cleanup fails, keep both generations and surface a partial failure;
   existing newest-`fetched_at` readers still select the new generation.
8. If the bounded prior read fails, changes count while paginating, truncates,
   or exceeds its cap, perform zero INSERTs and zero DELETEs.
9. Baseline detection considers only explicit `is_opener = true` game-level
   rows (`player_id IS NULL`), pages in stable `id` order with an exact count,
   and filters cross-product results back to the requested game/market keys.
10. Legacy history without any explicit opener gets one truthful current
    baseline generation. A failed, truncated, drifting, or over-cap baseline
    read inserts no guessed baseline and surfaces a partial failure while
    preserving the already-written current lines and append-only history.

Normal execution is sequential and bounded; it does not fan hundreds of
queries out through `Promise.all`.

## Request budget

Defaults are 1,000 prior rows/page, 10,000 maximum prior rows, 10,000 incoming
rows, 2,000 complete incoming groups, 200 rows/insert chunk, and 500 captured
prior IDs/delete chunk. A group is never divided merely to meet a chunk size;
an individually oversized group occupies one chunk.

For the observed 573-group/2,148-row generation, the normal current-line path
falls from as many as 1,719 requests to approximately:

- 3 deterministic prior-ID page reads,
- 11 complete-group insert chunks,
- approximately 5 complete-group delete chunks at the observed one-prior-row-
  per-new-row steady state, and
- about 19 total requests (approximately 98.9% fewer).

Prior cleanup can require more chunks when an earlier cleanup failure left
multiple generations, but remains bounded by the 10,000-row read cap.

The baseline tail no longer reads all 13,480 matching history observations.
It reads only explicit game-level openers in 1,000-row pages, capped at 10,000
rows. That adds `ceil(explicit opener rows / 1,000)` bounded requests—normally
one or a small handful—to the approximately 19-request current-line
replacement. A cap or pagination-integrity failure performs no baseline insert
and is reported instead of turning an incomplete page into fabricated missing
keys.

Fallback requests occur only after a failed chunk and remain sequential. The
old rows survive every failed new-group insert.

## Lifecycle boundary

`runCron` already calls `closeStaleRuns` for the same data source before
opening its next lifecycle row. That safely reconciles a platform-killed
slate-cycle after the configured stale threshold, but no in-process `finally`
can run after a platform hard kill. This candidate does not broaden the shared
cron lifecycle wrapper. Deadline-aware stage deferral remains a separate
follow-up only if the batched natural cycle does not restore generous runtime
margin.

## Validation

The focused executable suite covers:

- more than 1,000 prior rows with deterministic pagination;
- exact-key filtering of cross-product overfetch and `player_id` exclusion;
- complete-group insert chunk boundaries;
- partial chunk failure with per-group isolation;
- cleanup failure with both generations retained/newest-wins behavior;
- prior-read failure, pagination truncation, prior-row overflow, and incoming
  payload overflow with zero mutation;
- duplicate prior-ID deduplication; and
- exact accepted-row equality against the prior sequential algorithm;
- more than 1,000 explicit opener rows across deterministic baseline pages;
- baseline exclusion of player props, non-openers, and cross-product rows; and
- baseline truncation, count-change, and cap failures with no accepted keys.

Validation from the isolated worktree passed the focused executable suite,
TypeScript, scoped ESLint, current-refresh cron contract, the 11-case resilient
line-history suite, the complete `verify:model-change` suite, diff check, and a
Next 16.2.6 webpack production build. The default Turbopack build cannot follow
the intentionally external `node_modules` symlink used by isolated worktrees;
the supported webpack build completed all 105 static pages. Fresh-main
integration safety remains mandatory from the clean committed candidate before
publication is considered.

The unrelated static lineup-watch test is already stale on the recorded base:
it expects one daily full Player Props refresh while `vercel.json` schedules
four. This candidate changes neither file nor schedule; the other 11 assertions
in that test pass.
