# MLB player props launch-gate coherence — r25

Date: 2026-08-11

## Scope

- Candidate release: `mlb_props_2026_08_11_r25`
- Writer: `/api/cron/mlb-player-props-refresh` through `refreshMlbPropsBoard`
- Lease: MLB-scoped shared `prediction_pipeline`
- Readers: member snapshot reader and admin launch-readiness gate

## Live follow-up finding

Release r24 successfully published the coherent August 11 board, but the
separate admin launch-readiness check still required every active row to have
complete research. That contradicted the new row-scoped publication contract
and would falsely report the already-open healthy board as unsafe.

## r25 contract and paired impact

The launch gate now uses the same fail-closed invariant as publication:

- complete rows are eligible for their normal grades;
- incomplete rows pass the gate only as `PENDING_DATA` or `RESEARCH`;
- any incomplete No Edge, Watchlist, Lean, or Best Angle row closes the gate.

The same 5,821-row production slate retains 103 actionable offer rows and 403
explicit research holds. Promotions: 0. Demotions: 0. Net actionable change:
0. The member reader collapses repeated sportsbook offer rows into 92 unique
recommendations: 1 Best Angle and 91 Leans.

The held rows are now separated in operational warnings instead of being
reported as one ambiguous missing-data bucket: 370 rows depend on an official
opposing starter that MLB has not announced, while 33 rows have live pitch-mix
evidence but an insufficient hitter sample (Andrew Pinckney: 3 pitches and 8%
coverage; Austin Hays: 59 pitches and 69% coverage). No held row is missing a
posted price or line, and no recoverable ingestion or mapping gap remains.

## Required live proof

- production reports r25 and a publishable snapshot;
- launch readiness has no critical blockers after enough r25 snapshots exist;
- all incomplete rows remain explicitly held;
- tracking, settlement, prices, and the member reader remain healthy;
- the next scheduled refresh completes under the shared lease.
