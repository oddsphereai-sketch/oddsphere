# NFL player props touchdown-scorer quality predeclaration

Date: 2026-09-16

## Problem and scope

The active anytime-touchdown display cohort identifies 37 of 70 Week 1 scorers from 76
positive forecasts: 48.68% precision and 52.86% scorer recall. That is materially more
predictive than the former 50% binary cutoff, but it is not a sufficient scorer-ranking result.
This audit tests whether the touchdown model and scorer-selection policy can improve scorer
discrimination without manufacturing a fixed number of Yes predictions or hiding No predictions.

Scope is NFL player props, `anytime_td` only. A promoted change may affect the touchdown model,
touchdown calibration, touchdown scorer-selection policy, the shared player-props runtime,
decision, board, member, writer, tracking, and current-model registry. It must not change any
non-touchdown projection, side, probability, grade, action, stake, price, lock, or settlement.
No member-facing explanatory copy or new label is in scope.

## Incumbent and authority

- Touchdown source model / calibration: `nfl_player_props_anytime_td_model_2026_08_25_r3_shared_context`
  / `nfl_player_props_anytime_td_calibration_2026_08_25_r3_shared_context`.
- Shared active model / calibration / decision / runtime:
  `nfl_player_props_distribution_model_2026_09_16_r9_current_season_inputs` /
  `nfl_player_props_distribution_calibration_2026_09_16_r9_ranked_predictions` /
  `nfl_player_props_decision_2026_09_16_r12_ranked_predictions` /
  `nfl_player_props_runtime_2026_09_16_r13_current_season_inputs`.
- Active board / member / writer / tracking:
  `nfl_player_props_board_2026_09_16_r16_ranked_predictions` /
  `nfl_player_props_member_2026_09_16_r19_ranked_predictions` /
  `nfl_player_props_writer_2026_09_16_r22_current_season_inputs` /
  `nfl_player_props_tracking_2026_09_16_r12_current_season_inputs`.
- Current-season state: `nfl_player_props_current_season_state_2026_09_16_r1_prior_final_games`.
- Sole write authority remains the existing scheduled NFL player-props writer under the shared
  `prediction_pipeline:nfl` lease. No new writer, timer, endpoint, or provider call path is allowed.
- Starting production base: `d112f3eba88870d504851d84c45e95fa3cd12782`.

## Frozen hypotheses

The challenger may improve touchdown ranking by testing only pre-kickoff information already
available to the runtime or reproducible historically: prior player touchdown rate, red-zone and
goal-line opportunity, recent rushing/receiving role, snap participation, team scoring
expectation, opponent touchdown allowance, position, home status, current-season prior-final-game
state, and target-book-excluded anytime-touchdown market probability. Market price is evidence,
not an accuracy definition, and cannot be the sole reason for selecting a scorer.

The audit will test:

1. stronger regularized rare-event candidates and bounded tree candidates on the same shifted,
   leak-free features;
2. calibration learned only on a season later than model selection and earlier than holdout;
3. scorer ranking at the team/game level using calibrated expected scorer prevalence, with every
   count arising from probabilities rather than an operator quota; and
4. bounded blends of independent-model and target-excluded market probabilities selected before
   the final holdout is inspected.

The incumbent and all challengers must receive the same eligible player rows. A missing role or
identity input remains an operational data-health exception; it cannot be converted into a model
No prediction to improve metrics.

## Chronology and frozen evaluation

- Train: completed regular seasons 2016-2022.
- Candidate selection: 2023 only.
- Calibration and policy selection: 2024 only.
- Untouched final historical holdout: 2025 only.
- Week 1 2026: external confirmation only, after the candidate and policy are frozen. It cannot
  select features, hyperparameters, blend weights, calibration, or thresholds.
- The live Week 2 board is a no-outcome board-impact and operational-coherence check only.

Evaluation is clustered by game and reports row count, scorer prevalence, Brier score, log loss,
ROC AUC, calibration gap, expected-vs-observed scorer count, precision, recall, F1, and team/game
coverage. Where price history is complete, it also reports target-excluded market comparison and
locked exact-price units/ROI by immutable release. No mixed release is called current performance.

## Promotion gates

A candidate may replace the incumbent only if all of the following hold:

- it improves 2025 holdout Brier score and log loss, does not reduce ROC AUC, and reduces or holds
  calibration gap;
- its frozen scorer cohort improves 2025 scorer F1 and improves at least one of precision or recall
  without a material regression in the other;
- the direction of the scorer-ranking improvement is confirmed on Week 1 2026 after freezing;
- expected and selected scorer counts remain calibrated to natural scorer prevalence, with no
  universal Yes/No bias and no manually imposed board count;
- board impact reports Yes-to-No, No-to-Yes, selected-count, true-positive, false-positive, and
  missed-scorer changes on the identical eligible cohort;
- non-touchdown rows are byte-equivalent for their prediction, probability, projection, grade,
  action, stake, price, and lock fields;
- focused tests, `npm run verify:model-change`, affected full verification, production build, and
  clean latest-main integration safety pass.

If the candidate cannot clear these gates, it remains an audit/shadow artifact and the live
release does not change. A Week 1-only improvement is explicitly insufficient for promotion.

## Operational and rollback contract

The change must reuse cached slate-level context and the existing provider/query/write ceilings.
Failure must preserve the last coherent snapshot. Locked rows remain immutable. A promoted release
gets new immutable touchdown and shared release identifiers and updates
`docs/current-model-releases.md` in the same commit.

Roll back the complete promoted release family to the incumbent identifiers above on mixed release
stamps, reader/writer incoherence, missing eligible players, current-slate scorer-count collapse,
non-touchdown drift, writer or lease failure, or live page failure. Preserve release-stamped rows
as historical evidence rather than rewriting them.
