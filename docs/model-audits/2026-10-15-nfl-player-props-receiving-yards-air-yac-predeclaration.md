# NFL player props Receiving Yards air/YAC decomposition predeclaration

Date: 2026-10-15
Status: frozen before the tournament is run; research only

## Question

Can the independently released Receiving Yards point head be improved by modeling the two yardage
components that actually create a reception result, rather than asking one regression to learn yards
per target directly?

The challenger remains completely separate from the market reader. Prop lines and prices are used
only after the challenger is frozen, to score offered-line direction on immutable 2026 replay rows.

## Frozen candidate

The opportunity lane is the existing independently fitted team-target budget multiplied by the
complete-roster, participation-aware player target share. For each `BACK`, `WR`, and `TE`, the new
yardage component is:

`predicted targets × predicted completed-air-yards per target`

`+ predicted targets × predicted catch rate × predicted YAC per reception`

Weekly public nflverse player statistics provide the training outcomes. Completed air yards are
defined exactly as `receiving yards - receiving yards after catch`; the rate is clipped to
`[-10, 30]` yards per target. YAC per reception is clipped to `[-3, 30]`. Models use the existing
strictly shifted player, role, team, actual-opponent, availability, depth, pressure, NGS intended
air-yard, catch quality, separation/cushion, expected-YAC, weather, and position features. Rate
models are exposure-weighted by targets or receptions. No current-game component outcome may enter
its own prediction.

The finite tournament is six candidates: 25%, 50%, and 75% blends of the new component with the
released independent point head, tested once for all eligible receiving roles and once for wide
receivers only. There is no additive 2026 bias correction, market consensus term, or candidate
created after inspecting current-season results.

## Chronology and gates

1. Fit through 2023 and select on 2024.
2. Refit through 2024 and require confirmation on 2025.
3. Freeze the single historically ranked identity before opening the exact 2026 replay through
   Week 5.

A candidate must improve both MAE and RMSE in 2024, not worsen either metric in 2025, have a
game-clustered 95% MAE-delta upper bound below zero in 2025, and avoid a positive MAE delta in every
frozen 2025 chronological segment. Ranking uses the clustered upper bound, then normalized 2024
MAE+RMSE, then 2025 MAE.

The frozen identity qualifies on the current season only if exact offered-scope MAE and RMSE both
improve and offered-line direction does not decline. Results are also reported by role and week,
with no claim of assignment-level cornerback coverage because that source is not present.

## Release boundary

This run cannot change production. A pass opens a separate portable-parity and same-input board
replay; it is not itself deployment authority. A failure retains the released Receiving Yards head
unchanged. Every stored locked projection, probability, pick, grade, price, stake, and evidence
field remains immutable.
