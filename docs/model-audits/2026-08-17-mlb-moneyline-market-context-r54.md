# MLB Moneyline model-coherent market context — r54

Date: 2026-08-17

- Decision release: `mlb_daily_edge_decision_2026_08_17_r54`
- Rule bundle: `mlb_daily_edge_rule_bundle_v48_2026_08_17`
- Correction policy: `mlb_prediction_corrections_v14_market_context_grade_only_2026_08_17`
- Probability head retained: `mlb_moneyline_away_market_40_45_raw_side_champion_v1_2026_08_15`
- Rollback: r53, rule bundle v47, correction policy v13

## Problem

The legacy market-aware Moneyline selector treated any movement against the
model pick, opposing public-split conflict, or distance-cap flag as authority
to select the opposite team. It complemented the original raw probability,
then replaced that sub-50% probability with a cosmetic 55-60% recommendation
confidence and published the result as `model_probability`. A market signal
therefore created both a new prediction and an unsupported probability.

The ATH–KC oscillation exposed the architectural failure: the upstream model
continued to select KC, while changing prices repeatedly switched the public
record between KC and ATH. This was action-layer state churn, not a new model
forecast.

## Fresh locked-history replay

Run:

```bash
npx tsx --env-file=.env.local scripts/operator/audit-mlb-moneyline-market-context-r54.ts
```

The read-only audit reconstructed 93 legacy correction rows, 90 decided, from
931 locked MLB Moneyline records.

| Cohort | Legacy corrected | Original model side | Corrected units | Corrected Brier | Original Brier |
| --- | ---: | ---: | ---: | ---: | ---: |
| All decided | 49-41 (54.4%) | 42-48 (46.7%) | +12.352u | 0.2504 | 0.2549 |
| July | 29-17 (63.0%) | 17-29 (37.0%) | +15.788u | 0.2365 | 0.2741 |
| August | 20-24 (45.5%) | 25-19 (56.8%) | -3.436u | 0.2650 | 0.2349 |
| Current head, Aug 15+ | 3-3 (50.0%) | 4-2 (66.7%) | -0.134u | 0.2536 | 0.2342 |

Chronological partitions also failed to validate the legacy rule:

| Partition | Legacy corrected | Original side | Corrected units | Corrected Brier | Original Brier |
| --- | ---: | ---: | ---: | ---: | ---: |
| Development first 60% | 32-22 | 22-32 | +14.121u | 0.2427 | 0.2683 |
| Validation next 20% | 8-10 | 10-8 | -1.850u | 0.2623 | 0.2381 |
| Holdout last 20% | 9-9 | 10-8 | +0.080u | 0.2618 | 0.2315 |

The headline lifetime result was driven by the early development period and
did not survive chronology or compatibility with the current probability
head. The August line-movement-only cohort was 18-22 with -4.016u; its original
model sides were 23-17.

## Decision

Moneyline market context can now do exactly two things:

1. retain the independently modeled side; or
2. stand that side down when movement, split conflict, or an unconfirmed
   regularization cap makes it unsafe to act.

It cannot select the opposite team. The opposite side may still qualify only
through an independent, versioned prediction path: the existing inversion,
pick-calibration, or r48 raw-side probability champion. A side changed by the
raw champion still cannot inherit an old-side action.

The snapshot now stamps
`ml_market_context_side_policy.rule_id = mlb_moneyline_market_context_grade_only_v1_2026_08_17`
and records the retained side, rejected opposite candidate, reasons, and
effective retain/stand-down action. The legacy
`market_aware_side_correction` remains `null` for Moneyline. Total behavior is
unchanged.

## Board impact and promotion pairing

The August 17 unlocked-slate paired dry run produced one actionable demotion
(ATH to No Play on the original KC side) and one existing-rule promotion
(SD–NYM to Lean), for zero net action-count change. Two additional
market-manufactured opposite sides reverted to their original model side but
were already non-actionable, so they do not reduce the board.

The promotion half is not a new permissive exception. Existing validated
Moneyline promotion paths remain intact and are covered by the focused writer
tests: calibrated-model positive-EV Lean, tight-market Best Angle,
established-price Best Angle, near-market Lean, market-led movement Lean,
neutral consensus, and the source-aware portfolio ranker. Prices continue to
be evaluated against offered-price break-even probability; r54 adds no -120
or -200 ceiling.

## Verification contract

- `npm run verify:model-change`
- focused prediction-record writer tests
- read-only historical audit above
- current-slate paired dry run
- production build
- post-deploy release, writer coherence, cron, data coverage, and reader checks

Do not promote r54 if the live record carries a mixed release, if a Moneyline
row has a non-null market-aware side correction, or if the displayed side,
probability, and exact selected-side price are incoherent.
