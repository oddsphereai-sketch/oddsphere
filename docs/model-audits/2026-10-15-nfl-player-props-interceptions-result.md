# NFL player props: quarterback interceptions result

Date: 2026-10-15

Verdict: reject both learned candidates as replacements; retain the partially pooled opportunity/rate foundation for future interception research.

## Result

The Poisson tree won the predeclared 2025 selection but did not generalize to 2026 Weeks 2-5.

| 2026 Weeks 2-5, 132 QB-games | Opportunity foundation | Poisson GLM | Selected Poisson tree |
|---|---:|---:|---:|
| MAE | **0.6509** | 0.6524 | 0.6533 |
| RMSE | 0.7524 | **0.7364** | 0.7575 |
| Mean Poisson deviance | 1.0428 | **1.0097** | 1.0594 |
| Mean Poisson log score | 1.0344 | **1.0178** | 1.0427 |
| Average threshold Brier | 0.09549 | **0.09366** | 0.09677 |

The selected tree lost all three primary aggregate point metrics versus the foundation and improved only two of four threshold Brier scores. It failed the predeclared accuracy gate.

The GLM improved deviance, log score, RMSE, and Brier, but missed the MAE gate by 0.0015 and was not the architecture selected on 2025. It is a useful future diagnostic, not permission to switch winners after seeing 2026.

## Uncertainty

The 2,000-draw paired game-cluster bootstrap for the selected tree versus the foundation showed:

| Metric delta | Mean | 95% interval | Probability selected tree improves |
|---|---:|---:|---:|
| MAE | +0.0021 | [-0.0282, +0.0335] | 45.4% |
| Mean Poisson deviance | +0.0157 | [-0.0588, +0.0960] | 35.0% |
| Average threshold Brier | +0.00122 | [-0.00404, +0.00680] | 33.7% |

The intervals cross zero, but the probability mass does not support calling the selected model better.

## Archived-game slice

The four quarterbacks in OddSphere's two archived Week 5 games produced three total interceptions: Josh Allen 1, Matthew Stafford 0, Dak Prescott 2, and Jalon Daniels 0.

Both learned models beat the foundation on this four-row slice, primarily by reducing Stafford and Daniels, but all models undercalled Prescott's two-interception outcome. The slice is too small to reverse the current-season rejection.

## Football interpretation

The failure is consistent with interception volatility. Pressure, aggressiveness, air yards, and opponent takeaways may be directionally meaningful, but game-level interception counts remain sparse and unstable. Strong partial pooling of quarterback, team, and opponent rates was more robust than nonlinear interaction fitting in the current-season sample.

External work supports retaining hierarchical structure rather than raw matchup adjustments. A multilevel NFL pass-outcome study explicitly treats repeated quarterback and defense observations as dependent and estimates separate quarterback/defense effects; that is the direction for a future interception candidate, not another unconstrained tree search. [CMU hierarchical NFL pass study](https://www.stat.cmu.edu/cmsac/sure/2024/showcase/football/report.html)

nflfastR's football-state work remains relevant for pressure/play context and season-held-out calibration, but this test shows that useful context does not automatically produce stable player-prop gains. [nflfastR model documentation](https://github.com/nflverse/open-source-football/blob/master/_posts/2020-09-28-nflfastr-ep-wp-and-cp-models/nflfastr-ep-wp-and-cp-models.Rmd)

## Product decision

Do not add Interceptions to production and do not retune the failed tree after seeing Week 2-5. The next valid interception experiment would be a predeclared hierarchical quarterback/defense count model with stronger shrinkage, evaluated on additional 2026 weeks. Release-pure interception offers and exact prices must also be captured before economic or market-reader claims are possible.

No production model, calibration, decision, grade, stake, writer, reader, or public page changed.
