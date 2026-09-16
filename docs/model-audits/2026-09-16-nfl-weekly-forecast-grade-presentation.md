# NFL weekly flat-board health repair

Date: 2026-09-16

## Incident

The Week 2 NFL slate was complete at 16 games / 48 predictions / zero held
games, but the current evidence naturally produced 1 Lean / 8 Watchlists /
39 No Plays. Week 1 used a frozen game-specific forecast artifact and produced
materially more actionable grades.

The Week 2 runtime is also materially flatter than Week 1: every game is on the
target-excluded later-week market-reference path, the calibrated independent
core is absent, and current sharp/public/movement adjustments are effectively
neutral. This audit does not authorize threshold relaxation or a replacement
model. The previously evaluated independent NFL challenger did not beat the
market on the untouched 2025 holdout and therefore remains shadow-only.

## Repair

- Snapshot health now warns when a complete board has at most one actionable
  grade and at least 75% No Plays. The existing zero-actionable warning remains
  stricter and takes precedence.

This changes zero forecast sides, probabilities, score projections, exact
prices, grades, promotions, demotions, stakes, locks, tracking rows, provider
calls, writer behavior, lease behavior, or member presentation. The sole writer
remains under `prediction_pipeline:nfl`. The same live 48-row cohort remains
0 Best Angles / 1 Lean / 8 Watchlists / 39 No Plays.
