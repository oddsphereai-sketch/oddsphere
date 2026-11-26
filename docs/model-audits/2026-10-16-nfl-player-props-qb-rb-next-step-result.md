# NFL player props: quarterback and running-back next-step result

Date: 2026-10-16

Mode: read-only independent-model research; zero production writes

## Decision summary

The quarterback and running-back markets were evaluated separately from the market reader. The
independent point model, independent outcome distribution, exact offered-line probability, exact
price economics, and current-board impact are separate gates. No candidate is promoted merely
because it makes the board flatter or produces more plus-money selections.

| Prop | Independent-model decision | Current-season/exact evidence | Production decision |
|---|---|---|---|
| QB Passing Attempts | Retain the released model | Five point/distribution challengers fail either current-season point accuracy or exact probability gates | Unchanged |
| QB Passing Completions | Retain attempts × shifted completion rate | Released model improves exact MAE 12.33 → 7.29 and Brier 0.574 → 0.437; the new quintile distribution has an uncertain CRPS interval and worse 2025 NLL | Unchanged |
| QB Passing Yards | Retain completions × shifted yards/completion | Receiver aggregation worsens exact MAE 66.43 → 66.80; the new quintile distribution is uncertain and worsens the exact QB slice | Unchanged |
| QB Passing TDs | Retain Poisson HGB research foundation | 2025 MAE 0.964 → 0.924, deviance 1.177 → 1.110, 4/4 Brier wins; 2026 directionally improves but intervals cross zero | Research only; no exact offered-price ledger |
| RB Rushing Attempts | Preserve the validated released model | Mean-quintile residuals improve 2025 CRPS with CI below zero, but the exact RB slice worsens Brier 0.1885 → 0.2084, loses one direction, and loses 1.79u | Unchanged |
| RB Rushing Yards | Preserve the validated released model | Alternative residuals improve exact probability scoring but do not improve RB direction or exact-price units; the active point release already passed its required gates | Unchanged |
| RB Receptions | Reject the mean-quintile residual candidate | Full-market exact replay improves, but the RB slice worsens Brier 0.2593 → 0.3158, loses one direction, and loses 1.65u | Unchanged |
| RB Receiving Yards | Reject the mean-quintile residual candidate | RB exact Brier worsens 0.4206 → 0.4224 with no side or unit improvement | Unchanged |
| RB Rushing + Receiving Yards | Retain the opportunity-efficiency joint model as the new independent foundation | 2026 Weeks 2-5 passes MAE, RMSE, bias, five threshold Brier, and clustered uncertainty gates | Research ready; no exact offers in the retained board |

## Distribution conditioning exact replay

The residual-distribution tournament was frozen on 2024 and confirmed on 2025 before the exact
Week 5 replay. Its mean-quintile candidate had statistically reliable 2025 CRPS gains for Rushing
Attempts, Rushing Yards, Receptions, and Receiving Yards. Exact replay was then used only as an
external rejection gate.

The candidate is not a general RB upgrade:

- RB Rushing Attempts: four exact rows, direction 4-0 → 3-1, Brier 0.1885 → 0.2084, units +3.48u → +1.70u.
- RB Rushing Yards: nine exact rows, direction remains 4-5 and units remain -1.44u; Brier improves 0.3397 → 0.2172. Better confidence without better selections is insufficient to replace the validated live release.
- RB Receptions: six exact rows, direction 4-2 → 3-3, Brier 0.2593 → 0.3158, units +0.95u → -0.70u.
- RB Receiving Yards: six exact rows, direction remains 2-4 and units remain -2.21u while Brier slightly worsens.

The full Receptions market improved by four directions and 9.97u, but that gain is not an RB result
and cannot be selected after seeing the exact replay. It requires a newly frozen, position-aware
candidate and a prospective result window. The three QB distributions are also rejected: on the
14 exact QB rows they worsen Brier 0.2683 → 0.2961, lose three directions, and lose 5.57u.

## Rushing + Receiving Yards component/joint result

The joint model separately predicts rushing opportunity, target opportunity, yards per carry, and
yards per target, then samples position-conditioned paired rushing/receiving residuals. It uses no
sportsbook input. The 2025 selection chose the opportunity-efficiency HGB over the direct raw and
log-smear component variants.

On 982 eligible 2026 Weeks 2-5 player-games:

| Metric | Foundation | Joint candidate | Change |
|---|---:|---:|---:|
| Mean projection (actual 40.23) | 40.34 | 39.89 | candidate bias -0.35 |
| MAE | 24.5370 | **23.7269** | **-0.8101** |
| RMSE | 32.4960 | **31.0596** | **-1.4364** |
| Average threshold Brier | 0.15097 | **0.14218** | **-0.00879** |
| Threshold Brier wins | — | **5 of 5** | pass |

The 63-game paired bootstrap excluded zero in the improving direction for every frozen interval
gate: MAE -1.371 to -0.226, RMSE -2.157 to -0.702, and average threshold Brier -0.01342 to
-0.00396. This fixes the upper-tail compression that caused the earlier single-target log model to
fail RMSE.

The candidate is not production-authorized. The current product and retained Week 5 exact board do
not contain Rushing + Receiving Yards offers, so there is no release-pure exact-price calibration,
economics, or same-input promotion/demotion report. When exact offers are retained, this model is
the predeclared foundation to score; it should not be refit after seeing those outcomes.

## Market reading remains separate

The source-aware market reader remains qualified only for Receptions. Passing Attempts,
Completions, Passing Yards, Receiving Yards, Rushing Attempts, and Rushing Yards all failed their
source-aware replay gates. Line or price movement may confirm, flag, or demote a future independent
selection after a rule earns chronological evidence; it may not rewrite the independent projection.

## Next frozen work

1. Keep the live Rushing Attempts and Rushing Yards point releases unchanged.
2. Freeze a position-aware Receptions distribution before the next settled window; the opened
   full-market Week 5 gain is hypothesis evidence only.
3. Add complete route participation/alignment entitlement before another RB Receiving Yards or
   receiving-opportunity challenger.
4. Capture exact Rushing + Receiving Yards offers, prices, timestamps, nonoffers, and outcomes, then
   run the already-frozen joint model without refitting.
5. Keep QB work on opportunity/game-script and pregame role stability. Do not train toward random
   in-game exits or use the offered market line as a hidden accuracy feature.
