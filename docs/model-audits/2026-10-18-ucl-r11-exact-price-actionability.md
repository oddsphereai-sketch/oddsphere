# UCL r11 exact-price actionability correction

Date: 2026-10-18

## Scope

- Competition: UEFA Champions League only.
- Affected layer: future-unlocked Match Result bet grade only.
- Incumbent calibration: `ucl_grade_policy_2026_10_14_r10_agreement_probability_band`.
- Candidate calibration: `ucl_grade_policy_2026_10_18_r11_exact_price_actionability`.
- Preserved: r8u model, coherent score distribution, selected prediction,
  probability, target-excluded market reader, current price, Total, BTTS,
  Double Chance, stake, writer, cadence, shared soccer lease and every lock.

## Root cause

R10 intentionally required a 60%-70% forecast, target-excluded consensus
agreement, evaluated-book agreement and a quote above -600. The production
publication contract separately requires every actionable exact-price market
to have positive expected value. The Match Result grade omitted that last
condition, so three otherwise coherent winner forecasts blocked publication of
the entire upcoming UCL board.

R11 computes expected value from the unchanged forecast probability and exact
forecast-side quote. Positive EV keeps the existing Lean. Zero or negative EV
keeps the same forecast side and projection but returns Watchlist.

## Exact current-board rehearsal

The read-only 2026-10-18 rehearsal covers 18 fixtures and 72 markets. Before
the correction there were 13 actionables and three nonpositive-EV Match Result
Leans:

| Matchup | Pick | Probability | Price | Exact EV |
|---|---|---:|---:|---:|
| Villarreal at Liverpool | Liverpool | 66.94% | -206 | -0.56% |
| RB Leipzig at Real Madrid | Real Madrid | 69.37% | -374 | -12.08% |
| LASK at Sporting CP | Sporting CP | 66.88% | -448 | -18.19% |

R11 produces 10 actionables, zero nonpositive-EV actionables, zero forecast-side
changes, zero probability changes and zero score changes. Four positive-EV
Watchlists were also inspected; none satisfies the existing validated 60%-70%
Match Result agreement lane or a separately validated actionable Double Chance
lane, so promoting one merely to offset the three corrections was rejected.
This board-count contraction is explicit and limited to unsafe exact-price bet
grades; the underlying predictions remain present.

## Validation and rollback

Required before publication: focused UCL grade and publication tests, the live
readiness replay, TypeScript, `npm run verify:model-change`, current-main
integration safety, protected PR checks and post-deploy proof of the r11 release,
complete board, shared lease and unchanged locked records.

Roll back future-unlocked grading to r10 if r11 changes a selected side, score,
probability, reader output or locked payload, or if any nonpositive-EV actionable
survives the publication gate.
