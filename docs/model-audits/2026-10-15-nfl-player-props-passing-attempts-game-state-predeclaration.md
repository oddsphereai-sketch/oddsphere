# NFL Player Props Passing Attempts game-state simulation predeclaration

Date: 2026-10-15
Status: research-only continuation after the factorized-count rejection

## Hypothesis

The factorized count model correctly separates plays, dropback choice, credited attempts, and
quarterback share, but its component correlations show that shifted averages do not identify the
realized game script. The next candidate adds a pregame, market-free scoring/possession state model
and uses it to integrate pass-over-expected across simulated score/time states. It also separates
full-game starter survival from conditional starter volume.

This is not permission to use a sportsbook spread or total. The state distribution may consume
only shifted official team/opponent scoring, possession, pace, efficiency, turnover, pressure,
weather, home field, roster, depth, and injury evidence that exists with equivalent timestamps in
historical training and live inference.

## Frozen architecture

1. Fit independent team scoring and possession/drive distributions using expanding seasons.
2. Simulate game-state paths in score/time buckets rather than substituting the realized score
   sequence.
3. Apply shifted team pass-over-expected effects within those states.
4. Convert simulated dropbacks through sack/scramble/spike rates and allocate them to the expected
   starter.
5. Model full-game starter survival separately; combine zero/partial/full-role components into the
   final count distribution.
6. Compare 25%, 50%, 75%, and 100% challenger mixtures with the released independent head.

## Chronology and gates

Train through 2023, select on 2024, confirm on 2025, then open the completed 2026 Weeks 1–5 replay.
Report both the postgame lead-passer evaluation denominator and the immutable offered-threshold
denominator. Postgame lead identity is evaluation-only. The candidate must improve 2026 MAE/RMSE,
offered-threshold Brier/log loss without worse direction, chronological stability, clustered
uncertainty, and complete-board promotion/demotion economics before production can be proposed.

If the independent score/possession model itself does not validate, the simulation stops there.
It may not be repaired with a market spread/total inside the independent point forecast.

## Safety

Research writes local artifacts only. Production releases, the sole writer/lease, market reader,
member rows, tracking, and every locked payload remain unchanged.
