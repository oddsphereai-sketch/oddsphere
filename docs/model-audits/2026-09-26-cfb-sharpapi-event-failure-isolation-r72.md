# CFB SharpAPI event failure isolation r72

## Predeclaration

- Scope: CFB named-book SharpAPI fallback collection and the sole CFB forward-evidence writer.
- Production incident: the first score-side-coherent r71 writer run stopped before publication
  because the exact James Madison–Old Dominion SharpAPI event reported more than the bounded four
  200-row pages. The prior compact member snapshot remained available; no partial evidence was
  appended.
- Intended behavior: retain the four-page per-event and 192-request run caps. A malformed,
  non-advancing, or oversized exact-event odds response is recorded against only that verified
  game, returns no fallback books for that game, and lets healthy sibling games continue through
  the one atomic writer. Canonical event discovery, the global request cap, shared network errors,
  and ambiguous identity remain fail-closed.
- Unchanged: score model, PMF, probability, calibration, side, grade, stake, member copy/labels,
  layout, cron schedule, sole `/api/cron/cfb-forward-evidence` writer, `prediction_pipeline:cfb`
  lease, append-only evidence, immutable T-60 rows, and provider request ceilings.
- Release identifiers: SharpAPI fallback r13 and writer r72. The r71 score-side-coherent
  prediction/evidence/member release family remains authoritative.
- Rollback: revert fallback r13 and writer r72 together to r12/r71; preserve all immutable rows.

## Result

- Focused SharpAPI and CFB production contract tests pass.
- The live-provider zero-write replay completed instead of throwing: 106 games, 100 proposed
  opening payloads, 158 published exact-price evaluations, zero capture failures, zero writes,
  and an 89-call maximum accounting total. The oversized event remained an internal
  `sharpapi_odds_fallback_request_failed` health condition; healthy siblings continued.
- Protected PR, production deployment, and a successful applying writer run remain pending.
