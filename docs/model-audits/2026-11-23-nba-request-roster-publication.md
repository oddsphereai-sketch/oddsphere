# NBA request-scoped roster and publication diagnostics — November 23

Status: prospective, not deployed. Starting production base:
`a622cad6ec678b4da0194ea6aa404d521454b6a1`.
Fresh production integration base: `44a5457101128688f4cd454af4fb0007c62c0a89`
(PR1143). Both additive registry/safety sections are retained verbatim; R59
partition headroom and its source/writer release changes remain intact.

## Observed incident and scope

Owner-authorized, read-only Vercel logs show NBA Daily Edge rebuilds reporting
“The operation was aborted due to timeout” at November 23 16:45:13.543,
22:44:55 and 23:15:31.420 UTC. The first and last inspected invocations had
accepted 780 current-day odds rows, with zero incomplete groups dropped.
The existing log records only the message, not the dependency or stack. These
observations do **not** establish which source caused any of the three incidents.
No claim is made that separate player-prop generation failures caused them.

The SELECT-only health check at November 24 01:09:44.586 UTC found 10 current-day
games, all 30 market records, 24 locked records, no unlocked coherence defects,
and a recovered published reader generated at 01:01:06.177 UTC. This is incident
recovery, not proof of a permanent fix or a candidate deployment.

Code inspection establishes a separate, reproducible load issue: the seven-date
rolling member board can collect the identical all-team active-roster pagination
set once for each nonempty date, in batches of three dates. The scope is only
NBA Daily Edge Moneyline/Spread/Total source collection and error diagnostics.
The existing source, model, reader, prediction-record writer and scheduled
`prediction_pipeline:nba` lease remain authoritative. No props, other-sport,
provider contract, schedule, database schema or timer changes.

## Prospective change

- Model/record: `nba_professional_unified_2026_11_23_r39_request_scoped_roster`.
- Market marriage: `nba_market_marriage_2026_11_23_r41_request_scoped_roster`.
- Reader: `nba_reader_publication_2026_11_23_r5_request_scoped_roster`.
- Failure receipt: `nba_reader_failure_log_2026_11_23_r2_source_phase`.
- Previous: model R38, marriage R40, reader R4, receipt R1.
- Grade R31, roster residual R2, fitted score/probability artifacts and every
  numerical/posture/selection/price/stake rule remain unchanged.

One lazy request-local promise supplies the authoritative active-roster result
to every rolling date. Seven populated dates use one pagination set instead
of seven. Empty dates do not trigger collection; a new request collects anew.
There is no process cache, stale reuse, retry or second collection owner. The
existing ten-page limit, 100-player page size, 20-second request timeout and
three-date analysis concurrency remain exact. A successful complete source or
an already-supported explicit unavailable result is shared identically.

Response-body errors retain their original rejection semantics. In particular,
a timeout after headers or invalid JSON does **not** turn into a newly publishable
independent-only forecast. A failed rebuild retains the last complete reader,
its original clocks, cache TTL and locked fields. A partial roster map cannot
escape the rejected promise. Fetch/body parsing in `nbaRosterRegime.ts` is unchanged.

Error-only, weakly held phase markers distinguish the source stage in the
existing redacted failure receipt and cron error string. The innermost stage
wins; the original error object is rethrown and even frozen errors are supported.
No source payload, SQL text, token, success-path trace, new table or log writer
is introduced. Existing typed price/split completeness codes retain precedence.

R38/R37/R36/R35/R34 remain exact, explicit input-knowledge predecessors. Current
release state wins; no historical locked payload is restamped or reinterpreted.

## Offline verification

No real provider, AI, refresh or deployment request is used in these tests.
`test-nba-request-roster.ts` uses injected source responses and the actual roster
residual, professional candidate, current grade function and reader snapshot
writer. Thirty same-input team pairs include twenty nonzero roster correction
paths and 90 market evaluations. The unchanged comparison has 58 Best Angles,
15 Leans, 10 Watch and 7 No Play in **synthetic fixtures**, not the live slate.
Predictions, probabilities, selections and grades are deeply equal. Promotions
0; demotions 0; net actionable change 0. No demotion/promotion rule is added,
and these tests make no accuracy or profitability claim.

Concurrent timeout, invalid-JSON and failed-later-page cases reject all seven
consumers with the same original error, issue one collection only, publish zero
snapshots, advance no freshness/TTL/cache and preserve exact stored lock bytes.
The publication suite tests every allowlisted phase through the real existing
snapshot writer, including frozen errors, inner-phase precedence, redaction,
unknown-code rejection and successful recovery. Existing complete-event evidence,
knowledge continuity, numerical candidate, immutable writer/reader and rolling
schedule tests are required separately.

Two pre-existing structural test assumptions were stale: site-wiring assertions
looked for ID pagination inside the pipeline although R37/R38 delegate to the
authoritative exact-event helpers; the rolling test expected the superseded R22
cron literal and a removed conditional heading. The tests now check the current
helper pagination/count proof, actual R26 cron and current NBA heading; runtime
source/cron/UI behavior is not restored to an older release.

## Verified local checks on the integrated production base

On integrated main `44a5457101128688f4cd454af4fb0007c62c0a89`, all sixteen
focused NBA suites, full repository TypeScript (`--incremental false`), affected
ESLint and `npm run verify:model-change` pass. The optional local Market Brain
PostgreSQL proof is explicitly skipped because its URL is unset. The new roster
regressions run serially from the existing required reader-publication suite;
`package.json` is unchanged, preserving another task's independent test wiring.
The initial test-entry attempt lacked the mock DB environment and failed before
any I/O; the serial entry uses the existing fixture environment correctly.

The default local Turbopack build rejects this isolated worktree's external
`node_modules` symlink. The webpack production build is checked separately;
this is a worktree tooling constraint, not evidence of a live application error.

## Release gates and rollback

Before publication: focused suites, `npm run verify:model-change`, semantic
TypeScript, lint, clean committed latest-main integration/no dirty overlaps,
protected up-to-date pull request and exact remote tree. A preview alone is
insufficient. After merge require actual production Ready/current/source commit,
ordinary scheduled writer/reader release and coverage, existing lease health,
next sweep, and unchanged pre-existing lock hashes. No manual paid proof or
historical correction is authorized or needed.

Roll back future unlocked code through a protected fresh-base PR on source-call
growth, changed same-input numerical/grade behavior, missing scope, incoherent
publication, new source failure or any old lock change. Keep originals and the
previous complete reader. Repeated unclassified timeouts require their actual
new source phase before identifying another dependency as the cause.

Private incident/log/health/test evidence is outside Git at
`/private/tmp/nba-reader-timeout-stage-20261123`; no private source bodies are
added to the site or release registry.
