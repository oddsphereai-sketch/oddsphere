# MLB First-Inning Forecast Authority r80 — Predeclaration

Date: 2026-09-03

## Scope

This candidate corrects forecast authority for MLB first-inning 0.5-run
NRFI/YRFI markets. It does not change providers, query budgets, schedules,
the MLB `prediction_pipeline` lease, writer count, locked rows, or reader-side
override behavior.

## Contract

1. The independent FI run distribution remains the prior.
2. The named book selected for the exact evaluated quote is excluded from
   forecast consensus, opening/current movement, and posterior synthesis.
3. A target-excluded complete current pair may inform the posterior once;
   the exact evaluated pair is retained solely for fair probability, EV, and
   grade economics.
4. When no target-excluded pair exists, the posterior and decimal expected
   first-inning runs are exactly independent-only. This is not a hold when a
   coherent evaluated price still exists.
5. Posterior probability alone classifies NRFI, YRFI, or Toss-Up. Price and
   grade cannot promote, demote, or flip that forecast side.
6. Toss-Up is a first-class null-side, non-actionable prediction; it is not a
   hidden NRFI/YRFI boolean and cannot become an action through price alone.

## Frozen evaluation plan

Before any result/outcome join, retain release-pure locked FI snapshots and
separately report: proper-score/Brier and log loss for directional forecasts,
calibration, NRFI/YRFI/Toss-Up counts, side/probability/decimal-run changes,
and exact-price promotions, demotions, actionables, held rows, and ROI. Never
blend release identifiers or interpret price-grade returns as forecast quality.

## Required gates and rollback

Focused FI model, writer, member-record, model-change, type, lint, build,
whole-board/replay, integration-safety, protected-PR, and natural-cycle checks
must pass before publication. Prior r79 remains the rollback release. Existing
locked snapshots are immutable and are not reclassified.
