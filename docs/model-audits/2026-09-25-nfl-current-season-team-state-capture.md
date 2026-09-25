# NFL current-season team-state capture

Date: 2026-09-25

Status: implementation candidate. This release captures evidence only and does
not change a prediction, probability, projection, side, grade, stake, lock,
tracking result, reader field, label, or member copy.

## Finding

The authoritative NFL player-props writer already refreshes completed
current-season games and player stats before each new week, but its durable
state discards game-level team identities and final scores. The Daily Edge
team-state artifact is consequently frozen after the prior season. Current
injuries, quarterback context, and markets remain fresh, but completed 2026
team performance is unavailable to a release-pure weekly candidate.

## Repair boundary

- Extend the existing current-season state snapshot with normalized home/away
  teams and final scores from the games response already fetched by the sole
  NFL writer.
- Add no provider request, cron, timer, writer, database table, reader field,
  copy, or label.
- Preserve the shared `prediction_pipeline:nfl` lease and the existing
  fail-closed completed-game/stat completeness behavior.
- Migrate the preceding r1 snapshot by retaining its player stats while forcing
  one bounded games refresh; only genuinely missing player-stat games may
  trigger the existing stats request.
- Stamp a new immutable state release. The captured game rows are shadow input
  evidence only. A later model may consume them only after its own
  predeclared chronological selection/confirmation, balanced board-impact
  replay, release bumps, and protected production review.

## Acceptance

Focused tests must prove exact normalized game identity/score capture, cached
zero-call reuse, r1 migration without a duplicate stats request, malformed or
incomplete state rejection, and unchanged player rolling-feature output. Full
typecheck and model-change verification must pass. Live acceptance requires a
natural leased writer cycle whose state contains every completed prior-week
game once, retains the player-stat cohort, and stays inside the prior request
budget.
