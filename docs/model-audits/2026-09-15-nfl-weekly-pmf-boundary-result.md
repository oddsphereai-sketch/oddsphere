# NFL weekly PMF boundary recovery result

Date: 2026-09-15

## Result

The frozen NFL-only one-point boundary passes. A live-input, no-write replay at
the same declared due-cycle timestamp changed the writer result from 14 games /
42 predictions / 2 isolated games to 16 / 48 / 0. The board moved from 0 Best
Angles / 1 Lean / 6 Watchlists / 35 No Plays among published rows to 0 / 1 / 8 /
39. The 42 matching rows are produced by the unchanged forecast and grade path,
so promotions, demotions, side changes, probability changes, price changes, and
grade changes are all zero. The six restored rows are the already-computed
three-market dispositions for the two formerly isolated games.

An immediate real-time release-refresh replay also produced the complete 16 /
48 board with 0 Best Angles / 0 Leans / 8 Watchlists / 40 No Plays and zero held
games. That mix is reported honestly: current exact prices do not clear the
validated action gates, and no quota or forced promotion is introduced.

The existing warning for a zero-actionable weekly slate now marks the NFL
health cron partial and supplies its error message. This creates an operational
page while leaving the complete member board live and unchanged. Injury-report
and SharpAPI split unavailability remain truthful context findings and do not
become hidden holds.

## Releases

- Model / calibration: `nfl_v1_daily_edge_model_2026_09_15_r11_one_point_pmf_boundary` /
  `nfl_v1_daily_edge_calibration_2026_09_15_r11_one_point_pmf_boundary`.
- Decision / grade / member: `nfl_v1_daily_edge_decision_2026_09_15_r17_one_point_pmf_boundary` /
  `nfl_v1_grade_policy_2026_09_15_r17_one_point_pmf_boundary` /
  `nfl_v1_member_release_2026_09_15_r14_one_point_pmf_boundary`.
- Coherence / writer / fixture / compact snapshot:
  `football_cross_market_coherence_2026_09_15_r10_nfl_one_point_mean_median` /
  `nfl_forward_evidence_writer_2026_09_15_r28_one_point_pmf_boundary` /
  `nfl_weekly_member_fixture_2026_09_15_r20_one_point_pmf_boundary` /
  `nfl_forward_member_snapshot_2026_09_15_r12_one_point_pmf_boundary`.

The r11 compact snapshot is retained as a bounded continuity fallback until the
first r12 writer wave. No parallel writer, new provider request, schema change,
grade threshold change, or tracking backfill is added.
