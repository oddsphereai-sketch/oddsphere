# EPL published-goals coherence release — r12 / v17

## Decision

Retain every r11 Total and BTTS probability and grade rule. Replace the reader's club-only expected-goal projection with a validation-selected blend of 30% club lambdas and 70% lambdas from the coherent 1X2+Total-fitted Dixon-Coles distribution.

## Reason

The r11 BTTS head was more predictive than the club score distribution, but the reader continued displaying club-only lambdas. Manchester United at Hull therefore showed MAN 1.64 / HUL 1.21 next to Over 2.5 and BTTS No 50.16%, then forced a 3-0 representative scenario. The club head itself forecast BTTS Yes 54.99% and a 1-1 modal score. The page was combining two different distributions without making that boundary useful to members.

## Chronological validation

- Training source and partitions remain the r11 four-season tournament: 2022–23 and 2023–24 training, 2024–25 selection, and 2025–26 untouched holdout.
- The goal-projection blend weight was selected on 2024–25 from 5-point increments by combined home/away goal MAE.
- Selected weight: 30% club lambdas / 70% coherent goals-market-fitted lambdas.
- Untouched 2025–26 holdout: 342 matches.
- Club-only combined team-goal MAE: 0.89576; selected projection: 0.87639.
- Club-only total-goal MAE: 1.21499; selected projection: 1.19836.
- A near-even BTTS override to the club side was tested and rejected because it worsened untouched holdout Brier and log loss relative to the r11 market-derived head.

## Board impact

The contemporaneous no-write slate retained Match Result 3 Best Angles / 2 Leans / 1 Watchlist / 4 No Plays, Double Chance 4 Watchlists / 6 No Plays, Total 7 Leans / 3 No Plays, and BTTS 6 Leans / 3 Watchlists / 1 No Play. Sides remained Total 7 Over / 3 Under and BTTS 8 Yes / 2 No. There are zero promotions and zero demotions.

Manchester United at Hull now publishes MAN 2.03 / HUL 0.92. Over 2.5 remains a Lean at 56.64%; BTTS No remains a No Play at 50.16%. The probability head is unchanged, while the scoring context now comes primarily from the same coherent distribution that supplies the validated BTTS forecast.

## Rollback

Restore r11/v16 to return to club-only displayed lambdas. No probability, grade, writer, price-history, lock, settlement, or provider change is required.
