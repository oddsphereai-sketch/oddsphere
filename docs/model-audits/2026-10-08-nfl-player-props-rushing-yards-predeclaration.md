# NFL player props independent Rushing Yards predeclaration

Date: 2026-10-08  
Status: frozen before the market-specific tournament and any production edit

## Scope and production comparator

This stage changes only the ordinary `Rushing Yards` point and threshold-distribution head. Passing
Attempts, Passing Completions, Passing Yards, Rushing Attempts, Receptions, Receiving Yards, Anytime
Touchdown, exact-price grading, movement interpretation, locks, stakes, settlement, cadence, and the
single production writer remain unchanged.

The starting production family is the October 8 independent Passing Yards release:

- portable runtime `nfl_player_props_runtime_2026_10_08_r11_independent_passing_yards`;
- model `nfl_player_props_distribution_model_2026_10_08_r20_independent_passing_yards`;
- calibration `nfl_player_props_distribution_calibration_2026_10_08_r22_independent_passing_yards`;
- decision `nfl_player_props_decision_2026_10_08_r25_independent_passing_yards`; and
- expected-role artifact `nfl_player_props_expected_role_runtime_2026_10_08_r3_passing_yards`.

Locked rows keep their exact stored payload and preceding release identifiers.

## Frozen football hypothesis

Rushing Yards is `independent rushing opportunity × conditional yards per carry`, not a direct
function of the offered line or price. The candidate reuses the already-predeclared roster-constrained
expected-role hierarchy:

1. forecast each QB and RB/FB role group's rush budget from shifted team/opponent state;
2. allocate that budget across the known active roster using shifted carry share, snap/depth role,
   and point-in-time availability;
3. forecast conditional yards per carry separately by position group using only shifted player,
   offense, opponent-front, game-state, weather, PFR/FTN, and Next Gen Stats features available
   before the game; and
4. combine the hierarchy with the released independent Rushing Yards center at the fixed 50%, 75%,
   and 100% weights already declared in the expected-role research.

The tournament may compare game-weighted and carry-exposure-weighted squared-error or
absolute-error efficiency heads across the frozen feature families `state`, `state_pressure`,
`state_ftn`, `state_ngs`, and `full_external`. Bounds remain 0-15 yards per carry. No new feature,
model family, hyperparameter, blend weight, or post-outcome manual adjustment may be introduced
after opening the exact 2026 replay.

Prop line, price, market probability, sportsbook identity, consensus, movement, result, and
current-game outcome are forbidden point-model inputs. A posted prop may identify the evaluated
pregame-active player, but its numeric terms cannot enter the football projection.

## Chronology and acceptance gates

- Train through 2023 and select on 2024 only when both MAE and RMSE beat the released independent
  reference.
- Confirm the unchanged candidate on 2025 with non-regressing MAE and RMSE, a game-clustered 95%
  interval for candidate-minus-reference MAE below zero, and no chronological segment or material
  bias failure.
- Rank historical qualifiers without 2026 outcomes, then open the exact immutable 2026 Weeks 1-4
  Rushing Yards scopes. The first historically ranked candidate must improve both MAE and RMSE and
  preserve or improve offered-line direction accuracy. Current-season comparison must report both
  the locked independent center and the published posterior center; the published center is a
  benchmark, never a feature.
- Fit a market-specific independent residual distribution against historical opening thresholds.
  A probability challenger may ship only if exact-2026 Brier score and log loss do not regress and
  direction does not regress. Otherwise retain the independently fitted reference distribution with
  challenger weight zero; never substitute the market posterior.
- Freeze the current Week 5 board before implementation. Every non-Rushing-Yards family must be
  byte-identical. Report promotions, demotions, side changes, actionables, and exact-price completeness.
  No actionable demotion can ship without a tested actionable promotion rule.

## Release boundary

A passing result may extend the one existing expected-role artifact and the one existing batch scorer;
it may not add a writer, refresh loop, lease, or reader override. The complete model/calibration/
decision/runtime/board/member/lifecycle/writer/tracking family must advance together, portable parity
must pass, and ordinary unlocked rows must be recomputed rather than relabeled. Market movement stays
downstream as separately labeled confirming/adverse/unknown evidence and receives no new authority in
this stage.
