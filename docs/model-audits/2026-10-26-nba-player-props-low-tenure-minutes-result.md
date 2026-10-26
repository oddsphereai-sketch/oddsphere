# NBA player-props low-tenure minutes result

## Decision

Qualify the low-current-team-tenure minute route for future unlocked Rebounds
decisions. Do not change Rebounds + Assists, other prop markets, grades, stakes,
or stored locks.

## Diagnosed failure

The October 22-25 exact-lock replay contained 367 Rebounds and 276 Rebounds +
Assists decisions. The active release was 183-184 (49.86%) on Rebounds and
147-129 (53.26%) on Rebounds + Assists.

Only one rebound-family row had `changed_team_since_last_game = 1`, but 97
Rebounds rows and 64 Rebounds + Assists rows had fewer than three appearances
for the player's current team. The one-game flag correctly described the last
appearance but did not describe whether the new role was established. Those
low-tenure rows were heavily Over and overprojected the actual result by about
two units on average.

## Qualified candidate

The frozen artifact already contains two independently fitted minute heads:

- the active rotation-aware minute regression; and
- the generic minute regression used by the established research tournament.

The candidate changes only the minute head feeding the robust Rebounds
component:

- `same_team_games_10 < 3`: generic minute head;
- `same_team_games_10 >= 3`: existing rotation-aware minute head.

The threshold measures actual current-team appearances and therefore remains
valid after the one-game changed-team flag returns to false. It does not use the
offered line, result, target sportsbook, or postgame participation.

## Exact current-release replay

October 22-25, 2026; 2,646 resolved exact locks:

| Measure | Active r9 | Candidate r10 |
| --- | ---: | ---: |
| All-market direction | 1,473-1,173 (55.67%) | 1,478-1,168 (55.86%) |
| All-market MAE | 4.588 | 4.562 |
| Rebounds direction | 183-184 (49.86%) | 188-179 (51.23%) |
| Rebounds MAE | 3.039 | 2.850 |
| Rebounds side changes | — | 21 |
| Corrected / harmed | — | 13 / 8 |
| Best Angle / Lean / Watchlist | 8 / 41 / 44 | 8 / 41 / 44 |
| Actionable promotions / demotions | — | 0 / 0 |
| Projection/side contradictions | 0 | 0 |

## Independent confirmation

The 360-game historical tournament's untouched 72-game block is effectively
neutral: the low-tenure route matches the active robust Rebounds direction and
changes MAE by less than 0.001. The separate 900-game cross-season dataset's
180-game untouched block is also directionally identical and changes MAE by
less than 0.001. Its early-season model-selection block is likewise
directionally identical. These blocks contain few qualifying low-tenure rows,
so they establish non-regression rather than a second estimate of the current
gain.

## Rejected candidates

- Applying generic minutes to every Rebounds row lowers current Rebound MAE but
  loses one net Rebounds decision (20 corrections, 21 harms).
- Rebuilding Rebounds + Assists from the robust Rebound and Assist components
  lowers MAE slightly but loses two net decisions (three corrections, five
  harms). Its separate direct head remains authoritative.
- Linear and boosted direction classifiers, direct combination regressions,
  and broader nonlinear candidates fail the untouched historical block and do
  not receive runtime authority.
- Post-hoc low-line and rotation-minute rules are diagnostic only. They are not
  shipped because the apparent current pattern did not reproduce in the older
  untouched block.

## Release and rollback

- artifact: `nba_player_props_frozen_runtime_artifact_2026_10_26_r9_low_tenure_minutes`
- decision: `nba_player_props_forward_decision_2026_10_26_r10_low_tenure_minutes`

Rollback restores the prior r8/r9 minute routing for future unlocked Rebounds
rows. It must never rewrite or reinterpret an existing locked payload.

