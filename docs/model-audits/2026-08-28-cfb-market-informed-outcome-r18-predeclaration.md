# CFB market-informed outcome forecast r18 predeclaration

Date: 2026-08-28

Status: frozen before current-board scoring; no production behavior change

## Problem and scope

The active CFB product exposes a leakage-safe independent football score PMF,
but its exact-price grade heads are separately calibrated against the market.
On the current Hawaii-Stanford row, the independent PMF says Hawaii by 7.8 and
67.3% to win while the calibrated exact-price moneyline head assigns Hawaii
40.0%. The moneyline can still be positive value at +152 while Hawaii +4 is
negative value at -108, but displaying the independent score as the primary
game prediction makes the three outputs look contradictory.

This candidate changes only the public outcome-forecast axis. It promotes the
already frozen coherent market-informed joint PMF from the r9-r13 tournament
as the primary score/winner forecast and preserves the football-only PMF as an
explicit secondary independent read. Existing exact-price decisions, grades,
prices, thresholds, tracking tuples, stakes and the single writer/lease remain
unchanged byte for byte.

## Frozen model

- Canonical anchor: median home spread and total from at least three complete
  conventional named books. Playbook line context may be a clearly identified
  fallback anchor but can never become a target sportsbook price. When the
  main cohort is sparse, one supported target book may define the anchor only
  when its exact Spread and Total lines are each corroborated by at least two
  distinct conventional non-target books; those corroborators never become
  user-facing offers.
- Residual distribution:
  `cfb_market_anchored_joint_score_artifact_2026_08_27_r4`, built from 1,111
  genuine 2021-2023 generic-pregame market residual pairs and centered/mirrored
  to 2,222 paired outcomes.
- Model / distribution / probability / representative score:
  `cfb_market_informed_joint_score_model_2026_08_27_r2` /
  `cfb_market_residual_joint_distribution_2026_08_27_r2` /
  `cfb_market_informed_joint_probability_2026_08_27_r2` /
  `cfb_market_informed_reachable_score_2026_08_27_r2`.
- Outcome contract release:
  `cfb_market_informed_outcome_contract_2026_08_28_r18`.

No split, price, movement or grade field is a football feature. The canonical
spread and total define the market-informed game mean; exact book prices remain
solely in the separate Bet-grade evaluation.

## Predeclared gates

1. Historical proper-score evidence must preserve the prior frozen r10-r12
   result: the generic market-informed coherent PMF is no worse than every
   tested nonzero linear, nonlinear and conditional football correction on
   repeated 2025 confirmation.
2. PMF mass, decimal expected team points, expected margin/total, winner
   probability, reachable representative score and all line probabilities
   must be recomputed from the identical PMF.
3. Expected-score winner, moneyline winner and non-tie representative-score
   winner must agree for all current games.
4. Current primary scores must be differentiated, plausible football scores,
   and centered on the canonical market margin/total rather than the current
   independent outliers.
5. Existing exact-price decision tuples must be byte-identical. Promotions,
   demotions and grade counts must therefore be exactly zero.
6. The member contract must label the primary forecast as market-informed and
   the secondary forecast as football-only. Neither may be presented as the
   exact-price Bet grade or as a SharpAPI split signal.
7. Missing canonical anchor fails the primary market-informed forecast closed
   while preserving the independent football read and per-market price health.

Current 2026 games are forward audit rows, not selection or threshold-tuning
data. No current board result may change the frozen model or gates above.
