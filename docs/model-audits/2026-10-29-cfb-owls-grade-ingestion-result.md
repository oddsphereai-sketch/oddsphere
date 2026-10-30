# CFB Owls grading-price ingestion result

Starting and pre-publication main: `86c99a4303af9bc5e5dcd0ecec9fecb2315a7743`.
This repair does not include draft PR #877's policy relaxation.

## What changed

The existing Owls CFB odds response is now normalized for an explicit conventional
sportsbook roster, not just capture-only Circa/Pinnacle. Complete named pairs are
stored in a separate `market.supplementalGradingBooks` evidence field and passed
only into final exact-price grading. Existing evaluated markets take precedence;
the added evidence can recover held markets using the unchanged three-book total
requirement. Fresh primary quotes beat the same book from Owls, per market.
Extra reference books cannot become execution targets. Exchanges are excluded.

No source substitution into forecast seeding, PMF construction, market reader,
movement history, public splits or opening prices. No new provider calls,
prediction writer, timer or lease. Timestamp advancement includes real received
Owls observations; future-dated and post-kickoff source clocks are rejected.
Version/legacy compatibility is recorded in the current-release registry.

## Evidence

- Twelve-book event-per-book fixture retains eleven conventional books, merges
  repeated exact observations, and excludes Novig. Conflicting duplicate pairs,
  invalid odds/holds, wrong game/sport/kickoff, stale/future quotes and duplicate
  same-book votes cannot unblock a grade.
- A strict-policy unit fixture held with two books evaluates with a third distinct
  book; the PMF remains identical. Missing approved retail execution markets can
  use real complete Owls pairs with provider provenance. Global holds remain.
- Same-input sole-writer zero-write rehearsal at 22:02 UTC: 95 games, 156 existing
  evaluated markets preserved exactly; 18 Best Angle, 23 Lean, 99 Watchlist,
  16 No Play, 129 Held before AND after. Zero promotions, demotions, recoveries,
  net actionable changes or PMF changes. Coverage: 68 games with Owls grading
  inputs, 11 distinct books, maximum 11 books/game and 7,115 added evidence bytes.
- JMU/Troy has eleven Owls books including Circa and Pinnacle; its incumbent
  spread is Watchlist. FanDuel -18.5 and Betr -18.5 alone still do not meet the
  current three-book total. Ingestion does not pretend policy was loosened.
- Locked r54/r41/r27 payload retains exact reader precedence and writer lock
  exclusion; no legacy payload is rewritten or relabeled.

Machine-readable rehearsal: `2026-10-29-cfb-owls-grade-ingestion-same-input.json`.

## Verification and limitations

Passed full `npm run test:cfb-v1-production`, `npm run verify:model-change`,
TypeScript no-emit check, shared Owls normalizer/production adapter/active-cutover
tests, and changed-file lint (only two pre-existing unused-variable warnings in
cfbForwardEvidence.ts). Optional Market Brain PostgreSQL proof was skipped
because its dedicated local URL is unset; no Market Brain change is included.

The local rehearsal lacks Playbook credentials and uses retained evidence after
reported 401s. It also reproduces a forecast-coherence failure for game 457406
under BOTH baseline and candidate (identical PMFs); that pre-existing forecast
issue is not silently corrected by this price-ingestion change. Its failed row
is not published. Production credentials and actual cron/snapshot completion
must be verified after deployment; offline coverage alone is not live proof.

Open overlapping PR #811 is behind main and contains superseded SharpAPI
continuity code; none is restored. Overlapping policy experiment #877 remains
draft, unmerged and explicitly excluded. All other worktrees are preserved.

Rollback is previous main/r141, with all already stored locks retained unchanged.
