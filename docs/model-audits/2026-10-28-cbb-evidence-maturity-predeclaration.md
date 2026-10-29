# CBB r8: evidence-maturity interaction (private)

Declared after r7's selected-head diagnostics and fixed opening-quote replay.
R7 gained 33 winners overall (174 corrections/141 harms), but the opening-line
353-game sample lost 2 ML and 14 spread winners while gaining 14 Total winners;
the broader 635-game Total cohort lost 6. Therefore r7 is not adopted.

The opened diagnostic's monthly breakdown suggested a nonstationarity issue:
the r7 score improvements were strongest in November/December, while January
margin MAE worsened. A single residual relationship may be inappropriate when
current-season evidence is sparse versus mature. This is an exploratory inference,
not proof of cause, and all subsequent results remain adaptively researched.

Keep frozen R2 core and all r7 features. Append each non-intercept feature times
`mean_current_season_games / (mean_current_season_games + 5)`. Five is the existing
shot-profile prior pseudo-game precision, not an outcome-tuned cutoff. This smooth
interaction lets the fitted relationship change with information maturity without
a hard date rule, fixed score bump, arbitrary winner flip, or market-weight blend.

Exactly six heads (10/100/1000 penalties, squared/Huber), same chronological
2023 fit/2024 selection, same both-MAE/Brier/accuracy eligibility and normalized
MAE ranking. Only the selected head is diagnosed on already-opened 2025 and at
the cached exact quote timestamps. Do not select heads or markets on 2025 results.
Reject as a replacement if meaningful cross-market regressions persist. No new
paid source calls, production writes, activation, grades, stakes, or live shadow.
