# NFL actionable grading completion r6 predeclaration

Date: 2026-08-25

## Objective and unchanged boundaries

Complete the member-facing NFL grade ladder without changing the qualified r10 joint score
distribution, its expected scores, its outcome probabilities, the r6 moneyline side selector,
the single leased forward writer, tracking, or stakes. The candidate may add a relative top tier
inside the already-qualified moneyline lane and may qualify independent Spread and Total
exact-price lanes. Bet count is always an uncapped output. A game, market, or week is never
forced to contain a play.

All decisions retain one coherent tuple: probability, evaluated sportsbook/line/price,
target-book-excluded same-line consensus fair probability, grade, evaluation timestamp, model
release, calibration release, and decision release. Health and data failures remain `Held`, not
`No Play`. The existing T-60 freeze and maximum capture-lag boundary remain unchanged.

## Chronology and evidence status

- 2021–22: fit football and market-residual heads.
- 2023: select architectures, calibrators, exact-price policy, and tier boundaries.
- 2024 and 2025: repeated chronological confirmation, reported separately and pooled.
- 2026: immutable opening/unlocked/T-60/settlement rows remain the true forward holdout.

The 2024–25 seasons have been inspected by prior NFL research and are not represented as pristine.
No closing line, final starter, final injury, target-game result, or post-kick field may enter a
forecast or grade.

## Moneyline Best Angle

Best Angle is a relative evidence tier inside the existing bounded, direction-coherent r6 Lean
lane; it cannot create a new side or turn a non-play into a bet. Retain the previously selected
uncapped 2023 subgroup `exact-price EV >= 2%` and `edge >= 4 percentage points`. The subgroup is
qualified as the product's top tier only if 2024 and 2025 confirmation has:

- at least 24 pooled actions and at least eight in each season;
- positive units in each season and after removing each season's largest win;
- pooled ROI above 2%;
- nonnegative pooled mean normalized CLV and at least 40% positive-CLV frequency;
- no confirmation-season calibration gap above 10 percentage points; and
- week-cluster bootstrap probability of positive pooled units of at least 80%.

These gates define a strong relative tier, not certainty. The 95% ROI interval is reported but is
not required to exclude zero; requiring that from roughly two NFL seasons incorrectly collapses a
useful tier into a claim of statistical certainty. Failure keeps the underlying play as Lean.

## Spread probability and exact-price lane

Use the already frozen r6 comprehensive rolling-market-memory Spread head selected on 2023:
`residual_extra_trees`, beta calibrated on 2023. It previously beat neutral Brier/log loss and
passed ECE and market-tolerance gates in both 2024 and 2025. Its probability correction at the
opening consensus line is transported to an exact target line as a fixed log-odds correction to
the r10 PMF probability at that target line. This preserves r10's exact-line scoring geometry
instead of pretending one probability applies to every spread.

Candidate Lean policies are the Cartesian product of probability floors
`51.5%, 52.5%, 53.5%, 55%, 57.5%`, EV floors `0%, 1%, 2%, 3%`, edge floors
`0pp, 1pp, 2pp, 3pp`, and scoring-cushion floors `0, 0.5, 1`. Prices are bounded to
`-200..+200`, at least two other same-line books are required, the target book is excluded, and
key-number sensitivity adds a 0.5-point cushion requirement. One best exact offer per game is
retained; there is no weekly cap.

## Total probability and exact-price lane

Test a materially different direct score-component residual architecture. At the opening
consensus spread/total, derive market-implied home and away team points. Fit separate home and
away scoring-residual heads using only leakage-free pregame football features and frozen rolling
team total-residual memory, then sum the two predicted components. Frozen candidate families are
ridge, Huber gradient boosting, Extra Trees, and an equal-weight ridge/Extra-Trees ensemble.
Convert the predicted total residual to an Over probability with the empirical 2021–22 residual
law, select and beta-calibrate the architecture on 2023, then transport its opening-line log-odds
correction to each exact target total through the r10 PMF probability.

The Total Lean grid and exact-price requirements equal the Spread grid. Extreme total zones
(`<=41` or `>=50`) add a 0.5-point cushion requirement. This head may qualify independently of
Spread and cannot change the public r10 score projection.

## Action-lane selection and confirmation gates

A 2023 exact-price policy is selection-eligible only with at least 12 actions across at least six
weeks, positive units, positive units after removing its largest win, nonnegative mean CLV,
calibration gap at most 10 percentage points, and at least two sportsbooks. Rank eligible rules by
largest-win-independent units, mean CLV, calibration, then action count and stricter thresholds.

A selected Spread or Total Lean policy qualifies only if 2024–25 confirmation has at least 24
pooled actions and at least eight per season; positive pooled units and largest-win-independent
units; no season below -5% ROI and at least one positive season; pooled calibration gap at most
10pp and no season above 15pp; nonnegative pooled mean CLV; at least two books; and week-cluster
bootstrap probability of positive units at least 65%. A near-boundary Watchlist may be defined
only outside Lean and remains non-actionable.

Best Angle may be tested inside a qualified Spread or Total Lean lane using the same relative-tier
confirmation contract as moneyline. No passing subgroup means no top-tier label for that market.

## Required release evidence

Report 2023 selection and 2024/25 confirmation separately: actions, record, pushes, units, ROI,
CLV, calibration, largest-win independence, weekly-cluster uncertainty, book mix, and grade
counts. Replay the latest authoritative 16-game Week 1 multi-book evidence and report exact
promotions, demotions, prices, board mix, health holds, and release identifiers. Any member
change requires focused tests, `npm run verify:model-change`, production build, diff check,
integration safety on fresh `origin/main`, consolidation review, and post-deploy live proof.
