# NFL player props Receptions completion-allocation result

Date: 2026-10-15
Decision: reject; retain the released independent Receptions head

The team-completion-budget × roster-normalized reception-share challenger improved the aggregate
point metrics, but it did not pass the predeclared stability gate.

The 50% identity ranked first on 2024, improving the released head from
`1.50218/1.99196` to `1.49763/1.97874` MAE/RMSE. On 2025 it also improved aggregate MAE/RMSE from
`1.43812/1.89277` to `1.43662/1.88674`.

Those averages conceal unstable time behavior. The 2025 game-clustered MAE-delta interval is
`[-0.00642, +0.00344]`; Weeks 1-4 and Weeks 10-13 regress while the other two fixed segments
improve. The candidate therefore was not frozen and the 2026 challenger gate was not opened.

The current released Receptions head remains `1.99760` MAE, `2.80473` RMSE, and `48.28%`
offered-line direction over the exact 58 stored offered scopes. The candidate has zero live weight
and zero board impact. No production release, probability, grade, stake, writer, lease, or locked
record changes.
