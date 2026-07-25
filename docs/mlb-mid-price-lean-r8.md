# MLB mid-price Moneyline action ladder — r8

Date: 2026-07-25

Decision release: `mlb_daily_edge_decision_2026_07_25_r8`

## Scope and authoritative path

r8 changes only the public Moneyline grade policy. It keeps the r7 projection,
probability, calibration, side-selection, flip/correction, Total, and First
Inning behavior unchanged.

The single authoritative path remains:

1. `auto_v2.2_mlb_full_game_projection`
2. `mlb_projection_core_v2_2_baseline_2026_07_08`
3. Moneyline probability head
   `mlb_moneyline_regularized_k01_cap6_champion_guardrails_2026_07_11`
4. `predictionRecordService` as the final decision writer
5. `member_facing_lock_v2_writer_authority` as the reader/tracking contract
6. the existing sport-scoped `prediction_pipeline` lease

The release bumps public calibration to v8, decision release to r8, rule bundle
to v10, and grade policy to
`mlb_public_grade_policy_v10_mid_price_ml_ladder_2026_07_25`. It does not add a
writer, refresh path, cron, provider call, probability head, or stake rule.

## New promotions

Rule stamps:

- `ml_mid_price_established_price_best_angle_v1_2026_07_25`
- `ml_mid_price_near_market_lean_v1_2026_07_25`

A non-actionable Moneyline enters the r8 ladder only when all of these are true:

- final price is from -145 through -121;
- stored edge is at least -1.0 percentage point and below 2.0 points;
- the final side is home or away;
- the prediction is not held, `NO_BET`, flipped, pick-calibrated, or
  market-side-corrected;
- line movement is not against the pick;
- public splits do not conflict with the pick;
- an available run projection does not oppose the pick; and
- required MLB data is not incomplete.

Existing Best Angles have priority. Existing flip, correction, data-health,
price, freshness, and lock behavior remain intact.

An eligible row is a Best Angle from -145 through -131 and a Lean from -130
through -121.

## Chronological evidence

The audit uses rows locked under the current Moneyline probability head. To
avoid falsely counting older rows that current r7 rules already qualify, it
applies the current r7 eligibility rules before identifying genuinely
incremental r8 rows. This is rule-level current-head evidence, not relabeling
older rows as exact-r8 results.

| Period | Incremental rows | Record | Units | ROI |
| --- | ---: | ---: | ---: | ---: |
| Development, before 2026-07-20 | 5 | 3-2 | +0.363 | +7.3% |
| Locked holdout, 2026-07-20 through 2026-07-24 | 5 | 4-1 | +2.130 | +42.6% |
| Combined supporting cohort | 10 | 7-3 | +2.493 | +24.9% |

The holdout gains occurred on three different slate dates: 2-0 on July 20,
1-0 on July 22, and 1-1 on July 24.

This is a limited sample, so r8 is a controlled Lean-tier promotion, not a
profitability guarantee and not evidence for increasing stake.

## Best Angle / Lean split

The original incremental cohort supports adding the sleeve but is too small to
sort safely on edge alone. The tier decision therefore uses the full comparable
clean mid-price cohort, including rows already eligible under current rules,
and tests the same fixed price split in both chronological periods.

| Tier | Price | Development | Locked holdout | Combined |
| --- | --- | ---: | ---: | ---: |
| Best Angle | -145 through -131 | 7-0 | 4-2 | 11-2 |
| Lean | -130 through -121 | 3-2 | 3-2 | 6-4 |

Both tiers win in both periods, while the stronger-price tier is clearly
stronger. This produces a hierarchy instead of grading the entire sleeve the
same way. The smaller edge-at-least-1.0 fragment remains 1-0 in development and
3-0 in holdout, but it is not used as the production boundary because it has
only four rows.

No Best Angle is demoted by r8.

## Totals decision

Totals are unchanged. The analogous Total expansion went 2-3 and -1.297 units
in development despite a 2-0 holdout. Because it failed development and would
weaken the historical bundle, it is rejected rather than shipped.

## Board impact

The pre-release July 25 dry run adds two Moneyline Best Angles and one
Moneyline Lean:

- WSH moneyline Best Angle, -141, 56.99% model probability, 1.1-point edge;
- HOU moneyline Lean, -125, 54.03% model probability, 0.8-point edge; and
- SF moneyline Best Angle, -134, 56.20% model probability, 1.6-point edge.

At the latest audit timestamp the Moneyline board changes from two Best Angles
to four Best Angles plus one Lean. The Total board remains one Lean. Net
actionable impact is +3 Moneylines, zero demotions, and zero Total changes. Live
prices and unlocked decisions may move before the authoritative refresh.

## Required verification and rollback

Before publication:

- run `npm run verify:model-change`;
- run the focused prediction-writer and MLB pipeline tests;
- run `npx tsc --noEmit`, a production build, and the read-only r8 audit;
- deploy one clean intentional commit; and
- refresh only through the existing authoritative prediction writer.

After publication verify the r8 release identifiers, shared lease, writer/reader
agreement, provider/data coverage, snapshot freshness, lock preservation, board
counts, cron health, and site response. Roll back to r7 on mixed current-slate
release stamps, reader disagreement, unexpected board loss, missing required
data presented as ordinary `NO_PLAY`, or writer/lease failure.
