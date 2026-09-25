# NFL weekly representative-score dispersion result

Date: 2026-09-25

Status: qualified for production release.

Tournament: `nfl_weekly_representative_score_tournament_2026_09_25_r1`

## Result

The frozen 2023 selection chose center weight `0.20`. Instead of rounding the
two expected team scores independently, the selected point functional chooses
the winner-consistent, parity-valid score pair that balances positive marginal
margin/total likelihood with distance from the same distribution centers.

This is not a forced-margin rule. It changes no distribution, probability,
prediction side, evaluated quote, grade, stake, promotion, demotion, or board
count.

| Sample | Metric | Incumbent | Candidate |
| --- | --- | ---: | ---: |
| 2023 selection (272) | Team-score MAE | 7.3162 | 7.2739 |
|  | Margin MAE | 9.9265 | 9.8713 |
|  | Total MAE | 10.2279 | 10.1360 |
|  | Winner accuracy | 68.0147% | 68.0147% |
|  | Abs. margin ≤2 | 19.1176% | 18.3824% |
| 2024 confirmation (272) | Team-score MAE | 7.0717 | 7.0772 |
|  | Margin MAE | 9.5772 | 9.5956 |
|  | Total MAE | 9.7243 | 9.7279 |
|  | Winner accuracy | 71.3235% | 71.3235% |
| 2025 confirmation (272) | Team-score MAE | 7.2518 | 7.2390 |
|  | Margin MAE | 9.7463 | 9.6838 |
|  | Total MAE | 10.3934 | 10.3971 |
|  | Winner accuracy | 65.4412% | 65.4412% |
| 2024–25 pooled (544) | Team-score MAE | 7.1618 | 7.1581 |
|  | Margin MAE | 9.6618 | 9.6397 |
|  | Total MAE | 10.0588 | 10.0625 |
|  | Abs. margin ≤2 | 18.3824% | 17.2794% |

Observed 2024–25 absolute margins at most two points occurred in 11.0294% of
games. The candidate moves toward that rate while preserving all frozen error
and structural gates. All 816 selected/confirmed scores are nonnegative,
non-tied, parity-valid, winner-consistent, and positively supported by both
released marginal distributions.

## Current-board replay

The isolated 16-game replay changes 12 displayed score pairs and reduces
one-or-two-point projected margins from five games to four. It preserves 16/16
score/winner identities and all 48 Moneyline, Spread, and Total predictions.
Because the distributions and decision inputs are byte-identical, promotions,
demotions, side changes, probability changes, grade changes, and actionable
board-count changes are all `0`.

## Release and rollback

- Weekly outcome model:
  `nfl_v1_weekly_market_anchored_outcome_2026_09_25_r6_marginal_likelihood_score`
- Production model:
  `nfl_v1_daily_edge_model_2026_09_25_r16_marginal_likelihood_score`
- Representative score:
  `nfl_v1_market_evidence_representative_score_2026_09_25_r5_marginal_likelihood`
- Member / collector / writer / fixture / compact snapshot:
  `nfl_v1_member_release_2026_09_25_r19_marginal_likelihood_score` /
  `nfl_forward_evidence_collector_2026_09_25_r10_marginal_likelihood_score` /
  `nfl_forward_evidence_writer_2026_09_25_r39_marginal_likelihood_score` /
  `nfl_weekly_member_fixture_2026_09_25_r28_marginal_likelihood_score` /
  `nfl_forward_member_snapshot_2026_09_25_r20_marginal_likelihood_score`

The released margin/total distributions, probabilities, calibration, decision,
grade, target-exclusion, tracking, and coherence identifiers remain unchanged.
The prior r18/r21 immutable T-60 authority and r19 compact snapshot remain
explicit bounded transition fallbacks. Roll back by restoring the preceding
weekly/production/representative/member publication family; never rewrite
locked evidence.
