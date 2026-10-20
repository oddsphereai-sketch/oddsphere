# NBA heavy-tail margin calibration r11 result

Date: 2026-10-20

Status: accepted production candidate; publication remains subject to the
repository model-change, integration-safety, protected-PR, deployment, and
live-verification gates

## Decision

The NBA score model is not structurally capped at small margins. On the 2025
chronological confirmation season, the unified r10 score issued five expected
margins of at least 20 points. Those five selected winners went 5-0, averaged a
22.874-point projected margin, and averaged a 29.4-point realized margin in the
predicted direction. The 56 games projected in the 15-20 band averaged 16.927
projected and 15.821 realized points in the predicted direction. Arbitrarily
widening those scores would make that band less accurate.

The confirmed defect was instead the released single-normal margin residual:
it forecast a 20-plus result in 18.585% of 2025 games while 22.876% finished by
20 or more. The accepted repair leaves every independent and final score mean
unchanged and replaces only the margin probability residual with a symmetric
two-component normal mixture:

- 85% core at `0.85 * 12.964104634449086` points; and
- 15% tail at `2.5 * 12.964104634449086` points.

The frozen mean-widening candidates were rejected. Although some improved one
margin band or aggregate margin MAE, none cleared all predeclared score,
winner-probability, Spread, 10-plus Spread, alternate-line, Total, and
underdog gates. The result does not use a market line, price, movement, split,
or closing value as an independent-model input.

## Chronological validation

The candidate family was selected on 1,224 games from 2024 and confirmed once
on 1,224 games from 2025. The 2025 season had already been opened by earlier
NBA development and is therefore confirmation evidence, not a pristine future
holdout.

### 2024 selection

| Metric | r10 normal | r11 mixture |
| --- | ---: | ---: |
| Winner accuracy | 68.382% | 68.382% |
| Winner Brier | 0.203718 | 0.203702 |
| Winner log loss | 0.592181 | 0.592145 |
| 20+ Brier | 0.161805 | 0.161227 |
| 20+ log loss | 0.502806 | 0.500800 |
| 20+ calibration error | -2.911 pp | -1.546 pp |
| Spread | 51.676% | 51.676% |
| Spread on closing 10+ | 50.859% | 50.859% |
| Spread +3 | 62.633% | 62.633% |
| Spread +6 | 70.809% | 70.809% |
| Total | 49.632% | 49.632% |
| Selected underdogs | 51.355% | 51.355% |

Four candidates cleared every selection gate. The declared lexicographic rule
selected the `0.85 / 0.15 / 2.5` mixture.

### 2025 confirmation

| Metric | r10 normal | r11 mixture |
| --- | ---: | ---: |
| Team-score MAE | 9.4394 | 9.4394 |
| Margin MAE | 11.0143 | 11.0143 |
| Total MAE | 15.0846 | 15.0846 |
| Winner accuracy | 69.281% | 69.281% |
| Winner Brier | 0.197680 | 0.197365 |
| Winner log loss | 0.579858 | 0.579089 |
| 20+ forecast rate | 18.585% | 19.956% |
| 20+ outcome rate | 22.876% | 22.876% |
| 20+ Brier | 0.172382 | 0.171388 |
| 20+ log loss | 0.529103 | 0.525400 |
| 20+ calibration error | -4.290 pp | -2.919 pp |
| Spread | 52.941% | 52.941% |
| Spread on closing 10+ | 51.266% | 51.266% |
| Spread +3 | 62.010% | 62.010% |
| Spread +6 | 70.915% | 70.915% |
| Total | 52.614% | 52.614% |
| Selected underdogs | 52.925% | 52.925% |

Every predeclared confirmation gate passed. Directional metrics are identical
because a symmetric residual mixture changes calibrated probability, not the
expected score or the 50% side boundary.

## Mean-margin diagnostic

The 2025 final-score zero-centered calibration slope is 1.097, but the error is
not monotone. The 12-15 band averaged 13.433 projected versus 15.615 realized,
while the 15-20 band averaged 16.927 projected versus 15.821 realized. The
20-plus band averaged 22.874 projected versus 29.4 realized across only five
games. This supports continued release-pure monitoring; it does not support a
global multiplier or forced wider displayed scores.

## Runtime coherence repair

The initial implementation audit found that the professional candidate
computed the mixture correctly, but `nbaMarketIntelligence` recomputed exact-
line card probabilities from only `margin_sd_used`, silently falling back to a
single normal. R11 carries the full residual-distribution state through
`v1_probabilities` and requires exact-line recomputation to use the same
mixture. A focused end-to-end test proves that the member Moneyline and Spread
probabilities exactly equal the unified candidate probabilities, while Total
remains unchanged.

## Same-input board impact

The October 21 unlocked 11-game / 33-market board was evaluated concurrently
under the released normal residual and the candidate mixture from the same
pipeline inputs:

- score changes: 0;
- pick changes: 0;
- grade changes: 0;
- actionable promotions: 0;
- actionable demotions: 0; and
- Total probability changes: 0.

Today’s locked records remain byte-for-byte governed by locked-snapshot
precedence and are not recomputed under r11.

## Release contract and rollback

- Model / prediction record:
  `nba_professional_unified_2026_10_20_r11_heavy_tail_margin_calibration`
- Market marriage:
  `nba_market_marriage_2026_10_20_r11_heavy_tail_margin_calibration`
- Margin probability calibration:
  `nba_margin_distribution_2026_10_20_r2_heavy_tail_mixture`
- Point projection remains:
  `nba_unified_final_projection_2026_10_20_r4_minimum_coherent_crossing`
- Reader remains:
  `nba_professional_market_reader_2026_10_20_r6_structural_qualification`
- Grade policy remains:
  `nba_grade_policy_2026_10_16_r5_market_specific_accuracy`
- Sole writer and lease remain `/api/cron/nba-daily-refresh` and
  `prediction_pipeline:nba`.

Roll back future unlocked computation to r10 and the released single-normal
residual on mixed release identity, exact-line probability disagreement,
score/side drift, unexpected Total drift, actionable-board contraction, lock
mutation, writer overlap, or failed live release/reader/coverage verification.

Predeclaration:
`docs/model-audits/2026-10-20-nba-extreme-margin-calibration-predeclaration.md`.
