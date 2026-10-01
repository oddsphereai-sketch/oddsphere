# CFB cross-family domain arbitration r7 — predeclaration

Date: 2026-10-01

Status: research-only; frozen before scoring the r7 grid

## Purpose

R6 showed that replacing the selected linear Total with a nonlinear Total fixes
the 2026 scoring level but unnecessarily loses historical Total-side accuracy.
R7 therefore preserves the r4 linear Total's matchup ordering and uses model-
family disagreement only as a market-blind domain-shift detector.

For each week independently, calculate the mean difference between the r4 Total
and the row-wise median of the histogram-gradient and extra-trees direct Total
heads. If the absolute weekly disagreement clears a frozen activation threshold,
apply a constant fraction of that weekly mean difference to every r4 Total in
the week. Same-week scores, game outcomes, sportsbook lines, prices, splits and
movement are excluded. The margin remains byte-for-byte unchanged.

Frozen grid:

- activation threshold: 3, 5, or 7 points;
- correction strength: 0.75 or 1.00.

Selection uses 2023–2025 rolling-origin outcomes plus a structural check on 2026
predictions without reading 2026 outcomes. A candidate must put the 2026 mean
within 3.5 points of the completed 2023–2025 scoring mean; must not worsen pooled
historical Total MAE by more than 0.05, team-score MAE by more than 0.05, or
Total-side accuracy by more than 0.1 percentage points; and no historical season
may lose more than 0.20 points of Total MAE. Among eligible candidates, minimize
pooled Total MAE, maximize Total-side accuracy, minimize the 2026 past-state
mean gap, then prefer the higher activation threshold and lower strength.

Only after selection is frozen is the chosen rule scored against 2026 outcomes
and immutable pregame lines. No production release is authorized here.
