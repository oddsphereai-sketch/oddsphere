# MLB first inning r81 authoritative Toss-Up null persistence

## Predeclared defect and scope

r80 correctly generated an FI V2 Toss-Up with `predicted_nrfi:null` and a
member record with `pick:"Toss-Up"`, `side:null`, and `no_bet:true`. The
existing sole writer nevertheless retained an earlier directional boolean in
`game_predictions`: its automodel adapter omitted nullable pick fields, and
the existing ingester payload loop skipped all null values. That allowed a
pre-r80 NRFI/YRFI value to survive while the current audited tuple was
Toss-Up.

r81 changes only that persistence boundary. For an FI V2 row whose explicit
`nrfi_decision_kind` is `toss_up`, the adapter and existing ingester write
`predicted_nrfi:null` at both the authoritative column and its existing
sport-specific mirror. Generic nullable fields and FI holds retain their
existing behavior.

## Invariants and validation

- The FI model posterior, expected first-inning runs, NRFI/YRFI/Toss-Up
  classification, exact evaluated quote, EV, grade, stake, provider reads,
  writer/lease, and full-game tuples are unchanged.
- Locked rows remain blocked by the existing ingester lock guard; r81 applies
  only to an unlocked future writer cycle.
- Focused regression proves the FI V2 Toss-Up adapter intentionally carries a
  null to the sole writer, the ingester validates it as a first-class
  prediction rather than a hold, and the captured `game_predictions` payload
  persists the top-level and mirrored null. Directional FI still persists its
  boolean. Existing member-record tests prove Toss-Up remains `side:null`,
  `no_bet:true`.

This is forward-only. No historical rows are backfilled or rewritten.
