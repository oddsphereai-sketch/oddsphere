# MLB production release reconciliation r62

Date: 2026-08-21
Mode: production candidate, no database writes during audit
Authoritative writer: `lib/services/predictionRecordService.ts`

## Incident boundary

Production r61 correctly contained the August 20 first-inning bridge, but its
base did not contain the separately tested r48/r54/r55 Moneyline and Total
release line. This was behavioral, not merely stale registry text. Production
was missing the raw-side Moneyline champion, guarded Total residual champion,
model-coherent Moneyline market-context policy, and both confidence/value/context
Lean paths.

r62 reconciles those layers on the exact production r61 mainline. It does not
restore an older first-inning implementation and does not copy a dirty working
tree. The r61 first-inning probability head remains
`mlb_first_inning_fi_v4_market_backed_weight25_2026_08_20`.

## Restored evidence

The restored rules retain their frozen chronological evidence:

- Moneyline confidence/value/context: 39-16 overall, 11-4 development,
  11-4 validation, and 17-8 holdout; the incremental previously nonactionable
  cohort was 28-12 and +2.636 units.
- Total confidence/value/context: 48-32-2 overall, 25-21-1 development,
  9-4 validation, and 14-7-1 holdout; the incremental previously
  nonactionable cohort was 17-10 and +4.154 units.
- The r48 Moneyline exact-price replacement improved paired units by +5.028 in
  validation and +3.922 in the latest test window. Changed forecast sides do
  not inherit incumbent-side actions.
- The r48 Total residual head improved combined accuracy from 52.9% to 54.0%
  across 278 validation/latest rows and improved Brier and log loss in both
  windows. Changed Total sides remain nonactionable until independently
  qualified.
- The r54 Moneyline market-context correction paired one current-board
  demotion with one existing-rule promotion for zero net actions and prevents
  movement/splits from manufacturing an opposite-side probability.

The source reports are preserved in the r48, r54, and r55 audit documents
included with this release.

## August 21 paired board impact

The exact r61 production writer and r62 candidate writer were run read-only
against the same 15-game database slate.

| Market | r61 actionable | r62 actionable | Promotions | Demotions | Side changes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Moneyline | 3 | 5 | 2 | 0 | 5 |
| Total | 0 | 1 | 1 | 0 | 0 |
| First inning | 9 | 9 | 0 | 0 | 0 |

All five Moneyline side changes came from the scoped probability champion and
were nonactionable before the change. Four remained nonactionable; one earned
action only through the separate confidence/value/context gate. No old-side
action was transferred. All 15 first-inning picks, probabilities, and grades
were identical.

## Release and rollback

- schema: `mlb_model_layer_versions_v5`
- calibration: `mlb_public_calibration_v23_reconciled_market_champions_2026_08_21`
- decision: `mlb_daily_edge_decision_2026_08_21_r62`
- rule bundle: `mlb_daily_edge_rule_bundle_v51_2026_08_21`
- grade: `mlb_public_grade_policy_v41_reconciled_market_context_2026_08_21`
- correction: `mlb_prediction_corrections_v15_reconciled_market_context_grade_only_2026_08_21`

Rollback is the complete r61 release family. Locked rows remain immutable and
must continue to be evaluated by their stored release identifier and lock
timestamp.

## Verification gates

- focused immediate-market champion tests
- focused MLB pipeline-safety tests
- focused prediction-record writer tests
- `npm run verify:model-change`
- clean intentional commit and production release/readback verification
