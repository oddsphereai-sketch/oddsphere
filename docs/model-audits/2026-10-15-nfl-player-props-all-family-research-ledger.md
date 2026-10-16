# NFL player props: all-family independent-model research ledger

Date: 2026-10-16 (strict-chronology decisions updated)

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
| Passing TDs | Retain Poisson HGB research foundation after calendar-ordered confirmation | 578 QB-games in 2025; MAE 0.9643 → 0.9237, deviance 1.1766 → 1.1095, 4/4 Brier wins | Research only; confirmation was previously opened; no exact-price ledger |
| Interceptions | Keep pooled foundation; HGB is retrospectively validated but externally unresolved | 2025 improved MAE/deviance/Brier and 4/4 thresholds; already-inspected 2026 Weeks 2-5 reversed all three | Research only; new prospective decision window required |
| Rushing + Receiving Yards | Retain opportunity-efficiency HGB as the independent research foundation | 2025 selection confirmed on 982 current-season player-games: MAE 24.54 → 23.73, RMSE 32.50 → 31.06, 5/5 Brier wins; clustered intervals exclude zero | Research only; current season was previously opened and the retained board has no exact offers |
| Player Touchdowns | Reject Poisson-HGB candidate for count projection | 1,084 rows; deviance/Brier improved but MAE worsened with CI above zero | Research only |
| First Touchdown | Retain coherent hazard research foundation; evidence not conclusive | 63 games; point Brier/log loss improved, both bootstrap intervals cross zero | Research only |
| Longest Pass | Retain HGB-log research foundation after calendar-ordered confirmation | 602 QB-games in 2025; MAE 13.31 → 10.04, RMSE 16.94 → 13.70, 5/5 Brier wins | Research only; confirmation was previously opened; no exact-price ledger |
| Longest Reception | Hold HGB-log candidate; frozen bias gate failed | 3,456 player-games in 2025; MAE 10.97 → 7.08 and 5/5 Brier wins, but mean bias was -2.43 yards versus the -2.00 gate | Research only; prospective bias test required |
| Longest Rush | Hold Ridge-log candidate; frozen bias gate failed | 1,844 player-games in 2025; MAE 8.15 → 6.08 and 5/5 Brier wins, but mean bias was -2.33 yards versus the -2.00 gate | Research only; prospective bias test required |
| Field Goals Made | Hold Poisson GLM candidate; uncertainty gate failed | 562 kicker-games in 2025; all metrics and 4/4 thresholds improved, but the clustered MAE interval ended at +0.00020 | Research only; prospective confirmation required |
| Kicking Points | Retain decomposed Poisson GLM foundation after calendar-ordered confirmation | 562 kicker-games in 2025; MAE 3.107 → 2.982, RMSE 3.908 → 3.738, 6/6 Brier wins | Research only; confirmation was previously opened; no exact-price ledger |

## What is now answered

All canonical prop families have an explicit current decision. The strict chronology strengthens four market-free research foundations: Passing TDs, Rushing + Receiving Yards, Longest Pass, and Kicking Points. The later component/joint combined-yards architecture also clears every current-season accuracy and clustered-uncertainty gate, fixing the earlier upper-tail compression, but it still lacks exact offers. The QB/RB next-step evidence is recorded in `docs/model-audits/2026-10-16-nfl-player-props-qb-rb-next-step-result.md`. It also prevents false promotion: Longest Reception and Longest Rush miss their frozen bias gates, Field Goals Made misses its clustered-MAE gate, and Interceptions has contradictory 2025 and 2026 evidence. Player Touchdowns and First Touchdown remain held from their earlier tests.

These are retrospective decisions, not pristine confirmations. The earlier r1 work had already inspected 2025 and 2026, so none of the new chronology results may be labeled an untouched holdout. The next decisive evidence must come from outcomes generated after a new frozen declaration.

The market reader remains separate. The retained five-week exact ledger has opening/current lines and prices for its canonical scopes, but line movement did not establish a statistically reliable flip rule. Market movement may therefore flag, confirm, hold, or demote once a rule earns chronological evidence; it cannot rewrite the independent projection or any locked record.

## Exact smallest blockers to production expansion

1. Retain a release-pure full-board offer universe with exact line, price, book, observation time, eligible nonoffers, lock time, and official outcome for each new family. Without that, side economics, calibration at offered lines, promotions/demotions, and board size cannot be measured.
2. Add licensed route participation, alignment, red-zone routes, and end-zone targets for the receiving and touchdown allocation families. SportsDataIO Advanced Metrics is the first diligence target; Sportradar is second.
3. Retain complete exact Rushing + Receiving Yards offers so the validated component/joint model can receive probability, economic, and board-impact gates; continue component/joint work for touchdown counts.
4. Calibrate First Touchdown's game-level residual mass before player allocation and require complete offer-universe coverage.

Until those dependencies are present and settled, production remains unchanged. This is a safety boundary, not a return to market anchoring.
