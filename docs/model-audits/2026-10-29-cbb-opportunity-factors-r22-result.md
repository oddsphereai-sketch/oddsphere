# Private CBB r22 opportunity-weighted Four Factors: result

Decision: **reject both variants**. This experiment does not improve the
unpublished r2 model, and no production CBB model, score, market pick, grade,
stake, reader, writer, cron, or locked record changes. It tests the two fixed
variants declared in
`2026-10-29-cbb-opportunity-factors-r22-predeclaration.md`.

The existing r2 score head uses unweighted game-level Four-Factor rates.
R22 instead pools actual shot, possession and rebound opportunities from
strictly earlier accepted game boxes; the second variant also applies r2's
90-day recency weight. Both replace only the eight factor-feature slots, then
refit the correction head on 2023 and compare the exact same 2024 games.
An already-opened 2025 replay is included for stability, not untouched proof.

| Season / model | Winners | Margin MAE | Total MAE | Brier | Corrected / harmed winners vs r2 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2024 r2, 5,710 games | 4,113 | 9.24204 | 12.90614 | 0.181406 | — |
| 2024 pooled opportunities | 4,111 | 9.24357 | 12.90500 | 0.181422 | 6 / 8 |
| 2024 pooled + 90-day recency | 4,102 | 9.24516 | 12.91083 | 0.181501 | 9 / 20 |
| Opened 2025 r2, 5,721 games | 4,112 | 9.27887 | 13.63783 | 0.180016 | — |
| Opened 2025 pooled opportunities | 4,108 | 9.27978 | 13.64119 | 0.180042 | 9 / 13 |
| Opened 2025 pooled + 90-day recency | 4,111 | 9.27727 | 13.63299 | 0.179986 | 16 / 17 |

The 2024 pooled variant's 0.001-point Total MAE change is far too small to
matter and comes with two lost winners, a worse margin MAE, and worse Brier.
The recency variant worsens all four 2024 measures. On opened 2025, the
recency variant's tiny score/probability gains come with one lost winner.
Mean absolute predicted margin and Total shifts are only 0.075/0.127 points
for pooling and 0.122/0.212 for recency weighting in 2024. This directly
falsifies the narrow idea that equal game weighting of these rates is the
main cause of the 9/13-point score errors. It does not prove that Four Factors
are unimportant—the r21 removal ablation showed the opposite—or that a
different pregame efficiency source could not help.

All 5,710 and 5,721 games are retained, including 66 incomplete-input
forecasts in each season. The audit requires game identity and as-of checks,
regenerates the 2023/24 r2 feature arrays from source game/box/venue receipts
with SHA-256 parity, and reproduces r2's exact aggregate on 2025 before
comparing variants. The machine-readable local report is
`/private/tmp/oddsphere-cbb-data/opportunity-factors-r22-report.json` and
contains the clean source commit and input hashes. There are zero production
writes. Neither 2024 nor 2025 is an unopened holdout; no future accuracy gain
is claimed.

The evidence leaves no qualified input or mathematics change to activate from
r21 or r22. A new direction must be justified by a pregame variable that
predicts the remaining efficiency residual, not by further tuning a
negligible denominator-weighting delta. Any such proposal must pass exact
Moneyline/Spread/Total quotes, coherent final scores, grade-board impact,
chronological testing and the full model-change safety protocol before
publication.
