# NFL production-aligned independent score r4 — frozen predeclaration

Date: 2026-10-15

Status: research-only challenger; no production or locked-record writes.

## Question

Can a true independent NFL model trained only on team statistics that the sole
live writer can reproduce exactly outperform the current fantasy-defense score
center without depending on unavailable live EPA fields?

This is deliberately not a market model. Betting lines, prices, splits, line
movement, and market consensus are excluded from every model feature. The
professional market reader remains a separate downstream authority; no scalar
market weight or model/market average is permitted.

## Frozen state

Each team's offense and defense have fast (0.35) and slow (0.16) exponentially
weighted states for:

- points per game;
- offensive plays;
- net yards per play;
- net passing yards per dropback;
- rushing yards per attempt;
- sack rate;
- turnover rate per play; and
- pass/dropback rate.

All eight are available from both the checksum-pinned nflverse weekly team
files and the existing BALLDONTLIE game team-stat endpoint. A week's games are
all scored before any result from that week updates state. Offseason carry is
0.65 toward fixed league priors. Pregame context is limited to home field,
neutral/division status, rest, roof, surface, prior-game count, and the
already-pregame Elo state. Team identity and season identity are excluded.

For each state metric, the model receives fast and slow offense-versus-defense
matchup difference and sum. No completed-current-game field enters its own
feature row.

## Frozen tournament

- Train: 2016–2022.
- Select architecture: 2023 only.
- Confirm without tuning: expanding fits for 2024 and 2025.
- Opened stress test after selection: all completed 2026 games.
- Heads: margin and Total are selected separately.
- Candidate estimators: Ridge 30/100/300, strongly regularized histogram
  gradient boosting, 96-tree Extra Trees with `min_samples_leaf=12`, the three
  Ridge average, and the all-model average.
- Selection minimizes 2023 MAE, then RMSE, then component count.
- Team scores are always `(Total + margin) / 2` and `(Total - margin) / 2`.

## Gates

The challenger advances to runtime-artifact work only if 2024–2025 produces
finite coherent scores, improves the audited fantasy-center margin error scale
or its Total error scale, and does not collapse both direct Moneyline and line
direction. The exact 2026 replay and paid 32-game cohort are reported after the
architecture is frozen; they cannot alter the recipe.

Injury reports and expected quarterbacks remain mandatory eligibility and
context inputs in the complete product. This tournament does not fabricate a
historical expected-starter field where one was not timestamp-verifiable.

Passing this audit does not authorize production. Portable parity, qualified
market-reader replay, promotion/demotion accounting, release bumps, focused
tests, full model-change verification, integration safety, owner approval, and
live proof remain required. Existing locked payloads retain exact precedence.
