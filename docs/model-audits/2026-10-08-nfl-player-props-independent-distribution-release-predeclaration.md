# NFL player props independent-distribution release predeclaration

Date: 2026-10-08  
Starting production base: `b44a42d32b51487787b8d92b5cf19bc272e34ec0`  
Status: frozen before candidate implementation

## Objective and scope

The requested outcome is a stronger independent NFL Player Props model live in the member product,
not a research-only artifact. This work may advance the expected-role Passing Attempts point head and
the team-wide Receptions / Receiving Yards allocation heads, together with their matching independent
outcome distributions. All other markets inherit the active production behavior unchanged.

The active production family is the October 7 settlement-aligned Rushing Attempts release recorded in
`docs/current-model-releases.md`: portable/model/calibration/decision/runtime/board/member/lifecycle/
writer/tracking r8/r17/r19/r22/r23/r26/r34/r17/r40/r22. The sole writer and shared
`prediction_pipeline:nfl` lease remain authoritative. Existing locks retain their exact stored payload
and release tuple.

No target prop price, no-vig probability, sportsbook identity, movement, split, spread, or game total
may enter an independent point model or distribution. Historical prop lines are permitted only as
thresholds for evaluating direction and calibration, never as model features or point targets. Exact
current prices remain downstream grade economics.

## Frozen chronology

- The already-generated expected-role projections are the point-model inputs. Their weights were
  selected on 2024 and confirmed on 2025 before the opened 2026 replay.
- Candidate residual distributions are fit from 2024 out-of-sample point errors.
- The 2025 opening-price archive is reduced to one row per official game, player, market, and line.
  Weeks 1-9 fit any probability recalibration; Weeks 10-18 select the frozen family and ensemble
  weight by Brier score, then log loss, calibration gap, and direction.
- After selection, the chosen residual family is refit on 2024-2025 out-of-sample errors and any
  monotone probability calibration is refit on all eligible 2025 threshold rows.
- The exact 207-scope 2026 Weeks 1-4 locked replay is the final evaluation. It has already been opened
  and is reported as such; no result will be called untouched or guaranteed.

## Frozen candidates

For each affected market, compare the foundation distribution with:

1. global empirical residuals;
2. predicted-mean quartile and quintile empirical residuals;
3. position-role empirical residuals with global fallback;
4. position-role plus within-role mean-tertile residuals with role/global fallback;
5. a heteroscedastic empirical family using signed residuals normalized by a robust mean-conditioned
   absolute-error scale; and
6. the appropriate parametric family: Poisson and negative-binomial for counts, or Normal and
   Student-t residuals for yardage.

For threshold probabilities, test frozen independent-only mixtures of foundation and challenger CDFs
at 0%, 25%, 50%, 75%, and 100% challenger weight. Test identity and regularized logistic calibration
of the resulting probability. The logistic fit consumes only the independent probability and outcome;
it cannot see a price, book, consensus probability, movement, or split.

Side selection comes from the final independent threshold probability (`Over` above 50%, otherwise
`Under`), not blindly from point mean versus line. The displayed point and probability must be
coherent under the selected distribution.

## Acceptance gates

An affected head may advance only if:

- its historical point MAE and RMSE retain the already-confirmed 2024 and 2025 improvement;
- its 2025 validation Brier and log loss improve over the foundation, with direction no worse;
- on the exact 2026 replay, point MAE and RMSE do not regress, Brier and log loss do not regress,
  probability-selected direction does not regress, and coverage remains 100%;
- the complete-board point and probability metrics do not regress after unchanged markets are
  inherited exactly;
- a current-board A/B reports every side, promotion, demotion, actionable count, market mix, and
  Over/Under mix; no nonpositive-EV action may be promoted and no hidden board collapse is allowed;
- one coherent release family is stamped through artifact, model, calibration, decision, runtime,
  board, member, lifecycle, writer, and tracking paths; and
- focused tests, `npm run verify:model-change`, integration safety, protected PR checks, and post-deploy
  writer/lease/release/coverage/reader/lock proof all pass.

Passing Attempts, Receptions, and Receiving Yards may advance independently. A failed market inherits
the active production head byte-for-byte; a passing market is not blocked merely because another
market failed. Production publication applies only to future unlocked rows and never rewrites a lock.
