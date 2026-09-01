# MLB first-inning r78 member-tuple coherence

## Scope and invariant

R78 repairs the existing unlocked `prediction_records` handoff only. It does
not change FI V2 forecast inputs, posterior math, expected runs, side
selection, exact-price economics, grade rules, stakes, provider reads, cron
schedule, database schema, writer ownership, or the `prediction_pipeline:mlb`
lease.

For every unlocked, current, directional FI source row, including a `no_bet`,
the member record must carry the source side, natural-decimal selected-side
posterior, expected runs, exact named-book evaluation pair, cycle provenance,
and No Play grade. A valid No Play is not a hold and cannot be converted to a
Toss-Up merely because it is non-actionable. Genuine missing or incoherent FI
evaluation evidence retains the existing safe hold behavior. Locked records
are never altered.

## Production reproduction

The natural r77 cycle at 2026-09-01T23:16Z had current authoritative source
rows while member records remained stale:

| Game | Source tuple | Stale unlocked member tuple | R78 result |
| --- | --- | --- | --- |
| BAL@COL | YRFI, No Play, P(NRFI)=0.44651625949289914, expected runs=0.8062794638909853, Bally YRFI -155 | held Toss-Up, stale -157 snapshot | current YRFI/No Play with source posterior, runs, and Bally pair |
| STL@LAD | YRFI, No Play, P(NRFI)=0.46896685766049534, expected runs=0.757223179001908, Bally YRFI -137 | held Toss-Up, stale -139 snapshot | current YRFI/No Play with source posterior, runs, and Bally pair |

The source forecast had already demoted STL from an earlier Lean to a current
No Play. R78 preserves that immediate demotion and does not retain a previous
actionable public tuple because FI has no pending-promotion contract here.

## Guardrails and focused regressions

`scripts/test-prediction-record-service.ts` asserts that:

- a current directional r77 YRFI No Play publishes the current selected-side
  posterior, natural expected-runs value, exact Bally pair, and `no_bet`;
- a genuine current r77 pair gap emits no FI proposal and remains eligible for
  the existing safe hold path;
- a delayed FI writer result cannot overwrite a newer persisted cycle;
- same-cycle handoff is accepted; and
- locked rows remain excluded from both the stale cleanup and upsert paths.

The fixture is intentionally a No Play and does not modify an action rule.
Current board impact is exactly two stale-held FI member rows repaired, zero
model side/probability/projection/grade/economics/stake changes, zero
actionable promotions, and zero actionable demotions.

## Release and rollback

R78 stamps model-layer schema v11, decision r78, rule bundle v66, and
`mlb_first_inning_member_tuple_contract_v1_current_authoritative_r78_2026_09_01`.
R77 FI probability/price/calibration heads and all full-game r76 heads remain
unchanged. Rollback is r77/v10/v65: remove only the FI handoff and audited-pair
serialization while retaining the existing locked-row and genuine-incomplete
evidence safeguards.
