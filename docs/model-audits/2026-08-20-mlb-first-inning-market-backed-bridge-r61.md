# MLB first-inning market-backed bridge — r61

## Decision

Promote one deliberately narrow correction for future/unlocked MLB first-inning
predictions:

- change high-quality complete-market blending from 65% independent / 35%
  market to 25% independent / 75% same-book two-sided no-vig market;
- retain the 52% NRFI and 48% YRFI directional boundaries;
- require a selected-side no-vig edge of at least 0.0 percentage points for a
  Lean; and
- retain the existing starter, lineup, freshness, confidence, Best Angle, and
  missing-data gates.

This addresses the diagnosed failure mode: raw starter first-inning inputs and
the independent league baseline were able to pull a roughly balanced market
into repeated NRFI Leans. It does not infer that every market move should flip
the pick.

## Locked replay design

The evaluation used 902 games with locked timestamps. Outcomes were joined to
the release-stamped prediction history without rewriting locked records. The
simple 25%/75% blend and nonnegative Lean edge rule were frozen before opening
the June 7-July 10 replication slice. Later side-specific and market-movement
variants were inspected but rejected as post-hoc or too sparse.

| Slice | Actions | Record | Units | ROI |
| --- | ---: | ---: | ---: | ---: |
| Replication, Jun 7-Jul 10 | 199 | 121-78 | +18.907 | +9.5% |
| Development, Jul 11-31 | 87 | 51-36 | +3.403 | +3.9% |
| Validation, Aug 1-10 | 66 | 36-30 | -2.758 | -4.2% |
| Latest settled, Aug 11-20 | 66 | 38-28 | +1.464 | +2.2% |
| Combined | 418 | 246-172 | +21.016 | +5.0% |

The validation loss is reported, not hidden. Probability quality nevertheless
improved there: Brier .2447 vs .2468, log loss .6824 vs .6865, and AUC .580 vs
.573. On the identical 127-row latest settled comparison, the candidate was
.2436 Brier/.6803 log loss/.593 AUC versus incumbent .2456/.6843/.545.

## Paired action impact

Against the incumbent replay, the rule promotes 61 rows (38-23, +5.195 units,
+8.5% ROI) and demotes 149 rows (73-76, -4.134 units, -2.8% ROI), a net change
of -88 actionables, approximately 17% of the incumbent board. Promotions are
not one-sided: 35 are NRFI and 26 are YRFI. The untouched replication slice's
promotions were 23-17, +0.476 units (+1.2% ROI), satisfying the requirement that
the correction include a tested route into actionability rather than only
removing plays.

On the August 20 locked board, a dry run changes seven NRFI Leans, one NRFI No
Play, and one Toss-Up into five NRFI Leans and four Toss-Ups. This is a board
coherence check only; r61 will not mutate those already locked records.

## Rejected alternatives

- Automatic NRFI-to-YRFI flips on market movement: the apparent 6-1
  retrospective result had only seven rows and did not establish replacement
  value prospectively.
- Starter first-inning ERA shrinkage at the tested strengths: validation did
  not improve consistently.
- Side-specific thresholds or weights selected after opening replication:
  ineligible because they contaminate the holdout.
- A blanket NRFI veto: rejected because it suppresses the board without a
  tested promotion path.

## Release and operations

- decision: `mlb_daily_edge_decision_2026_08_20_r61`
- rule bundle: `mlb_daily_edge_rule_bundle_v50_2026_08_20`
- grade policy: `mlb_public_grade_policy_v40_first_inning_nonnegative_novig_edge_2026_08_20`
- calibration: `mlb_public_calibration_v22_first_inning_market_backed_2026_08_20`
- FI head: `mlb_first_inning_fi_v4_market_backed_weight25_2026_08_20`

The authoritative writer remains `predictionRecordService` under the shared
sport-scoped `prediction_pipeline` lease. Rollback is deployed r46/v45/v36/v19
with the 65% independent weight and 1.5-point Lean edge floor. Production
verification must confirm the live constants, writer/cron health, coverage,
release coherence, and a new reader snapshot before the release is declared
complete.
