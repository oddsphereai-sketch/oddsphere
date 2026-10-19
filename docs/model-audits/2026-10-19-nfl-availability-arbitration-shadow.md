# NFL availability arbitration shadow

Date: 2026-10-19

Status: internal prospective evidence candidate; zero production decision authority.

## Contract

The sole NFL forward writer retains the r28 model, r27 calibration, and r36 decision/grade family.
It additionally stores two internal fields on future unlocked payloads:

- the exact-provider market-free score before any downstream market correction; and
- `nfl_availability_arbitration_shadow_2026_10_19_r1`, which observes only verified starter
  replacement, player-aware winner direction, and the target-excluded professional Moneyline read
  produced inside the existing exclusion loop.

The shadow becomes `qualified_agreement` only when the verified injury report changed the expected
quarterback, the player-aware score and target-excluded professional Moneyline read agree, and that
winner conflicts with the exact-provider winner. Disagreement, missing evidence, or no verified
starter replacement remains neutral. The qualification records whether production reached a stable
target-excluded tuple and is explicitly scoped to the last exclusion-loop iteration; it is not
promotion-ready evidence for a different evaluated quote.

## Safety boundary

- `shadowOnly` is always true and `productionDecisionEffect` is always false.
- The existing professional market authority implementation and cross-market guard are unchanged.
- The independent model, Total, distributions, probabilities, sides, grades, promotions, demotions,
  actionable count, stakes, member presentation, locks, tracking, cadence, provider calls, and shared
  `prediction_pipeline:nfl` lease are unchanged.
- Existing locked payloads are never backfilled or reconstructed.
- Collector/writer releases advance to r24/r65 only so future evidence can be separated from the r23/r64
  starter-authority predecessor.

Rollback means stopping the optional shadow fields for future rows and restoring r23/r64 publication.
It never deletes or rewrites an already stored payload.
