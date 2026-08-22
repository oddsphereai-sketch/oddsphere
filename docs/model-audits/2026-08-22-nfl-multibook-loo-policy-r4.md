# NFL multi-book leave-one-book-out policy — 2026-08-22 r4

## Decision

Reject the candidate and retain the public Week 1 model-validation hold. This
audit changes no probability, projection, side, Bet grade, stake, published
board, tracking row, settlement, or production release.

- Tournament: `nfl_multibook_loo_exact_price_tournament_2026_08_22_r4`
- Forecast: `nfl_multibook_loo_margin_shadow_2026_08_22_r4`
- Calibration: `nfl_multibook_loo_probability_shadow_2026_08_22_r4`
- Decision: `nfl_multibook_loo_exact_price_shadow_2026_08_22_r4`
- Promotions: 0
- Demotions: 0
- Net actionable change: 0

The best policy was profitable when 2024 and 2025 were pooled, but it failed
the frozen per-season stability and probability gates. Pooled profit cannot
override a losing confirmation season.

## Exact-price and chronology contract

The checksum-pinned BALLDONTLIE opening history contains Caesars, DraftKings,
and FanDuel across 2021–2023, with Fanatics added during 2024–2025. The audit
formed 4,310 target-book observations. For every observation:

1. the target sportsbook was removed from the forecast and market consensus;
2. at least two other conventional books were required;
3. the existing r2 football residual was fit separately for each eligible
   target book and season;
4. an offered book's exact two-sided line and price entered only after the
   forecast, for EV and one-unit settlement;
5. the best playable exact offer was retained once per game and market; and
6. no weekly or slate bet quota was applied. Bet count remained an output.

The policy family was selected on 2023 only. The selected rule was then opened
once on 2024–2025 confirmation. Those seasons have been inspected by prior NFL
work and are historical confirmation, not a pristine future holdout.

## Selected rule and result

The 1,920-policy tournament selected a moneyline-only rule:

- price from -300 through +200;
- model probability at least 55%;
- edge at least 3 percentage points;
- expected value at least 1%; and
- no maximum actions per week.

Selection on 2023 was 88 bets, 62–26, +15.717 units, 17.86% ROI, and 57.95%
positive CLV. That strong selection result did not repeat evenly:

| Period | Bets | Record | Units | ROI | Positive CLV |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2024 | 92 | 62–30 | +12.437 | +13.52% | 55.43% |
| 2025 | 136 | 81–55 | -4.134 | -3.04% | 58.09% |
| 2024–2025 | 228 | 143–85 | +8.302 | +3.64% | 57.02% |

Removing the largest win left +7.350 units pooled, but 2025 remained -5.060
units after its largest win was removed. The required positive-each-season and
largest-win-independent-each-season gates therefore failed.

## Forecast and probability evidence

The leave-one-book-out point-margin residual remained very small and uneven.
It improved 2024 MAE for Caesars (+0.0352), DraftKings (+0.0359), and FanDuel
(+0.0106), but 2025 was negative for Caesars (-0.0105) and only marginally
positive for DraftKings (+0.0120) and FanDuel (+0.0027). Fanatics lacked enough
prior target-book seasons for a target-specific chronological fit and was not
used as an evaluated target.

Moneyline probability improved against the offered-book baseline in 2024:

- candidate Brier 0.20004 vs offered-book 0.20273;
- candidate log loss 0.58825 vs 0.59368.

It reversed in 2025:

- candidate Brier 0.21376 vs offered-book 0.21302;
- candidate log loss 0.61421 vs 0.61246.

Spread Brier improved slightly in both confirmation seasons, but the active
total challenger remained the already-required market fallback. The aggregate
probability gate failed because the moneyline candidate lost to the offered
book in 2025.

## What remains open

The new production r2 forward evidence writer now preserves five conventional
current books per Week 1 game, so the same no-self-reference calculation is
possible prospectively. A production model still requires:

1. a genuinely stable football probability head that beats the market in both
   confirmation seasons;
2. a current Week 1 scoring path using only timestamp-valid features;
3. opening and T-60 QB, depth, injury, split, and weather snapshots as they
   become knowable;
4. a repeated exact-price policy that is positive by season and robust without
   its largest win; and
5. the full model-change, T-60 lock, publication, tracking, and live coherence
   verification before any grade or stake is enabled.

The current evidence-only Week 1 board remains truthful but unfinished. This
audit does not authorize relabeling the failed candidate as No Play, Lean, Best
Angle, or a parlay recommendation.
