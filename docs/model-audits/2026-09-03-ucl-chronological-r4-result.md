# UCL chronological r4 result

> Runtime handoff: r6 preserves this evaluated PMF and adds the frozen
> 185/126/63 manifest (SHA-256 `00d3761b7d94851776ffb5b893bdaded8dec85657f769140a2aef0dacd306d36`),
> authenticated 754-row team-stat manifest (SHA-256
> `3b817b9aa164ebc5141c26dddf9194611735d98708deef2b5b7f16df91314f88`),
> deterministic cache rejoin, deduplicated production schedule context, and truthful qualifying metadata.
> Any cohort drift now fails closed and requires a new release/evaluation.

## Decision

Ship a forecast-only Champions League board under
`ucl_goals_coherent_2026_09_03_r4_singular_history_cohorts`. Keep Match Result,
Double Chance, Total, and BTTS at No Play under
`ucl_grade_policy_2026_09_03_r4_forecast_validated_no_price_action`.

The replay validates that the fixed UCL-owned regulation-time PMF can publish a
differentiated forecast. It does not validate a betting threshold because the
available history cannot support calibration of a contemporaneous exact-price
rule. A later predeclared opening-odds probe found 85.71% holdout coverage but
0% calibration coverage, so the holdout cannot be used to tune a threshold.

## Provider cohort

- Read-only run: 2026-09-03.
- Transport: one paginated `season=` request for 2024 and one for 2025.
- Contract deviation: documented `seasons[]` and bounded date filters ignored
  their values in live probes; production does not retry either path.
- Returned and validated: 189 rows for 2024, 189 rows for 2025, 378 unique IDs.
- Team-match stats: 754 rows, fetched only after both season cohorts passed.
- Safety: any season mismatch, empty regulation-final cohort, or conflicting
  duplicate ID rejects the foundation before cache or training.

## Fixed chronological split

- Training: 185 usable regulation-final matches from season 2024.
- Calibration/diagnostic: first 126 usable season-2025 matches.
- Untouched holdout: final 63 season-2025 matches, beginning
  `2026-01-28T20:00:00.000Z`.
- Every prediction uses only matches strictly earlier than its kickoff.

| Metric | Calibration | Untouched holdout |
|---|---:|---:|
| Match Result accuracy | 55.56% | 52.38% |
| Match Result multiclass Brier | 0.19356 | 0.19890 |
| Match Result log loss | 0.97738 | 0.99638 |
| Total 2.5 Brier | 0.22149 | 0.22968 |
| Total 2.5 log loss | 0.63330 | 0.65323 |
| BTTS Brier | 0.25069 | 0.23845 |
| BTTS log loss | 0.69437 | 0.66943 |
| Per-team score MAE | 1.11106 | 1.18637 |

## Grade replay

All four markets replay as No Play; actionables are 0. No EPL threshold,
favorite/underdog/draw quota, or contrarian selection is imported. A later
actionable release requires a new predeclaration with distinct calibration and
holdout exact-price coverage. The current evaluated quote remains
downstream economics/evidence only.
