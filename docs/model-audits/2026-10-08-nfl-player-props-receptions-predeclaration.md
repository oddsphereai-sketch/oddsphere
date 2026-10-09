# NFL player props independent Receptions predeclaration

Date: 2026-10-08  
Status: frozen before the Receptions-only tournament and any production edit

## Scope and production comparator

This stage changes only the ordinary `Receptions` point and threshold-distribution head. Passing
Attempts, Passing Completions, Passing Yards, Rushing Attempts, Rushing Yards, Receiving Yards,
Anytime Touchdown, exact-price grading, movement interpretation, locks, stakes, settlement, cadence,
and the single production writer remain unchanged.

The starting production family is the October 8 independent Rushing Yards release:

- portable runtime `nfl_player_props_runtime_2026_10_08_r12_independent_rushing_yards`;
- model `nfl_player_props_distribution_model_2026_10_08_r21_independent_rushing_yards`;
- calibration `nfl_player_props_distribution_calibration_2026_10_08_r23_independent_rushing_yards`;
- decision `nfl_player_props_decision_2026_10_08_r26_independent_rushing_yards`; and
- expected-role artifact `nfl_player_props_expected_role_runtime_2026_10_08_r4_rushing_yards`.

Locked rows keep their exact stored payload and preceding release identifiers.

## External-method conclusion frozen before testing

Public NFL tracking and play-model work supports a conditional receiving chain rather than a direct
line-anchored regression. Next Gen Stats exposes receiver cushion, separation, target depth, air-yard
share, and catch rate; nflfastR treats completion probability as separate from opportunity; FTN
charting distinguishes catchable, contested, dropped, created, designed, and checkdown targets; and
tracking research models target choice and catch probability as distinct conditional events. Route
and assignment-level coverage are valuable but cannot be invented from position labels when the same
timestamped source is unavailable for both historical training and live inference.

## Frozen football hypothesis and candidates

Receptions is `team target opportunity × roster-constrained player target share × conditional catch
probability`, not a function of an offered line, price, or market consensus.

The point tournament will reuse the already-predeclared team-wide target allocator rather than the
rejected position-group target budgets:

1. forecast the team target budget from shifted offensive volume, pass tendency, pace, opponent,
   quarterback, pressure, weather, and game-state inputs;
2. allocate targets across the complete known-active RB/FB, WR, and TE roster with normalized shifted
   target share, snap/depth role, air-yard share, availability, and vacated-workload inputs;
3. estimate catch probability by position group from strictly shifted target depth, quarterback
   completion quality, cushion/separation, catchability/contest/drop charting, pressure, opponent
   position context, and player history; and
4. compare the component with the immediately preceding independent Receptions center at fixed 50%,
   75%, and 100% component weights. The previously selected 75% team-target increment is included,
   but prior documentation does not exempt it from the new stability and exact-2026 gates.

The point model may consume only pregame football state available through the existing feature and
writer contract. Prop line, price, sportsbook, consensus, market probability, movement, result, and
current-game outcome are forbidden inputs. A posted prop may identify the named player as expected
active, but none of its numeric terms may enter the projection.

## Chronology and acceptance gates

- Train through 2023. Select on 2024 only when both MAE and RMSE beat the preceding independent
  center.
- Confirm the unchanged candidate on 2025 with non-regressing MAE and RMSE, a game-clustered 95%
  interval for candidate-minus-reference MAE below zero, improvement or a tie in all four frozen
  chronological segments, and no material bias failure.
- Rank historical qualifiers without 2026 outcomes, then open the exact immutable 2026 Weeks 1-4
  Receptions scopes. The first historically ranked candidate must improve both MAE and RMSE and
  preserve or improve offered-line direction. Report the market-influenced published center only as
  a benchmark.
- Fit Receptions-specific independent count/residual probability candidates on historical opening
  thresholds. A probability challenger may ship only if its robust historical Brier and log loss
  qualify and exact-2026 Brier, log loss, and direction do not regress. Otherwise the independently
  fitted reference distribution remains authoritative with challenger weight zero.
- Freeze the current Week 5 board before implementation. Every non-Receptions family must be
  byte-identical. Report projection, probability, side, grade, promotion, demotion, actionable, and
  exact-price changes. The earlier negative-binomial implementation that moved six actionables to
  zero is explicitly rejected and cannot be revived merely because it won historical metrics.

## Release boundary

A passing result may extend the one existing expected-role artifact and batch scorer only. It may not
add a writer, refresh loop, lease, provider call, reader override, grade threshold, stake, copy,
label, or layout change. The complete model/calibration/decision/runtime/board/member/lifecycle/
writer/tracking family must advance together, portable parity must pass, and ordinary unlocked rows
must be freshly recomputed. Market reading remains a separately labeled downstream observer and
cannot rewrite the independent point or probability.
