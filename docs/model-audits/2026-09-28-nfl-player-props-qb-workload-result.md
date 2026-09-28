# NFL player props quarterback workload marriage — result (2026-09-28)

## Candidate and boundary

- Base: `eb93e91a8aebb0edaea386375a5f166ac5df8e39`.
- Scope: verified current starting quarterbacks in Passing Attempts, Passing Completions, and
  Passing Yards only.
- The sole writer, `prediction_pipeline:nfl` lease, provider requests, schedule, stakes, member
  copy, labels, layout, lock boundary, and settlement contract are unchanged.
- Passing Yards retains its established target-excluded point head. The same architecture now
  repairs Attempts and Completions instead of leaving a verified starter on a reserve-history
  projection. Each market uses its own frozen empirical residual distribution.
- Different-line, target-excluded evidence may repair the projection and probability but does not
  bypass the existing same-line independent action gate.

## Same-capture A/B replay

The final read-only Week 3 replay collected one input capture and evaluated the preceding
Passing-Yards-only policy and the candidate against those identical offers and feature rows.

- observations: 42,976
- exact offers: 2,142
- feature rows / score eligible: 357 / 303
- member rows: 2,129 in both policies
- exact matched rows: 2,129; added: 0; removed: 0
- projection changes: 8; forecast-side changes: 4
- member-canonical actionables: 49 to 50
- promotions / demotions: 1 / 0
- complete-board counts after candidate reconciliation: 25 Best Angles / 42 Leans / 340
  Watchlists / 2,705 No Plays / 321 internal Held, 67 actionables
- tracking rows: 58
- provider-call maximum used: 47; current-season state calls: 0

The one promotion is not caused by relaxing the independent confirmation requirement: the exact
same-line gate remains in force. It is the downstream result of replacing an invalid reserve-scale
starter posterior with the current-role posterior on an already confirmed market. No market or
card is suppressed to obtain the result.

## Verification

- Focused portable-runtime, production-contract, snapshot-envelope, target-exclusion, and
  projection/probability-coherence assertions pass.
- TypeScript passes.
- The same-capture A/B audit reports zero row loss and zero unpaired demotions.
- The complete no-write cycle performed zero database writes and stayed inside the unchanged
  47-call observed ceiling.
- Full model-change verification, production build, latest-main integration verification,
  protected-PR checks, live writer publication, and post-publication Case Keenum workload proof
  remain required before the candidate may be called live.

## Rollback

Roll back the complete r12/r13/r16/r17/r20/r27/r10/r32/r15 release family to the September 28
current-role r11/r12/r15/r16/r19/r26/r9/r31/r14 family while preserving immutable locked evidence.
Rollback triggers include a mixed unlocked release, any starter-scale or projection/probability
coherence failure, target-book leakage, row loss, unexpected actionable inflation, provider-call
growth, writer/reader failure, or a failed live refresh.
