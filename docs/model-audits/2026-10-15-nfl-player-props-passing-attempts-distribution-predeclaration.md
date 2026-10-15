# NFL Player Props Passing Attempts distribution recalibration predeclaration

Date: 2026-10-15
Status: research only; fourth materially distinct Passing Attempts candidate

## Hypothesis

Three independent point-head approaches failed: factorized opportunity, independent game-state,
and explicit QB1 role survival. The production point estimate should therefore remain unchanged
while the forecast distribution is challenged. Passing Attempts residuals are asymmetric and
heavy-tailed because ordinary full games coexist with injury, benching, and extreme script games;
a smoother or differently conditioned residual law may improve threshold probabilities without
anchoring the independent projection to a sportsbook.

## Frozen candidates

Use the unchanged released independent point forecast as the location and compare:

- global empirical residual CDF;
- Gaussian-kernel empirical residual CDF with bandwidth 0.5, 1, 2, or 3 attempts;
- projection-tertile empirical CDF, shrunk 25%, 50%, or 75% toward the global CDF;
- projection-quintile empirical CDF, shrunk 25%, 50%, or 75% toward the global CDF;
- centered Student-t residual laws with 3, 5, or 8 degrees of freedom.

No candidate may change the point forecast. The evaluated prop line is used only as the threshold
at which a completed independent distribution is queried; line, price, side, book, movement, and
splits are not model features.

## Chronology and gates

Use game-clustered cross-fitting inside 2024 for selection, refit on 2024, confirm on untouched 2025,
then score the exact 16 offered 2026 Weeks 1-5 rows. Historical selection and confirmation use
proper whole-distribution scores (discrete CRPS and exact-count log score), not invented historical
book lines. The current offered replay compares Brier, log loss, calibration, and direction against
the exact stored locked independent probability.

A candidate advances only if both historical proper scores improve in selection and confirmation,
and current offered Brier and log loss both improve without worse probability-side direction. The
sample is reported as 16 and no production claim may rest on statistical significance that it does
not have.

## Safety

Research writes ignored local artifacts only. Production point projections, market reader, grades,
stakes, releases, sole writer/lease, tracking, and all locked payloads remain unchanged.
