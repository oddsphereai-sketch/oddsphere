# NFL player props independent Receiving Yards predeclaration

Date: 2026-10-08  
Status: frozen before the Receiving-Yards-only tournament and any production edit

## Scope and production comparator

This stage changes only the ordinary `Receiving Yards` point and threshold-distribution head.
Passing Attempts, Passing Completions, Passing Yards, Rushing Attempts, Rushing Yards, Receptions,
Anytime Touchdown, exact-price grading, movement interpretation, locks, stakes, settlement, cadence,
and the single production writer remain unchanged.

The starting production family is the October 8 independent Receptions release:

- portable runtime `nfl_player_props_runtime_2026_10_08_r13_independent_receptions`;
- model `nfl_player_props_distribution_model_2026_10_08_r22_independent_receptions`;
- calibration `nfl_player_props_distribution_calibration_2026_10_08_r24_independent_receptions`;
- decision `nfl_player_props_decision_2026_10_08_r27_independent_receptions`; and
- expected-role artifact `nfl_player_props_expected_role_runtime_2026_10_08_r5_receptions`.

Locked rows keep their exact stored payload and preceding release identifiers.

## External-method conclusion frozen before testing

Public NFL work supports a staged receiving-yards model instead of a direct regression or market
blend. Next Gen Stats separates intended air yards, receiver separation/cushion, catch probability,
expected YAC, and YAC over expectation. nflfastR likewise treats completion probability and YAC as
separate conditional problems. FTN charting adds catchable, contested, dropped, screen, play-action,
motion, pressure, and read-progression context. Published route and defender-position research shows
that assignment-level coverage is valuable but cannot be reconstructed faithfully from a generic
WR-versus-CB grade. Until the same timestamped route/assignment feed exists historically and live,
opponent effects remain partial-pooled team/position context rather than invented matchup certainty.

## Frozen football hypothesis and candidates

Receiving Yards is `team target opportunity × roster-constrained player target share × catch
probability × yards per reception`, with a direct yards-per-target head retained as a challenger.
It is not a function of an offered line, price, consensus, or movement.

All candidates reuse the previously validated team-wide target allocator:

1. forecast the team target budget from shifted pass volume, pace, pass tendency, quarterback,
   pressure, opponent, weather, and game-state inputs;
2. allocate targets across the complete known-active RB/FB, WR, and TE roster using normalized
   shifted target share, snaps/depth, air-yard share, availability, and vacated-workload evidence;
3. estimate receiving efficiency within the frozen expected-role groups using one of three fixed
   heads: ordinary direct yards per target, target-exposure-weighted direct yards per target, or
   target-exposure-weighted catch probability multiplied by reception-exposure-weighted yards per
   reception; and
4. compare each component with the immediately preceding independent Receiving Yards center at
   fixed 50%, 75%, and 100% component weights.

The efficiency inputs are limited to strictly shifted target depth/air-yard share, catch quality,
separation/cushion, expected and above-expected YAC, catchable/contested/drop charting, receiver role,
quarterback completion/pressure context, opponent position allowance, weather, and prior player
history already present in the checksum-pinned external feature contract. Bounds remain 0-30 yards
per target, 0-1 catch probability, and 0-40 yards per reception. No new feature, model family,
hyperparameter, blend weight, or manual outcome correction may be introduced after the exact 2026
replay is opened.

Prop line, price, sportsbook, consensus, market probability, movement, result, and current-game
outcome are forbidden point-model inputs. A posted prop may identify the named player as expected
active, but none of its numeric terms may enter the projection.

## Chronology and acceptance gates

- Train through 2023. Select on 2024 only when both MAE and RMSE beat the preceding independent
  center.
- Confirm the unchanged candidate on 2025 with non-regressing MAE and RMSE, a game-clustered 95%
  interval for candidate-minus-reference MAE below zero, improvement or a tie in all four frozen
  chronological segments, and no material bias failure.
- Rank historical qualifiers by the upper end of the clustered interval, then normalized historical
  error, without 2026 outcomes. Open the exact immutable 2026 Weeks 1-4 Receiving Yards scopes only
  for that ranking. The first-ranked candidate must improve both MAE and RMSE and preserve or improve
  offered-line direction; a lower-ranked exact-replay winner cannot replace it. Report the
  market-influenced published center only as a disclosed benchmark.
- Fit Receiving-Yards-specific independent residual/count-mixture probability candidates on
  historical opening thresholds. A probability challenger may ship only if robust historical Brier
  and log loss qualify and exact-2026 Brier, log loss, and direction do not regress. Otherwise retain
  the independently fitted reference distribution with challenger weight zero.
- Freeze the current Week 5 board before implementation. Every non-Receiving-Yards family must be
  byte-identical. Report projection, probability, side, grade, promotion, demotion, actionable, and
  exact-price changes. No actionable demotion may ship without a tested actionable promotion rule,
  and a flatter board is not an acceptable hidden side effect.

The exact 2026 replay is the product gate the owner requested, but it is not described as a pristine
holdout because earlier broad research has already inspected those four weeks. Historical chronology,
clustered uncertainty, exact-replay performance, and live-board behavior must all agree.

## Release boundary

A passing result may extend the one existing expected-role artifact and batch scorer only. It may not
add a writer, refresh loop, lease, provider call, reader override, grade threshold, stake, copy,
label, or layout change. The complete model/calibration/decision/runtime/board/member/lifecycle/
writer/tracking family must advance together, portable parity must pass, and ordinary unlocked rows
must be freshly recomputed. Market reading remains a separately labeled downstream observer and
cannot rewrite the independent point or probability.
