# MLB Daily Edge board coherence — r10

Date: 2026-07-27

Decision release: `mlb_daily_edge_decision_2026_07_27_r10`

## Scope and authoritative path

r10 changes only the MLB full-game Total correction ordering. Moneyline,
First Inning, player props, probability heads, projections, stakes, locks,
tracking history, provider calls, and refresh cadence are unchanged.

The single authoritative path remains:

1. `auto_v2.2_mlb_full_game_projection`;
2. `mlb_total_market_read_k04_cap8_thin_gap_guard_2026_07_11`;
3. `predictionRecordService` as the final decision writer;
4. `member_facing_lock_v3_refresh_coherent_writer_authority_2026_07_26`;
5. the existing sport-scoped `prediction_pipeline` lease.

The release bumps:

- public calibration to `mlb_public_calibration_v9_2026_07_27`;
- decision release to `mlb_daily_edge_decision_2026_07_27_r10`;
- rule bundle to `mlb_daily_edge_rule_bundle_v11_2026_07_27`; and
- correction policy to
  `mlb_prediction_corrections_v7_total_support_preserved_2026_07_27`.

Historical rows remain stamped with their original releases and are not
rewritten.

## Root cause

The retired market-aware Total correction treated both supporting and opposing
split evidence as reasons to select the opposite side. r9 correctly stopped
publishing that unstable opposite-side candidate, but the trigger still set
`NO_PLAY` before the original Total could reach the replacement promotion
ladder.

At the final pre-release audit on July 27 this flattened 10 of 12 Totals to
`NO_PLAY`. Six were blocked by the same market-aware split trigger, including
four original picks that
independently passed the existing validated Total Lean rule.

## r10 decision

Supporting split evidence no longer creates an opposite-side Total correction.
It does not promote a pick by itself. The original side must still pass every
existing gate:

- model probability at least 54%;
- edge at least 5 percentage points;
- price better than -145;
- projection aligned with the picked side;
- real current price and market probability;
- complete/fresh required data; and
- all existing hold, divergence, conflict, lock, and tracking protections.

Opposing split conflicts, mean/probability divergence, and other rejected
correction families remain stood down. Best Angle still requires the stricter
57% probability, 5-point edge, 0.75-run projection gap, price better than -135,
and clean market movement. Market resistance therefore prevents r10 from
manufacturing Total Best Angles.

Moneyline is unchanged. Seattle remains non-actionable because the refreshed
row is a final-side calibrated pick with line movement against Seattle, 53.3%
model probability, and a slightly negative stored edge. Price alone is not
used to override those facts.

## Equal-market precedence audit

The absence of Moneyline Best Angles on July 26 and July 27 is not caused by a
later `NO_PLAY` override. Both released Moneyline Best Angle promotion paths
remain active:

- `ml_tight_market_price_best_angle_v1_2026_07_20` is 8–2 and +3.401 units on
  all locked current-head rows, including 4–0 since the rule was released;
- `ml_mid_price_established_price_best_angle_v1_2026_07_25` has a 7–0
  development cohort and a 4–2 locked holdout; its two settled released rows
  are 2–0.

Neither July 26 nor July 27 supplied a final-side Moneyline satisfying those
fixed price, edge, projection, movement, split, and side-coherence conditions.
The nearest rows missed multiple established gates; no candidate was removed
only because of rule ordering. Market-corrected Moneylines remain capped below
Best Angle because the recalibration cohort was 4–4, and calibrated side
changes are not silently promoted.

Totals received the same precedence audit. The Best Angle path is active and
produced all three July 26 Total Best Angles. July 27 has no blocked Total that
independently qualifies for Best Angle. The four supporting-split rows affected
by r10 qualify for the existing Lean tier only.

## Chronological evidence

The r10 audit grades the original probability-side Total at its original
pregame price and line. It includes only supporting-split rows that also pass
the existing validated Total Lean or Best Angle gates.

| Period | Rows | Record | Units | ROI | Brier | Log loss | Calibration gap |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Train, July 11–17 | 3 | 1–2 | -0.8400 | -28.00% | 0.2946 | 0.7836 | +25.03 pp |
| Validation, July 18–22 | 7 | 4–3 | +1.0017 | +14.31% | 0.2449 | 0.6830 | -1.23 pp |
| Locked holdout, July 23–26 | 2 | 2–0 | +1.8349 | +91.74% | 0.1781 | 0.5481 | -42.19 pp |
| Combined | 12 | 7–5 | +1.9966 | +16.64% | 0.2462 | 0.6857 | -1.49 pp |

This is an ordering repair, not a new standalone promotion cohort. The
underlying released `total_validated_lean_v1_2026_07_11` sleeve is 9–7,
+1.219 units, +7.6% ROI, with a 1.2-point calibration gap on current-head
locked rows. Its latest weekly segment is 4–3 and +0.558 units.

The r9 stand-down evidence also supports preserving the original model pick:
the ten settled rows under the retired market-aware correction trigger went
9–1 and +7.156 units on their official original sides after the opposite-side
correction was disabled.

## Board impact

July 27 dry-run impact:

| Market | Before | r10 candidate | Net actionable |
| --- | --- | --- | ---: |
| Moneyline | 0 Best Angle, 1 Lean | unchanged | 0 |
| Total | 0 Best Angle, 0 Lean, 2 Watchlists, 10 No Plays | 0 Best Angle, 4 Leans, 2 Watchlists, 6 No Plays | +4 |
| First Inning | unchanged | unchanged | 0 |

The four Total Leans are:

- NYY at CWS Over 8.5, -102;
- CHC at STL Over 9.5, -103;
- BOS at ATH Over 9.5, -106; and
- MIL at SF Over 8.5, -102.

CHC at STL remains a Lean rather than Best Angle because the market is moving
against the pick. No demotions are introduced.

## Verification and rollback

Before publication:

- run `npm run verify:model-change`;
- run prediction-writer, totals-correction, reader, tracking, and focused
  pipeline tests;
- run TypeScript and production build verification;
- deploy one clean intentional commit; and
- refresh only through the authoritative leased prediction writer.

Roll back to r9 on mixed current-slate release stamps, missing-price rows
presented as normal `NO_PLAY`, reader/writer disagreement, unexpected board
loss, tracking mutation, overlapping writer runs, or site/load regression.
