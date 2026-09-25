# NFL Player Props projection/line coherence predeclaration

Date: 2026-09-24

## Scope

- Base commit: `d3adbd1997a3de95e0ccded91c559f9c51d3ea25` from the then-current remote `main`.
- Sport and markets: NFL player props; ordinary two-way passing attempts, passing completions,
  passing yards, rushing attempts, rushing yards, receptions, and receiving yards.
- Anytime TD is out of scope because it has no published volume projection/line comparison and
  retains its existing ranked distinct-scorer policy.
- The member reader, shared forecast helper, writer telemetry, release registry, and focused
  contracts are in scope. Provider adapters, model features, posterior probabilities,
  projections, exact prices, grades, stakes, locks, settlement, schedules, and tracking history
  are out of scope.
- The sole writer remains `nfl-forward-evidence` under `prediction_pipeline:nfl`. No new provider
  call, database writer, route, timer, member copy, label, or layout is authorized.

## Production finding frozen before implementation

The read-only production snapshot generated at `2026-09-24T23:51:09.913Z` contained 2,564 member
rows and 1,061 distinct ordinary two-way markets. The existing slate-level expected-prevalence
ranking displayed 197 markets on the opposite side of their published projection and exact line:

- receiving yards 110;
- rushing yards 37;
- receptions 27;
- passing yards 9;
- rushing attempts 8;
- passing completions 4;
- passing attempts 2.

There were no projection/line equalities. Of the contradictory displayed outcomes, 193 were No
Play, three were Watchlist, and one inferred outcome had no quoted sibling after filtering. No
Best Angle or Lean is changed by this finding.

## Candidate and acceptance gates

The sole candidate makes the published projection versus the exact line authoritative for the
ordinary member-facing prediction. Above is Over, below is Under, and an exact equality uses the
same posterior probability only as a deterministic tie-break. Grade, EV, current price, and any
slate-level side count cannot override that outcome.

Acceptance requires:

1. zero projection/line contradictions on the frozen production snapshot;
2. zero changes to rows, probabilities, projections, prices, grades, actionable counts, stakes,
   locks, or tracking tuples;
3. filtered one-sided quote views still resolve the forecast from the market projection rather
   than treating the remaining quote as the prediction;
4. new immutable calibration, decision, runtime, board, member, lifecycle, and writer releases;
5. focused tests, TypeScript, lint, model-change verification, full verification, production
   build, latest-main integration safety, protected PR checks, and live production proof.

Rollback restores the preceding r9/r12/r13/r16/r22/r4/r25 release family and ranked presentation
helper while preserving all locked/tracked rows.
