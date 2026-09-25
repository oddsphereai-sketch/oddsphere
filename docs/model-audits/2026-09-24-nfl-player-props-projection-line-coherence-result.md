# NFL Player Props projection/line coherence result

Date: 2026-09-24
Base: `d3adbd1997a3de95e0ccded91c559f9c51d3ea25`
Predeclaration: `docs/model-audits/2026-09-24-nfl-player-props-projection-line-coherence-predeclaration.md`

## Decision

Promote the projection/line-coherent member forecast policy. For every ordinary two-way market,
the published decimal projection now determines Over or Under against that row's exact line.
The calibrated posterior breaks only an exact projection/line equality. Anytime-TD, model inputs,
posterior probabilities, exact prices, EV, grades, actions, stakes, and tracking remain unchanged.

## Frozen same-snapshot impact

On the production snapshot generated at `2026-09-24T23:51:09.913Z`, the candidate resolves all
197 prior contradictions across 1,061 ordinary markets. It changes only those member-facing side
labels. The board retains the same 2,564 member rows and identical Best Angle, Lean, Watchlist,
No Play, price, projection, probability, lock, and tracking tuples. Promotions: zero. Demotions:
zero. Net actionable change: zero. No market or actionable category is flattened.

The ordinary forecast mix moves from 471 Over / 590 Under under the superseded ranked display
to 440 Over / 621 Under under the published point estimates. This is the natural output of each
market's projection, not a quota. Stored grade counts remain 9 Best Angles / 38 Leans / 220
Watchlists / 2,088 No Plays / 209 internal Held rows, with 47 actionables unchanged.

## Releases

- Model: `nfl_player_props_distribution_model_2026_09_16_r9_current_season_inputs` (unchanged)
- Calibration: `nfl_player_props_distribution_calibration_2026_09_24_r10_projection_line_forecast`
- Decision: `nfl_player_props_decision_2026_09_24_r13_projection_line_forecast`
- Runtime / board: `nfl_player_props_runtime_2026_09_24_r14_projection_line_forecast` /
  `nfl_player_props_board_2026_09_24_r17_projection_line_forecast`
- Member / lifecycle: `nfl_player_props_member_2026_09_24_r23_projection_line_forecast` /
  `nfl_player_props_member_lifecycle_2026_09_24_r5_projection_line_forecast`
- Writer: `nfl_player_props_writer_2026_09_24_r26_projection_line_forecast`
- Tracking and settlement releases remain unchanged because no tracking selection, lock, result,
  or settlement behavior changes.

## Verification

- Focused runtime, production-contract, and snapshot-store tests pass.
- Full repository, integration, protected-PR, deployment, and live proof are recorded in the PR
  and production deployment evidence for this release.

## Forward boundary and rollback

Accuracy evaluation remains release-separated by exact calibration/decision release and lock
timestamp. This repair makes the visible prediction mathematically auditable; it does not claim
that rewriting historical ranked labels creates new forward accuracy evidence. Roll back on any
projection/line contradiction, grade/actionable drift, mixed unlocked release, snapshot failure,
writer overlap, lease failure, or member-page regression. Prior locked tracking rows remain
immutable under their original releases.
