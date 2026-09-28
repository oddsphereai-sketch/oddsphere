# NFL market-arbitration r103 predeclaration

Date: 2026-09-28

Status: frozen before executing this candidate against its 2024-2025 reuse-aware confirmation partition

## Objective

Replace the idea that market evidence may only add a capped point nudge with a continuous,
sport-specific arbitration head. The NFL independent score remains the football expert. Opening-to-
current movement and current no-vig price form the market expert. When their combined calibrated
posterior crosses 50%, the candidate may genuinely change the Moneyline, Spread, or Total direction;
the complete score distribution must then be regenerated from that posterior.

This audit does not authorize a universal market weight, a sharp-follow rule, a board quota, a UI
change, or a production release.

## Frozen chronology and inputs

- Leakage-safe football feature release:
  `nfl_real_pregame_features_2016_2025_2026_08_19_r1`.
- Independent point forecasts are produced chronologically for each test season by one frozen
  histogram gradient-boosting regressor trained only on prior seasons and only on football,
  matchup, availability, coaching, rest, and weather inputs. It does not receive a betting line.
- DraftKings opening lines/prices come from the checksum-verified
  `bdl_nfl_opening_history_<season>_2026_08_20_r2` caches.
- Current line and price are the terminal nflverse consensus observations. They are a historical
  market proxy, not represented as OddSphere's exact T-60 Circa/Pinnacle tuple.
- Arbitration training: 2020-2021. Selection: 2022-2023. Reuse-aware confirmation: 2024-2025.
- The already-inspected 2026 Week 3 Circa/Pinnacle capture is diagnostic only and cannot select a
  coefficient or rule.

## Frozen model

Spread and Total are fit separately with one L2-regularized logistic stack (`C=0.1`) over:

- the independent expert's calibrated log-odds at the current line;
- the current market's no-vig log-odds;
- opening-to-current line movement, signed toward home/over;
- absolute movement;
- independent point disagreement with the current line;
- movement-by-independent-disagreement interaction;
- current line level, week, and early-season state; and
- opening-to-current no-vig price change.

Missing values receive training-median imputation and standardized scaling. No candidate family,
threshold grid, cap, manual flip, or confirmation-selected coefficient is permitted. Pushes are
excluded only from binary metrics.

The posterior point center is recovered continuously from the calibrated probability and the
training-only residual scale. There is no football-point nudge cap. A production implementation is
eligible only if it uses the posterior once, upstream, to rebuild a coherent distribution from the
independent base; it may not patch a displayed side after score generation.

## Gates

Spread and Total qualify independently only if all hold on pooled 2024-2025 confirmation:

1. Side accuracy exceeds 50%, neither season is below 50%, and both directions occur in each year.
2. Brier and log loss improve on the independent expert and are no worse than the current no-vig
   market baseline.
3. Point MAE improves on the independent expert and is no more than 0.10 points worse than the
   current market center.
4. Disagreements contain both beneficial and harmful potential flips, and the arbitration head's
   net correction count is positive rather than a blanket market-follow result.
5. A later exact-runtime replay preserves every game, one coherent score/side/probability identity,
   paired promotions and demotions, and a non-flat actionable board.

Moneyline may be derived from the qualifying coherent margin distribution; it may not receive a
separate downstream winner override. Split and Circa/Pinnacle source-quality features require their
own forward validation and cannot be assigned retrospective coefficients from Week 3 alone.
