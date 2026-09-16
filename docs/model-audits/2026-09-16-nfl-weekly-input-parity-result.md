# NFL weekly input parity result

Date: 2026-09-16

## Production candidate

The confirmed SharpAPI contract mismatch is repaired. The NFL split adapter now
uses `league=nfl` rather than the invalid `sport=nfl` filter while preserving one
bounded request, strict league/date/team matching, deterministic sportsbook
priority, complete complementary percentage validation, and the existing
two-hour evidence freshness boundary. No reader copy or grade policy changed.

A live, no-write Week 2 writer replay on the candidate produced the complete 16
games / 48 predictions / zero held games. It returned 1 Best Angle, 1 Lean, 8
Watchlists, and 38 No Plays. SharpAPI still returned zero current NFL rows at the
replay timestamp, so the honest transition is zero promotions, zero demotions,
zero side changes, and zero probability changes. The provider row is still
reported unavailable; this repair begins affecting forecasts only when the
provider publishes a fresh strictly matched NFL row.

## Calibrated-core finding

The remaining Week 1 versus Week 2 difference is not a rendering or threshold
bug. Week 1 has a frozen game-specific Spread/Total residual-head correction on
16/16 games; Week 2 has none and uses the approved generalized market-anchored
fallback. The Week 1 correction artifact cannot be reused by team or copied to a
different slate. The previously evaluated generalized independent challenger
did not clear the protected holdout benchmark, so it remains ineligible for live
promotion. No threshold was weakened and no play was manufactured to imitate
last week's board density.

## Candidate releases

- Model / calibration: `nfl_v1_daily_edge_model_2026_09_16_r12_sharp_league_contract` /
  `nfl_v1_daily_edge_calibration_2026_09_16_r12_sharp_league_contract`.
- Decision / grade / member: `nfl_v1_daily_edge_decision_2026_09_16_r18_sharp_league_contract` /
  `nfl_v1_grade_policy_2026_09_16_r18_sharp_league_contract` /
  `nfl_v1_member_release_2026_09_16_r15_sharp_league_contract`.
- Split / market-evidence / writer: `nfl_sharpapi_splits_2026_09_16_r1_league_contract` /
  `nfl_v1_market_evidence_outcome_2026_09_16_r4_sharp_league_contract` /
  `nfl_forward_evidence_writer_2026_09_16_r29_sharp_league_contract`.
- Fixture / compact snapshot: `nfl_weekly_member_fixture_2026_09_16_r21_sharp_league_contract` /
  `nfl_forward_member_snapshot_2026_09_16_r13_sharp_league_contract`.

The r12 compact snapshot and its complete r14/r17/r20 contract are retained as
the bounded continuity fallback until the first r13 writer wave. The sole
`prediction_pipeline:nfl` writer and lease are unchanged.
