# CFB market-evidence identity continuity and lock isolation

Date: 2026-09-04  
Status before runtime edits: predeclared candidate  
Scope: CFB grade-time evidence identity and forward-evidence collection only

## Defects

The locked-board review found three ways valid pre-lock context could disappear without the
underlying forecast changing:

1. Grade-time Circa matching required exact Spread/Total line equality while the model's existing
   forecast-time identity contract already treats an exact or half-point-adjacent line as the same
   bounded context. Price-shopping to a half-point-better user quote could therefore erase the
   source read.
2. Grade-time movement compared the operational opening with the price-shopped execution book.
   When those were different books, valid opening-to-current movement from the context book became
   unknown.
3. A network failure in optional SharpAPI odds fallback aborted the entire writer, including games
   that already had sufficient primary-provider named-book coverage. This caused otherwise complete
   games to miss an on-time T-60 attempt.

## Frozen correction contract

- Use the same 0.5-point line-identity tolerance already authorized for forecast evidence. Anything
  wider stays unavailable, never neutral or inferred.
- Compare operational opening with current context from the same sportsbook. A separately
  price-shopped execution quote remains the exact-price tuple and is not rewritten.
- Isolate only optional fallback network/fetch failure. Games already complete from the primary
  provider continue; fallback-dependent games remain held and the incident is surfaced. Structural,
  identity, malformed-response, and request-cap failures still fail closed.
- Keep the immutable T-60 maximum-lag gate, single writer, sport lease, PMF, side, probability,
  stake, price selection, and locked history unchanged.
- Add no team-, matchup-, spread-size-, price-, EV-, or result-specific grade sleeve. Existing grade
  arbitration receives the repaired evidence; this release does not automatically follow sharp
  money or flip a prediction.

## Required review

The frozen same-board comparison must report promotions and demotions caused solely by evidence
availability, plus unchanged market counts. It must include both winning and losing records when
describing sharp/movement behavior. The reusable audit is
`scripts/operator/audit-daily-edge-loss-market-evidence.ts`, which groups immutable locked rows by
release and places every settled win/loss into the same outcome-blind evidence ballot.

Publication requires the focused line-identity, same-book movement, optional-network isolation,
and structural-failure tests; TypeScript; full model-change verification; build; latest-main
integration safety; protected PR; and post-deploy writer/reader/release proof.

## Release and rollback

The release set is recorded in `docs/current-model-releases.md`. Rollback restores the September 1
r26 decision / r7 grade / r29 member release and the merged September 4 r44 writer / r14 tracking
contract while retaining locked evidence unchanged. A mixed slate, unexpected board
collapse, missing-evidence presentation as ordinary No Play, late lock, or writer/reader mismatch
blocks or rolls back publication.
