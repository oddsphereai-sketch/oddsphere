# NFL Paid Projection Forward Shadow R1 Predeclaration

## Scope and current authority

This change affects NFL Daily Edge research evidence only. It does not alter the active R44/R8
score forecast, probability distribution, prediction side, exact-price decision, grade, stake,
member fixture, copy, labels, layout, tracking tuple, lock behavior, or cron schedule.

The current production authority remains the pressure-direction family documented in
`docs/current-model-releases.md`, including collector
`nfl_forward_evidence_collector_2026_09_27_r12_pressure_direction` and sole writer
`nfl_forward_evidence_writer_2026_09_27_r45_tracking_isolation`. The only authoritative write path
remains `runNflForwardEvidenceWriter` under the existing `prediction_pipeline:nfl` lease.

## Candidate evidence

Research release `nfl_paid_projection_signal_audit_2026_09_28_r100` found complete pregame
BALLDONTLIE weekly projection coverage for 48 scheduled 2026 Week 1-3 games. On the exact 47-game
settled common cohort, the untrained paid-projection score improved the existing R95 independent
diagnostic from 57.45% to 65.96% winner direction, 38.64% to 47.73% against-market Spread direction,
and 44.68% to 48.94% against-market Total direction. Team-score, Margin, and Total MAE improved
from 8.4826 / 11.1221 / 12.0518 to 8.2266 / 10.6953 / 11.5966. This sample is diagnostic, not a
holdout, and does not authorize live prediction behavior.

Forward release `nfl_paid_projection_shadow_2026_09_28_r2_direct_score` captures the provider's
direct opponent D/ST `points_allowed` forecast as each team's expected score. The independently
reconstructed touchdown/kicking score remains in the payload as a health cross-check, but is not
averaged back into the direct team-score forecast. On the frozen 47-game diagnostic cohort this
direct construction improved Total direction from 48.94% to 55.32% and Total MAE from 11.5966 to
11.5406, while leaving winner and Spread direction unchanged; Margin MAE improved slightly and
team-score MAE was effectively neutral (+0.0035 points). Because that comparison used the same
diagnostic cohort, it authorizes forward shadow collection only, not live prediction use. The
shadow is stored only as internal evidence and cannot be read by member prediction or tracking
paths.

## Load and failure contract

- Fetch weekly projections once at slate scope with cursor pagination, never per game or per card.
- Cap one refresh at ten 100-row pages.
- Reuse the most recent complete stored per-game shadow for six hours, limiting the normal slate to
  at most four refresh attempts per day; the observed 434-487-row slate requires five requests.
- A projection failure preserves the stored shadow when available and never blocks or partially
  changes the authoritative NFL publication.
- Store only per-game aggregate scores and coverage, not hundreds of raw player rows.
- Keep the existing append-only evidence table, writer, lease, cadence, and member snapshot.

## Verification and promotion boundary

Focused pagination, aggregation, freshness, writer, member-reader, and tracking tests must prove
that same-input public output is unchanged. `npm run verify:model-change`, type checking, lint,
build, integration safety, protected-PR checks, merge, and live writer proof remain required.

This change authorizes forward shadow collection only. Promotion requires a later predeclared,
release-pure gate over settled forward games, an explicit model-release bump, coherent score and
market outputs, paired board-impact reporting, and the full deployment protocol.
