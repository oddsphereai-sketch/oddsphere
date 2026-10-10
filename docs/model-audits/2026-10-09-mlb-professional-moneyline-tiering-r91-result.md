# MLB professional Moneyline tiering r91 — audit result

Date: 2026-10-09

## Decision

The r91 candidate passes the declared professional-market-reader standard for
future unlocked MLB Moneylines. It is a tier-arbitration release, not a side
selector or projection rewrite. It keeps the independent model, selected side,
probability, offered price, projected score, Total, first-inning decision, and
stake unchanged.

The candidate is not yet a production release. Publication still requires an
owner-approved clean commit, the model-change verifier, integration-safety
proof against the latest remote `main`, protected pull-request checks, merge,
and post-merge live verification.

## What the loss and price audit found

The main weakness was not insufficient flipping. A broad reverse-the-market
rule would have made the reviewed conflict cohort worse: original selections
with both adverse movement and split conflict went 6-2, while the opposite-side
counterfactual went 2-6.

The material mismatch was public tier quality:

| Existing cohort | Rows | Record | Units | Finding |
| --- | ---: | ---: | ---: | --- |
| Tight market-price Best Angle | 74 | 44-30 | -0.057 | Directionally useful, but not strongest-tier price quality |
| Tight cohort, exact edge below zero | 70 | 40-30 | -2.799 | Retain as Lean |
| Tight cohort, exact edge at least zero | 4 | 4-0 | +2.742 | Retain as Best Angle |
| Confidence/value/score/market Lean | 61 | 46-15 | +9.795 | Promote to Best Angle without widening the rule |
| Neutral 70/70 SharpAPI Best Angle | 8 | 5-3 | -0.098 | All eight were below exact offered-price break-even; retain as Lean |

The promoted confidence/value cohort remained positive in all three declared
chronological blocks: 12-2 (+4.056u), 23-8 (+4.577u), and 11-5 (+1.162u).
Because the 2026 archive had already been opened during the audit, these are
retrospective diagnostics rather than a pristine holdout or a promised future
hit rate.

## Candidate impact

Across the audited historical cohorts, the strongest-tier composition changes
from 82 rows at 49-33 and approximately -0.155u to 65 rows at 50-15 and
approximately +12.536u. The other 78 rows do not disappear: they remain Lean.
Thus the actionable board count is unchanged, while Best Angle means something
materially stronger.

Within the current r90 release evidence, the two qualifying tight-price rows
on 2026-10-07 (LAD at ATL and TB at NYY) would have changed from Best Angle to
Lean because their exact price edges were -0.971pp and -0.554pp. One won and
one lost. Their sides, probabilities, prices, projected scores, and
actionability would not have changed. There is no October 9 MLB game slate to
mutate, and locked records remain immutable in every case.

## Professional-reader coverage

The candidate preserves the already audited MLB architecture:

- target-excluded, two-sided evaluated prices;
- same-book opening-to-current chronology with stale or incomplete trails
  rejected rather than inferred;
- exact offered-price economics;
- independent probability and score-direction coherence;
- movement as directional evidence, not an automatic truth signal;
- verified SharpAPI split provenance when present and neutral handling when
  absent;
- correction, cap, starter, lineup, and data-completeness blockers;
- separate full-game Moneyline, Total, and first-inning heads;
- immutable locked snapshots and the shared sport-scoped writer lease.

The research boundary and source links are recorded in the paired
predeclaration. No evidence supports a generic late-move rule or broad
Moneyline flip.

## Verification

- `scripts/test-prediction-record-service.ts`: 390 passed, 0 failed.
- `scripts/test-mlb-pipeline-safety.ts`: 74 passed, 0 failed.
- The complete `verify:model-change` command chain passed, including every
  shared NFL, CFB, NHL, WNBA, EPL, UCL, props, lock, tracking, and writer
  regression suite.
- End-to-end tests prove the promoted cohort retains its model side and
  projected-score direction, negative-exact-value tight-price rows remain
  Lean, and neutral 70/70 consensus requires non-negative exact value for Best
  Angle.
- Machine-readable release, calibration, rule-bundle, component, and grade
  policy identifiers are bumped together.

## Release identifiers

- calibration: `mlb_public_calibration_v37_professional_moneyline_tiering_2026_10_09`
- decision: `mlb_daily_edge_decision_2026_10_09_r91_professional_moneyline_tiering`
- rule bundle: `mlb_daily_edge_rule_bundle_v76_professional_moneyline_tiering_2026_10_09`
- grade policy: `mlb_public_grade_policy_v60_professional_moneyline_tiering_2026_10_09`

Rollback restores r90/v75/v36/v59 for future unlocked rows only. It must never
rewrite, suppress, or reinterpret a stored locked payload.
