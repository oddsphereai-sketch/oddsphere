# NFL opening-to-market Spread direction result

Date: 2026-09-21

Predeclaration: `docs/model-audits/2026-09-21-nfl-opening-to-market-direction-predeclaration.md`

## Decision

Promote the Spread direction rule into the single existing NFL forecast writer. Do not promote the analogous Total movement rule. Moneyline and Total behavior, thresholds, labels, copy, stakes, provider calls, schedules, and leases remain unchanged.

The Spread rule chooses a side for every healthy game. A home line that moves at least 0.5 points toward home selects home; a line that moves at least 0.5 points toward away selects away; an otherwise flat line uses the target-excluded current no-vig price lean. When that direction opposes the incumbent PMF, the implementation reflects the incumbent probability distance around 50% instead of reducing conviction to a flat board. The coherent margin PMF, expected team scores, representative score, exact-price evaluation, and tracking tuple are then derived from that oriented distribution.

## Chronological result

The fixed rule was committed before any outcome from this audit was opened.

- Selection, 2021-2023: 413-374, 52.4778% resolved accuracy, +10.5524 units / +1.3408% ROI. Annual accuracy was 51.8657%, 50.9579%, and 54.6512%.
- Confirmation, 2024-2025: 281-257, 52.2305% resolved accuracy, -4.8180 units / -0.8955% ROI. Annual accuracy was 51.3109% and 53.1365%.
- Both directions were present in both confirmation seasons. The rule keeps every non-push game in the prediction denominator.

The forecast-accuracy gates passed. The small negative all-game confirmation ROI means the rule does not create a new autonomous action lane: existing exact-price EV, edge, probability, cushion, and grade gates remain authoritative.

The predeclared Total movement rule failed selection at 50.5576% pooled and fell below 50% in both 2021 and 2022. It is rejected and does not enter production.

## Current-season diagnostic

This diagnostic used already-settled 2026 outcomes and is not represented as an untouched holdout. It checks whether the historical rule addresses the observed production failure without changing the rule.

- 29 resolved locked Spread forecasts: candidate 19-10 (65.5172%).
- Locked-probability Brier: incumbent 0.255006; direction-reflected candidate 0.243361.
- Week 2 resolved replay: candidate 11-3; the immutable incumbent record remains 5-8-1 and is never rewritten.
- Movement cases were 14-6; flat price reads were 5-4.

## Exact current-board impact

The SELECT-only 16-game / 48-market Week 2 replay preserves all 48 predictions and score/winner coherence for all 16 games.

- Spread sides change on 9 games.
- Spread actionables remain 2 before and 2 after: 2 Leans becomes 1 Best Angle / 1 Lean.
- Across every tier there are 2 promotions and 4 demotions, with net actionable change 0.
- Moneyline and Total sides and grades change on 0 games.
- Maximum absolute expected team-score change is 1.8157 points.
- Target-excluded resolution is stable on 12 games; four retain the direction-oriented incumbent fallback.

This is not a quota. The board remains complete and action count is an output of the existing price gates.

## Production release family

- Weekly outcome / distribution / probability: `nfl_v1_weekly_market_anchored_outcome_2026_09_21_r5_opening_market_direction` / `nfl_pooled_discrete_residual_distribution_2026_09_21_r5_opening_market_direction` / `nfl_v1_weekly_pooled_discrete_probability_2026_09_21_r5_opening_market_direction`.
- Market outcome / representative score / Spread direction: `nfl_v1_market_evidence_outcome_2026_09_21_r6_opening_market_direction` / `nfl_v1_market_evidence_representative_score_2026_09_21_r4_opening_market_direction` / `nfl_v1_opening_market_spread_direction_2026_09_21_r1`.
- Spread head / target exclusion: `nfl_v1_spread_market_direction_2026_09_21_r6` / `nfl_target_excluded_market_outcome_2026_09_21_r4_opening_market_direction`.
- Model / calibration / decision / grade / member: `nfl_v1_daily_edge_model_2026_09_21_r15_opening_market_direction` / `nfl_v1_daily_edge_calibration_2026_09_21_r15_opening_market_direction` / `nfl_v1_daily_edge_decision_2026_09_21_r21_opening_market_direction` / `nfl_v1_grade_policy_2026_09_21_r21_opening_market_direction` / `nfl_v1_member_release_2026_09_21_r18_opening_market_direction`.
- Collector / writer / fixture / compact snapshot: `nfl_forward_evidence_collector_2026_09_21_r9_opening_market_direction` / `nfl_forward_evidence_writer_2026_09_21_r36_locked_transition_continuity` / `nfl_weekly_member_fixture_2026_09_21_r26_locked_transition_continuity` / `nfl_forward_member_snapshot_2026_09_21_r18_locked_transition_continuity`. The transition-only publication repair is documented in `docs/model-audits/2026-09-21-nfl-opening-direction-transition-hotfix.md`.
- Tracking lifecycle / bundle / boundary / record: `nfl_tracking_lifecycle_2026_09_21_r13_opening_market_direction` / `nfl_tracking_composite_release_bundle_2026_09_21_r9_opening_market_direction` / `nfl_evaluated_tuple_tracking_boundary_2026_09_21_r10_opening_market_direction` / `nfl_official_tracking_record_2026_09_21_r11_opening_market_direction`.

The evidence schema, one `prediction_pipeline:nfl` lease, sole writer, request budget, append-only storage, immutable T-60 behavior, and settlement path are unchanged.

## Rollback

Roll back the complete release family to the September 20 r17/r14/r20 outcome and publication set. The compact reader retains the immediately preceding r16 snapshot as bounded availability continuity. Never rewrite locked or settled rows.
