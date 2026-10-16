# NFL player props: all-family independent-model research ledger

Date: 2026-10-15

Scope: all 18 canonical families in `NFL_PLAYER_PROPS_RESEARCH_MARKETS`

This ledger separates three decisions that must not be conflated: independent point/probability quality, market-reader evidence, and production authorization. A successful independent replay is not automatically a profitable bet, and a sportsbook move is not allowed to become a hidden model feature.

| Canonical family | Current research decision | 2026 evidence used in the latest decision | Production state |
|---|---|---|---|
| Passing Attempts | Retain released independent model; five challengers failed full gates | Exact locked scopes plus current-season replay | Live existing family; unchanged |
| Passing Completions | Retain released attempts × completion-rate architecture | Exact locked scopes | Live existing family; unchanged |
| Passing Yards | Reject receiver-room challenger | Candidate MAE 66.80 vs 66.43 incumbent on exact scopes | Live existing family; unchanged |
| Rushing Attempts | Retain released conditional-on-participation model | External challenger improved RMSE but worsened MAE | Live existing family; unchanged |
| Rushing Yards | Reject explosive-decomposition challenger | Historical RMSE improved while MAE worsened | Live existing family; unchanged |
| Receptions | Reject completion-allocation challenger | Historical stability interval crossed zero | Live existing family; unchanged |
| Receiving Yards | Reject air/YAC challenger | MAE 34.33 → 34.04, but probability scores and actions worsened | Live existing family; unchanged |
| Anytime TD | Keep actionability disabled; fixed ensemble improves independent probability but not economic ordering | Corrected Week 5 ledger: 45 rows, released exact-price ROI -37.68% | Existing board family; no actionable promotion |
| Passing TDs | Retain Poisson HGB research foundation; evidence modest | 132 QB-games; MAE 0.9051 → 0.8822, deviance 1.0709 → 1.0468 | Research only; no exact-price ledger |
| Interceptions | Reject learned candidate; retain pooled foundation | 132 QB-games; candidate worsened MAE, deviance, and Brier | Research only |
| Rushing + Receiving Yards | Reject log-HGB candidate | 982 player-games; MAE/Brier improved but RMSE 32.50 → 33.94 | Research only |
| Player Touchdowns | Reject Poisson-HGB candidate for count projection | 1,084 rows; deviance/Brier improved but MAE worsened with CI above zero | Research only |
| First Touchdown | Retain coherent hazard research foundation; evidence not conclusive | 63 games; point Brier/log loss improved, both bootstrap intervals cross zero | Research only |
| Longest Pass | Retain HGB-log independent foundation | 136 QB-games; MAE 13.30 → 10.58 and 5/5 Brier wins | Research only; no exact-price ledger |
| Longest Reception | Retain HGB-log independent foundation | 797 player-games; MAE 11.34 → 7.52 and 5/5 Brier wins | Research only; no exact-price ledger |
| Longest Rush | Retain HGB-log independent foundation | 436 player-games; MAE 7.30 → 5.32 and 5/5 Brier wins | Research only; no exact-price ledger |
| Field Goals Made | Retain decomposed Poisson foundation | 126 kicker-games; MAE 1.139 → 1.057, deviance 1.266 → 1.022, 4/4 Brier wins | Research only; no exact-price ledger |
| Kicking Points | Retain decomposed component foundation | 126 kicker-games; MAE 3.293 → 3.043, RMSE 3.960 → 3.623, 6/6 Brier wins | Research only; no exact-price ledger |

## What is now answered

All canonical prop families have an explicit current decision. Six previously unsupported outputs now have successful independent research foundations: Passing TDs (modest), Longest Pass, Longest Reception, Longest Rush, Field Goals Made, and Kicking Points. Four new-family candidates were correctly rejected or held: Interceptions, Rushing + Receiving Yards, Player Touchdowns, and First Touchdown.

The market reader remains separate. The retained five-week exact ledger has opening/current lines and prices for its canonical scopes, but line movement did not establish a statistically reliable flip rule. Market movement may therefore flag, confirm, hold, or demote once a rule earns chronological evidence; it cannot rewrite the independent projection or any locked record.

## Exact smallest blockers to production expansion

1. Retain a release-pure full-board offer universe with exact line, price, book, observation time, eligible nonoffers, lock time, and official outcome for each new family. Without that, side economics, calibration at offered lines, promotions/demotions, and board size cannot be measured.
2. Add licensed route participation, alignment, red-zone routes, and end-zone targets for the receiving and touchdown allocation families. SportsDataIO Advanced Metrics is the first diligence target; Sportradar is second.
3. Replace upper-tail-compressing single-target models for combined yards and touchdown counts with predeclared component/joint distributions.
4. Calibrate First Touchdown's game-level residual mass before player allocation and require complete offer-universe coverage.

Until those dependencies are present and settled, production remains unchanged. This is a safety boundary, not a return to market anchoring.

