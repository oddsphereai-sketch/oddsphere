# NFL player-props provider and Radar coverage repair — predeclaration

Date: 2026-09-18

Owner approval: Daniel Mengel explicitly approved the narrow release split on 2026-09-18 after review: new provider/member/lifecycle/writer identifiers with the unchanged model, calibration, decision, runtime, board, and tracking identifiers. The approval excludes added member copy or labels.

## Scope

- Sport: NFL player props, 2026 regular-season Week 2.
- Provider boundary: the existing BALLDONTLIE primary catalog and bounded optional SharpAPI enrichment inside the sole NFL forward-evidence writer.
- Member boundary: Today’s Radar selection only. The complete board, ranked prediction cohorts, reader, probabilities, projections, grades, stakes, locks, settlement, and tracking formulas are unchanged.
- Writer ownership: the existing `nfl-forward-evidence` writer remains the sole write path under `prediction_pipeline:nfl`. No timer, endpoint, writer, provider call, or call ceiling is added.

## Active authority before the repair

- Model: `nfl_player_props_distribution_model_2026_09_16_r9_current_season_inputs`
- Calibration: `nfl_player_props_distribution_calibration_2026_09_16_r9_ranked_predictions`
- Decision: `nfl_player_props_decision_2026_09_16_r12_ranked_predictions`
- Runtime / board: `nfl_player_props_runtime_2026_09_16_r13_current_season_inputs` / `nfl_player_props_board_2026_09_16_r16_ranked_predictions`
- Provider observation: `nfl_player_props_provider_observation_2026_09_07_r8_week_one_identity_capacity`
- Member / lifecycle: `nfl_player_props_member_2026_09_17_r20_no_held_member_coverage` / `nfl_player_props_member_lifecycle_2026_09_17_r2_no_held_member_coverage`
- Writer / tracking: `nfl_player_props_writer_2026_09_16_r22_current_season_inputs` / `nfl_player_props_tracking_2026_09_16_r12_current_season_inputs`

## Declared defects and bounded repair

1. SharpAPI currently emits the exact documented provider strings `player_total_receptions`, `player_total_rush_attempts`, and `player_rushing_+_receiving_yards`. The canonicalizer rejected them even though the first two map to already-modeled families and the third maps to an already-declared research-only family. Add only those exact aliases. Do not map ambiguous `player_prop`, period markets, or unrelated sports strings.
2. BALLDONTLIE may include a `next_cursor` on an explicit player-ID batch even when all requested IDs were returned. Cursor presence alone created four false health alarms. Retain the bounded 100-ID batch and the existing exact missing-ID check; report incomplete identity only if a requested ID is absent.
3. Today’s Radar currently chooses the ranked display forecast sibling before testing actionability. A real Best Angle or Lean can therefore disappear when the ranked sibling is No Play. Build Radar directly from actual Best Angle/Lean rows, then apply the existing game/player/market dedupe and six-card cap. Do not alter the full-board ranked prediction, grade, side, or odds.

## Release and evaluation contract

The model artifact, calibration, decision, runtime, board, and tracking releases remain unchanged because their algorithms and outputs on matching rows are unchanged. The new provider observation / member / lifecycle / writer identifiers are `nfl_player_props_provider_observation_2026_09_18_r9_sharp_alias_coverage` / `nfl_player_props_member_2026_09_18_r21_actionable_radar_coverage` / `nfl_player_props_member_lifecycle_2026_09_18_r3_actionable_radar_coverage` / `nfl_player_props_writer_2026_09_18_r23_provider_alias_coverage`. Evaluation must compare the same live Week 2 snapshot with a read-only candidate replay, report complete rows and every grade tier, and prove zero promotions/demotions on matching rows. Locked rows remain immutable under their original releases.

The repair is acceptable only if all 16 games remain present, provider calls remain at or below 51, actionability does not collapse, no unsupported market is promoted into the modeled set, focused tests and the full model-change checks pass, and the clean protected-PR/live-verification protocol succeeds.

Rollback disables the new provider/member/writer release together and restores the preceding alias table and Radar selector without rewriting any locked or tracked evidence.
