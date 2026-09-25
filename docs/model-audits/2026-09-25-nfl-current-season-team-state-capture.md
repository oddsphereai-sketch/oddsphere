# NFL current-season team box-score capture

Date: 2026-09-25

Status: implementation candidate. This release captures evidence only and does
not change a prediction, probability, projection, side, grade, stake, lock,
tracking result, reader field, label, or member copy.

## Finding

The authoritative NFL player-props writer already refreshes completed
current-season games and player stats before each new week, but its durable
state discards game-level team identities, final scores, and team box scores.
The Daily Edge team-state artifact is consequently frozen after the prior
season. Current injuries, quarterback context, and markets remain fresh, but
completed 2026 team performance is unavailable to a release-pure weekly
candidate.

## Repair boundary

- Extend the existing current-season state snapshot with normalized home/away
  teams and final scores from the games response already fetched by the sole
  NFL writer, plus completed-game team box scores from BALLDONTLIE's official
  batch `team_stats` endpoint.
- Add one bounded team-stat request path to the existing weekly state transition,
  with at most eight pages under the declared worst-case ceiling. Completed
  weeks reuse durable state and make zero repeat requests.
- Add no cron, timer, writer, database table, reader field, copy, or label.
- Preserve the shared `prediction_pipeline:nfl` lease and the existing
  fail-closed completed-game/stat completeness behavior.
- Migrate the preceding r1 snapshot by retaining its player stats while forcing
  one bounded games refresh; only genuinely missing player-stat games may
  trigger the existing player-stats request, while missing team box scores are
  populated once through the new bounded batch request.
- Stamp a new immutable state release. The captured game rows are shadow input
  evidence only. A later model may consume them only after its own
  predeclared chronological selection/confirmation, balanced board-impact
  replay, release bumps, and protected production review.

## Acceptance

Focused tests must prove exact normalized game identity/score and two-sided box
score capture, cached zero-call reuse, r1 migration without a duplicate player-
stats request, malformed or incomplete state rejection, and unchanged player
rolling-feature output. Full typecheck and model-change verification must pass.
The declared worst-case cycle ceiling changes from 93 to 101 calls; the natural
weekly transition normally adds one batched team-stats response and completed
weeks add zero. Live acceptance requires a natural leased writer cycle whose
state contains every completed prior-week game and both team rows exactly once,
retains the player-stat cohort, and stays inside the new request ceiling.
