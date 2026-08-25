# CFB v1 market-calibrated grade policy predeclaration

Date: 2026-08-25

Status: frozen before 2024/2025 repeated confirmation

The qualified `cfb_v1_independent_joint_distribution_2026_08_25_r3`
score PMF remains fixed and remains the public independent forecast. The first
exact-price policy failed before confirmation: Moneyline returns depended on a
single synthetic long-price win, Spread was negative across the frozen grid,
and only Total passed 2023 selection. It is rejected as a complete policy.

This second architecture adds a separately disclosed, market-aware probability
calibration layer for Bet grades. It does not replace or relabel the independent
PMF. For each evaluation season, the calibrator is fitted only on earlier-season
PMF forecasts and outcomes. The bounded candidate families are:

- logistic calibration of the independent probability;
- logistic market-residual calibration using the independent logit, the
  synchronized market fair logit, their difference, and a market-zone term;
- the calibrated probability blended with synchronized market fair probability
  at independent weights of 35%, 50%, 65%, 80%, or 100%.

The only bounded abstention choices are declared before confirmation:

- Moneyline: all prices, -300 through +250, -200 through +200, favorite only,
  or underdog only;
- Spread: all spreads, absolute line at most 14, absolute line at most 7, home
  favorite only, or home underdog only;
- Total: all totals, 40 through 70, 45 through 65, Over only, or Under only.

Policy selection uses 2023 only. The minimum edge grid is 1–5 percentage points
and minimum expected value grid is 0–3%. It requires at least 15 Moneyline or 20
Spread/Total actions, positive units after removing the largest win, and a
positive weekly-cluster bootstrap median. The objective penalizes weekly lower
tail return. The selected family, blend, abstention, and thresholds are frozen
before evaluating 2024 and 2025.

A Lean lane qualifies only with positive pooled raw and largest-win-removed
confirmation units, no confirmation season below -3% ROI, and a positive
weekly-cluster bootstrap median. Best Angle adds two percentage points to both
edge and EV thresholds and must have at least five actions plus positive raw and
largest-win-removed units in each confirmation season.

Historical price limitations remain explicit: Spread and Total settle at -110;
Moneyline uses a past-only spread-to-win curve and 4.5% synthetic overround.
These rows support return robustness but not historical CLV claims. Forward
decisions must instead use an exact named-book price and target-excluded,
same-line consensus.

No quota, weekly cap, forced action, stake, reader-side override, or market-copy
labelled as an independent OddSphere forecast is allowed.
