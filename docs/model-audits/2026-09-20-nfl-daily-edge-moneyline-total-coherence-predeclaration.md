# NFL Daily Edge Moneyline and generalized Total coherence predeclaration

Date: 2026-09-20

## Scope and incident

This audit is limited to NFL Daily Edge full-game Moneyline and Total prediction/grade behavior.
Spreads, player props, copy, labels, stakes, schedules, provider budgets, locks, tracking settlement,
and the single `prediction_pipeline:nfl` writer are controls.

The current 16-game Week 2 board has zero actionable Moneylines and a 15 Under / 1 Over Total
forecast mix. Read-only stage decomposition shows that all six still-qualified r6 market-led
Moneyline Leans agree with the published outcome winner but are discarded when the later
prediction-owned selector replaces their calibrated probability with the independent outcome
probability. The later-week Total fallback centers the pooled 16-game Week 1 Total distribution
at the market line; that distribution supplies only about 47.8% neutral Over probability and
therefore creates a reusable Under direction before game-specific evidence.

## Frozen Moneyline candidate

Restore the previously released direction-coherent r6 Moneyline tuple only when all of the
following are true: the r6 tuple is healthy, its side exactly equals the holistic Daily Edge
predicted winner, its frozen grade is Lean, its price remains inside the existing -300..+300
boundary, and its exact probability/quote/target-excluded fair probability/EV/edge remain one
coherent tuple. The holistic outcome winner continues to own the side and expected-score
direction. A conflicting r6 side cannot publish. The existing Best Angle rule remains an r6 Lean
with at least 2% EV and 4 percentage points of target-excluded edge. No new threshold is searched.

Historical evidence is the already-frozen direction-coherent r6 confirmation cohort: 72 actions,
54-18 and +16.080 units in 2024; 104 actions, 67-37 and +2.295 units in 2025; 176 pooled actions,
121-55 and +18.375 units. The 2026 Week 1 immutable T-60 cohort is a forward diagnostic, not a
threshold-selection set. It will be reported by exact release and locked timestamp before any
publication. Current board impact must include promotions, demotions, side changes, exact prices,
and prediction alignment. Any opposing-winner action or incoherent probability/price tuple rejects
the candidate.

## Frozen generalized Total candidate

The incumbent asymmetric pooled distribution and the rejected constant median shift are controls.
The candidate derives one target-excluded no-vig Over probability from fresh, complete, two-sided
same-line named-book prices. It translates the existing discrete Total distribution until its
non-push Over probability equals that market probability, then applies the already bounded signed
Circa, public-consensus, and same-book movement shifts. It does not invert the incumbent, impose an
Over quota, or learn an outcome-fitted directional intercept. Missing price consensus fails back
to the existing coherent forecast rather than fabricating a signal.

Historical evaluation uses the checksummed nflverse regular-season file with only pregame total
line and two-sided prices. 2016-2021 describe the fixed residual law, 2022-2023 are repeated
selection diagnostics, and 2024-2025 are repeated confirmation. No 2026 outcome selects a rule.
The candidate has no tunable threshold: its anchor is the two-sided no-vig market probability.

Qualification requires pooled 2024-2025 Brier and absolute calibration-gap improvement over the
incumbent, directional accuracy at least 50%, no confirmation season below 49% directional
accuracy, and no material Total MAE regression. The current exact 16-game wave must contain both
forecast directions after signed evidence, preserve all 16 predictions and prices, and report
every side/grade/actionability change. Every actionable demotion must have a tested eligible
promotion, and the total actionable count may not fall. A one-sided Over replacement, broad
flattening, or direction change unsupported by the coherent shifted PMF rejects the candidate.

## Release and deployment boundary

Any passing behavior change must bump the affected model, calibration, decision, grade, member,
evidence, collector, writer, fixture, snapshot, tracking, and target-exclusion identifiers as
applicable; update `docs/current-model-releases.md`; preserve the existing leased writer and
append-only T-60 records; pass focused tests and `npm run verify:model-change`; and ship only from
a clean current-main-descended PR followed by live release, cron, coverage, and board verification.
Locked historical records are never rewritten.
