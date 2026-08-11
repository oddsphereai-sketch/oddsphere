# MLB Total Under market-anchored sleeve — r35

Date: 2026-08-11

Scope: MLB full-game Total grades in the authoritative member-facing writer

Decision release: `mlb_daily_edge_decision_2026_08_11_r35`

Rule bundle: `mlb_daily_edge_rule_bundle_v34_2026_08_11`

Grade policy: `mlb_public_grade_policy_v26_market_anchored_total_under_2026_08_11`

Rule: `total_under_low_ticket_resistance_lean_v2_market_anchored_2026_08_11`

## Reason for the change

The r30 sleeve was discovered as a market-only pattern, then guarded in production by model
probability, offered-price edge, projection, price, source, and quality requirements. A broader
audit of every settled non-launch MLB full-game row found that two model-derived guards were not
protective inside the already narrow market cohort. The exact incremental rows rejected only by
the 55% model-probability and nonnegative/sub-five-point edge requirements went 8-1 across seven
dates, +5.727 units and +63.6% ROI. They were 4-1 in training, 2-0 in validation, and 2-0 in the
chronological holdout. A 20,000-iteration date-cluster bootstrap had a +33.8% fifth-percentile ROI.

The larger market-only family—model-selected Under, -145 through -105, at most 35% of tickets,
and selected-side SharpAPI money at least five points below tickets—went 28-6 across 23 dates.
The prior r30 audit's outcome-permutation placebo within eligible moderate-price Unders was
`p=0.00144`. The new audit independently rediscovered this family while testing 3,189 market-only
and 4,466 weak-model Total candidate row sets. It also found that stale evidence and movement
against the pick were not reliable expansion paths, and that opposite-side Total flips lost.

## Production contract

The sleeve remains promotion-only and Lean-only. It requires:

1. the frozen final side is Under;
2. no existing hold, missing-price failure, correction, no-bet, or Best Angle has priority;
3. the selected price is -145 through -105;
4. high data quality and same-side projection alignment;
5. an exact frozen SharpAPI selected-side split row;
6. selected-side tickets at most 35%; and
7. selected-side money minus tickets at most -5 percentage points.

Model probability and model-versus-price edge are retained in the record as context but are not
eligibility gates for this market-defined sleeve. The rule does not change the side, probability,
projection, price, units, or Best Angle status. It does not substitute Playbook/consensus splits
for SharpAPI and does not override projection conflict or any existing no-bet reason.

## Paired-board and operational safety

The writer remains `lib/services/predictionRecordService.ts` and continues to run under the
sport-scoped shared `prediction_pipeline` lease. The change introduces no writer, provider call,
or refresh path. The paired current-slate dry run produced all 45 expected records across 15 games
with zero errors and zero held/skipped markets. Every record carried the same
r35/rule-bundle-v34/grade-policy-v26 stamp. Relative to the same-data r34 policy, Milwaukee at
San Diego Under 7.5, -113 is the sole added Lean; its 54.4% model probability was the unsupported
blocker removed by this release. Moneylines and first inning are unchanged by the policy, and the
board delta is one Total Lean with zero demotions.

Roll back to r34/rule-bundle v33/grade-policy v25 if the rule activates on an Over, outside the
price/ticket/gap band, without exact SharpAPI evidence, on low-quality or projection-opposed data,
or if any side, probability, price, stake, other market, or locked historical row changes.
