# NFL player props official-outcome joint model r3 result

Date: 2026-09-28
Production base: `9f7c3300f642b18084f93ca2e852696ef4defbc1`
Predeclaration: `docs/model-audits/2026-09-28-nfl-player-props-joint-model-r3-predeclaration.md`

## Decision

Promote the corrected official-outcome model and the confirmed quarterback joint workload head.
Keep the existing receiving and rushing point-head architectures because their proposed conditional
efficiency replacements did not repeat on the frozen 2024 confirmation season. This is a model and
calibration change only: member copy, labels, layout, canonical-line selection, stakes, provider
cadence, lock/settlement rules and the sole writer remain unchanged.

## Material label defect corrected

The preceding historical builder derived sportsbook passing-attempt outcomes from the nflfastR
play-level `pass_attempt` field. That field is useful for play/dropback analysis but is not the
official box-score passing-attempt label required by a sportsbook prop model. For example, the old
dataset represented Josh Allen's 2025 Week 1 BAL-BUF game as 50 attempts while the official weekly
box score records 46.

The corrected builder uses nflverse weekly player and team statistics for all outcome labels and
team totals, retaining play-by-play only for game identity and schedule. nflverse documents those
weekly statistics as matching official NFL box scores:

- https://nflreadr.nflverse.com/articles/dictionary_player_stats.html
- https://github.com/nflverse/nflreadr/blob/main/R/load_stats.R
- https://github.com/nflverse/nflfastR/blob/master/R/helper_add_nflscrapr_mutations.R

Corrected dataset identity:

- schema: `nfl_player_props_historical_schema_2026_09_28_r3_official_stats`
- dataset: `nfl_player_props_historical_features_2016_2025_2026_09_28_r3_official_stats`
- SHA-256: `6afb497b7a18c1e97a6bf2e9e7ec047c2f3ad5d98640914f70e2b8afdb9cc953`
- 138,860 player-games / 2,639 games / 3,104 players
- outcome-to-roster identity coverage: 99.2584%

## Frozen chronological point evaluation

Training ends in 2022, 2023 selects, 2024 confirms and 2025 is the locked holdout. Every market
selected the HGB point champion on the corrected official labels. Direct-model 2025 holdout error:

| Market | Rows | MAE | RMSE |
| --- | ---: | ---: | ---: |
| Passing attempts | 1,308 | 6.0782 | 9.4508 |
| Passing completions | 1,308 | 4.0234 | 6.2092 |
| Passing yards | 1,308 | 45.7977 | 70.9069 |
| Rushing attempts | 3,423 | 2.2068 | 3.5135 |
| Rushing yards | 3,423 | 12.2131 | 21.0768 |
| Receptions | 5,095 | 1.2106 | 1.7259 |
| Receiving yards | 5,095 | 15.7058 | 23.6538 |

These values replace the prior mislabeled evaluation; they are not blended with an older release.

## Confirmed joint quarterback architecture

The selected quarterback hierarchy predicts attempts first, then conditional completion rate and
yards per attempt. A 75% joint / 25% direct blend won on 2023 and repeated on 2024 for completions
and passing yards.

On the untouched 2025 holdout:

| Market | Direct MAE / RMSE | Joint MAE / RMSE | MAE delta |
| --- | ---: | ---: | ---: |
| Passing completions | 4.0234 / 6.2092 | 4.0102 / 6.1916 | -0.0132 |
| Passing yards | 45.7977 / 70.9069 | 45.0262 / 70.6226 | -0.7715 |

Passing-yards clustered MAE delta is -0.7779 with a 95% game-cluster interval of
[-1.1311, -0.3988]. Passing-yards bias improves from +3.5360 to +1.2420 yards. The joint holdout
contains zero completions-greater-than-attempts rows. The completion improvement interval crosses
zero, so the release claim there is physical coherence plus no material error regression, not a
statistically certain accuracy gain.

Receiving-yards and rushing-yards conditional-efficiency candidates were rejected because the
selected 2023 architecture did not satisfy the 2024 confirmation rule. Their corrected official-
label direct champions remain active; an attractive selection-year result was not promoted.

## Distribution calibration

The joint completion and passing-yard means were recalibrated rather than paired with the old
direct-model residuals. The 2023 residual fit / 2024 selection chose mean-quartile empirical
residual distributions. Locked 2025 evaluation:

| Market | NLL | CRPS | 80% coverage | 90% coverage | PIT KS |
| --- | ---: | ---: | ---: | ---: | ---: |
| Passing completions | 2.3052 | 2.6332 | 80.35% | 90.75% | 0.0506 |
| Passing yards | 4.6940 | 30.0038 | 81.73% | 90.37% | 0.0420 |

The runtime therefore derives point, probability and interval from the same release-specific
center and residual family.

## Market-reading marriage and coherence

For a verified expected starter, the runtime gathers one primary complete quote per independent
book across Passing Attempts, Passing Completions and Passing Yards. It excludes the evaluated
sportsbook from every component. Those target-excluded centers update one latent attempt workload;
completion-rate and yards-per-attempt estimates are smoothly pooled toward official league priors
when the player has little history. The final completions projection is constrained to attempts.

This repairs the reserve-head failure where an expected starter could show roughly 19 attempts and
19 completions. It also allows completions and yards markets to infer plausible workload when an
independent attempt line is temporarily absent. The evaluated price remains downstream for EV and
grade. Cross-line or cross-market evidence cannot bypass the existing independent same-line action
gate.

## Same-slate board and operational impact

The final read-only Week 3 capture is evaluated against the immutable production snapshot and the
immediately preceding workload behavior. It retains all eligible member scopes and tracking rows,
uses zero current-season state calls, and stays inside the unchanged 47-call observed / 51-call
collection ceiling.

- 43,047 normalized observations, 1,986 exact offers, 357 feature rows, 303 score-eligible rows
- 2,131 member rows and 58 tracking rows retained
- full internal board: 27 Best Angles / 38 Leans / 343 Watchlists / 2,696 No Plays / 315 Held
- relative to the preceding workload logic: 12 projection changes, 5 forecast-side changes,
  0 promotions, 0 demotions, 47 to 47 member-canonical actionables
- relative to the live snapshot: 52 matched projection changes, 9 forecast-side changes,
  1 promotion, 2 demotions, 48 to 47 member-canonical actionables
- passing forecast mix remains two-sided: Attempts 16 Over / 18 Under, Completions 12 / 22,
  Passing Yards 37 / 35
- no added provider call, per-card fetch, writer, timer, database query loop or state write

The one-actionable net reduction is paired with a tested promotion and is not a hidden grade or
threshold change. Existing grades are downstream of changed projections; no grade threshold was
tightened and the current board is not flattened.

## Release set and rollback

- portable artifact: `nfl_player_props_runtime_2026_09_28_r5_official_joint_outcomes`
- model / calibration / decision: `nfl_player_props_distribution_model_2026_09_28_r13_official_joint_outcomes` /
  `nfl_player_props_distribution_calibration_2026_09_28_r14_official_joint_outcomes` /
  `nfl_player_props_decision_2026_09_28_r17_official_joint_outcomes`
- runtime / board: `nfl_player_props_runtime_2026_09_28_r18_official_joint_outcomes` /
  `nfl_player_props_board_2026_09_28_r21_official_joint_outcomes`
- member / lifecycle / writer / tracking: `nfl_player_props_member_2026_09_28_r28_official_joint_outcomes` /
  `nfl_player_props_member_lifecycle_2026_09_28_r11_official_joint_outcomes` /
  `nfl_player_props_writer_2026_09_28_r33_official_joint_outcomes` /
  `nfl_player_props_tracking_2026_09_28_r16_official_joint_outcomes`
- QB joint point head: `nfl_player_props_qb_passing_projection_2026_09_28_r4_joint_latent_workload`

Roll back the complete release family together to the September 28 r12/r13/r16/r17/r20/r27/r10/
r32/r15 family while preserving immutable locked and settled evidence. Hold or roll back if a
natural cycle mixes releases, loses eligible scopes, violates completions <= attempts, exceeds the
existing request ceiling, overlaps the sport lease, or fails reader/snapshot coherence.
