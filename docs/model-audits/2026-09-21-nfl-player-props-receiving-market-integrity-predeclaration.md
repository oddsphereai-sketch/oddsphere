# NFL player-props receiving-market integrity predeclaration

Date: 2026-09-21

Status: predeclared before production code changes

## Scope

- Sport and product: NFL player props.
- Affected input: BALLDONTLIE `receiving_yards` over/under observations.
- Affected reader: the existing NFL player-props member snapshot assembled from the exact-price board.
- Unchanged: the independent player model, probability calibration, market residual math, side selection, grade thresholds, stakes, tracking settlement, page layout, labels, and copy.
- Authoritative writer: `app/api/cron/nfl-forward-evidence/route.ts` through `writeNflPlayerPropsProductionSnapshot`.
- Lease: the existing `prediction_pipeline:nfl` lease.
- Provider request count: unchanged. The repair operates on the already-fetched slate payload.

## Current release family

- Provider observation: `nfl_player_props_provider_observation_2026_09_18_r9_sharp_alias_coverage`.
- Model/calibration: `nfl_player_props_distribution_model_2026_09_16_r9_current_season_inputs` / `nfl_player_props_distribution_calibration_2026_09_16_r9_ranked_predictions`.
- Decision/runtime/board: `nfl_player_props_decision_2026_09_16_r12_ranked_predictions` / `nfl_player_props_runtime_2026_09_16_r13_current_season_inputs` / `nfl_player_props_board_2026_09_16_r16_ranked_predictions`.
- Member/lifecycle: `nfl_player_props_member_2026_09_18_r21_actionable_radar_coverage` / `nfl_player_props_member_lifecycle_2026_09_18_r3_actionable_radar_coverage`.
- Writer/tracking: `nfl_player_props_writer_2026_09_20_r24_canonical_snapshot_capacity` / `nfl_player_props_tracking_2026_09_16_r12_current_season_inputs`.

## Observed defect

A fresh Week 2 collection found FanDuel rows labeled `receiving_yards` that track the
player's rushing-plus-receiving market rather than the receiving market. Current examples
include Cam Skattebo 67.5, Devin Singletary 25.5, Kyren Williams 84.5, and Blake Corum
54.5. Independent ordinary receiving lines for those players are 11, 7, 15.5, and 3
yards respectively, while independent rushing-plus-receiving lines are 67.5, 26, 84.5,
and 52.5. The Week 2 opening feed contains the same systematic FanDuel cross-market
misclassification across the slate.

These rows can currently enter the exact receiving-yards offer family. They are generally
non-actionable because downstream guards notice the extreme model disagreement, but they
are still false predictions and can contaminate market references and movement history.

## Candidate rule

Before normalization, reject a FanDuel ordinary `receiving_yards` over/under row only when
all of these independently observable conditions hold within the same fetched payload,
game, and player:

1. At least two other sportsbooks provide ordinary receiving-yard lines.
2. At least one other sportsbook provides a rushing-plus-receiving-yard line.
3. The FanDuel line is at least 10 yards from the target-excluded receiving median.
4. It is within 3 yards of the target-excluded rushing-plus-receiving median.
5. Its distance from the receiving median exceeds its distance from the combined-yard
   median by at least 7 yards.

This is a provider semantic-integrity rule, not a projection, edge, price, or board-balance
threshold. It retains every row when the cross-book evidence is incomplete. Milestones and
all other markets/providers are untouched.

## Acceptance gates

- Add focused fixtures that reject the proven cross-market duplicate while retaining a
  legitimate FanDuel receiving line and retaining ambiguous rows without sufficient
  independent evidence.
- Replay one identical live collection before/after and report observation, decision,
  actionable promotion/demotion, market-mix, and member-row impact.
- No valid actionable may disappear. Any actionable change blocks publication pending
  release-pure review.
- Retained decisions must be byte-equivalent apart from release metadata.
- Keep the current single writer, lease, request ceilings, snapshot bounds, and
  last-known-good failure behavior.
- Bump the provider/member/lifecycle/writer releases because the published input and member
  cohort change. Retain model/calibration/decision/runtime/board/tracking releases only if
  replay proves their behavior and actionable cohort unchanged.
- Run focused NFL props tests, `npm run verify:model-change`, type/lint/build checks required
  by the affected tree, integration safety against the latest remote `main`, protected PR
  checks, and live writer/member verification.

## Rollback

Restore the prior provider/member/lifecycle/writer release family for future unlocked
cycles while preserving locked and settled evidence. Do not rewrite prior tracking rows.
