# CBB private shot-profile experiment r3

Scope: private CBB score research only. No production model, writer, reader,
cron, lease, grades, stakes, or locked records change. Baseline is frozen r2
`cbb_candidate_2026_10_28_r2_score_precision`; working base is
`461d70c1782ff3f891a35a59a01da132e9332e0e`.

Hypothesis: aggregate efficiency and four factors omit shooting composition,
free-throw accuracy, opponent shot suppression, and temporal matchup style.
Add historical two/three-point accuracy, three-point attempt share, free-throw
accuracy/rate, turnover and rebound rates, and scoring/pace variation, computed
only from exact accepted games completed at least six hours before the forecast.
Use current-season profiles shrunk toward the previous season, plus recent-five
profiles. Never use the evaluated game's box score in its features.

Keep r2's core rating/tempo forecasts unchanged. Fit alternative residual heads
on those raw forecasts, comparing against r2's learned head. Train on 2023, select on
2024, then report 2025 as an already-opened diagnostic, not a pristine holdout.
Test ridge penalties 10/100/1000, squared and Huber residual fits, plus the
existing absolute-error trees at depths 2/3. Rank by equal normalized margin
and Total MAE improvement on 2024, requiring both improve, winner accuracy no
more than 0.5 percentage points worse, and Brier no worse. Reject if these
conditions fail. Report all tests, exact paired cohort, corrections and harms.
Do not promote a candidate merely because 2025 improves.

Targets under 6 margin / under 10 Total remain aspirations, not promised or
release criteria justified by evidence. A historical peer-reviewed market
benchmark reports 8.36 margin MAE over 25,574 games (2003–2011); that is not the
same cohort and cannot establish our current market-relative quality.

Sources: https://kenpom.com/blog/ratings-explanation/ and
https://www.jvlone.com/sportsdocs/GamblingBasketbal2013.pdf (Table 3).
