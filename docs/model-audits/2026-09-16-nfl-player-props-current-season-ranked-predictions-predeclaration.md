# NFL Player Props current-season inputs and ranked predictions predeclaration

Date: 2026-09-16

## Problem and frozen scope

The Week 2 production scorer was still merging the portable model with player/team/opponent rolling state frozen through the end of 2025. Completed 2026 games were not entering the next weekly feature rows. The member prediction resolver also used a per-row 50% classifier. That rule is unsuitable for rare player touchdowns and produced a weak, heavily one-sided set forecast for ordinary props even when the probabilities contained useful rank information.

This candidate is limited to NFL Player Props. It does not change fitted trees, empirical distributions, market-residual coefficients, exact prices, EV, grade thresholds, stakes, actionability, T-60 locking, settlement, tracking eligibility, cron ownership, or the shared `prediction_pipeline:nfl` lease. It adds no member copy or labels.

## Predeclared candidate

1. Fetch only completed prior regular-season weeks from the existing BALLDONTLIE games/stats authority, with four games pages and twenty stats pages as hard ceilings. Persist the compact state only after a coherent candidate has been built.
2. Overlay current-season player usage, team environment, opponent allowance, and touchdown occurrence onto the existing frozen prior before scoring the next week.
3. Treat displayed prediction selection as a ranking problem while preserving every calibrated probability. For each ordinary market, select the highest Over probabilities until the selected count equals the rounded sum of Over probabilities. For each team’s anytime-touchdown catalog, select the highest scorer probabilities until the count equals the rounded expected number of distinct scorers. Remaining outcomes are Under or No TD.
4. Compute both cohorts from the complete unfiltered slate so member filters cannot change a prediction.

The count rule is confined to displayed predictions; it is not a grade/action quota and cannot promote, demote, alter a price, or authorize a bet.

## Acceptance gates

- All 16 completed Week 1 games must be represented, with no partial-final game accepted.
- Focused state, runtime, production-contract, type, and full model-change verification must pass.
- A read-only Week 2 replay must retain the complete slate and show nontrivial Over and scorer cohorts without manufacturing a market.
- Week 1 official-result replay must improve all non-touchdown set accuracy in aggregate versus the incumbent modal classifier. Any individual lane regression and every board-count impact must be reported rather than hidden.
- Latest `origin/main` must remain an ancestor at publication, integration safety must pass, and production must be published only through a protected PR.

## Releases and rollback

Candidate family: model/calibration/decision/runtime/board/member/writer/tracking `r9/r9/r12/r13/r16/r19/r22/r12`, plus current-season state `nfl_player_props_current_season_state_2026_09_16_r1_prior_final_games`.

Rollback is the preceding September 16 injury-pagination family. Disable `NFL_PLAYER_PROPS_ENABLED` to stop new writes while retaining the last coherent snapshot and immutable locked rows.
