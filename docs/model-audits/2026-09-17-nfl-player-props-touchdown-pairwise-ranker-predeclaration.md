# NFL player props touchdown pairwise-ranker predeclaration

Date: 2026-09-17

## Scope

This is a second, bounded scorer-discrimination audit after the September 16 probability-model
challenger was rejected. The active touchdown probability, target-excluded market residual,
team-scoped expected-scorer count, price, EV, grade, stake, lock, tracking, writer, cron, and
`prediction_pipeline:nfl` lease remain authoritative and unchanged. The sole candidate behavior
is which players fill each team's already-determined displayed Yes count.

No member copy, label, filter, or visual change is in scope.

## Frozen hypothesis

A pairwise logistic ranker trained on scorer-versus-nonscorer teammate differences may identify
the correct players more often than sorting by marginal touchdown probability alone. Inputs are
limited to shifted pre-kickoff role evidence: relative and absolute touchdown rate, red-zone and
goal-line opportunity, rushing share, target share, snap share, team scoring expectation, home
status, and position. It cannot use the evaluated game's outcome, sportsbook identity, target-book
price, grade, or actionability.

The team's displayed Yes count remains `round(sum(finalProbability))`; there is no count quota,
multiplier, or outcome-fitted threshold. The ranker cannot change a probability or create a play.

## Chronology and selection

- Pairwise training: regular seasons 2016-2022.
- Regularization selection: 2023 only, using scorer F1 with exactly the incumbent per-team count.
- Confirmation: 2024 and 2025, reported independently.
- External check: Week 1 2026 production-shaped offered-player cohort.

The September 16 audit already exposed aggregate 2025 and Week 1 results. They are therefore
confirmation sets, not newly blind holdouts, and cannot alone authorize production. A candidate
that passes every retrospective set may enter the sole writer as release-stamped shadow telemetry;
member prediction activation still requires genuinely new forward evidence.

## Gates

- The selected ranker must improve true positives and F1 without reducing precision on 2023,
  2024, 2025, and Week 1 2026 at the exact same selected-player count.
- Every active probability, expected team count, exact-price field, grade, action, stake, lock,
  and non-touchdown row must remain identical.
- Missing rank inputs fall back to the incumbent probability ordering.
- Runtime parity, focused tests, model-change verification, full verification, build, protected
  PR, latest-main ancestry, release coherence, and live shadow proof remain mandatory.
- No production activation is permitted from a failed or mixed-direction result.

## Frozen nonlinear addendum

The linear pairwise candidate failed every confirmation set and is rejected. Before running the
next candidate, the bounded family is extended to grouped XGBoost `rank:pairwise` models with tree
depth 2, 3, or 4; 300 estimators; learning rate 0.03; histogram construction; 80% row and feature
subsampling; minimum child weight 20; L1 regularization 0.5; and L2 regularization 10. Depth is
selected on 2023 only. Inputs, team-game grouping, unchanged count/probability contract, chronology,
shadow-only limitation, and every gate above are unchanged.

The pinned XGBoost wheel cannot load because this host has no system OpenMP runtime. No system
package is installed for the audit. Before evaluation, the implementation is therefore frozen to
the repository-supported `HistGradientBoostingClassifier` on the same pairwise-difference rows,
with 7, 15, or 31 leaves; 180 estimators; learning rate 0.04; minimum leaf size 80; and L2
regularization 8. A player's group score is the sum of its predicted pairwise win probabilities
against every teammate. Leaf count is selected on 2023 only; all other contracts are unchanged.
