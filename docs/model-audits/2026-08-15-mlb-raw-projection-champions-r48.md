# MLB raw projection champions — r48

## Release

- Decision: `mlb_daily_edge_decision_2026_08_15_r48`
- Rule bundle: `mlb_daily_edge_rule_bundle_v47_2026_08_15`
- Calibration: `mlb_public_calibration_v21_raw_projection_champions_2026_08_15`
- Layer schema: `mlb_model_layer_versions_v4`
- Moneyline head: `mlb_moneyline_away_market_40_45_raw_side_champion_v1_2026_08_15`
- Total head: `mlb_total_runtime_residual_guarded40_champion_v1_2026_08_15`
- Grade policy: `mlb_public_grade_policy_v38_raw_champion_scoped_action_2026_08_15`

The authoritative writer remains `lib/services/predictionRecordService.ts`
under the shared sport-scoped `prediction_pipeline` lease. No new writer,
refresh, provider call, cron, or stake path is introduced.

## Moneyline evidence

The market-only run-margin baseline beat the current posterior on the latest
148 games (RMSE 4.2360 versus 4.3192; MAE 3.3315 versus 3.3948). A clean
market-anchor-plus-baseball-residual model was rejected because it worsened
latest RMSE to 4.3393 and degraded side accuracy and proper scores.

The selected side challenger is deliberately narrower. When the r47 final pick
is away and its locked selected-side market probability is in [0.40, 0.45),
r48 selects the coherently priced home side and publishes `1 - p_market`.
Exact opposite price is mandatory.

| Partition | r47 | r48 | Delta |
| --- | ---: | ---: | ---: |
| Validation (135) | 83-52, 61.5% | 85-50, 63.0% | +1.5 pp |
| Latest (148) | 77-71, 52.0% | 79-69, 53.4% | +1.4 pp |
| Combined (283) | 160-123, 56.5% | 164-119, 58.0% | +1.4 pp |

Eight sides change. Validation Brier/log loss improve from 0.2352/0.6631 to
0.2330/0.6585; latest improves from 0.2537/0.7006 to 0.2519/0.6970. Two of
four rolling-origin folds improve. The cohort was discovered post hoc during
the fresh rebuild and remains explicitly narrow; no adjacent band is inferred.

## Total evidence

The runtime residual is fitted to `actual_total - locked_market_total` with
ridge lambda 10. Inputs are the already-locked independent and posterior total
edges, starter ERA sum, bullpen sum, lineup and top-order OPS sums, park,
weather, and market-total center. The fitted residual is:

```text
0.21937246
+ 0.21467304 * independent_total_edge
- 0.23219491 * posterior_total_edge
- 0.08283439 * starter_era_sum_centered
- 0.38844991 * bullpen_sum_centered
+ 1.42575875 * lineup_ops_sum_centered
+ 1.87298987 * top_order_ops_sum_centered
+ 0.00048605 * park_factor_centered
- 1.32100637 * weather_total_adjust
- 0.04736969 * market_total_centered
```

The over probability is
`sigmoid(-0.30863529 + 0.47301004 * residual)`. r48 retains the r47 side and
probability unless the fitted probability of that selected side is below 40%;
only then does it select the exact-price opposite side.

| Partition | r47 | r48 | Delta |
| --- | ---: | ---: | ---: |
| Validation (133) | 70-63, 52.6% | 72-61, 54.1% | +1.5 pp |
| Latest (145) | 77-68, 53.1% | 78-67, 53.8% | +0.7 pp |
| Combined (278) | 147-131, 52.9% | 150-128, 54.0% | +1.1 pp |

Three sides change. Validation Brier/log loss improve from 0.2425/0.6780 to
0.2410/0.6749; latest improves from 0.2544/0.7020 to 0.2526/0.6985. Three of
four rolling accuracy folds and two of four projection-RMSE folds improve.
Latest projection RMSE improves 4.1176 to 4.1121; MAE worsens 3.3032 to 3.3383.

## Action and board behavior

The exact-price moneyline tournament qualified a zero-margin replacement in
the tested -120 through +129 price band. Outside that band, r47 action behavior
is retained—including favorites below -120 and below -200. On validation the
board moved from 39 to 64 actions: 36 retained, 3 demoted, and 28 promoted
(+25 net), while paired units improved by 5.028. On latest it moved from 37 to
51: 35 retained, 2 demoted, and 16 promoted (+14 net), while paired units
improved by 3.922. Delta without the best date remained +2.696/+1.970 units;
two of four rolling folds improved and aggregate rolling delta was +2.540
units. This is a scoped replacement, not a global odds ceiling.

The single-record product cannot retain an incumbent-side action while
publishing a corrected opposite-side forecast coherently. Therefore the eight
moneyline rows whose raw side changes remain `no_bet`; the qualified action
replacement applies only where the raw champion retained the incumbent side.
Those rows cannot inherit the original side's grade or stake.

The totals exact-price action tournament produced no qualifier. Each of its
three changed sides is written and graded for forecast tracking but remains
`no_bet`, with no public play grade or Best Angle. Unchanged totals retain r47
action behavior. Board changes are explicit and the qualified moneyline policy
expands rather than flattens the tested board.

The August 15 read-only production dry run scanned 15 games and built 15
moneylines plus 15 totals with no errors. Every row carried r48; the current
slate contained no raw-side change. The resulting board contained six
moneyline and four total actions.

## Rollback

Restore r47, rule bundle v46, calibration v20, schema v3, grade policy v37,
and the former moneyline and total probability heads. Historical locked r48
rows remain immutable and must not be blended with r47 when reporting current
release performance.
