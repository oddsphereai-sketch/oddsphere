# NFL Player Props current-season inputs and ranked predictions result

Date: 2026-09-16

## Result

The candidate passes the predeclared logic checks and live no-write replay. The current-season stage discovered all 16 completed Week 1 games and normalized 1,044 player-game stat rows in 12 bounded calls. The final Week 2 replay retained all 16 games, 24,378 observations, 10,991 exact offers, 447 feature rows, and 350 score-eligible features. It built 1,391 member rows: 6 Best Angles / 27 Leans / 173 Watchlists / 1,185 No Plays / 154 genuine role-or-identity Held exceptions. No grade or action rule was changed.

Displayed prediction impact on that replay:

| Market | Prior modal Over / Under | Ranked prediction Over / Under |
| --- | ---: | ---: |
| Passing attempts | 11 / 8 | 10 / 9 |
| Passing completions | 8 / 10 | 8 / 10 |
| Passing yards | 61 / 35 | 48 / 48 |
| Receiving yards | 46 / 154 | 79 / 121 |
| Receptions | 26 / 52 | 35 / 43 |
| Rushing attempts | 5 / 15 | 9 / 11 |
| Rushing yards | 13 / 81 | 37 / 57 |
| Anytime TD | 20 / 330 on the 50% rule | 72 / 278 |

These counts follow the probability sums and ranks; they are not forced equal. The existing modal distribution remains emitted in writer telemetry for monitoring.

Actionable board impact from the ranked display policy is exactly zero promotions, zero demotions, and zero net actionables because it does not enter the grade path. The current-season input overlay changes probabilities under the new release, so its live candidate board is reported as a complete release rather than blended row-by-row with the prior model.

## Week 1 outcome check

On official Week 1 outcomes, the incumbent non-touchdown side classifier went 543-540 (50.14%). Applying the predeclared ranked expected-prevalence classifier to the same frozen probabilities would have gone 567-516 (52.35%), a gain of 24 correct predictions / 2.22 percentage points. Receptions improved from 111/209 to 124/209, rushing yards from 94/204 to 104/204, passing attempts from 18/45 to 21/45, passing completions from 24/42 to 25/42, and passing yards from 53/109 to 54/109. Receiving yards declined 214/414 to 211/414 and rushing attempts 29/60 to 28/60; those regressions are disclosed and remain under release-separated monitoring.

The team-scoped touchdown cohort captured 37 of 70 observed scorers among 76 positive forecasts (48.68% precision, 52.86% scorer recall), compared with the incumbent 50% classifier’s 10 of 70 scorer recall from 13 positives. Overall binary TD accuracy moves from 81.36% to 78.70% because the incumbent was rewarded for predicting No TD almost everywhere; the release explicitly prioritizes scorer discrimination and reports precision/recall rather than presenting that majority-class accuracy as predictive success.

## Operational behavior

The current-season cache is internal and bounded. Provider or completeness failure aborts the candidate and leaves the last coherent member snapshot untouched. The one authoritative writer, shared lease, exact-price economics, market movement, T-60 lock, and immutable tracking records remain unchanged. No member-facing explanatory copy or new labels were added.
