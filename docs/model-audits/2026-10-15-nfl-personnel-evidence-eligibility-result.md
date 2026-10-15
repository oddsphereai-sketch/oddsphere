# NFL personnel-evidence eligibility result — 2026-10-15

## Outcome

The bounded candidate closes the fail-open path. Future unlocked games publish no exact-price
decisions when the exact-game injury report, expected quarterback, or selected quarterback's exact
historical model identity is unavailable. The diagnostic projection may still be stored, but the
member board receives a transparent game-level hold.

## Implemented contract

- `injury_report_unavailable` and `expected_quarterback_unavailable` are blocking rather than
  contextual health reasons.
- The selected away/home quarterback must exist and match an exact historical quarterback state.
- Out/Doubtful from either the current roster/depth snapshot or verified injury report removes the
  expected starter. A backup marked Out/Doubtful by either source is skipped.
- The compact writer persists the effective shadow blockers in `coverage.healthHolds`; downstream
  production already withholds all three game decisions whenever a blocker exists.
- Projected-but-identified starters are retained and disclosed. Treating projected as unverified
  would hold the entire current board because the provider does not supply universal pregame
  confirmation.
- Forecast coefficients, projected score, market authority, exact prices, provider cadence, sole
  writer, shared `prediction_pipeline:nfl` lease, and historical locked payloads are unchanged.

## Focused proof

Automated coverage now proves:

- a missing injury report holds;
- a missing expected quarterback holds;
- roster status `O` or `D` triggers replacement even when the injury report omits that player;
- an unavailable backup is skipped and no remaining quarterback holds;
- an unmatched replacement holds;
- a matched healthy replacement remains eligible;
- effective blockers reach the writer coverage payload;
- the new compact reader retains the immediate r30/r33 snapshot verbatim, while existing locked
  fixture precedence remains intact.

The focused r6/QB, writer, fixture, compact-snapshot, and production-grade suites pass.

## Current Week 6 no-write rehearsal

The credential-backed rehearsal used the configured BALLDONTLIE, Sharp, and database credentials,
with `apply=false`; proposed/inserted rows were 14/0 and member/tracking writes were zero. The local
environment did not contain a Playbook key, so the run explicitly marked that provider unavailable
rather than claiming full split-feed parity.

| Measure | Stored baseline | Candidate at rehearsal time |
| --- | ---: | ---: |
| Games | 14 | 14 |
| Market slots | 42 | 42 |
| Held games | 0 | 2 |
| Actionable labels | 22 | 17 |
| Best Angle | 15 | 11 |
| Lean | 7 | 6 |
| Watchlist | 10 | 10 |
| No Play / held display | 10 | 15 |

Two of the five observed actionable-label reductions were concurrent market/price changes between
the stored capture and rehearsal and are not credited to this repair. The personnel gate itself
withheld six decisions across two named games and demoted three previously actionable labels:

- `PIT@TB`: selected home-quarterback history was unmatched after the unavailable-starter
  substitution path. Its prior Moneyline Best Angle and Total Lean become held; Spread Watchlist is
  also withheld.
- `WSH@SF`: no verified exact-game injury report was available even after last-known exact-game
  continuity. Its prior Spread Best Angle becomes held; the two No Plays are also withheld.

There are zero personnel-gate promotions. These rows are excluded as incomplete evidence, not
reclassified as correct predictions. Twelve games remain eligible; the release changes no score or
probability mathematics for them.

## Remaining gates

Full `npm run verify:model-change`, clean current-main integration safety, protected pull-request
checks, merge, and live release/cron/coverage/reader/lock verification remain required before this
candidate can be called production-live. Playbook parity must be verified in the deployment
environment that owns that credential.
