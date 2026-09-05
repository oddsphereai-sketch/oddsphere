# CFB lock capture isolation r61 — predeclaration

Date: 2026-09-05  
Scope: CFB evidence-writer failure isolation and member lock-state truth only  
Starting production base: `021d99b1862f2e33ef9f95d92046b39dd1776fea`

## Incident and frozen acceptance criteria

The current weekly board contains games whose scheduled T-60 boundary passed without a valid immutable capture. The writer run that should have captured them stopped before its atomic append when one different matchup failed a synchronous cross-market assertion. The reader also derived `locked` from a row's stage or capture timestamp rather than the full immutable-lock validator, allowing late or unhealthy T-60 attempts to look locked.

This change is acceptable only if:

1. One game-specific calculation or validation exception cannot suppress another planned game's payload, including a due T-60 capture.
2. Shared provider, lease, storage, and append failures continue to fail closed.
3. A member card says `LOCKED` only for a row that passes the existing immutable T-60 validator.
4. Inside-window games without a valid lock say `LOCKS`; games past kickoff without one say `LOCK MISSED` and retain `lockedAt=null`.
5. No historical lock is fabricated, no prediction record is backfilled, and no side, probability, projection, quote, EV, grade, execution status, or stake changes.
6. The writer response exposes affected provider game IDs and stages, the compact snapshot remains authoritative, focused tests and the complete model-change gate pass, and production is verified after protected merge.

Rollback is the complete writer/fixture/snapshot presentation family to r53/r49/r7 while preserving all immutable evidence and tracking records.
