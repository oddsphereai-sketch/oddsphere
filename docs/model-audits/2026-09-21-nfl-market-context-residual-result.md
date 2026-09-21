# NFL market-context residual forecast result

Date: 2026-09-21

Tournament: `nfl_market_context_residual_tournament_2026_09_21_r1`

Decision: rejected; research only; no production behavior changed

## Confirmation result

The frozen recipe was selected on 2022-2023 and evaluated once on the pooled
2024-2025 confirmation seasons.

| Market | Metric | Market | Candidate | Result |
| --- | ---: | ---: | ---: | --- |
| Spread | MAE | 9.666360 | 9.665292 | Improved by 0.001068 |
| Spread | Brier | 0.250325 | 0.250255 | Improved by 0.000071 |
| Total | MAE | 10.061581 | 10.132126 | Worse by 0.070545 |
| Total | Brier | 0.250094 | 0.252435 | Worse by 0.002341 |

The spread candidate moved the market by only 0.1689 points on average.  It
created zero actions at the predeclared two percentage-point edge threshold,
so it failed the sample-size, ROI, and two-direction action gates even though
its pooled point and probability scores were microscopically better.

The total candidate moved the market by 1.1669 points on average, but its
direction accuracy was 49.54%.  Its 374 simulated actions went 182-190-2 for
-24.782 units and -6.63% ROI.  The 2025 slice was -10.91% ROI.  It failed MAE,
Brier, direction, cross-season, and ROI gates.

## Disposition

- Do not promote either recipe.
- Do not change projections, probabilities, grades, or stakes from this audit.
- Retain the report only as negative evidence that conditioning a conventional
  market-residual model on line level and price skew is insufficient.
- Test the distinct score-construction hypothesis separately: predict home and
  away scoring residuals from a shared, orientation-symmetric team model, then
  reconstruct the coherent game margin and total.  That candidate requires a
  new predeclaration before its confirmation seasons are evaluated.

The generated JSON report remains a local ignored research artifact at
`football-research/reports/nfl_market_context_residual_tournament_2026_09_21_r1.json`.

