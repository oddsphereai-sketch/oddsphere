# Football reader prediction / Bet Grade axis separation

Date: 2026-08-28

Release: `daily_edge_member_presentation_2026_08_28_r10_football_prediction_bet_axis`

## Incident

Signed-in production QA after the r18/r20 football release found that the shared Quick Read could combine a model-owned prediction label with an opposing exact-price decision. The concrete SJSU-USC Total example displayed `Over 61.5` beside BetMGM `-108`, a `58.9%` Bet Grade probability, and a Best Angle explanation that correctly belonged to `Under 61.5`. The stored tuple was coherent; the reader crossed the prediction and price axes.

## Contract

- Prediction tabs use `marketPrediction.label` and `marketPrediction.probability`.
- The Quick Read exact-price panel uses `pick`, the evaluated book/line/price, `modelProb`, fair probability, edge, EV, and Bet Grade.
- When the two qualified heads select different sides, the reader names both sides explicitly.
- A missing exact tuple retains the model prediction and presents a reasoned public No Play; it never presents Held as the prediction.
- A one-sided provider quote stamped within five seconds after writer run start may be shown only as opposing sportsbook context from that bounded response. It cannot populate the selected price, fair probability, EV, grade, or tracking tuple; rows outside that bound still fail closed.

## Model impact

None. This reader-only release changes zero PMFs, probabilities, projections, exact-price tuples, grades, promotions, demotions, stakes, locks, or tracking rows. The current CFB replay remains 8 games / 24 markets with 23 exact decisions and one incomplete Moneyline; the current NFL replay remains 16 games / 48 markets.

## Rollback

Restore presentation release r9. No writer, provider, database, model, grading, T-60, settlement, or tracking rollback is required.
