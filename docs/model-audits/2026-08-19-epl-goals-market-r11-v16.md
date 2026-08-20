# EPL goals-market and line-history release — r11 / v16

## Decision

Promote a market-derived Total forecast and an independently priced BTTS forecast. Retain the r10 Match Result, Double Chance, expected-goal lambdas, provider budgets, writer, T-60 lock, and settlement paths.

## Chronological protocol

- Training: 2022–23 and 2023–24.
- Selection: 2024–25.
- Untouched holdout: 2025–26, 342 matches with complete Football-Data average pre-closing 1X2 and Over/Under 2.5 prices.
- BALLDONTLIE supplied official match identity, results, and club history. Football-Data supplied historical 1X2 and Total prices.
- Scripts: `scripts/operator/tournament-epl-derived-markets.ts` and `scripts/operator/tournament-epl-market-anchored.ts`.

The standalone recent-form logistic candidate failed. Total Brier was 0.24945 versus 0.24837 for a constant baseline. BTTS Brier was 0.25119 versus 0.24639. It is not released.

## Selected forecasts

Total Over probability is 25% raw club score-distribution probability plus 75% coherent de-vigged two-sided Total-market probability. On holdout it recorded 0.24620 Brier, 0.68569 log loss, and 57.0% side accuracy. At the 55% confidence floor it was 109–72 (60.2%), comprising 158 Over and 23 Under forecasts.

BTTS does not use the offered BTTS price to select a side. A coherent three-way result book plus the Total 2.5 book is fit to the same Dixon-Coles score family; that fitted distribution supplies Yes/No. On holdout it recorded 0.24427 Brier, 0.68164 log loss, and 59.9% side accuracy. At 55% confidence it was 100–70 (58.8%), comprising 159 Yes and 11 No forecasts; at 57% it was 68–43 (61.3%). Adding the club BTTS head worsened holdout Brier, log loss, and side accuracy, so it is rejected.

## Grade policy and board impact

For Total and BTTS, a coherent current price is mandatory. Forecast confidence of at least 55% is Lean; 53% through below 55% is Watchlist; below 53% is No Play. No Best Angle path is enabled because a return-qualified cohort was not validated.

The contemporaneous no-write preview changed only the goals markets: Total moved from 0 actionable rows to 7 Leans; BTTS moved from 0 actionable rows to 6 Leans plus 3 Watchlists. There were 13 promotions and zero demotions. Match Result remained 3 Best Angles, 2 Leans, 1 Watchlist, and 4 No Plays. All 40 selected prices and all 100 outcome rows were present.

## Line-history incident and repair

Production initially rendered Arsenal movement inconsistently. The post-release audit verified that the durable and member histories contained Arsenal -700 followed by -650, Coventry +1100 followed by +1400, and a flat Draw +650. The member snapshot could overwrite durable history, provider timestamps were substituted for OddSphere capture time, and identical stored rows could be interpreted as a trail. r11 merges snapshot and durable observations, stamps changed quotes at actual capture time, removes consecutive economic duplicates, prevents flat rewrites, and renders a single observation as current-only instead of a fabricated three-point move. No historical quote is invented.

## Rollback

Restore r10/v15. This removes actionable Total/BTTS grades and the new probability heads; retain the tracking repair independently if a probability rollback is required.
