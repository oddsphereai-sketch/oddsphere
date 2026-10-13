# EPL coherent Total/margin r20 result

Date: 2026-10-13

Candidate release: `epl_goals_coherent_2026_10_13_r20_coherent_total_margin_matchup`

Professional score component:
`epl_professional_score_2026_10_13_r1_total_margin_matchup`

Grade release: unchanged
`epl_grade_policy_2026_10_10_v25_exact_match_result_price_tiering`

## Decision

R20 passes the historical score/probability gates and the current-board
no-flattening gate. Publication remains conditional on focused tests, full
model-change verification, current-main integration safety, protected PR
checks, deployment, and live release/reader/writer/lock proof.

## Frozen construction

- The r19 projected Total is retained exactly.
- A prior-match-only attack/defence model uses 365-day time decay, ten-match
  shrinkage, 20% xG target weight when available, and a 30% bounded process
  contribution from shots, shots on target, possession, and available xG.
- Final margin is 75% professional matchup margin and 25% r19 margin.
- Home and away lambdas are reconstructed from that one Total and margin.
- One Dixon-Coles distribution with tau -0.15 derives Match Result, Double
  Chance, Total, BTTS, likely score, representative score, and decimal expected
  scores.
- The r19 draw arbitration and v25 exact-price grade policy remain unchanged.
- No sportsbook quote, split, movement, evaluated target, or future outcome is
  an independent-model feature.

## Chronological evidence

Protocol: 2022-2023 foundation, 2024 candidate selection, 2025 untouched
holdout. The 380-match untouched holdout changes:

| Metric | r19 | r20 |
|---|---:|---:|
| Match Result accuracy | 48.95% | 50.00% |
| Match Result Brier | 0.61651 | 0.61311 |
| Match Result log loss | 1.02691 | 1.02126 |
| Team-score MAE | 0.89999 | 0.89790 |
| Total MAE | 1.24131 | 1.24134 |
| Margin MAE | 1.22053 | 1.20760 |
| Total accuracy | 56.05% | 56.05% |
| BTTS accuracy | 55.26% | 55.53% |
| BTTS Brier | 0.24631 | 0.24616 |
| Margin correlation | 0.34307 | 0.36142 |

The complete r20a replacement and the r20b 33-feature Poisson regression both
failed and are not production behavior.

## Exact current-board replay

Read-only replay of the current ten-game board:

- markets: 30 to 30;
- actionable plays: 8 to 8;
- promotions: zero;
- demotions: zero;
- Match Result side changes: three, all non-actionable;
- Total actionables: four to four;
- BTTS actionables: four to four; and
- no new provider request path or database write loop.

The final replay used the corrected production runtime and the current quote
set. It proves the release does not flatten the current board.

## Immutable and operational boundaries

Prior r19 locks remain the public record and readers continue to prefer each
locked row's own release tuple. R20 applies only to future unlocked writes.
The existing `epl_daily_refresh` and targeted T-60 lock remain the sole writers
under the shared `prediction_pipeline:soccer` lease. Historical foundation and
current-stat request budgets are unchanged.

Rollback restores r19 for future unlocked rows while preserving every r19 or
r20 lock unchanged.
