# NFL player props independent forecast and market observer — complete-family result

Date: 2026-10-08  
Production base: `0e7e6e056f9b7da64dc3f71920c908f577c7c5c5`

## Decision

Do not increase market dependence, but do not remove it from the probability
posterior yet. No production prediction, probability, projection, grade, stake,
writer, schedule, or locked record changes in this audit.

The product supports all eight requested families. The new independent-model
tournament evaluated all seven ordinary families, and the existing frozen
Anytime Touchdown audit already supplies the eighth decision. One new challenger
is credible enough for shadow work: a Receptions count model using lagged public
Next Gen Stats. It improved both MAE and RMSE in 2023 selection, 2024
confirmation, and untouched 2025 holdout. It is not production-ready until its
probability distribution, portable parity, current-season source coverage, and
product replay pass.

The current market observer contains real opening and current evidence, including
both line and price changes. It does not contain enough sharp-book coverage to
fit a Pinnacle/Circa/Bookmaker rule: the current Week 5 snapshot has seven sharp
observations, all Circa, and no Pinnacle observations. Movement remains observer
evidence, not an automatic flip instruction.

## What the product does today

- Ordinary probability posteriors generally use a residual coefficient of 0.20,
  meaning the log-odds gap from market consensus to the independent model is
  traversed only 20%.
- The quarterback passing point marriage is more market-dependent: when its
  evidence minimum is met, the point center is 90% market-derived and 10% role
  model.
- The independent family already has market-specific point heads and 204 modeled
  inputs, including player opportunity and shares, team/opponent play mix and
  efficiency, pressure/sacks, explosives, air yards/YAC, venue, weather, home,
  and week.
- Those matchup inputs are aggregate team/opponent proxies. They are not
  assignment-level CB/WR coverage or OL/DL matchup data.
- Historical injury and roster descriptions are intentionally excluded because
  the retained history does not prove when those fields became known. Learning
  from them would introduce pregame leakage.

## Independent-model tournament

The new tournament used no sportsbook input and froze train-through-2022,
2023-selection, 2024-confirmation, and 2025-holdout chronology. NGS season-summary
rows were excluded and each game received only strictly earlier player-week
tracking state.

The public NGS source includes weekly player summaries from 2016 and updates the
current season nightly, but publishes rows only after minimum passing, rushing,
or receiving participation. The lagged feature families covered about 11.0% of
2025 history rows for passing, 14.5% for rushing, and 35.8% for receiving. These
are expected sparse overlays, not substitutes for the base model.

| Market | Selected challenger | 2024 result | 2025 result | Decision |
| --- | --- | --- | --- | --- |
| Passing Attempts | control Poisson, 100% | MAE/RMSE improved | MAE improved; RMSE 9.4485 → 9.5722 | reject |
| Passing Completions | NGS Poisson, 75% | failed | not opened as eligible | reject |
| Passing Yards | none | — | — | retain |
| Rushing Attempts | none | — | — | retain active settlement-aligned release |
| Rushing Yards | NGS recipe, 25% | passed | MAE 11.9981 → 12.0012; RMSE improved | reject |
| Receptions | NGS Poisson, 75% | MAE 1.2602 → 1.2557; RMSE 1.8156 → 1.8128 | MAE 1.1976 → 1.1923; RMSE 1.7170 → 1.7123 | shadow candidate |
| Receiving Yards | NGS regularized, 75% | passed | MAE 15.6524 → 15.7633; RMSE improved | reject |

For Receptions, the 2025 game-clustered mean MAE delta was `-0.00524`, with a
95% interval of `[-0.00725, -0.00326]` over 272 games. That is a real but small
point improvement. Selection alone does not authorize production: the candidate
still needs a newly fit price-blind residual distribution and release-complete
replay.

Anytime Touchdown remains a separate rare-event problem. The prior bounded
role/red-zone challenger improved the complete 2025 historical holdout but failed
the frozen Week 1 2026 external confirmation, including scorer precision/recall.
The active touchdown model therefore remains the correct incumbent.

## Independent point versus market posterior

The exact-opening tournament joined the active portable model and distribution
to 2025 lines, excluded the evaluated sportsbook from market consensus, selected
through October, and confirmed from November onward. It tested independent
weights of 0%, 20%, 35%, 50%, 65%, 80%, and 100%.

No ordinary family passed the frozen probability gate for a shippable 65%+
independent posterior. Rushing Yards selected 65% in the early window, then made
confirmation Brier score worse by `0.00739`; its 95% game-clustered interval was
`[0.00144, 0.01365]`, entirely worse than the 20% incumbent.

Point accuracy and probability accuracy are not the same result. In a diagnostic
single-market posterior, 65% independent Rushing Yards improved point MAE and
RMSE in both chronological windows:

| Window | 20% independent MAE / RMSE | 65% independent MAE / RMSE |
| --- | ---: | ---: |
| Through October | 19.8447 / 27.7984 | 19.1961 / 27.5877 |
| November onward | 19.2654 / 27.7343 | 19.0740 / 27.6941 |

That is the clearest evidence supporting the owner's concern: the market-heavy
posterior can slightly hurt the displayed Rushing Yards center even while it
helps probability calibration. It is not safe to solve that by publishing a
point from one distribution and a probability from another. The next Rushing
Yards research target is therefore a coherent independent distribution whose
point and probability both pass, not an uncalibrated point override.

For Passing Attempts, Passing Completions, Passing Yards, Rushing Attempts,
Receptions, and Receiving Yards, the 65% independent single-market point did not
improve both confirmation MAE and RMSE over the 20% incumbent. The three QB rows
are diagnostics rather than an exact replay of the cross-market 90% QB workload
marriage.

## Current market-reading inventory

The SELECT-only Week 5 audit found 630 retained prop identities and 1,510 book
observations. It reconstructed the enclosing current line for each evidence
identity and compared it with each book's retained opener.

| Market | Identities | Sharp observations | Opening→current line changes | Price changes |
| --- | ---: | ---: | ---: | ---: |
| Anytime TD | 135 | 0 | 5 | 509 |
| Passing Attempts | 40 | 0 | 13 | 42 |
| Passing Completions | 33 | 0 | 4 | 40 |
| Passing Yards | 61 | 1 | 34 | 19 |
| Receiving Yards | 110 | 2 | 68 | 73 |
| Receptions | 93 | 2 | 10 | 132 |
| Rushing Attempts | 42 | 0 | 10 | 48 |
| Rushing Yards | 116 | 2 | 77 | 85 |
| **Total** | **630** | **7** | **221** | **948** |

All seven sharp observations were Circa. Pinnacle and Bookmaker supplied none.
Therefore the product may truthfully show opening/current line and price history,
but it must label sharp evidence unavailable for most rows. Retail consensus is
not a synthetic sharp feed.

The retained snapshot proves opener-to-current movement, but one Week 5 snapshot
does not validate when a move occurred or whether following it improves outcomes.
The observer needs immutable observations at opening, T-24, T-6, and T-60, graded
after settlement and separated by market and release. Price-only moves must remain
same-book and same-line; line moves must remain same-book and exact player/market.

## Matchup-source conclusions

NFL tracking can support richer models: the league describes tracking for every
player on every play and derived formation, coverage, route, completion, and
expected-rushing metrics. The public weekly NGS summaries tested here expose
useful player efficiency features but not reproducible individual CB/WR assignments
or OL/DL blocking matchups.

The public participation dataset is also not a current-season inference source:
from 2023 onward it is published after postseason completion. An assignment-level
feature may enter production only after OddSphere has both timestamped historical
training coverage and a pregame live path. Until then, the model should describe
its opponent inputs as aggregate matchup proxies.

For movement history, the current internal capture should be the prospective
source of truth. A paid historical bootstrap is possible: The Odds API documents
event-level historical player-prop snapshots after 2023-05-03 at five-minute
intervals. Provider/book/market coverage and cost still require a separate data
purchase decision; no unsupported claim of Pinnacle coverage should be made.

Sources:

- [nflreadr weekly Next Gen Stats loader](https://github.com/nflverse/nflreadr/blob/main/R/load_nextgen_stats.R)
- [nflreadr participation availability](https://github.com/nflverse/nflreadr/blob/main/R/load_participation.R)
- [NFL performance tracking and Next Gen Stats](https://operations.nfl.com/game-operations-logistics/technology/performance-tracking-data-next-gen-stats)
- [The Odds API historical event odds](https://the-odds-api.com/liveapi/guides/v4/index.html#get-historical-event-odds)

## Concrete next move

1. Keep all live releases unchanged.
2. Advance the Receptions NGS Poisson candidate to a release-pure shadow artifact:
   fit a new residual distribution, prove portable parity, verify current-season
   NGS coverage/freshness, and replay board promotions and demotions.
3. Run a coherent Rushing Yards distribution tournament around the 65% point
   result. It must improve point MAE/RMSE and probability Brier/log loss together.
4. Begin prospective market-observer grading from the already retained opening,
   current-line, and current-price evidence. Evaluate confirming, adverse, and
   strongly adverse states separately at opening/T-24/T-6/T-60. Missing or
   non-sharp evidence is neutral, never inferred.
5. Do not fit a movement adjustment, demotion, or flip until that exact market has
   at least 100 settled non-push decisions in both development and untouched
   confirmation. A flip must beat the independent forecast on direction, Brier,
   and log loss; otherwise movement may only confirm, warn, or hold.
6. Prioritize timestamped availability and role-transfer history for volume props.
   Passing Attempts and Rushing Attempts are more likely to improve through
   starter/backup mixture and opportunity transfer than through another generic
   efficiency feature block.
7. Acquire assignment-level history only if the same source can populate live
   pregame inference. Until then, do not manufacture CB/WR or OL/DL coefficients.

This establishes the intended architecture: the independent football forecast is
the research target and source of model conviction; the market observer is a
separate, timestamped evidence layer. Market data may change availability or
confidence only after it earns that authority prospectively per market.
