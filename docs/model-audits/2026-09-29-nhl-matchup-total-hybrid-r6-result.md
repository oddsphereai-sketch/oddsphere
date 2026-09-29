# NHL matchup Total hybrid r6 result — 2026-09-29

## Decision

Activate the opponent-adjusted scoring-Total hybrid as
`nhl_regular_2026_r6_opponent_adjusted_total`. This is an incremental repair,
not a replacement of the complete NHL model. It retains the r5 independent and
market-conditioned Moneyline probability and winner, retains puck-line
direction, and replaces only the weaker independent scoring-Total component.

The final home and away scores remain one coherent joint Poisson distribution.
After the new Total is computed, the margin is solved so the distribution's
home-win probability equals the r5 probability to numerical tolerance. The
grade layer remains downstream and its thresholds are unchanged.

## Research result

The winning Total component uses a recency-weighted 2018-2024 score fit plus a
pregame opponent-adjusted expected-goals attack/defense state. Generic travel,
special-teams-opportunity, danger-chance, settled-goal, static-opening-state,
and retrospectively known starting-goalie variants were rejected. They either
regressed an important untouched measure or could not be reproduced with
timestamped pregame production evidence.

On the final 30% untouched priced-2025 segment (394 games), the hybrid improves
team-score MAE from 1.393818 to 1.389944 and Total MAE from 1.857158 to
1.849124. Total direction improves from 56.56% to 58.61%. Moneyline accuracy,
Brier score, log loss, and puck-line direction are unchanged by construction.
Margin MAE moves from 2.103320 to 2.103400, a 0.000079-goal regression.

On all 1,311 priced-2025 games, team-score, margin, and Total MAE all improve.
Total direction improves from 54.87% to 55.26%; Moneyline and puck-line
directions remain unchanged. Complete machine-readable evidence is in
`nhl-research/nhl_matchup_total_hybrid_2026_09_29_r1.json`.

This does not prove or promise a 60% future overall rate. It moves the identified
weak component toward that target without discarding the components that tested
better.

## Production inputs and failure behavior

The 2026 opening state is frozen in source control. After games are played, the
sole writer replays MoneyPuck's small team game-by-game files using only games
strictly earlier than the target slate. Updates are simultaneous, opponent
adjusted, and cannot consume same-day results.

The fetch reads one small public season directory and only the team files listed
there, in batches of six, with a hard season-maturity ceiling of 33 requests; it
is cached for six hours within a process. An empty opening-season directory uses the frozen
opening state. Any incomplete or failed response activates the exact r5
Total fallback for that run. Failure never clears games, prices, splits, or the
member board, and it adds no paid-provider request.

## Board impact

The September 29 five-game board retains 5 games, 15 markets, and 14 actionable
markets. There are zero side changes, zero demotions, and one Total Lean-to-Best
Angle promotion. Moneyline and puck-line grades are unchanged. No member copy,
label, layout, market, stake, schedule, writer, lease, or lock rule changes.

Existing locked r5 records remain immutable. r6 is eligible only for new
unlocked records. Roll back unlocked r6 output to r5 if coverage is incomplete,
the joint score fails coherence, Moneyline probability differs from r5, a board
market disappears, or the reader cannot prove one consistent release.
