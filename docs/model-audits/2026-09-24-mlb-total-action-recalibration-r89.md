# MLB Total action recalibration r89

Date: 2026-09-24

## Scope and frozen candidate

This release changes only the additive full-game MLB Total Lean sleeve. It does
not change a predicted side, projected score, probability head, market input,
price, stake, provider, cron cadence, writer, lease, member copy, label, or
layout. Moneyline and first inning are unchanged.

The incumbent r88 probability head remains authoritative. The failing action
sleeve selected Total probabilities at or above 55% when exact-price edge,
same-side projection, movement, and split-conflict checks passed. The frozen
r89 replacement selects probabilities from 52% inclusive to 55% exclusive and
requires at least a 0.5-run same-side projection gap. The existing exact-price
edge floor, adverse-movement veto, public/split-conflict veto, data-completeness
gates, provisional gates, side-change gates, and no-bet gates remain unchanged.

The candidate was fixed before inspecting its exact-row results for September
19–23. Evaluation uses canonical locked rows, exact locked prices, and only
prior-day outcomes to reconstruct the already-released trailing-90 r88 regime
head. Historical reconstruction is labeled reconstruction, not current-release
performance. Exact r88 rows remain release-separated.

## Chronological evidence

| Cohort | Train through Jul 31 | Aug validation | Sep 1–18 confirmation | Exact r88 Sep 19–23 |
|---|---:|---:|---:|---:|
| Incumbent 55%+ sleeve | 34–30, -1.005u | 36–28, +2.736u | 22–24, -4.583u | 3–12, -9.341u |
| Candidate 52–54.9%, gap >=0.5 | 35–30, +3.074u | 29–23, +3.762u | 11–9, +1.213u | 5–1, +3.803u |

The candidate is 80–63 (+11.852u) across the separated partitions. This is an
accuracy-directed paired replacement, not a quota and not a claim that the six
exact-current observations alone prove the rule. The larger chronological
reconstruction is the promotion evidence; future locked r89 rows are the
prospective evaluation set.

## Release and ownership

- Public calibration: `mlb_public_calibration_v35_total_action_recalibration_2026_09_24`
- Decision: `mlb_daily_edge_decision_2026_09_24_r89_total_action_recalibration`
- Rule bundle: `mlb_daily_edge_rule_bundle_v74_total_action_recalibration_2026_09_24`
- Grade policy: `mlb_public_grade_policy_v58_total_action_recalibration_2026_09_24`
- Total action rule: `mlb_total_confidence_value_context_lean_v2_midband_projection_gap_2026_09_24`

`lib/services/predictionRecordService.ts` remains the sole authoritative member
record builder. Scheduled generation retains the shared
`prediction_pipeline:mlb` lease. Locked r88 rows remain immutable.

## Board impact, verification, and rollback

The exact September 24 SELECT-only before/after board replay covered all 12
games with identical sides, probabilities, projections, lines, and prices.
Totals moved from 0 Best Angles / 1 Lean / 7 Market Aligned / 4 No Plays to
0 / 3 / 5 / 4. MIL@PHI Over, MIA@CHC Over, and SD@LAD Under promoted to Lean;
CIN@ATL Over demoted to Market Aligned. That is three promotions, one demotion,
net +2 actions, zero side changes, and zero nonpositive-EV actions. The result
comes from the frozen rule rather than a board-count quota.

Required checks are the MLB pipeline and prediction-record tests, model-change
verification, TypeScript, lint, production build, and integration safety against
the latest remote main. Publish only through a protected, up-to-date pull
request. After merge, verify the production commit, one coherent r89 slate, the
natural sole-writer cycle and released lease, exact prices and input coverage,
member-reader coherence, and normal site responsiveness.

Rollback the complete r89 calibration/decision/rule/grade family to r88 if the
board unexpectedly collapses, releases mix, the rule changes a side or score,
an actionable lacks a complete exact-price tuple, the writer or lease fails, or
the member reader disagrees with stored rows. Never rewrite locked evidence.
