# NFL player props team-target allocation result

Date: 2026-10-08  
Decision: retain r1 as the complete foundation; retain team-wide allocation as the receiving point challenger

## Historical gates

Both receiving markets selected a 75% team-wide allocation increment on 2024 and confirmed on
2025. The candidate improved point error and bias while retaining every historical row:

| Market | r1 2025 MAE / RMSE / bias | Team-wide MAE / RMSE / bias |
| --- | ---: | ---: |
| Receptions | 1.44642 / 1.90850 / -0.19922 | **1.43868 / 1.88994 / -0.16551** |
| Receiving Yards | 19.32129 / 26.63466 / -2.12257 | **19.23808 / 26.41080 / -1.68449** |

The result supports the structural hypothesis: forecasting one team target budget and allocating it
across the whole active receiving corps is more accurate than independently forecasting BACK, WR,
and TE budgets.

## Exact 2026 replay

Coverage remained 207/207 locked scopes. Relative to r1:

| Market | MAE delta | RMSE delta | Bias improvement | Direction delta | Brier delta |
| --- | ---: | ---: | ---: | ---: | ---: |
| Receptions | **-0.09424** | **-0.14097** | +0.15396 | -5.17 pp | **-0.00879** |
| Receiving Yards | **-0.45066** | **-0.57522** | +1.39535 | +1.39 pp | +0.00667 |
| Complete board | **-0.18316** | **-0.25937** | +0.52848 | -0.97 pp | **-0.00014** |

The complete board improves point MAE, RMSE, bias, and Brier, but its direction regression violates
the frozen gate. Receptions improves point error and Brier but regresses direction; Receiving Yards
improves point error and direction but regresses Brier. The candidate therefore does not replace r1
as the complete independent foundation and is not productionized.

## Cumulative use

The team-wide target allocator is retained as the leading receiving **point-model challenger** for
the next probability/distribution iteration. That iteration must calibrate a coherent conditional
distribution around the improved mean and must pass without borrowing target lines or prices as
model features. Until then, r1 remains the authoritative research foundation and production remains
unchanged.

